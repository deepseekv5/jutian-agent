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
 *
 * v18.1.1 健壮性强化：
 *  - arguments 为 undefined / 空串 / 已解析对象等各种畸形 delta 不再产生
 *    "undefined" 拼接或 "[object Object]" 废串；
 *  - 累积数组里混入 null / 非对象项不再让整轮崩掉；
 *  - adoptNonStreamToolCalls（全量快照路径）对非法 JSON 参数容错：
 *    跳过损坏的调用、保留同批其它调用（历史教训：spark-x2.6 快照损坏）。
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
  /** 内部优化（v16.0.0）：arguments 已确认为完整 JSON 快照后不再重复 parse */
  argsComplete?: boolean
}

/** index 合法性判据：数字且有限值才算真分桶索引，否则按 0 处理（防 "0" 字符串幽灵分桶） */
function normIndex(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
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
  // 防御：个别上游会在 tool_calls 数组里混入 null / 非对象项，忽略之，不让整轮崩
  if (!tc || typeof tc !== 'object') return
  const idx = normIndex(tc.index)
  if (!map.has(idx)) map.set(idx, { id: '', name: '', arguments: '' })
  const slot = map.get(idx)!

  // id / name：整值语义，只接受首次非空值，避免重发导致拼接
  if (typeof tc.id === 'string' && tc.id && !slot.id) slot.id = tc.id
  const name = tc.function?.name
  if (typeof name === 'string' && name && !slot.name) slot.name = name
  // arguments：增量语义，逐块拼接。
  // 快照型上游兼容（v14.13）：spark-x2.6 等中转的每个 delta 携带【完整】arguments 对象
  // 而非增量分片，朴素拼接会得到 {"a":1}{"a":1}… 的废串 → 执行时参数全丢。
  // 判据：已累积内容本身是完整 JSON 且新片段以 '{' 开头 → 以新快照为准（取最后一份）。
  const args = tc.function?.arguments
  if (typeof args !== 'string') {
    // 个别网关把 arguments 直接下发成【已解析对象】（同样是快照语义）：
    // 按字符串拼接会得到 "[object Object]" 甚至发生数字相加，必须序列化后整体替换
    if (args && typeof args === 'object') {
      try {
        slot.arguments = JSON.stringify(args)
        slot.argsComplete = true
      } catch { /* 循环引用等序列化失败 → 丢弃本片，不污染已累积内容 */ }
    }
    return
  }
  if (!args) return // undefined / 空串：空片不参与拼接，杜绝 "undefined" 混进参数
  if (args.trimStart().startsWith('{')) {
    if (slot.argsComplete) { slot.arguments = args; return }
    try {
      JSON.parse(slot.arguments)
      slot.argsComplete = true
      slot.arguments = args
      return
    } catch { /* 已累积的不完整 → 正常拼接 */ }
  }
  slot.arguments += args
}

/**
 * 处理"非流式兼容"路径：部分模型把完整 tool_calls 放在
 * choices[0].message 而非 delta 里。仅在累积表为空时采用。
 *
 * v18.1.1 容错：这里的 arguments 是【全量快照】而非增量，非法 JSON 意味着
 * 参数已损坏、执行必然失败 —— 跳过该调用并保留同批其它调用，
 * 绝不让单个坏项把整轮崩掉（历史教训：spark-x2.6 快照型参数损坏）。
 * 另外 message.tool_calls 常缺 index 字段：按数组位置分桶，
 * 避免多个调用全挤进 0 号槽互相覆盖（旧行为只执行最后一个）。
 */
export function adoptNonStreamToolCalls(
  map: Map<number, ToolCallAccum>,
  messageToolCalls: unknown,
): void {
  if (map.size > 0) return
  if (!Array.isArray(messageToolCalls)) return
  for (let i = 0; i < messageToolCalls.length; i++) {
    const raw = messageToolCalls[i] as RawToolCallDelta | null | undefined
    // 坏项（null / 非对象 / 缺函数名）跳过，不影响同批其它调用
    if (!raw || typeof raw !== 'object') continue
    const fnName = typeof raw.function?.name === 'string' ? raw.function.name : ''
    if (!fnName) continue
    // arguments 兼容三种形态：字符串快照 / 已解析对象 / 缺省（无参工具）
    const rawArgs = raw.function?.arguments
    let args = ''
    if (typeof rawArgs === 'string') {
      args = rawArgs
    } else if (rawArgs && typeof rawArgs === 'object') {
      try {
        args = JSON.stringify(rawArgs)
      } catch { continue }
    }
    // 非空 arguments 必须是合法 JSON；非法 → 参数已损坏，跳过该调用、保留其它
    if (args !== '') {
      try {
        JSON.parse(args)
      } catch { continue }
    }
    // index 缺失 / 非数字（message.tool_calls 常不带 index）：按数组位置分桶
    const idx = typeof raw.index === 'number' && Number.isFinite(raw.index) ? raw.index : i
    map.set(idx, {
      id: typeof raw.id === 'string' ? raw.id : '',
      name: fnName,
      arguments: args,
      // 全量快照已验证合法：标记 argsComplete，后续若仍收到 '{' 开头的分片按快照替换
      argsComplete: args !== '' ? true : undefined,
    })
  }
}

/** 累积表 → 有序数组（按 index 升序，保证与模型给出的调用顺序一致） */
export function toolCallsToArray(map: Map<number, ToolCallAccum>): ToolCallAccum[] {
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}
