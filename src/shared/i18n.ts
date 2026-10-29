/**
 * 界面文案字典（中/英）—— v13.5
 *
 * 为什么单独一份：此前英文覆盖全靠各组件里的 t('中文','English')，
 * 结果只有零星几十处被翻译，切到英文仍是满屏中文。集中一份字典的好处：
 *   · 英文覆盖可测（tests/i18n.test.ts 扫描缺键与硬编码中文）
 *   · 新增文案必须同时给两种语言，漏了会被测试拦住
 *   · 服务端/桌面/手机共用同一份（手机端也能按语言渲染）
 *
 * 用法：const { tt } = useLanguage(); tt('nav.chat')
 * 带变量：tt('chat.messages', { n: 12 }) → "12 条消息" / "12 messages"
 */

export type Lang = 'zh' | 'en'

export interface Entry {
  zh: string
  en: string
}

export const STRINGS: Record<string, Entry> = {
  // ── 导航与通用动作 ──
  'nav.chat': { zh: '对话', en: 'Chat' },
  'nav.newChat': { zh: '新建对话', en: 'New chat' },
  'nav.market': { zh: '市场', en: 'Market' },
  'nav.tasks': { zh: '任务', en: 'Tasks' },
  'nav.settings': { zh: '设置', en: 'Settings' },
  'nav.about': { zh: '关于', en: 'About' },
  'nav.files': { zh: '文件', en: 'Files' },
  'nav.terminal': { zh: '终端', en: 'Terminal' },
  'nav.code': { zh: '代码', en: 'Code' },
  'nav.memory': { zh: '记忆', en: 'Memory' },
  'nav.outputs': { zh: '产出', en: 'Outputs' },
  'nav.skills': { zh: '技能', en: 'Skills' },
  'nav.employees': { zh: '员工', en: 'Team' },
  'nav.kb': { zh: '知识库', en: 'Knowledge' },
  'nav.diary': { zh: '日记', en: 'Diary' },
  'nav.persona': { zh: '角色', en: 'Personas' },
  'nav.research': { zh: '调研', en: 'Research' },
  'nav.call': { zh: '通话', en: 'Call' },
  'nav.ppt': { zh: '演示', en: 'Slides' },
  'nav.freemodels': { zh: '免费模型', en: 'Free models' },
  'nav.qqbot': { zh: 'QQ 机器人', en: 'QQ bot' },

  'action.save': { zh: '保存', en: 'Save' },
  'action.cancel': { zh: '取消', en: 'Cancel' },
  'action.confirm': { zh: '确定', en: 'Confirm' },
  'action.delete': { zh: '删除', en: 'Delete' },
  'action.remove': { zh: '移除', en: 'Remove' },
  'action.rename': { zh: '重命名', en: 'Rename' },
  'action.copy': { zh: '复制', en: 'Copy' },
  'action.copied': { zh: '已复制', en: 'Copied' },
  'action.install': { zh: '安装', en: 'Install' },
  'action.uninstall': { zh: '卸载', en: 'Uninstall' },
  'action.installing': { zh: '安装中…', en: 'Installing…' },
  'action.retry': { zh: '重试', en: 'Retry' },
  'action.refresh': { zh: '刷新', en: 'Refresh' },
  'action.close': { zh: '关闭', en: 'Close' },
  'action.open': { zh: '打开', en: 'Open' },
  'action.edit': { zh: '编辑', en: 'Edit' },
  'action.search': { zh: '搜索', en: 'Search' },
  'action.export': { zh: '导出', en: 'Export' },
  'action.import': { zh: '导入', en: 'Import' },
  'action.more': { zh: '更多', en: 'More' },
  'action.back': { zh: '返回', en: 'Back' },
  'action.next': { zh: '下一个', en: 'Next' },
  'action.prev': { zh: '上一个', en: 'Previous' },
  'action.enable': { zh: '启用', en: 'Enable' },
  'action.disable': { zh: '停用', en: 'Disable' },
  'action.apply': { zh: '应用', en: 'Apply' },
  'action.reset': { zh: '重置', en: 'Reset' },
  'action.clear': { zh: '清空', en: 'Clear' },
  'action.send': { zh: '发送', en: 'Send' },
  'action.stop': { zh: '停止', en: 'Stop' },
  'action.pin': { zh: '置顶', en: 'Pin' },
  'action.unpin': { zh: '取消置顶', en: 'Unpin' },
  'action.archive': { zh: '归档', en: 'Archive' },
  'action.unarchive': { zh: '取消归档', en: 'Unarchive' },
  'action.share': { zh: '分享', en: 'Share' },
  'action.shareImage': { zh: '分享图', en: 'Share image' },
  'action.speak': { zh: '朗读', en: 'Read aloud' },
  'action.stopSpeaking': { zh: '停止朗读', en: 'Stop reading' },
  'action.regenerate': { zh: '重新生成', en: 'Regenerate' },
  'action.quote': { zh: '引用回复', en: 'Quote' },
  'action.focus': { zh: '聚焦阅读', en: 'Focus mode' },
  'action.saveToKb': { zh: '存入知识库', en: 'Save to knowledge' },
  'action.branch': { zh: '分叉', en: 'Branch' },
  'action.rollback': { zh: '回滚到这里', en: 'Roll back here' },

  // ── 状态与提示 ──
  'state.loading': { zh: '加载中…', en: 'Loading…' },
  'state.empty': { zh: '暂无内容', en: 'Nothing here yet' },
  'state.error': { zh: '出错了', en: 'Something went wrong' },
  'state.saving': { zh: '保存中…', en: 'Saving…' },
  'state.saved': { zh: '已保存', en: 'Saved' },
  'state.online': { zh: '在线', en: 'Online' },
  'state.offline': { zh: '离线', en: 'Offline' },
  'state.connected': { zh: '已连接', en: 'Connected' },
  'state.disconnected': { zh: '未连接', en: 'Disconnected' },
  'state.generating': { zh: '正在生成…', en: 'Generating…' },
  'state.thinking': { zh: '思考中', en: 'Thinking' },
  'state.noResult': { zh: '没有匹配结果', en: 'No matches' },

  // ── 聊天 ──
  'chat.placeholder': { zh: '给 {name} 发送消息', en: 'Message {name}' },
  'chat.searchInChat': { zh: '在对话中搜索…', en: 'Search this chat…' },
  'chat.expandAll': { zh: '展开全文', en: 'Show all' },
  'chat.collapse': { zh: '收起', en: 'Collapse' },
  'chat.expand': { zh: '展开', en: 'Expand' },
  'chat.you': { zh: '你', en: 'You' },
  'chat.assistant': { zh: '助手', en: 'Assistant' },
  'chat.copyMarkdown': { zh: '复制 Markdown', en: 'Copy Markdown' },
  'chat.emptyHint': { zh: '开始一段新对话', en: 'Start a new conversation' },
  'chat.disclaimer': { zh: '{name} 可能会犯错，请核查重要信息。', en: '{name} can make mistakes. Check important info.' },
  'chat.attach': { zh: '附件', en: 'Attach' },
  'chat.voiceInput': { zh: '语音输入', en: 'Voice input' },
  'chat.listening': { zh: '正在聆听…', en: 'Listening…' },
  'chat.recording': { zh: '正在录音…', en: 'Recording…' },
  'chat.transcribing': { zh: '识别中…', en: 'Transcribing…' },
  'chat.sessions': { zh: '会话', en: 'Chats' },
  'chat.searchAll': { zh: '搜索标题与全部消息', en: 'Search titles and messages' },
  'chat.today': { zh: '今天', en: 'Today' },
  'chat.yesterday': { zh: '昨天', en: 'Yesterday' },
  'chat.earlier': { zh: '更早', en: 'Earlier' },
  'chat.thisWeek': { zh: '前 7 天', en: 'Previous 7 days' },
  'chat.thisMonth': { zh: '前 30 天', en: 'Previous 30 days' },
  'chat.justNow': { zh: '刚刚', en: 'just now' },
  'chat.minutesAgo': { zh: '{n} 分钟前', en: '{n} min ago' },
  'chat.hoursAgo': { zh: '{n} 小时前', en: '{n} h ago' },
  'chat.daysAgo': { zh: '{n} 天前', en: '{n} d ago' },
  'chat.messages': { zh: '{n} 条消息', en: '{n} messages' },
  'chat.charCount': { zh: '{n} 字', en: '{n} chars' },
  'chat.backToBottom': { zh: '回到底部', en: 'Back to bottom' },

  // ── 输入区 ──
  'composer.goal': { zh: '目标', en: 'Goal' },
  'composer.research': { zh: '调研', en: 'Research' },
  'composer.plan': { zh: '计划模式', en: 'Plan mode' },
  'composer.editable': { zh: '可编辑', en: 'Editable' },
  'composer.kbOn': { zh: '知识库', en: 'Knowledge' },
  'composer.stop': { zh: '停止生成', en: 'Stop generating' },

  // ── 技能市场 ──
  'skills.title': { zh: 'Skills 市场', en: 'Skills market' },
  'skills.subtitle': { zh: '真实技能市场：Anthropic 官方与社区仓库，一键安装', en: 'Real skills from Anthropic official and community repos' },
  'skills.tab.local': { zh: '市场', en: 'Market' },
  'skills.tab.remote': { zh: '在线市场', en: 'Online' },
  'skills.tab.installed': { zh: '已安装', en: 'Installed' },
  'skills.search': { zh: '搜索 Skills…', en: 'Search skills…' },
  'skills.searchOnline': { zh: '搜索官方与社区技能…', en: 'Search official and community skills…' },
  'skills.filter.all': { zh: '全部', en: 'All' },
  'skills.filter.official': { zh: 'Anthropic 官方', en: 'Anthropic official' },
  'skills.filter.community': { zh: '社区', en: 'Community' },
  'skills.viewMd': { zh: '查看 SKILL.md', en: 'View SKILL.md' },
  'skills.hideMd': { zh: '收起说明', en: 'Hide details' },
  'skills.installFromGithub': { zh: '粘贴 GitHub 仓库 URL 安装…', en: 'Paste a GitHub repo URL to install…' },
  'skills.emptyInstalled': { zh: '暂无已安装的 Skills', en: 'No skills installed yet' },
  'skills.stale': { zh: '缓存数据（网络不可达）', en: 'Cached data (offline)' },

  // ── 设置 ──
  'settings.title': { zh: '设置', en: 'Settings' },
  'settings.model': { zh: '模型', en: 'Model' },
  'settings.appearance': { zh: '外观', en: 'Appearance' },
  'settings.language': { zh: '语言', en: 'Language' },
  'settings.theme': { zh: '主题', en: 'Theme' },
  'settings.theme.light': { zh: '浅色', en: 'Light' },
  'settings.theme.dark': { zh: '深色', en: 'Dark' },
  'settings.theme.system': { zh: '跟随系统', en: 'System' },
  'settings.fontSize': { zh: '聊天字号', en: 'Chat font size' },
  'settings.data': { zh: '数据', en: 'Data' },
  'settings.permissions': { zh: '权限', en: 'Permissions' },
  'settings.about': { zh: '关于', en: 'About' },
  'settings.version': { zh: '版本', en: 'Version' },
  'settings.checkUpdate': { zh: '检查更新', en: 'Check for updates' },
  'settings.legal': { zh: '用户协议与隐私政策', en: 'Terms & Privacy' },
  'settings.remote': { zh: '手机远程', en: 'Phone remote' },
  'settings.copyRemote': { zh: '复制手机远程地址', en: 'Copy phone remote link' },
  'settings.seedColor': { zh: '种子色', en: 'Accent color' },
  'settings.autoTitle': { zh: 'AI 自动标题', en: 'Auto-generate titles' },

  // ── 文件/代码/终端 ──
  'files.title': { zh: '文件', en: 'Files' },
  'files.empty': { zh: '未设置工作目录（在顶栏选择目录后浏览文件）', en: 'No workspace selected (pick a folder in the top bar)' },
  'files.preview': { zh: '预览', en: 'Preview' },
  'code.title': { zh: '代码', en: 'Code' },
  'code.terminal': { zh: '终端', en: 'Terminal' },
  'code.diff': { zh: '改动', en: 'Diff' },
  'terminal.title': { zh: '终端', en: 'Terminal' },
  'terminal.dangerConfirm': { zh: '这个命令可能影响系统，确认执行？', en: 'This command may affect your system. Run it?' },

  // ── 其他面板 ──
  'memory.title': { zh: '记忆', en: 'Memory' },
  'memory.empty': { zh: '还没有长期记忆', en: 'No long-term memories yet' },
  'tasks.title': { zh: '任务', en: 'Tasks' },
  'tasks.empty': { zh: '还没有定时任务', en: 'No scheduled tasks yet' },
  'outputs.title': { zh: '产出', en: 'Outputs' },
  'outputs.empty': { zh: '还没有生成的文件', en: 'No generated files yet' },
  'kb.title': { zh: '知识库', en: 'Knowledge base' },
  'kb.empty': { zh: '知识库还是空的', en: 'Knowledge base is empty' },
  'about.title': { zh: '关于', en: 'About' },
  'about.changelog': { zh: '更新日志', en: 'Changelog' },
  'about.upToDate': { zh: '已是最新版本', en: 'You are up to date' },
  'about.updateAvailable': { zh: '有新版本可用', en: 'Update available' },
  'about.installUpdate': { zh: '立即更新', en: 'Update now' },

  // ── 错误与网络 ──
  'err.network': { zh: '网络连接失败', en: 'Network error' },
  'err.timeout': { zh: '请求超时', en: 'Request timed out' },
  'err.unauthorized': { zh: '未授权，请检查 API Key', en: 'Unauthorized — check your API key' },
  'err.rateLimit': { zh: '请求过于频繁，稍后再试', en: 'Rate limited — try again shortly' },
  'err.server': { zh: '服务异常', en: 'Server error' },
  'err.unknown': { zh: '未知错误', en: 'Unknown error' },
  'err.copyFailed': { zh: '复制失败', en: 'Copy failed' },

  // ── 移动端 ──
  'mobile.menu': { zh: '菜单', en: 'Menu' },
  'mobile.sidebar': { zh: '会话列表', en: 'Chat list' },
  'mobile.tapToClose': { zh: '点击关闭', en: 'Tap to close' },
  'mobile.localMode': { zh: '本机模式', en: 'On-device' },
  'mobile.remoteMode': { zh: '远程模式', en: 'Remote' },
  'mobile.startLocal': { zh: '启动本机服务', en: 'Start on-device service' },
  'mobile.detectLocal': { zh: '检测本机服务', en: 'Detect on-device service' },
  'mobile.connecting': { zh: '正在连接…', en: 'Connecting…' },
  'mobile.installHint': { zh: '添加到主屏幕，获得全屏体验', en: 'Add to home screen for a full-screen app' },
  // ── 补充（面板与设置高频） ──
  'settings.search': { zh: '搜索设置…', en: 'Search settings…' },
  'settings.shortcuts': { zh: '快捷键', en: 'Shortcuts' },
  'settings.notifications': { zh: '通知', en: 'Notifications' },
  'settings.voice': { zh: '语音', en: 'Voice' },
  'settings.research': { zh: '调研', en: 'Research' },
  'chat.versions': { zh: '{n} 个版本', en: '{n} versions' },
  'chat.branchFrom': { zh: '从此分叉', en: 'Branch from here' },
  'chat.thinkLevel': { zh: '思考档位', en: 'Thinking level' },
  'skills.by': { zh: 'by {name}', en: 'by {name}' },
  'common.yes': { zh: '是', en: 'Yes' },
  'common.no': { zh: '否', en: 'No' },
  'state.on': { zh: '开', en: 'On' },
  'state.off': { zh: '关', en: 'Off' },
  'state.done': { zh: '完成', en: 'Done' },
  'state.pending': { zh: '待处理', en: 'Pending' },
  'mobile.openSidebar': { zh: '会话列表', en: 'Chat list' },
  'files.pickFolder': { zh: '选择工作目录', en: 'Pick workspace folder' },
  'kb.search': { zh: '搜索笔记…', en: 'Search notes…' },
  'tasks.due': { zh: '计划时间', en: 'Schedule' },
  'memory.count': { zh: '{n} 条记忆', en: '{n} memories' },
}


/** 取词；缺键时回退到 key（并在测试里被扫出来） */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const e = STRINGS[key]
  let s = e ? (lang === 'en' ? e.en : e.zh) : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  }
  return s
}

/** 列出某种语言的空文案（构建/测试用） */
export function emptyKeys(lang: Lang): string[] {
  return Object.entries(STRINGS).filter(([, e]) => !String(e[lang] || '').trim()).map(([k]) => k)
}

/** 中英条目数量不一致的键（结构体检） */
export function brokenEntries(): string[] {
  return Object.entries(STRINGS).filter(([, e]) => !e.zh || !e.en).map(([k]) => k)
}

/** 相对时间文案（聊天列表用） */
export function relativeTime(lang: Lang, ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return translate(lang, 'chat.justNow')
  if (min < 60) return translate(lang, 'chat.minutesAgo', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return translate(lang, 'chat.hoursAgo', { n: h })
  return translate(lang, 'chat.daysAgo', { n: Math.floor(h / 24) })
}
