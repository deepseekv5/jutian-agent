// 对话标题清洗：模型给的"标题"并不总是标题。
//
// 实测踩过的坑：
//  - 带引号/书名号：「AI 标题」《项目》——顶栏和侧栏里像脏数据
//  - 带解释："标题：官网改版" ——冒号前缀没剥掉
//  - 客套开场白："您好！在我们当前的对话中，我并没有看到之前…" ——模型没照做，
//    把整句客套话当标题返回，直接塞进顶栏 tab 和侧栏
//  - 多行：模型先写了一段再写标题
//
// 判定"不是标题"用启发式而非硬编码：句子过长、以客套词开头、
// 含明显解释性连接词，一律丢弃并让调用方回退到本地截断标题。

const MAX = 20

/** 明显不是标题的客套/元叙述开头 */
const CHITCHAT = /^(您好|你好|嗯|好的|当然|抱歉|不好意思|作为(一个|一名)?(AI|人工智能|助手)|我是)/

/** 解释性前缀，剥掉 */
const PREFIX = /^(标题|题目|会话标题|对话标题)\s*(是|为|：|:)?\s*/

/** 含这些结构更像一段话而不是标题 */
const SENTENCEY = /(在(我们)?(当前|之前)的?(对话|会话)|没有(看到|发现)|无法(确定|得知)|请(提供|告诉)|首先|其次|综上所述|希望(这|它)|如果(你|您)需要)/

/**
 * 清洗模型返回的标题。返回空串表示"这段不像标题"，调用方应回退。
 */
export function sanitizeTitle(raw: string): string {
  let t = String(raw || '').trim()
  if (!t) return ''

  // 多行取第一行；但若第一行是客套而后面有正经标题，取后面那条
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length > 1) {
    const good = lines.find(l => !CHITCHAT.test(l) && !SENTENCEY.test(l) && l.length <= MAX)
    t = good || lines[0]
  }

  t = t.replace(PREFIX, '')
  t = t.replace(/^["'「『《【(（]+/, '').replace(/["'」』》】)）]+[。.!！?？,，、\s]*$/, '').trim()
  t = t.replace(/[。.!！?？,，、\s]+$/, '').trim()
  t = t.slice(0, MAX).trim()

  if (!t) return ''
  // 客套话 / 解释性长句：宁可不改标题，也别把客套话显示在 tab 上
  if (CHITCHAT.test(t)) return ''
  if (SENTENCEY.test(t)) return ''
  // 单个句号结尾的整句（超过 12 字）多半是完整句子而非标题
  if (t.length > 12 && /[。！？]/.test(t)) return ''
  return t
}

/** 标题不可用时，从首条用户消息截一个像样的本地标题 */
export function fallbackTitle(userContent: string): string {
  const first = String(userContent || '').trim().split('\n')[0] || ''
  const cleaned = first.replace(/[#*_`>[\]]/g, '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return '新对话'
  return cleaned.slice(0, MAX)
}