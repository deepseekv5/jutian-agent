/**
 * 工作流引擎（v14.1）
 *
 * 定时任务解决的是「什么时候跑」，工作流解决的是「按什么顺序跑、上一步的结果
 * 怎么给下一步用」。两者组合起来才是真正的自动化：
 *
 *   每天 9 点 → 抓取昨天的提交 → 总结成周报 → 写进知识库
 *
 * 一个工作流 = 若干步骤，步骤要么调模型（prompt），要么调工具（tool）。
 * 步骤之间用占位符传值：
 *
 *   {{input.KEY}}        用户运行时填的输入
 *   {{step.ID.output}}   某一步的输出（prompt 步骤=模型文本，tool 步骤=工具输出）
 *   {{prev.output}}      上一步的输出
 *
 * 纯函数、无依赖：解析 / 校验 / 渲染都在这里，执行在服务端。
 */

export type StepType = 'prompt' | 'tool'

export interface WorkflowInput {
  key: string
  label: string
  required?: boolean
  /** 输入框占位提示 */
  placeholder?: string
  default?: string
}

export interface WorkflowStep {
  id: string
  type: StepType
  title: string
  /** type=prompt：给模型的指令（可含占位符） */
  prompt?: string
  /** type=tool：工具名 */
  tool?: string
  /** type=tool：参数 JSON（字符串形式，值里可含占位符） */
  args?: string
  /** 单步超时（秒），默认 prompt 120 / tool 180 */
  timeoutSec?: number
  /** 出错是否继续（默认 false = 中止后续步骤） */
  continueOnError?: boolean
}

export interface Workflow {
  id: string
  name: string
  description?: string
  inputs: WorkflowInput[]
  steps: WorkflowStep[]
  createdAt?: string
  lastRun?: string
  lastStatus?: string
  lastSummary?: string
}

export interface StepResult {
  id: string
  title: string
  type: StepType
  status: 'done' | 'error' | 'skipped'
  output: string
  error?: string
  ms?: number
}

/* ─── 校验 ─── */

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/

/** 返回中文错误（可直接展示给用户），合法返回 null */
export function validateWorkflow(wf: Partial<Workflow>): string | null {
  const name = String(wf.name || '').trim()
  if (!name) return '工作流名称不能为空'
  const steps = Array.isArray(wf.steps) ? wf.steps : []
  if (steps.length === 0) return '至少需要一个步骤'
  if (steps.length > 20) return '步骤过多（最多 20 步）'

  const seen = new Set<string>()
  for (const [i, s] of steps.entries()) {
    const id = String(s.id || '').trim()
    if (!id) return `第 ${i + 1} 步缺少 id`
    if (!ID_RE.test(id)) return `第 ${i + 1} 步的 id「${id}」不合法（字母开头，只含字母数字 _ -）`
    if (seen.has(id)) return `步骤 id 重复：${id}`
    seen.add(id)
    if (s.type !== 'prompt' && s.type !== 'tool') return `第 ${i + 1} 步类型不合法`
    if (s.type === 'prompt' && !String(s.prompt || '').trim()) return `第 ${i + 1} 步（${id}）缺少提示词`
    if (s.type === 'tool') {
      if (!String(s.tool || '').trim()) return `第 ${i + 1} 步（${id}）缺少工具名`
      const err = validateArgsJson(String(s.args || '{}'))
      if (err) return `第 ${i + 1} 步（${id}）的参数 JSON ${err}`
    }
  }

  const inputs = Array.isArray(wf.inputs) ? wf.inputs : []
  const inputKeys = new Set<string>()
  for (const [i, inp] of inputs.entries()) {
    const k = String(inp.key || '').trim()
    if (!k) return `第 ${i + 1} 个输入缺少 key`
    if (!ID_RE.test(k)) return `输入 key「${k}」不合法（字母开头，只含字母数字 _ -）`
    if (inputKeys.has(k)) return `输入 key 重复：${k}`
    inputKeys.add(k)
  }
  return null
}

function validateArgsJson(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  // 允许占位符出现在字符串值里，但整体必须是对象字面量（占位符可能整段替换成数字/字符串，
  // 所以只做宽松检查：去掉占位符后仍须能解析，或者以 { 开头 } 结尾）
  if (!s.startsWith('{') || !s.endsWith('}')) return '必须是对象（{ ... }）'
  const stripped = s.replace(/\{\{[^}]+\}\}/g, '0')
  try {
    const v = JSON.parse(stripped)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return '必须是对象（{ ... }）'
  } catch (e) {
    return '无法解析：' + (e as Error).message
  }
  return null
}

/* ─── 渲染 ─── */

export interface RenderContext {
  inputs: Record<string, string>
  /** stepId → 输出文本 */
  steps: Record<string, string>
  /** 上一步输出 */
  prev?: string
}

const PLACEHOLDER = /\{\{\s*(input|step|prev)(?:\.([a-zA-Z0-9_-]+))?(?:\.output)?\s*\}\}/g

/**
 * 替换占位符。找不到的值替换成空串（并在调用方能看到 warnings），
 * 而不是留下原始占位符——留着会让模型把 `{{input.x}}` 当正文输出。
 */
export function renderTemplate(text: string, ctx: RenderContext): { text: string; warnings: string[] } {
  const warnings: string[] = []
  const out = String(text ?? '').replace(PLACEHOLDER, (_m, scope: string, key?: string) => {
    if (scope === 'input') {
      if (!key) return ''
      const v = ctx.inputs[key]
      if (v === undefined || v === '') { warnings.push(`输入 ${key} 为空`); return '' }
      return v
    }
    if (scope === 'prev') return ctx.prev ?? ''
    if (scope === 'step') {
      if (!key) return ''
      const v = ctx.steps[key]
      if (v === undefined) { warnings.push(`步骤 ${key} 尚无输出`); return '' }
      return v
    }
    return ''
  })
  return { text: out, warnings }
}

/**
 * 渲染工具参数（v14.1）
 *
 * 关键：**先解析 JSON，再在字符串叶子节点里替换占位符**。
 * 早期实现是「先替换整段文本、再 JSON.parse」——上一步的输出常含换行与引号，
 * 直接塞进 JSON 字符串字面量会把 JSON 撑破（实测：system_info 的输出写入文件时
 * 报 Bad control character）。在叶子节点替换就天然安全，不需要转义。
 *
 * 另外：整串只有一个占位符时保留原始类型（数字/布尔），便于 `{"n": {{input.count}}}` 写法。
 */
export function renderToolArgs(raw: string, ctx: RenderContext): { args?: Record<string, unknown>; error?: string; warnings: string[] } {
  const warnings: string[] = []
  const src = String(raw || '{}').trim() || '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(src)
  } catch (e) {
    return { error: '参数 JSON 解析失败：' + (e as Error).message, warnings }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: '参数必须是对象（{ ... }）', warnings }
  }

  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = renderTemplate(v, ctx)
      warnings.push(...r.warnings)
      const onlyPlaceholder = /^\{\{\s*[^}]+\}\}$/.test(v.trim())
      if (onlyPlaceholder) {
        const t = r.text.trim()
        if (t === 'true') return true
        if (t === 'false') return false
        if (t !== '' && !Number.isNaN(Number(t))) return Number(t)
      }
      return r.text
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val)
      return o
    }
    return v
  }

  return { args: walk(parsed) as Record<string, unknown>, warnings }
}

/** 运行时输入整理：补默认值、检查必填 */
export function collectInputs(wf: Workflow, provided: Record<string, unknown>): { values: Record<string, string>; error?: string } {
  const values: Record<string, string> = {}
  for (const inp of wf.inputs || []) {
    const raw = provided[inp.key]
    const v = raw === undefined || raw === null ? '' : String(raw)
    if (!v && inp.default) { values[inp.key] = String(inp.default); continue }
    if (!v && inp.required) return { values, error: `缺少必填输入：${inp.label || inp.key}` }
    values[inp.key] = v
  }
  return { values }
}

/** 执行摘要（面板与通知共用，避免两处格式不一致） */
export function summarizeRun(results: StepResult[]): string {
  const done = results.filter(r => r.status === 'done').length
  const failed = results.filter(r => r.status === 'error').length
  const skipped = results.filter(r => r.status === 'skipped').length
  const ms = results.reduce((a, r) => a + (r.ms || 0), 0)
  return `${done} 成功${failed ? ` / ${failed} 失败` : ''}${skipped ? ` / ${skipped} 跳过` : ''} · ${(ms / 1000).toFixed(1)}s`
}
