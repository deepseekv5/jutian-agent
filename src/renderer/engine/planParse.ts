// 从模型自由文本中解析出结构化计划，渲染成可交互的"计划确认卡片"。
// 近似解析而非严格 JSON：模型给计划的格式不一，宁可宽松提取也不要整块丢失。
// 无法解析出任何步骤时返回 null，由界面退回纯文本渲染。

export interface ParsedPlanStep {
  title: string
}

export interface ParsedPlan {
  steps: ParsedPlanStep[]
}

const HEADING = /计划|plan/i

function stripDecorators(line: string): string {
  // 先去掉 **/**，否则列表标记剥离会把 `**` 当作无序列表符号吃掉，留下悬挂的 `*`
  return line
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)、．]|[一二三四五六七八九十]+[、.．])\s*/, '')
    .trim()
    .slice(0, 300)                 // 先截断，避免超长项被长度判定直接丢弃
}

/**
 * 从文本里提取计划步骤。识别两种常见结构：
 *  1) 有序/无序列表项（含 1. 2. 3. / - / 一、二、）
 *  2) "步骤 N" / "第 N 步" 前缀行
 * 其余叙述性文字忽略。至少提取到 1 条才返回计划。
 */
export function parsePlanFromText(text: string): ParsedPlan | null {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  const steps: ParsedPlanStep[] = []
  const seen = new Set<string>()

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // 列表项
    const listMatch = line.match(/^(?:[-*+•]|\d+[.)、．]|[一二三四五六七八九十]+[、.．])\s*(.+)$/)
    // 步骤前缀
    const stepMatch = line.match(/^(?:步骤|第)\s*[\d一二三四五六七八九十]+\s*(?:步)?[:：、.．]?\s*(.+)$/i)

    const candidate = listMatch?.[1] ?? stepMatch?.[1]
    if (!candidate) continue

    const title = stripDecorators(candidate)
    if (!title || title.length < 2 || title.length > 300) continue
    if (seen.has(title.toLowerCase())) continue
    seen.add(title.toLowerCase())
    steps.push({ title })
  }

  if (steps.length === 0) return null
  // 只有一条且不像标题/计划的（例如一个普通列表），仍返回——由调用方决定是否用
  return { steps }
}

/** 判断一段文本是否像是在陈述计划（用于自动弹出确认卡片的启发式）。 */
export function looksLikePlan(text: string): boolean {
  if (!text) return false
  const head = text.slice(0, 400)
  return HEADING.test(head) && (parsePlanFromText(text)?.steps.length ?? 0) >= 1
}
