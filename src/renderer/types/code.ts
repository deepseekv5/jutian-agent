// Code 模式相关类型

export interface AICompletionEvent {
  id: string
  type: 'loading' | 'success' | 'error'
  context?: {
    language: string
    prefix: string
    suffix: string
  }
  result?: string
  error?: string
  timestamp: string
}

/** 跟随模式 — AI 消息中解析出的文件跳转目标 */
export interface FollowTarget {
  filePath: string
  line?: number
  highlightLines?: number[]
}

/** AI 修改高亮 — 单行变更信息 */
export interface ChangedLine {
  line: number
  type: 'added' | 'modified' | 'deleted'
}

/** AI 修改高亮 — 文件级变更信息 */
export interface FileChangeInfo {
  filePath: string
  lines: ChangedLine[]
}

export interface CodeProject {
  id: string
  name: string
  rootPath: string
  created_at: string
  updated_at: string
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  expanded?: boolean
}

export interface EditorTab {
  path: string
  name: string
  language: string
  content: string
  modified: boolean
  originalContent: string
}

export interface CodeMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

/** 根据文件扩展名推断语言标识 */
const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c',
  cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', rb: 'ruby',
  php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', html: 'html', htm: 'html', css: 'css',
  scss: 'scss', less: 'less', sql: 'sql', sh: 'bash',
  bash: 'bash', zsh: 'bash', md: 'markdown', mdx: 'mdx',
  dockerfile: 'dockerfile', env: 'plaintext', gitignore: 'plaintext',
}

export function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return LANG_MAP[ext] || 'plaintext'
}

/** Git 文件状态 */
export type GitStatusType = 'modified' | 'untracked' | 'deleted' | 'added'

export interface GitFileStatus {
  filePath: string
  status: GitStatusType
}

export interface GitStatusData {
  isGitRepo: boolean
  branch: string
  files: GitFileStatus[]
  stats: { modified: number; untracked: number; deleted: number; added: number }
}

/** 搜索匹配结果 */
export interface SearchResult {
  filePath: string
  line: number
  content: string
}

/** 代码片段 */
export interface Snippet {
  id: string
  name: string
  language: string
  code: string
  description?: string
}

/** 最近文件 */
export interface RecentFile {
  path: string
  name: string
  openedAt: string
}

/** 语言对应的注释语法 */
export function getCommentSyntax(lang: string): { line: string } {
  const map: Record<string, string> = {
    python: '#', bash: '#', sh: '#', ruby: '#', yaml: '#', toml: '#',
    sql: '--', haskell: '--', lua: '--',
  }
  return { line: map[lang] || '//' }
}
