// Types for 巨天agent

export interface AttachedFile {
  path: string
  name: string
  size: number
  file?: File  // 浏览器原生 File 对象（非 Electron 环境降级方案）
  dataUrl?: string  // 截图/直接携带的图片内容（多模态优先使用，免读盘）
}

export interface Session {
  id: string
  title: string
  created_at: string
  updated_at: string
  /** 项目分组标签：会话绑定的工作目录绝对路径，空=未分组 */
  project?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: string  // JSON string
  status: 'pending' | 'running' | 'done' | 'error'
  result?: string
  started_at?: string
  finished_at?: string
  /** 时序交错:工具调用开始时正文已流出的长度,渲染按真实顺序排布 */
  preLen?: number
}

export interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  swarm?: any
  /** 消息分支：历史版本（重新生成时旧回答依次归档于此） */
  variants?: string[]
  created_at: string
}

export type PermissionLevel = 'restricted' | 'standard' | 'full'

export interface Settings {
  apiBaseUrl: string
  apiKey: string
  model: string
  provider: 'api' | 'local'
  localModel: string
  voiceId: string
  theme?: 'light' | 'dark'
  // 工作区（AI 默认工作目录，实时生效）
  workDir: string
  // 安全设置
  permissionLevel: PermissionLevel
  allowedFolders: string[]
  shellAccess: boolean
  sensitiveBlock: boolean
  // 合盖保持运行（默认开启）
  keepAwake?: boolean
  // 提供商与模型能力
  providerName?: string
  contextWindow?: number
  multimodal?: boolean
  // 提供商下的模型列表（快捷切换）
  models?: string[]
  // ── 对话行为 ──
  /** Enter 直接发送；false 时需 Cmd/Ctrl+Enter 发送（默认 true） */
  enterToSend?: boolean
  /** 聊天字号：small / standard / large（默认 standard） */
  chatFontSize?: 'small' | 'standard' | 'large'
  /** 首次对话后 AI 自动生成标题（默认 true） */
  autoTitle?: boolean
  /** 回复完成后系统通知（窗口在后台时，默认 false） */
  notifyDone?: boolean
  /** 上下文自动压缩阈值百分比（默认 70） */
  autoCompactPct?: number
  /** 朗读语速（Edge-TTS rate，默认 1.0） */
  ttsSpeed?: string
  /** AI 回复完成后自动朗读（默认 false） */
  autoSpeak?: boolean
}

// Tool definition matching OpenAI function calling format
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, any>
}

// ============================================================
//  🛠️ 巨天agent 工具集 — 覆盖文件、系统、网络、开发、搜索等场景
// ============================================================


import BTList from '../../shared/builtin-tools.json'

/** 工具 schema 单一来源:src/shared/builtin-tools.json(手机远程共用) */
export const BUILTIN_TOOLS: ToolDef[] = BTList as ToolDef[]
