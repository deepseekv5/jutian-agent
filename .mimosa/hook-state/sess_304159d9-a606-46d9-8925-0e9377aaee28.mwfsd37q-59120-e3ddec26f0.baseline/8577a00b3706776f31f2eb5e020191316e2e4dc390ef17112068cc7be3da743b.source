/**
 * 环境诊断（v12 新功能）
 *
 * 用户报"用不了"时，最耗时的是猜环境问题。这里把可自检项固化：
 * 每项给出 通过/警告/失败 + 具体修复动作，一键复制成报告。
 *
 * 设计原则：只报能确认的事实，不猜测。检测失败的项标注"无法检测"而不是判失败。
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface CheckResult {
  id: string
  name: string
  status: CheckStatus
  /** 一句话结论 */
  message: string
  /** 修复动作（status 非 pass 时尽量给） */
  fix?: string
  /** 原始细节，展开时看 */
  detail?: string
}

export interface DiagnosticReport {
  generatedAt: string
  version: string
  platform: string
  overall: CheckStatus
  results: CheckResult[]
}

const STATUS_WEIGHT: Record<CheckStatus, number> = { fail: 3, warn: 2, skip: 1, pass: 0 }

export function overallStatus(results: CheckResult[]): CheckStatus {
  let worst: CheckStatus = 'pass'
  for (const r of results) if (STATUS_WEIGHT[r.status] > STATUS_WEIGHT[worst]) worst = r.status
  return worst
}

/** 生成 Markdown 报告（用户可直接粘给客服/贴 issue） */
export function reportToMarkdown(rep: DiagnosticReport): string {
  const icon: Record<CheckStatus, string> = { pass: '通过', warn: '警告', fail: '失败', skip: '跳过' }
  const lines: string[] = [
    `# 环境诊断报告`,
    '',
    `- 时间：${rep.generatedAt}`,
    `- 版本：${rep.version}`,
    `- 平台：${rep.platform}`,
    `- 总体：${icon[rep.overall]}`,
    '',
    '## 检查项',
    '',
  ]
  for (const r of rep.results) {
    lines.push(`### ${icon[r.status]} · ${r.name}`)
    lines.push('', r.message)
    if (r.fix) lines.push('', `**建议：** ${r.fix}`)
    if (r.detail) lines.push('', '<details><summary>详情</summary>', '', '```', r.detail.slice(0, 2000), '```', '', '</details>')
    lines.push('')
  }
  return lines.join('\n')
}

/** 纯函数检查：给定输入产出结果，便于单测与复用 */
export function checkApiConfig(s: { apiBaseUrl?: string; apiKey?: string; model?: string }): CheckResult {
  const base = String(s.apiBaseUrl || '').trim()
  const key = String(s.apiKey || '').trim()
  const model = String(s.model || '').trim()
  if (!base) return { id: 'api', name: 'API 配置', status: 'fail', message: '未填写接口地址', fix: '设置 → 模型 → 填入 Base URL（如 https://api.openai.com/v1）' }
  if (!/^https?:\/\//i.test(base)) return { id: 'api', name: 'API 配置', status: 'fail', message: '接口地址必须以 http:// 或 https:// 开头', fix: '检查是否漏了协议头' }
  if (!key) return { id: 'api', name: 'API 配置', status: 'warn', message: '未填写 API Key（免费模型可忽略）', fix: '若要使用付费模型，请填入密钥' }
  if (!model) return { id: 'api', name: 'API 配置', status: 'warn', message: '未选择模型', fix: '设置 → 模型 → 拉取列表后选择一个' }
  return { id: 'api', name: 'API 配置', status: 'pass', message: `已配置：${new URL(base).host}` }
}

export function checkWorkDir(dir: string, exists: boolean): CheckResult {
  if (!dir) return { id: 'workdir', name: '工作目录', status: 'warn', message: '未设置工作目录，文件操作将落在用户主目录', fix: '设置 → 通用 → 选择工作目录' }
  if (!exists) return { id: 'workdir', name: '工作目录', status: 'fail', message: `目录不存在：${dir}`, fix: '重新选择一个存在的目录（可能已被移动或删除）', detail: dir }
  return { id: 'workdir', name: '工作目录', status: 'pass', message: dir }
}

export function checkNodeVersion(v: string): CheckResult {
  const major = Number(String(v || '').replace(/^v/, '').split('.')[0])
  if (!Number.isFinite(major)) return { id: 'node', name: 'Node 版本', status: 'skip', message: '无法获取版本号' }
  if (major < 18) return { id: 'node', name: 'Node 版本', status: 'fail', message: `Node ${v} 过低（需 >= 18）`, fix: '升级 Node.js 到 18 或更高' }
  if (major < 20) return { id: 'node', name: 'Node 版本', status: 'warn', message: `Node ${v} 可用，但建议 >= 20`, detail: v }
  return { id: 'node', name: 'Node 版本', status: 'pass', message: v }
}

export function checkStorage(persistent: boolean): CheckResult {
  return persistent
    ? { id: 'storage', name: '本地存储', status: 'pass', message: '可持久化' }
    : { id: 'storage', name: '本地存储', status: 'warn', message: '存储不可用，界面设置重启后会丢失', fix: '检查是否处于隐私模式或磁盘已满' }
}

export function checkServer(reachable: boolean, version?: string): CheckResult {
  return reachable
    ? { id: 'server', name: '本地服务', status: 'pass', message: `运行中${version ? ' v' + version : ''}` }
    : { id: 'server', name: '本地服务', status: 'fail', message: '无法连接本地服务', fix: '重启应用；若仍失败，查看设置 → 诊断中的日志' }
}

export function buildReport(input: {
  version: string
  platform: string
  results: CheckResult[]
  now?: Date
}): DiagnosticReport {
  return {
    generatedAt: (input.now || new Date()).toISOString().replace('T', ' ').slice(0, 19),
    version: input.version,
    platform: input.platform,
    overall: overallStatus(input.results),
    results: input.results,
  }
}
