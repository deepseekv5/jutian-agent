/**
 * 敏感操作判定 —— 权限档位在代码层的强制点
 *
 * 此前「需要我确认」这一档只靠系统提示词让模型自觉：提示词写「执行前必须
 * 先确认」，但模型完全可以不遵守，直接调用 delete_file。对本地智能体来说
 * 这是最要紧的一道边界——它手握真实终端与文件系统。
 *
 * 这里提供纯函数判定，由调用方（主对话流 / 集群）在**执行前**拦截，
 * 不依赖模型配合。放在 shared 是因为前端与后端都需要同一份判据。
 */

export interface SensitiveHit {
  /** 展示给用户与模型的中文名 */
  label: string
  /** 风险等级：high = 不可逆，warn = 需留意 */
  level: 'high' | 'warn'
}

/** 不可逆的文件系统操作 */
const DESTRUCTIVE_TOOLS: Record<string, string> = {
  delete_file: '删除文件',
  move_file: '移动文件',   // 移动会覆盖目标，且源路径消失
}

/** 高危命令模式：与后端 shell 工具的黑名单保持一致的意图（后端拦「绝对破坏」，
 *  这里拦「局部破坏」——后端放行的 rm -rf ./build 在这里仍需确认） */
const DANGEROUS_CMD = [
  { re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, label: '递归/强制删除' },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force)/i, label: 'Git 破坏性操作' },
  // git_operation 工具传的是子命令（如 "reset --hard"），不带 git 前缀，
  // 因此这里同时匹配裸子命令形态
  { re: /(^|\s)(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force)/i, label: 'Git 破坏性操作' },
  // Windows del/rd 的参数可任意顺序（del /f /s /q、del /s /f 都常见），
  // 只要出现 /s 或 /q 即视为递归/静默删除
  { re: /\b(del|rd|rmdir)\b[^\n]*\s\/[a-z]*[sq]/i, label: 'Windows 递归删除' },
  { re: /\b(drop|truncate)\s+(table|database)/i, label: '数据库破坏性语句' },
  { re: /\b(shutdown|reboot|diskpart|mkfs)\b/i, label: '系统级操作' },
  { re: /\bchmod\s+-R\s+777\b/i, label: '危险的权限变更' },
  { re: />\s*\/dev\/(sd|disk)/i, label: '直写块设备' },
]

/**
 * 判定一次工具调用是否属于敏感操作。
 * 返回 null 表示放行；返回命中信息表示需要用户确认（ask 档）或直接拦截（集群档）。
 */
export function checkSensitiveTool(name: string | undefined, args: unknown): SensitiveHit | null {
  if (!name) return null

  const destructive = DESTRUCTIVE_TOOLS[name]
  if (destructive) return { label: destructive, level: 'high' }

  if (name === 'shell' || name === 'git_operation') {
    const cmd = String((args as { command?: unknown })?.command || '')
    for (const { re, label } of DANGEROUS_CMD) {
      if (re.test(cmd)) return { label, level: 'high' }
    }
  }

  // 写文件本身不算敏感（用户让它改代码就是要写），但覆盖已存在文件
  // 且内容清空属于潜在数据丢失，交给上层按需提示
  if (name === 'write_file') {
    const content = String((args as { content?: unknown })?.content ?? '')
    if (content === '') return { label: '清空文件内容', level: 'warn' }
  }

  return null
}

/** 是否属于「写」类工具（供 ask 档判断"有副作用"） */
const WRITE_TOOL_NAMES = new Set([
  'write_file', 'edit_file', 'move_file', 'delete_file', 'shell',
  'create_skill', 'install_skill', 'git_operation',
])

export function isWriteTool(name: string | undefined): boolean {
  return !!name && WRITE_TOOL_NAMES.has(name)
}
