/**
 * 会话分支（v12.1 新功能）
 *
 * "从这条消息另开一个对话"——探索不同方案时不污染主对话。
 * 这里只做纯逻辑：从消息序列里截取分支点、生成新会话的标题与内容。
 */

export interface BranchableMessage {
  id: string
  role: string
  content: string
  created_at?: string
}

export interface BranchPlan {
  /** 分支点消息 id（含） */
  at: string
  /** 新会话应包含的消息（原会话从头到分支点） */
  messages: BranchableMessage[]
  /** 建议标题 */
  title: string
  /** 与原会话的关联标记，写进新会话备注 */
  note: string
}

/**
 * 生成分支计划。
 * @param messages 原会话消息（按时间正序）
 * @param atId 从哪条消息处分叉
 * @param sourceTitle 原会话标题，用于生成"xx（分支）"
 */
export function planBranch(messages: BranchableMessage[], atId: string, sourceTitle = ''): BranchPlan | null {
  const idx = messages.findIndex((m) => m.id === atId)
  if (idx < 0) return null
  const included = messages.slice(0, idx + 1)
  // 标题取分支点之前最近的一条用户消息，比"原标题（分支）"更有信息量
  let anchor = ''
  for (let i = idx; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content.trim()) { anchor = messages[i].content.trim(); break }
  }
  const short = anchor.replace(/\s+/g, ' ').slice(0, 18)
  const title = short ? `${short}（分支）` : `${(sourceTitle || '对话').slice(0, 16)}（分支）`
  return {
    at: atId,
    messages: included,
    title,
    note: `从「${sourceTitle || '原会话'}」第 ${idx + 1} 条消息分出`,
  }
}

/** 分支后要去掉哪些消息（原会话保持不变时返回空；用于"分叉并截断原会话"模式） */
export function messagesAfter(messages: BranchableMessage[], atId: string): BranchableMessage[] {
  const idx = messages.findIndex((m) => m.id === atId)
  if (idx < 0) return []
  return messages.slice(idx + 1)
}
