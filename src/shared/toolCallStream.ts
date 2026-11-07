/**
 * 工具调用的流式累积
 *
 * 上游按 chunk 增量下发 tool_call：首块给 id 与函数名，后续块只补 arguments。
 * 不同 provider 行为有差异，这里统一收敛：
 *
 *  - **id / name 只取首次出现的值**。OpenAI 语义里 id 与 name 是整值而非增量，
 *    但部分兼容网关会在多个 chunk 里重复下发同一个 id；若按增量拼接会得到
 *    `call_abc123call_abc123`，后续 tool result 的 tool_call_id 匹配不上，
 *    模型会认为工具没执行过 —— 表现为反复调用同一工具或声称"没有结果"。
 *  - **arguments 是真增量**，必须逐块拼接（这是流式的意义所在）。
 *  - **index 缺省按 0 处理**，且按 index 分槽，支持并行多工具调用。
 */

/** SSE delta 里解析出的原始 tool_call 片段（不同模型字段不全） */
export interface RawToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** 累积中的工具调用槽位 */
export interface ToolCallAccum {
  id: string
  name: string
  arguments: string
}

/**
 * 解析 SSE chunk 中的 delta，兼容不同模型的 tool_calls 格式。
 *
 * OpenAI 格式：delta.tool_calls[{index, id, function: {name, arguments}}]
 * 兼容：某些模型用 delta.function_call（单函数、无 index）
 */
export function parseToolCallsFromDelta(delta: unknown): RawToolCallDelta[] | null {
  const d = delta as {
    tool_calls?: unknown
    function_call?: { id?: string; name?: string; arguments?: string }
  } | null | undefined

  if (d?.tool_calls && Array.isArray(d.tool_calls)) {
    return d.tool_calls as RawToolCallDelta[]
  }
  if (d?.function_call) {
    return [{ index: 0, id: d.function_call.id, function: d.function_call }]
  }
  return null
}

/**
 * 把一个 delta 片段合并进累积表（就地修改传入的 Map）。
 * 抽成独立函数是为了能对"重发 id / 分片 arguments / 并行多槽"这些
 * 容易出错的组合写回归测试。
 */
export function accumulateToolCallDelta(
  map: Map<number, ToolCallAccum>,
  tc: RawToolCallDelta,
): void {
  const idx = tc.index ?? 0
  if (!map.has(idx)) map.set(idx, { id: '', name: '', arguments: '' })
  const slot = map.get(idx)!

  // id / name：整值语义，只接受首次非空值，避免重发导致拼接
  if (tc.id && !slot.id) slot.id = tc.id
  const name = tc.function?.name
  if (name && !slot.name) slot.name = name
  // arguments：增量语义，逐块拼接。
  // 快照型上游兼容（v14.13）：spark-x2.6 等中转的每个 delta 携带【完整】arguments 对象
  // 而非增量分片，朴素拼接会得到 {"a":1}{"a":1}… 的废串 → 执行时参数全丢。
  // 判据：已累积内容本身是完整 JSON 且新片段以 '{' 开头 → 以新快照为准（取最后一份）。
  const args = tc.function?.arguments
  if (args) {
    if (args.trimStart().startsWith("{")) {
      try {
        JSON.parse(slot.arguments)
        slot.arguments = args
        return
      } catch { /* 已累积的不完整 → 正常拼接 */ }
    }
    slot.arguments += args
  }
}

/**
 * 处理"非流式兼容"路径：部分模型把完整 tool_calls 放在
 * choices[0].message 而非 delta 里。仅在累积表为空时采用。
 */
export function adoptNonStreamToolCalls(
  map: Map<number, ToolCallAccum>,
  messageToolCalls: unknown,
): void {
  if (map.size > 0) return
  if (!Array.isArray(messageToolCalls)) return
  for (const raw of messageToolCalls as RawToolCallDelta[]) {
    const idx = raw.index ?? 0
    map.set(idx, {
      id: raw.id || '',
      name: raw.function?.name || '',
      arguments: raw.function?.arguments || '',
    })
  }
}

/** 累积表 → 有序数组（按 index 升序，保证与模型给出的调用顺序一致） */
export function toolCallsToArray(map: Map<number, ToolCallAccum>): ToolCallAccum[] {
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}
