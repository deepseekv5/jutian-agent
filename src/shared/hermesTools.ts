/**
 * Hermes 文本协议工具调用（v13.9.2）
 *
 * 移植自 NousResearch/Hermes-Function-Calling 的提示模板与解析语义（Apache-2.0）。
 *
 * 为什么需要：大量开源/免费小模型（Llama/Qwen 微调系）被 Hermes 格式训练过
 * 工具调用，但不支持 OpenAI 标准 tool_calls API——在标准通道里它们要么忽略
 * 工具要么输出乱码。双协议并行：标准 tool_calls 参数照发，同时把工具 schema
 * 以 <tools> 注入系统提示；模型走哪条通道都能被解析，互不干扰。
 *
 * 格式（Hermes Function Calling v1）：
 *   系统：<tools>[{"type":"function","function":{...}}]</tools>
 *   输出：<tool_call>{"name": "x", "arguments": {...}}</tool_call>
 */

export interface HermesToolDef {
  name: string
  description: string
  parameters: unknown
}

/** 工具 schema → Hermes <tools> 注入块（JSON schema 数组） */
export function buildToolsBlock(tools: HermesToolDef[]): string {
  if (!tools.length) return ''
  const defs = tools.map(t => JSON.stringify({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  })).join('\n')
  return [
    '',
    '# Tools',
    '',
    '你可能需要调用工具来完成任务。可用工具的 JSON Schema 如下（置于 <tools> 标签内）：',
    '',
    '<tools>',
    defs,
    '</tools>',
    '',
    '当需要调用工具时，严格按以下格式输出（每个调用一行，可一次输出多个）：',
    '<tool_call>{"name": "工具名", "arguments": {"参数": "值"}}</tool_call>',
    '在收到工具结果之前不要编造结果；不需要调用工具时直接正常回答。',
    '',
  ].join('\n')
}

export interface ParsedToolCall {
  name: string
  arguments: string
}

/**
 * 从模型回复文本中解析 <tool_call> 调用。
 * - 容忍空白与转义差异；JSON 解析失败的单条跳过（不炸整轮）
 * - name 缺失或非法的跳过
 */
export function parseHermesToolCalls(text: string): ParsedToolCall[] {
  if (!text || !text.includes('<tool_call>')) return []
  const out: ParsedToolCall[] = []
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim()
    // 容错：部分模型会输出带尾逗号/单引号的伪 JSON
    try {
      const parsed = JSON.parse(raw) as { name?: unknown; arguments?: unknown }
      const name = typeof parsed.name === 'string' ? parsed.name : ''
      if (!name) continue
      const args = typeof parsed.arguments === 'string'
        ? parsed.arguments
        : JSON.stringify(parsed.arguments ?? {})
      out.push({ name, arguments: args })
    } catch {
      // 容错二：键没加引号（Hermes 训练数据偶发）——补引号重试一次
      try {
        const fixed = raw.replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3')
        const parsed = JSON.parse(fixed) as { name?: unknown; arguments?: unknown }
        const name = typeof parsed.name === 'string' ? parsed.name : ''
        if (!name) continue
        const args = typeof parsed.arguments === 'string'
          ? parsed.arguments
          : JSON.stringify(parsed.arguments ?? {})
        out.push({ name, arguments: args })
      } catch { /* 单条解析失败，跳过 */ }
    }
  }
  return out
}

/** 去除文本中的工具调用块（解析后正文里不应再显示原始 <tool_call>） */
export function stripToolCallBlocks(text: string): string {
  if (!text || !text.includes('<tool_call>')) return text
  return text.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}
