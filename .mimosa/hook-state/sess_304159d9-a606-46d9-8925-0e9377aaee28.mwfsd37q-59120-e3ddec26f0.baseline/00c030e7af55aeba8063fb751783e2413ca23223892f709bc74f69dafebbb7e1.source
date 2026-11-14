/**
 * 对话健康度与建议（v12.1 新功能）
 *
 * 回答用户一个真实问题："这个对话还能继续吗？"
 * 依据：上下文占比、消息数、工具失败率、重复提问迹象。
 *
 * 只给可解释的信号，不做"智能评分"式的黑箱数字。
 */

export interface HealthInput {
  messageCount: number
  usedTokens: number
  contextLimit: number
  toolCalls: number
  failedToolCalls: number
  /** 同一用户问题重复出现的次数（去重后对比） */
  repeatedQuestions?: number
}

export type HealthLevel = 'good' | 'notice' | 'warn'

export interface HealthSignal {
  level: HealthLevel
  title: string
  detail: string
  /** 建议动作 */
  action?: 'compact' | 'new-session' | 'review-tools' | 'none'
}

export interface HealthReport {
  level: HealthLevel
  /** 0-100，仅供参考：不是"AI 评分"，是上面几个可解释信号的加权 */
  score: number
  signals: HealthSignal[]
}

export function analyzeHealth(input: HealthInput): HealthReport {
  const signals: HealthSignal[] = []
  const limit = input.contextLimit > 0 ? input.contextLimit : 128000
  const usage = input.usedTokens / limit

  if (usage >= 0.9) {
    signals.push({
      level: 'warn', action: 'compact',
      title: '上下文接近上限',
      detail: `已用约 ${Math.round(usage * 100)}%，继续下去会开始丢弃早期内容`,
    })
  } else if (usage >= 0.7) {
    signals.push({
      level: 'notice', action: 'compact',
      title: '上下文偏满',
      detail: `已用约 ${Math.round(usage * 100)}%，建议压缩一次再继续`,
    })
  }

  if (input.messageCount >= 60) {
    signals.push({
      level: 'notice', action: 'new-session',
      title: '对话很长',
      detail: `${input.messageCount} 条消息。换新对话往往比继续更省 token，也更少串味`,
    })
  }

  if (input.toolCalls >= 5) {
    const rate = input.failedToolCalls / input.toolCalls
    if (rate >= 0.4) {
      signals.push({
        level: 'warn', action: 'review-tools',
        title: '工具失败率偏高',
        detail: `${input.failedToolCalls}/${input.toolCalls} 次失败。可能是环境或权限问题，可跑一次环境诊断`,
      })
    } else if (rate >= 0.2) {
      signals.push({
        level: 'notice', action: 'review-tools',
        title: '有工具调用失败',
        detail: `${input.failedToolCalls}/${input.toolCalls} 次失败，检查失败的几条是否同一个原因`,
      })
    }
  }

  if ((input.repeatedQuestions || 0) >= 2) {
    signals.push({
      level: 'notice', action: 'new-session',
      title: '似乎在重复提问',
      detail: '同一个问题问过多次，模型可能被前面的内容干扰，换个新对话效果通常更好',
    })
  }

  if (!signals.length) {
    signals.push({ level: 'good', action: 'none', title: '对话状态良好', detail: '上下文与工具调用都正常' })
  }

  // 分数：从 100 扣，越严重扣越多（仅用于排序/配色，不做"评分"宣传）
  let score = 100
  for (const s of signals) score -= s.level === 'warn' ? 35 : s.level === 'notice' ? 15 : 0
  score = Math.max(0, Math.min(100, score))
  const level: HealthLevel = signals.some((s) => s.level === 'warn')
    ? 'warn'
    : signals.some((s) => s.level === 'notice') ? 'notice' : 'good'

  return { level, score, signals }
}
