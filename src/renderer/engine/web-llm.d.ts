/**
 * @mlc-ai/web-llm 的最小类型声明
 *
 * 该包仅在用户实际启用「本地模型」时由 Vite 运行时动态加载,不进依赖树
 * (安装 ~80MB)。这里提供能通过类型检查的最小 API 面,与运行时真实包对齐。
 */
declare module '@mlc-ai/web-llm' {
  export interface InitProgressReport {
    progress: number
    text: string
  }

  export interface ChatCompletionMessage {
    role: string
    content: string | null
  }

  export interface ChatCompletionOptions {
    messages: ChatCompletionMessage[]
    temperature?: number
    top_p?: number
    max_tokens?: number
    stream?: boolean
  }

  export interface ChatCompletionChunk {
    choices: {
      delta: { content?: string }
      finish_reason: string | null
    }[]
  }

  export interface ChatCompletionsModule {
    create(opts: ChatCompletionOptions): Promise<AsyncIterable<ChatCompletionChunk>>
  }

  export interface MLCEngine {
    chat: { completions: ChatCompletionsModule }
    unload?(): Promise<void>
    resetChat?(): Promise<void>
    interruptGenerate?(): void
  }

  export function CreateMLCEngine(
    modelId: string,
    opts?: { initProgressCallback?: (report: InitProgressReport) => void },
  ): Promise<MLCEngine>
}
