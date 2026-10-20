import type { GenerateOptions, SlideSpec, LayoutId, ChartKind } from '../types/ppt'
import { getSettingsSync, effectiveApiKey } from './storage'
import { dateCN } from '../utils/datetime'
import { fetchCompat } from '../api'

/**
 * PPT AI 智能生成：由大模型根据主题产出完整大纲与内容（JSON），
 * 不再依赖固定模板填充。失败时返回 null，由调用方回退到内置模板。
 */

const LAYOUT_RULES = `可用的版式 layout 取值（必须严格使用以下值）：
- cover: 封面（title, subtitle, eyebrow, background: "gradient"）
- agenda: 目录（title, bullets[3~5]）
- bullets: 要点页（title, bullets[3~5]，每条一句话干货）
- stats: 数据页（title, stats[3]: {value, label}，value 要具体）
- compare: 对比页（title, columns[2]: {title, items[2~3]}）
- timeline: 时间线（title, steps[3~4]: {title, desc}）
- twoColumn: 双栏（title, columns[2]: {title, items[3]}）
- imageText: 图文页（title, bullets[3]）
- quote: 金句页（quote: {text, author}）
- closing: 结尾页（title, subtitle, background: "deep"）
- table: 数据表格（title, table: {headers:[3~4 个列名], rows:[[每列一个单元格], ...2~5 行]}）
- chart: 图表分析（title, chart: {kind:"bar"|"line"|"pie"|"doughnut"|"area"|"radar", categories:[3~6 个分类名], series:[{name, values:[与 categories 等长的数字]}]}）
- gallery: 多图展示（title, images:[{caption}, {caption}, {caption}]，3 张）`

function buildPrompt(opts: GenerateOptions): string {
  const count = opts.depth === 'brief' ? 5 : opts.depth === 'detailed' ? 10 : 7
  return `你是一份顶级咨询公司风格的 PPT 策划师。请围绕主题《${opts.topic}》策划一份 ${count} 页的演示文稿大纲。

要求：
1. 内容必须紧扣主题、有真实信息量的具体内容（数字、案例、结论），禁止"待补充""示例"等占位文本
2. 第 1 页必须是 cover，最后 1 页必须是 closing，第 2 页通常是 agenda
3. 中间页面根据内容逻辑自由选择最合适的版式，版式要有变化不要连续重复
4. 每条 bullet 控制在 25 字以内，stats 的 value 简短（如 "98%"、"3倍"、"+120万"）
5. 只输出一个 JSON 数组，不要任何解释、注释或 markdown 代码块标记

${LAYOUT_RULES}

输出格式示例：
[{"layout":"cover","title":"...","subtitle":"...","eyebrow":"...","background":"gradient"},
 {"layout":"bullets","title":"...","bullets":["...","...","..."]}]`
}

/** 模型返回的原始 slide JSON：字段全部可选且类型不定，逐字段校验后收敛为 SlideSpec */
interface RawSlide {
  layout?: unknown
  title?: unknown
  subtitle?: unknown
  eyebrow?: unknown
  bullets?: unknown
  stats?: unknown
  columns?: unknown
  steps?: unknown
  table?: unknown
  chart?: unknown
  images?: unknown
  quote?: unknown
}

function sanitizeSpecs(raw: unknown, opts: GenerateOptions): SlideSpec[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null
  const VALID = new Set(['cover', 'agenda', 'bullets', 'stats', 'compare', 'timeline', 'twoColumn', 'imageText', 'quote', 'closing', 'table', 'chart', 'gallery'])
  const specs: SlideSpec[] = []
  for (const item of raw as RawSlide[]) {
    if (!item || typeof item !== 'object') continue
    const layout = String(item.layout || '')
    if (!VALID.has(layout)) continue
    const spec: SlideSpec = { layout: layout as LayoutId }
    if (typeof item.title === 'string' && item.title.trim()) spec.title = item.title.trim().slice(0, 40)
    if (typeof item.subtitle === 'string') spec.subtitle = item.subtitle.trim().slice(0, 60)
    if (typeof item.eyebrow === 'string') spec.eyebrow = item.eyebrow.trim().slice(0, 20)
    if (Array.isArray(item.bullets)) spec.bullets = (item.bullets as unknown[]).filter((b): b is string => typeof b === 'string').slice(0, 6).map(b => b.trim().slice(0, 60))
    if (Array.isArray(item.stats)) spec.stats = (item.stats as unknown[])
      .filter((s): s is { value: string; label: string } => !!s && typeof (s as { value?: unknown }).value === 'string' && typeof (s as { label?: unknown }).label === 'string')
      .slice(0, 4).map(s => ({ value: s.value.trim().slice(0, 12), label: s.label.trim().slice(0, 16) }))
    if (Array.isArray(item.columns)) spec.columns = (item.columns as unknown[])
      .filter((cc): cc is { title: string; items: unknown[] } => !!cc && typeof (cc as { title?: unknown }).title === 'string' && Array.isArray((cc as { items?: unknown }).items))
      .slice(0, 2).map(cc => ({ title: cc.title.trim().slice(0, 20), items: cc.items.filter((x): x is string => typeof x === 'string').slice(0, 4).map(x => x.trim().slice(0, 40)) }))
    if (Array.isArray(item.steps)) spec.steps = (item.steps as unknown[])
      .filter((st): st is { title: string; desc?: unknown } => !!st && typeof (st as { title?: unknown }).title === 'string')
      .slice(0, 5).map(st => ({ title: st.title.trim().slice(0, 20), desc: typeof st.desc === 'string' ? st.desc.trim().slice(0, 40) : undefined }))
    // 表格
    const table = item.table as { headers?: unknown; rows?: unknown } | null
    if (table && Array.isArray(table.headers) && Array.isArray(table.rows)) {
      const headers = (table.headers as unknown[]).filter((h): h is string => typeof h === 'string').slice(0, 6).map(h => h.trim().slice(0, 20))
      const rows = (table.rows as unknown[]).filter((r): r is unknown[] => Array.isArray(r)).slice(0, 8)
        .map(r => r.slice(0, 6).map(cell => String(cell ?? '').trim().slice(0, 30)))
      if (headers.length && rows.length) spec.table = { headers, rows }
    }
    // 图表
    const chart = item.chart as { kind?: unknown; categories?: unknown; series?: unknown } | null
    if (chart && Array.isArray(chart.categories) && Array.isArray(chart.series)) {
      const KINDS = new Set(['bar', 'line', 'pie', 'doughnut', 'area', 'radar'])
      const rawKind = String(chart.kind || 'bar')
      const kind = (KINDS.has(rawKind) ? rawKind : 'bar') as ChartKind
      const categories = (chart.categories as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 8).map(c => c.trim().slice(0, 16))
      const series = (chart.series as unknown[])
        .filter((s): s is { name?: unknown; values: unknown[] } => { const o = s as { values?: unknown } | null; return !!o && Array.isArray(o.values) })
        .slice(0, 4)
        .map(s => ({
          name: String(s.name || '数值').trim().slice(0, 16),
          values: s.values.slice(0, 8).map(v => (typeof v === 'number' && isFinite(v) ? v : parseFloat(String(v).replace(/[^\d.-]/g, '')) || 0)),
        }))
      if (categories.length && series.length) spec.chart = { kind, categories, series }
    }
    // 多图
    if (Array.isArray(item.images)) {
      const imgs = (item.images as Array<{ caption?: unknown } | null>).slice(0, 3)
        .map(im => ({ caption: typeof im?.caption === 'string' ? im.caption.trim().slice(0, 24) : undefined }))
      if (imgs.length) spec.images = imgs
    }
    const quote = item.quote as { text?: unknown; author?: unknown } | null
    if (quote && typeof quote.text === 'string') spec.quote = { text: quote.text.trim().slice(0, 60), author: typeof quote.author === 'string' ? quote.author.trim().slice(0, 16) : 'AI' }
    if (layout === 'cover') { spec.background = 'gradient'; if (!spec.subtitle) spec.subtitle = dateCN() }
    if (layout === 'closing') { spec.background = 'deep' }
    // 基本校验：每个版式的必需字段
    const need: Record<string, string> = { cover: 'title', agenda: 'bullets', bullets: 'bullets', stats: 'stats', compare: 'columns', timeline: 'steps', twoColumn: 'columns', imageText: 'bullets', quote: 'quote', closing: 'title', table: 'table', chart: 'chart', gallery: 'images' }
    const required = need[layout]
    if (required === 'title' && !spec.title) continue
    if (required === 'bullets' && (!spec.bullets || spec.bullets.length === 0)) continue
    if (required === 'stats' && (!spec.stats || spec.stats.length === 0)) continue
    if (required === 'columns' && (!spec.columns || spec.columns.length === 0)) continue
    if (required === 'steps' && (!spec.steps || spec.steps.length === 0)) continue
    if (required === 'quote' && !spec.quote) continue
    if (required === 'table' && !spec.table) continue
    if (required === 'chart' && !spec.chart) continue
    if (required === 'images' && (!spec.images || spec.images.length === 0)) continue
    specs.push(spec)
  }
  // cover/closing 兜底补齐
  if (specs.length < 3) return null
  if (specs[0].layout !== 'cover') {
    specs.unshift({ layout: 'cover', title: opts.topic, subtitle: dateCN(), eyebrow: 'AI 生成', background: 'gradient' } as SlideSpec)
  }
  if (specs[specs.length - 1].layout !== 'closing') {
    specs.push({ layout: 'closing', title: '感谢聆听', subtitle: 'Q & A', background: 'deep' } as SlideSpec)
  }
  return specs
}

export async function aiGenerateSlides(opts: GenerateOptions): Promise<SlideSpec[] | null> {
  const settings = getSettingsSync()
  if (!settings.apiBaseUrl || !settings.apiKey) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90000)
    const res = await fetchCompat('/api/llm-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Target-Base': settings.apiBaseUrl,
        'X-Api-Key': effectiveApiKey(settings.apiKey),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: buildPrompt(opts) }],
        max_tokens: 12000,
        temperature: 0.7,
        stream: false,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    const msg = data.choices?.[0]?.message || {}
    // 推理模型常把正文放 content、思考放 reasoning_content；content 为空时回退后者
    let text = String(msg.content || msg.reasoning_content || '')
    if (!text.trim()) return null
    // 剥掉可能的 markdown 代码块
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end === -1 || end <= start) return null
    const json = JSON.parse(text.slice(start, end + 1))
    return sanitizeSpecs(json, opts)
  } catch {
    return null
  }
}
