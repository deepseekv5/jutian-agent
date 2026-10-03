/**
 * computerAgent.ts — Computer Use 代理循环
 *
 * 循环：截屏 → 模型观察并给出 JSON 指令 → 执行 → 再截屏验证，直到 done 或步数上限。
 * 协议（模型输出，严格 JSON）：
 *   { "thought": "简短思考", "action": {"type":"click","x":123,"y":456, ...}, "status": "continue" | "done" | "stuck", "summary": "给用户的一句话" }
 * 动作类型：click / double_click / right_click / type / key / scroll / drag / wait
 * 设计要点：
 *  - 每步都把「最新截图」作为 image_url 传给模型（多模态）
 *  - 历史只保留动作摘要（省 token），截图只传最新一张
 *  - 任何一步可被用户中断（AbortController）
 */
import { streamChat } from './stream'
import type { Settings } from '../types'

export interface CuAction {
  type: 'click' | 'double_click' | 'right_click' | 'type' | 'key' | 'scroll' | 'drag' | 'wait'
  x?: number; y?: number
  fromX?: number; fromY?: number; toX?: number; toY?: number
  text?: string; key?: string; direction?: 'up' | 'down'; amount?: number; ms?: number
  button?: 'left' | 'right'
}
export interface CuStep {
  thought: string
  action?: CuAction
  status: 'continue' | 'done' | 'stuck'
  summary?: string
}
export interface CuExecResult { ok: boolean; err?: string; at?: { x: number; y: number } }

/** 动作的人类可读描述（步骤列表展示用） */
export function describeAction(a: CuAction): string {
  switch (a.type) {
    case 'click': return `点击 (${Math.round(a.x ?? 0)}, ${Math.round(a.y ?? 0)})`
    case 'double_click': return `双击 (${Math.round(a.x ?? 0)}, ${Math.round(a.y ?? 0)})`
    case 'right_click': return `右键 (${Math.round(a.x ?? 0)}, ${Math.round(a.y ?? 0)})`
    case 'type': return `键入「${String(a.text || '').slice(0, 24)}${(a.text || '').length > 24 ? '…' : ''}」`
    case 'key': return `按键 ${a.key}`
    case 'scroll': return `滚动${a.direction === 'up' ? '上' : '下'} ${a.amount || 3}`
    case 'drag': return `拖拽 (${Math.round(a.fromX ?? 0)},${Math.round(a.fromY ?? 0)}) → (${Math.round(a.toX ?? 0)},${Math.round(a.toY ?? 0)})`
    case 'wait': return `等待 ${a.ms || 500}ms`
    default: return a.type
  }
}

/** electronAPI 桥（由 preload 暴露） */
function cu() {
  return (window as any).electronAPI
}

/** 截屏：返回 dataURL（JPEG）。purpose: agent=1600px 供模型观察；preview=900px 供监视预览 */
export async function captureScreen(displayId?: number | string, purpose: 'agent' | 'preview' = 'agent'): Promise<{ dataUrl: string; display: { w: number; h: number } } | { error: string }> {
  const r = await cu().cuCapture(displayId, purpose)
  if (!r || !r.ok) return { error: r?.error || '截屏失败' }
  return { dataUrl: r.dataUrl, display: { w: r.display.w, h: r.display.h } }
}

/** 执行动作（wait 也在渲染层处理，不占用主进程） */
export async function execAction(a: CuAction): Promise<CuExecResult> {
  if (a.type === 'wait') {
    await new Promise(r => setTimeout(r, Math.min(3000, Math.max(100, a.ms || 500))))
    return { ok: true }
  }
  const map: Record<string, CuAction['type']> = {
    double_click: 'click', right_click: 'click',
  }
  const payload: any = { ...a }
  if (map[a.type]) { payload.type = 'click'; payload.double = a.type === 'double_click'; payload.button = a.type === 'right_click' ? 'right' : 'left' }
  const r = await cu().cuAction(payload)
  return { ok: !!r?.ok, err: r?.err || undefined, at: r?.at }
}

/** 系统提示词：定义观察-行动协议 */
function systemPrompt(screenW: number, screenH: number): string {
  return `你是「巨天agent」的 Computer Use 引擎，通过截图观察屏幕并输出一个动作来推进用户目标。

【输出协议 — 严格 JSON，禁止多余文字】
{"thought":"简短观察与下一步理由(30字内)","action":{"type":"..."},"status":"continue"|"done"|"stuck","summary":"完成或卡住时给用户的一句话"}

【动作类型】
- {"type":"click","x":数字,"y":数字} / double_click / right_click（坐标为屏幕逻辑坐标，屏幕 ${screenW}x${screenH}）
- {"type":"type","text":"要输入的文本"}（先确保焦点在输入框）
- {"type":"key","key":"enter|tab|esc|space|up|down|left|right|delete|cmd+a|cmd+c|cmd+v|cmd+w|cmd+q"}
- {"type":"scroll","direction":"down"|"up","amount":3}
- {"type":"drag","fromX":数字,"fromY":数字,"toX":数字,"toY":数字}
- {"type":"wait","ms":800}（页面加载时用）

【规则】
1. 每次只输出一个动作，执行后会给你新截图。
2. 点击前先在截图里找到目标元素的确切位置；小图标点中心。
3. 输入文本前，先点击输入框获得焦点。
4. 目标已完成时输出 status=done 并在 summary 里说明结果；重复尝试同一动作两次仍失败输出 stuck。
5. 不要猜测截图里没有的内容；看不清就放大目标区域附近点击或滚动后再看。`
}

/** 从模型输出中提取 JSON（容忍 ```json 包裹） */
function parseStep(text: string): CuStep | null {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const j = JSON.parse(t.slice(start, end + 1))
    return {
      thought: String(j.thought || ''),
      action: j.action && j.action.type ? j.action : undefined,
      status: ['done', 'stuck'].includes(j.status) ? j.status : 'continue',
      summary: String(j.summary || ''),
    }
  } catch { return null }
}

export interface RunOptions {
  goal: string
  settings: Settings
  signal: AbortSignal
  maxSteps?: number
  /** 逐步确认模式：每个动作执行前暂停，等用户放行（对标 Claude Computer Use 的安全设计） */
  confirmEach?: boolean
  onStep: (step: CuStep, shot?: string) => void
  onShot: (dataUrl: string) => void
  onExec: (action: CuAction, result: CuExecResult) => void
  /** 确认模式回调：返回 Promise，用户点「继续」时 resolve(true)、点「停止」resolve(false) */
  onConfirm?: (action: CuAction) => Promise<boolean>
}

/** 运行代理循环；resolve 于循环结束（done/stuck/中断/步数用尽） */
export async function runComputerAgent(opts: RunOptions): Promise<{ steps: CuStep[]; finalShot?: string }> {
  const maxSteps = opts.maxSteps ?? 14
  const steps: CuStep[] = []
  const history: { role: string; content: string }[] = []
  let finalShot: string | undefined

  for (let i = 0; i < maxSteps; i++) {
    if (opts.signal.aborted) break
    const stepT0 = Date.now()
    // 1) 观察
    const shot = await captureScreen(undefined, 'agent')
    if ('error' in shot) throw new Error(shot.error)
    finalShot = shot.dataUrl
    opts.onShot(shot.dataUrl)

    // 2) 决策
    let out = ''
    const msgs: any[] = [
      { role: 'system', content: systemPrompt(shot.display.w, shot.display.h) },
      { role: 'user', content: `用户目标：${opts.goal}` },
      ...history,
      {
        role: 'user',
        content: [
          { type: 'text', text: history.length ? '这是执行上一动作后的最新截图，请继续。' : '这是当前屏幕截图，请开始。' },
          { type: 'image_url', image_url: { url: shot.dataUrl } },
        ],
      },
    ]
    await streamChat(
      opts.settings,
      msgs,
      { onChunk: d => { out += d }, onToolStart: () => {}, onToolEnd: () => {}, onDone: () => {}, onError: e => { out = '' } },
      opts.signal,
    )
    const step = parseStep(out)
    if (!step) {
      // 模型没按协议输出：重试一次
      history.push({ role: 'user', content: '你上一次的输出不是合法 JSON。请只输出协议要求的 JSON 对象。' })
      continue
    }
    steps.push(step)
    opts.onStep(step, shot.dataUrl)

    // 3) 收尾判断
    if (step.status !== 'continue' || !step.action) {
      if (step.status === 'continue' && !step.action) break
      break
    }

    // 4) 执行（确认模式下先等用户放行）
    if (opts.confirmEach && opts.onConfirm) {
      const go = await opts.onConfirm(step.action)
      if (!go || opts.signal.aborted) break
    }
    const result = await execAction(step.action)
    opts.onExec(step.action, result)
    history.push({ role: 'assistant', content: JSON.stringify(step) })
    history.push({ role: 'user', content: `动作执行${result.ok ? '成功' : '失败：' + (result.err || '未知原因')}。` })
    if (!result.ok && step.action.type === 'click' && i > 4) continue
  }
  return { steps, finalShot }
}
