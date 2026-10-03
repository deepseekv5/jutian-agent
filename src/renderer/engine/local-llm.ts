/**
 * WebLLM 引擎封装 — 浏览器端模型加载与流式推理
 * 使用 @mlc-ai/web-llm 在 WebGPU 上运行 2B 以下模型
 */

import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm'

/** 支持的本地模型列表（2B 及以下） */
export const LOCAL_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B', size: '~700MB' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B', size: '~1.0GB' },
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 0.5B', size: '~350MB' },
  { id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', name: 'SmolLM2 1.7B', size: '~1.1GB' },
  { id: 'gemma-2b-it-q4f16_1-MLC', name: 'Gemma 2B', size: '~1.3GB' },
]

export type ProgressCallback = (progress: number, text: string) => void

// 挂到 window 上避免 HMR 热更新丢失引擎引用
function getEngine(): MLCEngine | null {
  return (window as any).__localEngine ?? null
}
function setEngine(eng: MLCEngine | null) {
  (window as any).__localEngine = eng
}

// HMR 保留引擎
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // 不卸载，保留在 window 上
  })
}

/** 加载模型，带进度回调 */
export async function loadLocalModel(
  modelId: string,
  onProgress: ProgressCallback,
): Promise<void> {
  console.log('[WebLLM] Starting to load model:', modelId)
  const engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      console.log('[WebLLM] Progress:', Math.round(report.progress * 100) + '%', report.text)
      try {
        onProgress(report.progress, report.text)
      } catch (e) {
        console.error('[WebLLM] Progress callback error:', e)
      }
    },
  })
  setEngine(engine)
  ;(window as any).__localModelId = modelId
  console.log('[WebLLM] Model loaded successfully:', modelId)
}

/** 流式聊天（AsyncGenerator），兼容 OpenAI Message 格式 */
export async function* localLLMStream(
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const engine = getEngine()
  if (!engine) throw new Error('模型未加载，请先在设置中下载模型')

  const chunks = await engine.chat.completions.create({
    messages: messages as any,
    temperature: 0.7,
    max_tokens: 4096,
    stream: true,
  })

  for await (const chunk of chunks) {
    if (signal?.aborted) break
    const delta = (chunk as any).choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}

/** 模型是否已加载 */
export function isModelLoaded(): boolean {
  return getEngine() !== null
}

/** 获取当前已加载的模型 ID */
export function getLoadedModelId(): string | null {
  return (window as any).__localModelId ?? null
}

/** 卸载模型，释放内存 */
export async function unloadModel(): Promise<void> {
  const engine = getEngine()
  if (engine) {
    console.log('[WebLLM] Unloading model:', (window as any).__localModelId)
    await engine.unload?.()
    setEngine(null)
    ;(window as any).__localModelId = null
    console.log('[WebLLM] Model unloaded')
  }
}
