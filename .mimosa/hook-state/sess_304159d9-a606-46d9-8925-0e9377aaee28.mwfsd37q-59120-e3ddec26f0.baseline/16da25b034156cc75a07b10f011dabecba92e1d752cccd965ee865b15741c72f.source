/**
 * MCP 推荐服务预设（v14）
 *
 * 用户面对「填命令/地址」这一步往往不知道写什么——官方 server 的包名
 * 各平台一样但不直观。这里放一份精选清单：一键填入表单，需要参数
 * （目录/数据库路径/token）的预设把占位符留在表单里让用户改。
 *
 * 只放「官方或社区长期维护」的 server，避免推荐来路不明的包。
 */

export interface McpPreset {
  id: string
  name: string
  /** 一句话说明它能让 AI 做什么 */
  description: string
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string
  url?: string
  /** 需要用户补的参数说明（非空则只预填表单，不直接添加） */
  needs?: string
  /** 建议的权限：只读类服务默认打开只读，降低误操作风险 */
  readOnly?: boolean
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    description: '读写指定目录里的文件（最常用）',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-filesystem ~/Documents',
    needs: '把 ~/Documents 换成你要授权的目录',
  },
  {
    id: 'git',
    name: 'git',
    description: '查看提交历史、diff、分支状态',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-git --repository .',
    needs: '把 . 换成你的仓库路径',
    readOnly: true,
  },
  {
    id: 'fetch',
    name: 'fetch',
    description: '抓取网页并转成 Markdown（比内置 web_fetch 更宽松）',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-fetch',
    readOnly: true,
  },
  {
    id: 'memory',
    name: 'memory',
    description: '知识图谱式长期记忆（可与内置记忆并用）',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-memory',
  },
  {
    id: 'sequential-thinking',
    name: 'sequential-thinking',
    description: '把复杂问题拆成多步推理链',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-sequential-thinking',
    readOnly: true,
  },
  {
    id: 'time',
    name: 'time',
    description: '时区换算与当前时间（模型算时间常出错）',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-time',
    readOnly: true,
  },
  {
    id: 'sqlite',
    name: 'sqlite',
    description: '直接查询 SQLite 数据库（只读建议）',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-sqlite ~/data.db',
    needs: '把 ~/data.db 换成你的数据库文件',
    readOnly: true,
  },
  {
    id: 'puppeteer',
    name: 'puppeteer',
    description: '浏览器自动化：打开页面、点击、截图',
    type: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-puppeteer',
  },
  {
    id: 'github-remote',
    name: 'github-remote',
    description: 'GitHub 官方远程 MCP（需在请求头填 PAT）',
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    needs: '请求头填 Authorization: Bearer <你的 GitHub PAT>',
    readOnly: true,
  },
]

export interface PresetServerPayload {
  name: string
  type: 'stdio' | 'http' | 'sse'
  command: string
  args: string
  url: string
  readOnly: boolean
  enabled: boolean
}

/** 预设 → 可直接提交给 /api/mcp/servers 的表单值 */
export function buildPresetServer(p: McpPreset): PresetServerPayload {
  return {
    name: p.name,
    type: p.type,
    command: p.command || '',
    args: p.args || '',
    url: p.url || '',
    readOnly: !!p.readOnly,
    enabled: true,
  }
}

/** 是否可以直接一键添加（不需要用户先改参数） */
export function isOneClick(p: McpPreset): boolean {
  return !p.needs
}
