/**
 * Tool executor - executes agent tools via a local backend proxy.
 * 
 * Since the frontend can't directly run shell commands (browser sandbox),
 * we use a small Express/Fastify backend that exposes tool execution endpoints.
 * 
 * Architecture:
 *   Frontend → fetch('/api/tools/execute') → Backend server → shell exec → result
 */

export interface ToolRequest {
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  duration_ms: number
  /** 文件变更 id（edit_file 等写操作返回，供前端 diff 展示/撤销） */
  changeId?: string
}

const API_BASE = '/api'

/**
 * Execute a tool by calling the local backend proxy.
 * The backend (server.ts) handles actual command execution with safety limits.
 * workDir: 用户设置的工作区目录，作为后端执行命令/文件操作的默认目录（实时生效）。
 */
export async function executeTool(req: ToolRequest, workDir?: string, signal?: AbortSignal): Promise<ToolResult> {
  const start = Date.now()

  try {
    const res = await fetch(`${API_BASE}/tools/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // HTTP 头只允许 Latin-1，中文路径需 URL 编码（服务端 decodeURIComponent 还原）
        ...(workDir ? { 'X-Work-Dir': encodeURIComponent(workDir) } : {}),
      },
      body: JSON.stringify(req),
      // 传中止信号：用户点停止时，正在等待的长命令（npm install 等）
      // 立即断开，而不是等它自己跑完
      ...(signal ? { signal } : {}),
    })

    if (!res.ok) {
      const errText = await res.text()
      return {
        success: false,
        output: '',
        error: `Tool server error ${res.status}: ${errText}`,
        duration_ms: Date.now() - start,
      }
    }

    const data = await res.json() as ToolResult
    return { ...data, duration_ms: Date.now() - start }
  } catch (err: unknown) {
    const e = err as { message?: string; name?: string }
    // 用户主动中止必须和"后端挂了"区分开：否则模型会以为工具坏了，
    // 转而声称无法调用工具，然后换一种方式重试
    if (e.name === 'AbortError' || signal?.aborted) {
      return {
        success: false,
        output: '',
        error: '已中止（用户停止）',
        duration_ms: Date.now() - start,
      }
    }
    return {
      success: false,
      output: '',
      error: `Cannot connect to tool server. Is the backend running?\n${e.message}`,
      duration_ms: Date.now() - start,
    }
  }
}

/**
 * Check if the tool backend is alive.
 */
export async function checkToolServer(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}
