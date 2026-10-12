// 空会话清理：应用每次冷启动会建一个默认对话，用户若没在上面打字就留下一条
// "新对话"。反复启动后侧栏会被几十条空会话淹没（实测见过 27 条），
// 而用户在界面上看不出区别——它们和真正用过的会话长得一样。
//
// 判定"空"只看消息表：一条消息都没有才算空。标题不算依据，
// 因为空会话的标题恒为默认值，而真实会话也可能被用户手动改名。

/** 判定规则：消息数为 0 即为空。 */
export function isEmptySession(session: { id: string }, messageCountBySession: Map<string, number>): boolean {
  const n = messageCountBySession.get(session.id)
  // 查不到计数时保守当"非空"——宁可漏删，也不要误删有内容的会话
  if (n === undefined) return false
  return n === 0
}

/**
 * 选出可以清理的空会话。
 * @param sessions     全部会话
 * @param counts       session_id → 消息数
 * @param protectIds   不可清理的会话（当前打开的 tab 所引用的会话）
 * @param max          最多清理多少个（留最近的一批，避免一次性删太多）
 */
export function pickEmptySessions(
  sessions: { id: string }[],
  counts: Map<string, number>,
  protectIds: Set<string>,
  max = 50,
): string[] {
  const empties = sessions
    .filter(s => !protectIds.has(s.id) && isEmptySession(s, counts))
    .map(s => s.id)
  // sessions 已按 updated_at DESC 排序（最新在前），所以从尾部取最旧的
  return empties.slice(Math.max(0, empties.length - max))
}

/** 判断这次启动是否需要跑清理（空会话堆积到阈值才动手，避免每次启动都扫全表）。 */
export function shouldCleanup(emptyCount: number, threshold = 5): boolean {
  return emptyCount > threshold
}