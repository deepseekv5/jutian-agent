/**
 * 动态工具选择（v15.1）
 *
 * 问题：50 个工具的全量 JSON Schema 每轮发给模型 ≈ 5K tokens。
 * 对小模型来说，工具太多反而降低选择准确率——选项越多越容易选错。
 *
 * 解法：按对话上下文匹配工具类别，每轮只发最相关的 10-15 个。
 * 核心工具（读文件/写文件/列表/搜索/终端）永远在列，其他按需匹配。
 *
 * 纯函数、可测。
 */

export interface ToolDef {
  name: string
  description: string
  parameters: unknown
}

/** 工具类别 → 触发关键词（中英文匹配） */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  file: ['file', 'read', 'write', 'edit', 'save', 'open', 'folder', 'directory', 'rename', 'move', 'copy', 'delete',
    '文件', '读取', '写入', '编辑', '保存', '打开', '重命名', '移动', '复制', '删除', '目录', '文件夹'],
  terminal: ['terminal', 'command', 'bash', 'shell', 'run', 'execute', 'install', 'npm', 'node', 'python', 'script',
    '运行', '执行', '命令', '安装', '终端', '脚本', '启动', '编译', 'build', 'deploy', 'test'],
  web: ['search', 'fetch', 'web', 'browse', 'url', 'http', 'api', 'internet', 'online',
    '搜索', '网页', '抓取', '浏览', '联网', '互联网', 'url', '链接', '请求'],
  data: ['json', 'csv', 'data', 'process', 'text', 'parse', 'format', 'base64', 'hash', 'encode', 'decode',
    '数据', '处理', '文本', '解析', '格式化', '编码', '解码', '哈希', '加密'],
  memory: ['remember', 'recall', 'memory', 'save', 'store', 'remember', 'forget',
    '记住', '回忆', '记忆', '忘记', '保存', '偏好', '信息'],
  git: ['git', 'commit', 'branch', 'merge', 'push', 'pull', 'rebase', 'tag',
    '提交', '分支', '合并', '推送', '拉取', '版本'],
  media: ['image', 'screenshot', 'generate', 'picture', 'photo', 'draw',
    '图片', '截屏', '生成', '画', '拍照', '截图'],
  knowledge: ['knowledge', 'kb', 'note', 'document', 'wiki', '笔记', '知识', '文档', '资料', '库'],
  code: ['code', 'debug', 'refactor', 'analyze', 'lint', 'typescript', 'javascript', 'python',
    '代码', '调试', '重构', '分析', '类型', '语法', '函数', '变量', '接口'],
  scheduling: ['cron', 'schedule', 'timer', '定时', '计划', '调度', '闹钟', '提醒'],
  workflow: ['workflow', 'pipeline', 'automation', '工作流', '流水线', '自动化', '编排'],
  /** 界面扩展（v14.11）：AI 给自己做面板/小工具 — 必须能匹配「日历/番茄钟/看板」等意图 */
  extension: ['extension', 'plugin', 'widget', 'panel', 'ui', 'interface', 'calendar', 'timer', 'pomodoro', 'dashboard', 'kanban',
    '扩展', '插件', '面板', '界面', '小工具', '日历', '番茄钟', '看板', '计时器', '给自己做', '加个', '做个', '做一个', '生成界面', '改造界面', '换个界面', '主题皮肤'],
}

/** 永远保留的核心工具（任何任务都需要） */
const ALWAYS_INCLUDE = new Set([
  'read_file', 'write_file', 'list_dir', 'search_content', 'shell', 'system_info',
  'recall', 'save_knowledge',
  // v14.11：造界面扩展是「AI 改自己」的入口，任何任务都不该被动态过滤截掉
  'create_extension',
])

/** 工具名 → 类别映射（从分类关键词反向构建） */
const TOOL_CATEGORY_MAP: Record<string, string> = {
  read_file: 'file', write_file: 'file', edit_file: 'file', list_dir: 'file',
  search_files: 'file', search_content: 'file', get_file_info: 'file',
  move_file: 'file', delete_file: 'file',
  shell: 'terminal', npm_run: 'terminal',
  web_search: 'web', web_fetch: 'web', http_request: 'web',
  json_process: 'data', text_tools: 'data', base64_tools: 'data',
  hash_tools: 'data', url_tools: 'data', random_tools: 'data',
  timestamp_tools: 'data', color_tools: 'data',
  remember: 'memory', recall: 'memory', forget: 'memory', save_knowledge: 'memory',
  git_operation: 'git', code_analysis: 'code',
  image_generate: 'media', screenshot: 'media',
  create_extension: 'extension', create_skill: 'extension',
}

/** 用户消息 → 应包含的工具类别集合 */
function matchedCategories(message: string): Set<string> {
  const msg = message.toLowerCase()
  const matched = new Set<string>()
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (msg.includes(kw.toLowerCase())) { matched.add(cat); break }
    }
  }
  return matched
}

/**
 * 动态工具过滤：按对话上下文选出最相关的工具子集。
 *
 * 策略：
 *   1. 核心工具永远保留
 *   2. 按用户消息的类别匹配加入对应工具
 *   3. 上限 maxTools 条，超出时按「核心 > 匹配类别 > 其余」优先级截断
 *
 * @param tools 全量工具列表
 * @param userMessage 用户消息（触发类别匹配）
 * @param maxTools 最大返回条数（默认 15）
 */
export function filterTools(tools: ToolDef[], userMessage: string, maxTools = 15): ToolDef[] {
  if (tools.length <= maxTools) return tools

  const matched = matchedCategories(userMessage || '')
  const scored = tools.map((t) => {
    if (ALWAYS_INCLUDE.has(t.name)) return { t, score: 3 }
    const cat = TOOL_CATEGORY_MAP[t.name]
    if (cat && matched.has(cat)) return { t, score: 2 }
    return { t, score: 0 }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxTools).map((s) => s.t)
}

/**
 * 工具调用修复（v15.1）
 *
 * 模型偶尔会产生格式不对的 tool_call JSON——缺引号、尾逗号、单引号包裹。
 * 以前直接报错，模型下一轮看到错误又重试，浪费一轮。
 * 这里尝试修复常见问题，修好就用，修不好才回错。
 */
export function repairToolCallJson(raw: string): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return {}
  let s = String(raw).trim()
  try { return JSON.parse(s) } catch { /* 继续修 */ }
  // 修 1：尾逗号
  s = s.replace(/,\s*([}\]])/g, '$1')
  // 修 2：单引号 → 双引号（只换包裹，不动内容里的单引号）
  if (s.startsWith("{'") || s.includes("': '")) {
    s = s.replace(/'/g, '"').replace(/"\s*":\s*"/g, ': "').replace(/"\s*":\s*"/g, ': "')
  }
  // 修 3：键没引号 → 加引号
  s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3')
  // 修 4：字符串内换行转义
  s = s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  try { return JSON.parse(s) } catch { return null }
}

/**
 * prepareStep：智能步骤控制（v15.1）
 *
 * 第一步只给只读工具——模型在没有信息的情况下不应该直接写文件。
 * 后续步骤放开全部工具。这个「先看后写」的约束来自 Cline 的实践。
 */
export function stepToolFilter(stepNumber: number): string[] | undefined {
  if (stepNumber === 0) {
    // 第一步只给只读工具（不提供 write_file / shell 等）
    return ['read_file', 'list_dir', 'search_files', 'search_content', 'web_search',
      'web_fetch', 'system_info', 'recall', 'code_analysis', 'get_file_info',
      'json_process', 'text_tools', 'timestamp_tools']
  }
  return undefined // 后续步骤不限（undefined = 全部可用）
}
