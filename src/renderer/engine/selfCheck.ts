// 发送前自检：在真的发出去之前，指出"这件事以当前配置根本做不到"的情况。
//
// 动机来自实测：用户问"帮我搜一下"，而当前一个联网工具都没加载/没配模型，
// 代理只能回一句"我做不到"。那时用户已经等了一轮才知道。
// 这里把它提前到发送那一刻 —— 代价是一行提示，收益是不浪费一整轮。
//
// 原则：只报"确定做不到"的，不做"可能做不到"的猜测。
// 宁可少提示，不可乱提示——一个总在预警的提示等于没有提示。

export interface Capability {
  /** 是否有联网检索能力（内置工具或 MCP 提供） */
  web?: boolean
  /** 是否配置了模型 */
  modelConfigured?: boolean
  /** 是否安装了可用技能 */
  skillCount?: number
}

export interface SelfCheck {
  level: 'ok' | 'warn' | 'block'
  message: string
}

/** 判定某段输入是否"要求联网" */
export function needsWeb(text: string): boolean {
  const t = String(text || '')
  // 明确要"最新/今天/现在"的
  if (/(最新|今天|今日|现在|当前|实时|近期|最近|新闻|股价|汇率|天气)/.test(t)) return true
  // 明确要"搜一下/查一下"
  if (/(搜一下|搜搜|查一下|查询|百度|谷歌|google|bing|搜索一下)/i.test(t)) return true
  // 给了具体 URL 要读
  if (/https?:\/\/\S+/.test(t)) return true
  return false
}

/**
 * 自检。返回 ok 表示可以直接发。
 */
export function selfCheck(input: string, cap: Capability): SelfCheck {
  const text = String(input || '').trim()

  if (!text) return { level: 'block', message: '输入为空' }

  if (!cap.modelConfigured) {
    return { level: 'block', message: '还没有配置模型，设置一个就能开始对话（设置 → 模型）' }
  }

  if (needsWeb(text) && !cap.web) {
    return {
      level: 'warn',
      message: '当前没有联网检索能力，这类问题只能凭已有知识回答，可能不是最新的。设置 → 开启联网工具，或直接粘贴资料给我。',
    }
  }

  return { level: 'ok', message: '' }
}

/** 是否需要拦截（warn 不拦，只提示） */
export function shouldBlock(c: SelfCheck): boolean {
  return c.level === 'block'
}