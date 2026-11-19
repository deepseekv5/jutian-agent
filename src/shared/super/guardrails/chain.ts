/**
 * 护栏链（Guardrail Chain）——超级内核 D 模块之一。
 *
 * 提供四道检查，全部是"机器可判定、可解释、可注册"的规则：
 *   checkTool()   工具调用前：危险工具 / 危险参数检测（rm -rf、删库、系统命令、付费、网络发送…）
 *   checkOutput() 输出后：密钥泄露、注入痕迹、超长截断建议
 *   checkLoop()   循环检测：连续相同工具调用（基于 toolFingerprint 思路）
 *   checkBudget() token 预算超限分级警告
 *
 * 设计要点：
 *   1. 规则是数据（GuardrailRule），不是写死的 if；通过 addRule 可扩展，内置 30+ 条。
 *   2. 每条规则有 id / 说明 / 严重度 / 匹配器，命中即返回带 reason 的结果，可解释。
 *   3. 中英文双语模式库：同一风险同时覆盖英文命令与中文口语（"删库跑路"、"转账"等）。
 *   4. 检测的是"文本模式"，不存在误判为零容忍——危险用 block，可疑用 warn，由上层决定。
 *
 * 契约来源：types.ts 的 GuardrailChain / GuardrailResult，LoopToolCall 来自 agentLoop。
 */

import type { GuardrailChain, GuardrailResult } from '../types'
import type { LoopToolCall } from '../../agentLoop'

/* ════════════════════════════════════════════════════════════════════════════
 * 第 0 节：通用辅助
 * ════════════════════════════════════════════════════════════════════════════ */

type Severity = 'warn' | 'block'

/** 规整化为小写并压缩空白（命令模式匹配用）。 */
function normText(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 判断值是否"看起来像JSON字符串"并尽量解析为对象；失败返回原样字符串。 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch { /* 不是 JSON，按普通字符串处理 */ }
  }
  return {}
}

/** 把任意参数对象扁平化为一个可扫描的文本（递归拼接 key/value）。 */
export function flattenArgs(args: Record<string, unknown>, depth = 0): string {
  if (depth > 5) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(args || {})) {
    parts.push(k)
    if (typeof v === 'string') parts.push(v)
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(String(v))
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string') parts.push(item)
        else if (item && typeof item === 'object') parts.push(flattenArgs(asRecord(item), depth + 1))
      }
    } else if (v && typeof v === 'object') {
      parts.push(flattenArgs(asRecord(v), depth + 1))
    }
  }
  return parts.join(' ')
}

/** 把 tool_calls 参数（可能是字符串 JSON）统一解析。 */
function toolCallArgs(tc: LoopToolCall): Record<string, unknown> {
  return asRecord(tc.arguments)
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 1 节：规则模型与匹配器
 *
 * GuardrailRule 是统一抽象：
 *   scope   —— 作用于哪道检查（tool / output / loop / budget / all）
 *   severity—— 命中后的严重度
 *   test    —— 判定函数，返回命中详情（可解释）
 * 内置规则全部由 make*Rule 工厂生成，便于 addRule 注册自定义规则。
 * ════════════════════════════════════════════════════════════════════════════ */

export type RuleScope = 'tool' | 'output' | 'loop' | 'budget' | 'all'

/** 规则的匹配上下文：不同 scope 填充不同字段。 */
export interface RuleContext {
  // tool
  toolName?: string
  args?: Record<string, unknown>
  argsText?: string
  // output
  text?: string
  // loop
  recentCalls?: LoopToolCall[]
  // budget
  currentTokens?: number
  limit?: number
  // 通用：配置（由链实例注入）
  config?: GuardrailConfig
}

/** 规则命中详情。 */
export interface RuleHit {
  hit: boolean
  reason?: string
}

export interface GuardrailRule {
  id: string
  description: string
  scope: RuleScope
  severity: Severity
  test(ctx: RuleContext): RuleHit | boolean
}

/** 从 test 返回值统一抽取命中与原因。 */
function toHit(result: RuleHit | boolean, rule: GuardrailRule): RuleHit {
  if (typeof result === 'boolean') {
    return result ? { hit: true, reason: `命中规则 ${rule.id}：${rule.description}` } : { hit: false }
  }
  if (result.hit && !result.reason) {
    return { hit: true, reason: `命中规则 ${rule.id}：${rule.description}` }
  }
  return result
}

/* ── 工厂：基于"包含任一模式"的文本规则 ───────────────────────────────── */

interface PatternRuleSpec {
  id: string
  description: string
  scope: RuleScope
  severity: Severity
  /** 待扫描的文本字段 */
  field: 'toolName' | 'argsText' | 'text' | 'allText'
  patterns: Array<string | RegExp>
  /** 自定义命中原因 */
  reason?: string
}

function patternMatches(text: string, patterns: Array<string | RegExp>): string | null {
  // 压缩空白用于字符串包含匹配；正则用原始文本（保留大小写，模式自带 i 标志时忽略大小写）。
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim()
  const lower = compact.toLowerCase()
  for (const p of patterns) {
    if (p instanceof RegExp) {
      // 全局/粘滞标志会导致 lastIndex 状态问题，统一用非 g 副本测试。
      const safe = new RegExp(p.source, p.flags.replace(/[gy]/g, ''))
      // 先按原文测（保留大小写），再按小写测（兼容无 i 标志但模式用小写书写的规则）。
      if (safe.test(compact) || safe.test(lower)) return safe.source
    } else if (lower.includes(normText(p))) {
      return p
    }
  }
  return null
}

function makePatternRule(spec: PatternRuleSpec): GuardrailRule {
  return {
    id: spec.id,
    description: spec.description,
    scope: spec.scope,
    severity: spec.severity,
    test(ctx: RuleContext): RuleHit {
      let text = ''
      if (spec.field === 'toolName') text = ctx.toolName || ''
      else if (spec.field === 'argsText') text = ctx.argsText || ''
      else if (spec.field === 'text') text = ctx.text || ''
      else text = [ctx.toolName, ctx.argsText, ctx.text].filter(Boolean).join(' ')
      const matched = patternMatches(text, spec.patterns)
      if (matched == null) return { hit: false }
      return {
        hit: true,
        reason: spec.reason || `命中规则 ${spec.id}（${spec.description}）：检测到「${matched}」`,
      }
    },
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 2 节：内置规则库（30+ 条）
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * 危险工具调用规则。分组：
 *   A. 工具名本身危险（shell / execute / sudo / payment / email …）—— block
 *   B. 命令内容危险（rm -rf / 删库 / DROP TABLE / format…）—— block
 *   C. 危险参数（ recursive=true + force / 写入系统路径 / 无确认发送）—— block/warn
 *   D. 系统级破坏（shutdown / chmod 777 / 修改 hosts / 内核参数）—— block
 *   E. 付费/网络外发（purchase / 转账 / curl 外传 / webhook）—— warn/block
 */
const TOOL_RULES: GuardrailRule[] = [
  // ── A 组：危险工具名（直接 block）────────────────────────────────────
  makePatternRule({
    id: 'tool.shell_exec', description: '通用 shell/命令执行工具', scope: 'tool', severity: 'block', field: 'toolName',
    patterns: [/^shell$/, /^bash$/, /^sh$/, /^cmd$/, /^powershell$/, /execute_command/, /run_command/, /命令执行/],
    reason: '工具本身可执行任意系统命令，需人工确认后放行',
  }),
  makePatternRule({
    id: 'tool.sudo', description: '提权执行工具', scope: 'tool', severity: 'block', field: 'toolName',
    patterns: [/sudo/, /root_shell/, /提权/],
  }),
  makePatternRule({
    id: 'tool.payment', description: '支付/转账工具', scope: 'tool', severity: 'block', field: 'toolName',
    patterns: [/pay/, /payment/, /purchase/, /transfer/, /转账/, /付款/, /支付/, /购买/],
    reason: '涉及资金流动，必须由用户明确确认',
  }),
  makePatternRule({
    id: 'tool.email_send', description: '邮件/消息外发工具', scope: 'tool', severity: 'block', field: 'toolName',
    patterns: [/send_email/, /send_mail/, /smtp/, /send_message/, /发邮件/, /发送消息/],
  }),
  makePatternRule({
    id: 'tool.network', description: '通用网络请求工具', scope: 'tool', severity: 'warn', field: 'toolName',
    patterns: [/^http/, /^curl/, /^wget/, /webhook/, /网络请求/],
    reason: '网络工具可能外发数据，请确认目标可信',
  }),

  // ── B 组：危险命令内容（block）────────────────────────────────────────
  makePatternRule({
    id: 'cmd.rm_rf', description: '递归强制删除 rm -rf', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/, /rm\s+-rf/, /del\s+\/f\s+\/s/, /递归强制删除/, /强制删除目录/],
    reason: '递归强制删除不可逆， block',
  }),
  makePatternRule({
    id: 'cmd.rm_root', description: '删除根目录或系统关键路径', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/rm\s+.*\s\/\s*$/, /rm\s+-rf\s+\//, /删除根目录/, /删根目录/],
  }),
  makePatternRule({
    id: 'cmd.drop_db', description: '删库/删表', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/drop\s+(database|table|schema)/i, /truncate\s+table/, /删库/, /删表/, /删除数据库/, /清空数据库/],
    reason: '破坏数据库结构，几乎不可恢复',
  }),
  makePatternRule({
    id: 'cmd.format_disk', description: '格式化磁盘', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/mkfs\./, /format\s+[a-z]:/i, /diskpart/i, /格式化磁盘/, /格式化硬盘/],
  }),
  makePatternRule({
    id: 'cmd.dd_disk', description: 'dd 覆盖磁盘', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/\bdd\s+if=/, /of=\/dev\//, /写穿磁盘/],
  }),
  makePatternRule({
    id: 'cmd.shutdown', description: '关机/重启系统', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/\bshutdown\b/, /\breboot\b/, /\bhalt\b/, /关机/, /重启系统/, /重新启动计算机/],
  }),
  makePatternRule({
    id: 'cmd.kill_all', description: '批量杀进程', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/kill\s+-9\s+-1/, /pkill\s+-9/, /taskkill\s+\/f\s+\/im\s+\*/, /杀掉所有进程/, /结束所有进程/],
  }),
  makePatternRule({
    id: 'cmd.chmod_777', description: '危险权限提升', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/chmod\s+-r\s+777/, /chmod\s+777\s+\//, /icacls.*\/grant.*everyone/i, /开放全部权限/],
  }),
  makePatternRule({
    id: 'cmd.system_file', description: '修改系统关键文件', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/\/etc\/(passwd|shadow|hosts|sudoers)/, /c:\\windows\\system32/i, /修改系统文件/, /篡改hosts/],
  }),
  makePatternRule({
    id: 'cmd.git_push_force', description: '强制推送覆盖远程', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/git\s+push\s+.*--force/, /git\s+push\s+-f\b/, /强推/, /强制推送/],
    reason: '强制推送会覆盖远程历史，请确认',
  }),
  makePatternRule({
    id: 'cmd.git_reset_hard', description: '硬重置丢弃改动', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/git\s+reset\s+--hard/, /硬重置/, /丢弃所有修改/],
  }),
  makePatternRule({
    id: 'cmd.eval_exec', description: '动态执行任意代码', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/\beval\s*\(/, /\bexec\s*\(/, /os\.system/, /subprocess\.(call|run|Popen)/, /动态执行代码/],
    reason: '动态执行来源不明的代码有注入风险',
  }),
  makePatternRule({
    id: 'cmd.curl_pipe_sh', description: '下载即执行（curl|sh）', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/curl[^\n]*\|\s*(ba)?sh/, /wget[^\n]*\|\s*(ba)?sh/, /下载并直接执行/],
    reason: '远程脚本未经审查直接执行极度危险',
  }),
  makePatternRule({
    id: 'cmd.base64_decode_exec', description: '混淆解码后执行', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/base64[^\n]*-d[^\n]*\|\s*(ba)?sh/, /decode[^\n]*exec/, /解码后执行/],
  }),

  // ── C 组：危险参数组合（block/warn）───────────────────────────────────
  {
    id: 'param.recursive_force', description: 'recursive+force 组合删除', scope: 'tool', severity: 'block',
    test(ctx: RuleContext): RuleHit {
      const a = ctx.args || {}
      // 常见键名：recursive / force / r / f
      const recursive = a.recursive === true || a.force === true && a.recursive !== false
        || a.r === true || (typeof a.flags === 'string' && /r/.test(a.flags) && /f/.test(a.flags))
      const destructive = a.force === true || a.f === true
        || (typeof a.flags === 'string' && /f/.test(a.flags))
      if (recursive && destructive) {
        return { hit: true, reason: `参数含递归+强制组合（recursive/force），可能导致不可逆删除（工具 ${ctx.toolName || '?'}）` }
      }
      return { hit: false }
    },
  },
  {
    id: 'param.no_confirm_send', description: '外发操作缺少确认标志', scope: 'tool', severity: 'warn',
    test(ctx: RuleContext): RuleHit {
      const name = normText(ctx.toolName)
      if (!/send|mail|transfer|pay|upload|分享|发送|上传/.test(name)) return { hit: false }
      const a = ctx.args || {}
      const hasConfirm = a.confirmed === true || a.confirm === true || a.dryRun === true || a.dry_run === true
      if (!hasConfirm) return { hit: true, reason: `外发工具 ${ctx.toolName} 未显式设置 confirmed/dryRun，建议先预览再发送` }
      return { hit: false }
    },
  },
  makePatternRule({
    id: 'param.system_path', description: '写入系统路径', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/\/etc\//, /\/usr\/(bin|sbin|lib)/, /c:\\windows\\/i, /system32/i, /写入系统目录/],
  }),
  makePatternRule({
    id: 'param.env_secrets', description: '读取环境变量中的凭据', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/env\.(api_key|secret|token|password)/i, /process\.env\.[a-z_]*(key|secret|token|pass)/i, /读取环境变量密钥/],
    reason: '读取环境变量中的凭据可能泄露密钥',
  }),

  // ── D 组：网络外发 / 数据外泄（warn）──────────────────────────────────
  makePatternRule({
    id: 'net.exfil_domain', description: '向可疑域名外发数据', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/curl[^\n]*-d\s/, /--data-binary/, /POST[^\n]*http/i, /webhook\.site/, /requestbin/, /外发数据/],
    reason: '检测到向外部端点发送数据，请确认数据不含敏感信息',
  }),
  makePatternRule({
    id: 'net.dns_exfil', description: 'DNS 隧道外泄', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/nslookup[^\n]*\$\(/, /dig[^\n]*\$\(/, /dns.*exfil/i, /dns外泄/],
  }),

  // ── E 组：补充危险模式（扩大中英文覆盖面）───────────────────────────────
  makePatternRule({
    id: 'cmd.git_clean_fd', description: '强制清理未跟踪文件', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/git\s+clean\s+-(f)?d(f|x)/, /git\s+clean\s+-fd/, /清理未跟踪文件/],
    reason: 'git clean -fd 会删除未跟踪文件，可能丢失用户数据',
  }),
  makePatternRule({
    id: 'cmd.registry_edit', description: '修改系统注册表', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/reg\s+delete\s+hklm/i, /reg\s+add\s+hklm/i, /修改注册表/, /删除注册表项/],
  }),
  makePatternRule({
    id: 'cmd.cron_modify', description: '修改系统定时任务', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/crontab\s+-r/, /\/etc\/cron\./, /删除所有定时任务/, /systemd.*disable/i],
  }),
  makePatternRule({
    id: 'cmd.user_modify', description: '增删系统用户', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/userdel\b/, /useradd\b/, /net\s+user\s+\S+\s+\/delete/i, /删除用户账户/, /新建系统用户/],
  }),
  makePatternRule({
    id: 'cmd.db_bulk_delete', description: '数据库批量删除', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/delete\s+from\s+\w+\s+where\s+1\s*=\s*1/i, /delete\s+from\s+\w+\s*;?\s*$/i, /批量删除数据/, /清空表数据/],
  }),
  makePatternRule({
    id: 'cmd.privilege_escalate', description: '权限提升/绕过', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/--no-sandbox/, /setuid\(0\)/, /bypass.*permission/i, /绕过权限/, /提权执行/],
  }),
  makePatternRule({
    id: 'cmd.overwrite_important', description: '覆盖重要文件', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/> \/etc\//, /\bcp\b.*\/etc\//, /mv\s+\S+\s+\/etc\//, /覆盖配置文件/],
    reason: '覆盖系统配置可能导致服务不可用，请确认已备份',
  }),
  makePatternRule({
    id: 'net.reverse_shell', description: '反弹 Shell', scope: 'tool', severity: 'block', field: 'argsText',
    patterns: [/nc\s+-[elvp]/, /bash\s+-i\s*>&\s*\/dev\/tcp/, /reverse.?shell/i, /反弹.?shell/, /反向连接/],
    reason: '检测到反弹 Shell 连接模式，属于高危行为',
  }),
  makePatternRule({
    id: 'net.upload_secret', description: '上传敏感文件到外部', scope: 'tool', severity: 'warn', field: 'argsText',
    patterns: [/curl[^\n]*(@|-F)[^\n]*(\.env|credentials|id_rsa|\.ssh)/i, /upload[^\n]*(\.env|\.ssh|private)/i, /上传密钥/],
  }),
]

/** 输出检查规则：密钥泄露 / 注入 / 超长。 */
const OUTPUT_RULES: GuardrailRule[] = [
  // ── 密钥泄露 ────────────────────────────────────────────────────────────
  makePatternRule({
    id: 'secret.openai_key', description: 'OpenAI 风格密钥 sk-…', scope: 'output', severity: 'block', field: 'text',
    patterns: [/\bsk-[a-z0-9]{16,}\b/i, /\bsk-[a-z0-9]{8,}-[a-z0-9-]{8,}/i],
    reason: '输出包含 sk- 开头的 API 密钥，必须脱敏后再展示',
  }),
  makePatternRule({
    id: 'secret.aws_key', description: 'AWS Access Key', scope: 'output', severity: 'block', field: 'text',
    patterns: [/\bAKIA[0-9A-Z]{16}\b/, /\bASIA[0-9A-Z]{16}\b/],
  }),
  makePatternRule({
    id: 'secret.api_key_assignment', description: 'api_key/token 赋值', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/api[_-]?key\s*[:=]\s*['"]?[a-z0-9_-]{12,}/i, /secret[_-]?key\s*[:=]/i, /access[_-]?token\s*[:=]/i, /api密钥\s*[:：]/],
    reason: '输出疑似包含 key/token 赋值，建议脱敏',
  }),
  makePatternRule({
    id: 'secret.bearer_token', description: 'Bearer Token', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/bearer\s+[a-z0-9._-]{20,}/i, /authorization\s*[:=]/i, /持有者令牌/],
  }),
  makePatternRule({
    id: 'secret.private_key', description: '私钥 PEM 头', scope: 'output', severity: 'block', field: 'text',
    patterns: [/-----begin\s+(rsa|ec|dsa|openssh|pgp)?\s*private key-----/i, /私钥内容/],
  }),
  makePatternRule({
    id: 'secret.jwt', description: 'JWT 令牌', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/\beyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i],
  }),
  makePatternRule({
    id: 'secret.password', description: '明文密码', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/password\s*[:=]\s*['"]?[^\s'"]{6,}/i, /密码\s*[:：]\s*\S{6,}/],
  }),
  makePatternRule({
    id: 'secret.github_token', description: 'GitHub Token', scope: 'output', severity: 'block', field: 'text',
    patterns: [/\bghp_[a-z0-9]{30,}\b/i, /\bgho_[a-z0-9]{30,}\b/i, /\bghs_[a-z0-9]{30,}\b/i, /\bgithub_pat_[a-z0-9_]{40,}\b/i],
  }),

  // ── 注入检测 ────────────────────────────────────────────────────────────
  makePatternRule({
    id: 'inject.prompt_override', description: '提示词覆盖注入', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/ignore\s+(all\s+)?previous\s+instructions/i, /disregard\s+(all\s+)?(prior|above)/i, /忽略(之前|以上|前面)的?(所有|全部)?指令/],
    reason: '输出包含提示词覆盖语句，疑似注入攻击',
  }),
  makePatternRule({
    id: 'inject.system_tag', description: '伪造 system 通道', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/<\|\s*system\s*\|>/i, /<system\s*>/i, /\[\[system\]\]/i, /伪造系统消息/],
  }),
  makePatternRule({
    id: 'inject.role_spoof', description: '伪造角色标签', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/\bassistant\s*[:：]\s*(ignore|system|override)/i, /\bsystem\s*[:：]\s*(you are|new instructions)/i],
  }),
  makePatternRule({
    id: 'inject.jailbreak', description: '越狱引导词', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/dan\s+mode/i, /developer\s+mode/i, /越狱模式/, /开发者模式\s*开启/, /假装你是(一个)?没有限制/],
  }),

  // ── 个人信息（PII）泄露 ──────────────────────────────────────────────────
  makePatternRule({
    id: 'pii.chinese_id', description: '中国身份证号码', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/\b[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/],
    reason: '输出疑似包含身份证号码，建议脱敏',
  }),
  makePatternRule({
    id: 'pii.phone_cn', description: '中国手机号', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/(?<!\d)1[3-9]\d{9}(?!\d)/],
    reason: '输出疑似包含手机号，建议脱敏',
  }),
  makePatternRule({
    id: 'pii.bank_card', description: '银行卡号（16-19 位）', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/(?<!\d)\d{16,19}(?!\d)/],
    reason: '输出疑似包含银行卡号，建议脱敏',
  }),
  makePatternRule({
    id: 'pii.email', description: '邮箱地址', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
    reason: '输出包含邮箱地址，若非用户要求请确认是否脱敏',
  }),
  makePatternRule({
    id: 'pii.address', description: '详细住址', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/住址\s*[:：]\s*\S{6,}/, /详细地址\s*[:：]/, /家庭住址/],
  }),

  // ── 恶意代码/命令输出 ────────────────────────────────────────────────────
  makePatternRule({
    id: 'output.malicious_script', description: '输出含危险脚本片段', scope: 'output', severity: 'warn', field: 'text',
    patterns: [/rm\s+-rf\s+\//, /curl[^\n]*\|\s*(ba)?sh/, /eval\s*\(\s*(atob|decode)/, /<script[^>]*>\s*alert\(/i],
    reason: '输出包含可执行危险片段，展示前请人工确认',
  }),

  // ── 超长截断建议（由单独规则处理，见 OUTPUT_LENGTH_RULE）─────────────────
]

/** 长度规则单独定义（需要读 config.outputMaxChars）。 */
const OUTPUT_LENGTH_RULE: GuardrailRule = {
  id: 'output.too_long', description: '输出超长建议截断', scope: 'output', severity: 'warn',
  test(ctx: RuleContext): RuleHit {
    const text = ctx.text || ''
    const max = ctx.config?.outputMaxChars ?? 40_000
    if (text.length <= max) return { hit: false }
    return {
      hit: true,
      reason: `输出 ${text.length} 字符超过建议上限 ${max}，建议截断/摘要化或分段展示（保留前 ${Math.floor(max * 0.3)} 与末尾 ${Math.floor(max * 0.7)} 字符）`,
    }
  },
}

/** 循环检测规则（基于 toolFingerprint 思路，见第 3 节详述）。 */
const LOOP_RULES: GuardrailRule[] = [
  {
    id: 'loop.identical_calls', description: '连续相同工具调用', scope: 'loop', severity: 'warn',
    test(ctx: RuleContext): RuleHit {
      const calls = ctx.recentCalls || []
      const threshold = ctx.config?.loopIdenticalThreshold ?? 3
      if (calls.length < threshold) return { hit: false }
      // 只看最近 threshold 次是否完全相同（按指纹）。
      const tail = calls.slice(-threshold)
      const fps = tail.map(toolFingerprint)
      if (fps.every((f) => f === fps[0])) {
        return {
          hit: true,
          reason: `最近 ${threshold} 次工具调用完全相同（${tail[tail.length - 1].name}），疑似死循环；建议改变策略或参数`,
        }
      }
      return { hit: false }
    },
  },
  {
    id: 'loop.same_tool_many', description: '同一工具高频调用', scope: 'loop', severity: 'warn',
    test(ctx: RuleContext): RuleHit {
      const calls = ctx.recentCalls || []
      const threshold = ctx.config?.loopToolFrequencyThreshold ?? 6
      if (calls.length < threshold) return { hit: false }
      // 统计最近 N 次里出现次数最多的工具。
      const counts = new Map<string, number>()
      for (const c of calls) counts.set(c.name, (counts.get(c.name) || 0) + 1)
      let topName = ''
      let topCount = 0
      for (const [name, n] of counts) if (n > topCount) { topName = name; topCount = n }
      if (topCount >= threshold) {
        return { hit: true, reason: `工具 ${topName} 高频调用：在最近 ${calls.length} 次调用中占 ${topCount} 次，可能陷入重复试探` }
      }
      return { hit: false }
    },
  },
]

/** 预算检查规则（分级警告，见第 4 节详述）。 */
const BUDGET_RULES: GuardrailRule[] = [
  {
    id: 'budget.soft_limit', description: 'token 预算软警告（80%）', scope: 'budget', severity: 'warn',
    test(ctx: RuleContext): RuleHit {
      const cur = ctx.currentTokens || 0
      const lim = ctx.limit || 0
      if (lim <= 0) return { hit: false }
      const ratio = cur / lim
      const soft = ctx.config?.budgetSoftRatio ?? 0.8
      if (ratio >= soft && ratio < 1) {
        return { hit: true, reason: `token 用量 ${cur}/${lim}（${Math.round(ratio * 100)}%）已达软上限，建议开始裁剪历史或降低输出长度` }
      }
      return { hit: false }
    },
  },
  {
    id: 'budget.hard_limit', description: 'token 预算硬超限', scope: 'budget', severity: 'block',
    test(ctx: RuleContext): RuleHit {
      const cur = ctx.currentTokens || 0
      const lim = ctx.limit || 0
      if (lim <= 0) return { hit: false }
      if (cur > lim) {
        return { hit: true, reason: `token 用量 ${cur} 已超过硬上限 ${lim}，必须裁剪历史后才能继续` }
      }
      return { hit: false }
    },
  },
  {
    id: 'budget.critical', description: 'token 预算严重超限（>120%）', scope: 'budget', severity: 'block',
    test(ctx: RuleContext): RuleHit {
      const cur = ctx.currentTokens || 0
      const lim = ctx.limit || 0
      if (lim <= 0) return { hit: false }
      const critical = ctx.config?.budgetCriticalRatio ?? 1.2
      if (cur / lim >= critical) {
        return { hit: true, reason: `token 用量 ${cur} 超过上限 ${lim} 的 ${Math.round(critical * 100)}%，需立即压缩上下文` }
      }
      return { hit: false }
    },
  },
]

/* ════════════════════════════════════════════════════════════════════════════
 * 第 3 节：工具指纹（toolFingerprint）
 *
 * 目标：把一次工具调用规范化为可比较的字符串，用于"连续相同调用"检测。
 * 做法：工具名 + 参数按 key 排序后的稳定 JSON 串（忽略参数顺序差异、忽略易变字段）。
 * 忽略字段：timestamp / requestId / nonce 等每次都变但与语义无关。
 * ════════════════════════════════════════════════════════════════════════════ */

const FINGERPRINT_IGNORE_KEYS = new Set([
  'timestamp', 'time', 'requestId', 'request_id', 'id', 'nonce', 'uuid',
  'traceId', 'trace_id', 'started_at', 'callId', 'call_id',
])

/** 稳定序列化：对象 key 排序，忽略易变字段，数组保序。 */
function stableStringify(value: unknown, depth = 0): string {
  if (depth > 8) return '"…"'
  if (value == null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v, depth + 1)).join(',') + ']'
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter((k) => !FINGERPRINT_IGNORE_KEYS.has(k)).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k], depth + 1)).join(',') + '}'
  }
  return JSON.stringify(String(value))
}

/** 计算一次工具调用的指纹（导出供测试/复用）。 */
export function toolFingerprint(tc: LoopToolCall): string {
  const args = toolCallArgs(tc)
  return `${normText(tc.name)}|${stableStringify(args)}`
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 4 节：GuardrailChainImpl 与工厂
 * ════════════════════════════════════════════════════════════════════════════ */

export interface GuardrailConfig {
  /** 输出长度建议上限（字符）。 */
  outputMaxChars: number
  /** 连续相同调用达到几次触发循环警告。 */
  loopIdenticalThreshold: number
  /** 同一工具高频阈值。 */
  loopToolFrequencyThreshold: number
  /** 预算软上限比例。 */
  budgetSoftRatio: number
  /** 预算严重超限比例。 */
  budgetCriticalRatio: number
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  outputMaxChars: 40_000,
  loopIdenticalThreshold: 3,
  loopToolFrequencyThreshold: 6,
  budgetSoftRatio: 0.8,
  budgetCriticalRatio: 1.2,
}

/** 合并命中结果：block 优先于 warn；同一级别取首个（或拼接）原因。 */
function combineResults(hits: Array<{ rule: GuardrailRule; hit: RuleHit }>): GuardrailResult {
  if (hits.length === 0) return { allowed: true }
  // 只要有 block 就是 block。
  const blocking = hits.filter((h) => h.rule.severity === 'block')
  const severity: Severity = blocking.length > 0 ? 'block' : 'warn'
  // allowed：warn 仍放行（上层可自行升级），block 拒绝。
  const allowed = severity !== 'block'
  const reasons = hits
    .filter((h) => (severity === 'block' ? h.rule.severity === 'block' : h.rule.severity === 'warn'))
    .map((h) => h.hit.reason)
    .filter(Boolean) as string[]
  const reason = reasons.length === 1
    ? reasons[0]
    : reasons.join('；')
  return { allowed, reason, severity }
}

/**
 * 护栏链实现。持有一份规则表与配置；所有 check* 方法无副作用，可并发调用。
 * 通过 addRule 注册自定义规则（scope 决定它参与哪道检查）。
 */
export class GuardrailChainImpl implements GuardrailChain {
  private readonly rules: GuardrailRule[] = []
  private readonly config: GuardrailConfig

  constructor(config: Partial<GuardrailConfig> = {}, opts: { includeBuiltins?: boolean } = {}) {
    this.config = { ...DEFAULT_GUARDRAIL_CONFIG, ...config }
    if (opts.includeBuiltins !== false) {
      this.rules.push(...TOOL_RULES, ...OUTPUT_RULES, OUTPUT_LENGTH_RULE, ...LOOP_RULES, ...BUDGET_RULES)
    }
  }

  /** 注册自定义规则。返回 this 便于链式调用。 */
  addRule(rule: GuardrailRule): this {
    // id 冲突时后者覆盖前者（便于禁用/替换内置规则）。
    const idx = this.rules.findIndex((r) => r.id === rule.id)
    if (idx >= 0) this.rules[idx] = rule
    else this.rules.push(rule)
    return this
  }

  /** 移除规则（按 id）。返回是否移除成功。 */
  removeRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id)
    if (idx < 0) return false
    this.rules.splice(idx, 1)
    return true
  }

  /** 当前规则数量（诊断用）。 */
  get ruleCount(): number {
    return this.rules.length
  }

  /** 当前配置（诊断/测试用，返回副本避免被外部修改）。 */
  getConfig(): GuardrailConfig {
    return { ...this.config }
  }

  /** 导出当前规则清单（id / 说明 / scope / 严重度），供诊断面板展示。 */
  listRules(): Array<{ id: string; description: string; scope: RuleScope; severity: Severity }> {
    return this.rules.map((r) => ({ id: r.id, description: r.description, scope: r.scope, severity: r.severity }))
  }

  /** 统计各 scope 的规则数量。 */
  ruleCountByScope(): Record<RuleScope, number> {
    const out: Record<RuleScope, number> = { tool: 0, output: 0, loop: 0, budget: 0, all: 0 }
    for (const r of this.rules) out[r.scope] += 1
    return out
  }

  /** 批量检查：依次跑四道检查，汇总所有命中（用于一次性审计一段交互）。 */
  audit(args: {
    toolName?: string
    toolArgs?: Record<string, unknown>
    output?: string
    recentCalls?: LoopToolCall[]
    currentTokens?: number
    limit?: number
  }): Array<{ scope: RuleScope; result: GuardrailResult }> {
    const out: Array<{ scope: RuleScope; result: GuardrailResult }> = []
    if (args.toolName != null) {
      out.push({ scope: 'tool', result: this.checkTool(args.toolName, args.toolArgs || {}) })
    }
    if (args.output != null) {
      out.push({ scope: 'output', result: this.checkOutput(args.output) })
    }
    if (args.recentCalls != null) {
      out.push({ scope: 'loop', result: this.checkLoop(args.recentCalls) })
    }
    if (args.currentTokens != null && args.limit != null) {
      out.push({ scope: 'budget', result: this.checkBudget(args.currentTokens, args.limit) })
    }
    return out
  }

  /** 运行某一 scope 的规则集。 */
  private runScope(scope: Exclude<RuleScope, 'all'>, ctx: RuleContext): GuardrailResult {
    const withConfig: RuleContext = { ...ctx, config: this.config }
    const hits: Array<{ rule: GuardrailRule; hit: RuleHit }> = []
    for (const rule of this.rules) {
      if (rule.scope !== scope && rule.scope !== 'all') continue
      let result: RuleHit
      try {
        result = toHit(rule.test(withConfig), rule)
      } catch (err) {
        // 单条规则异常不应拖垮整条链：记为 warn。
        result = { hit: true, reason: `规则 ${rule.id} 执行异常：${err instanceof Error ? err.message : String(err)}` }
        hits.push({ rule: { ...rule, severity: 'warn' }, hit: result })
        continue
      }
      if (result.hit) hits.push({ rule, hit: result })
    }
    return combineResults(hits)
  }

  checkTool(name: string, args: Record<string, unknown>): GuardrailResult {
    const argsText = flattenArgs(args)
    return this.runScope('tool', { toolName: name, args, argsText })
  }

  checkOutput(text: string): GuardrailResult {
    return this.runScope('output', { text })
  }

  checkLoop(recentCalls: LoopToolCall[]): GuardrailResult {
    return this.runScope('loop', { recentCalls })
  }

  checkBudget(currentTokens: number, limit: number): GuardrailResult {
    return this.runScope('budget', { currentTokens, limit })
  }
}

/** 工厂函数：创建带全部内置规则的护栏链。 */
export function createGuardrails(config?: Partial<GuardrailConfig>): GuardrailChainImpl {
  return new GuardrailChainImpl(config)
}

/** 导出内置规则数量（测试断言"30+ 条"时使用）。 */
export function builtinRuleCount(): number {
  return TOOL_RULES.length + OUTPUT_RULES.length + 1 /* OUTPUT_LENGTH_RULE */
    + LOOP_RULES.length + BUDGET_RULES.length
}
