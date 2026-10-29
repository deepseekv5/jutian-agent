/**
 * 全局命令面板（Cmd+K）：应用内快速跳转 + 对话搜索 + 键盘导航。
 * ChatGPT / Raycast 风格：居中浮层、↑↓ 选择、Enter 执行、Esc 关闭。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { Session } from '../types'

interface CmdItem {
  id: string
  label: string
  /** 英文文案（缺省回退中文）—— 命令面板是高频入口，英文必须齐 */
  labelEn?: string
  hint?: string
  hintEn?: string
  icon: string
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  onOpenTab: (type: string) => void
  sessions: Session[]
  onSelectSession: (sid: string) => void
  onCreateSession: () => void
}

export default function CommandPalette({ open, onClose, onOpenTab, sessions, onSelectSession, onCreateSession }: Props) {
  const { t, lang } = useLanguage()
  const { c } = useTheme()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setCursor(0) } }, [open])

  const items = useMemo<CmdItem[]>(() => {
    const cmds: CmdItem[] = [
      { id: 'new', label: '新建对话', labelEn: "New chat", hint: '开始一段新对话', hintEn: "Start a new conversation", icon: 'M12 4v16m8-8H4', run: () => { onCreateSession(); onClose() } },
      { id: 'persona', label: '打开 AI 角色', labelEn: "Open AI personas", hint: '有长期记忆的对话角色 · 免费直接聊', hintEn: "Personas with long-term memory — free", icon: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z', run: () => { onOpenTab('persona'); onClose() } },
      { id: 'research', label: '打开深度调研', labelEn: "Deep research", hint: '多路检索 → 交叉验证 → 带引用的报告', hintEn: "Multi-source search → cross-check → cited report", icon: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z', run: () => { onOpenTab('research'); onClose() } },
      { id: 'code', label: '打开 Code 工作台', labelEn: "Open code workspace", hint: '编辑器 / 终端 / AI 编程', hintEn: "Editor / terminal / AI coding", icon: 'M8 9l-3 3 3 3m8-6l3 3-3 3M14 5l-4 14', run: () => { onOpenTab('code'); onClose() } },
      { id: 'kb', label: '打开知识库', labelEn: "Open knowledge base", hint: '笔记 / 双链 / 关系图谱', hintEn: "Notes / backlinks / graph", icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', run: () => { onOpenTab('kb'); onClose() } },
      { id: 'diary', label: '打开日记', labelEn: "Open diary", hint: '记录每一天（Beta）', hintEn: "Write down every day (Beta)", icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', run: () => { onOpenTab('diary'); onClose() } },
      { id: 'call', label: '开始通话', labelEn: "Start voice call", hint: '语音对话模式', hintEn: "Talk to the agent", icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z', run: () => { onOpenTab('call'); onClose() } },
      { id: 'files', label: '打开文件', labelEn: "Open files", hint: '授权目录文件浏览', hintEn: "Browse your workspace", icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', run: () => { onOpenTab('files'); onClose() } },
      { id: 'ppt', label: '生成 PPT', labelEn: "Generate slides", hint: 'AI 驱动的演示文稿', hintEn: "AI-made presentations", icon: 'M9 17v-6h6v6m-7 4h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z', run: () => { onOpenTab('ppt'); onClose() } },
      { id: 'skills', label: '技能市场', labelEn: "Skills market", hint: '安装 / 管理 Skill', hintEn: "Install / manage skills", icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', run: () => { onOpenTab('skills'); onClose() } },
      { id: 'tasks', label: '定时任务', labelEn: "Scheduled tasks", hint: '周期性自动执行', hintEn: "Run automatically on schedule", icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', run: () => { onOpenTab('tasks'); onClose() } },
      { id: 'templates', label: '提示词模板库', labelEn: "Prompt templates", hint: '10 个可复用模板，填参数直接用', hintEn: "10 reusable templates", icon: 'M4 5a2 2 0 012-2h3l2 2h7a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V5z', run: () => { onOpenTab('templates'); onClose() } },
      { id: 'snippets', label: '代码片段库', labelEn: "Code snippets", hint: '存常用片段，触发器一键展开', hintEn: "Save snippets, expand with a trigger", icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', run: () => { onOpenTab('snippets'); onClose() } },
      { id: 'usage', label: '用量与成本', labelEn: "Usage & cost", hint: 'Token 趋势 / 按模型花费', hintEn: "Token trend / spend per model", icon: 'M3 3v18h18M7 14l4-4 3 3 4-6', run: () => { onOpenTab('usage'); onClose() } },
      { id: 'diagnostics', label: '环境诊断', labelEn: "Diagnostics", hint: '一键自检并复制报告', hintEn: "One-click self-check and report", icon: 'M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', run: () => { onOpenTab('diagnostics'); onClose() } },
      { id: 'export', label: '导出会话', labelEn: "Export chats", hint: '多选合并 · 可按角色/关键词筛选', hintEn: "Merge selection, filter by role/keyword", icon: 'M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z', run: () => { onOpenTab('export'); onClose() } },
      { id: 'compare', label: '多模型对比', labelEn: "Compare models", hint: '同一问题并行生成并排看', hintEn: "Ask once, see answers side by side", icon: 'M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h2m8-14h2a2 2 0 012 2v10a2 2 0 01-2 2h-2m-6-6h6', run: () => { onOpenTab('compare'); onClose() } },
      { id: 'todos', label: '待办清单', labelEn: "Todo list", hint: 'AI 维护的工作清单', hintEn: "The plan the agent maintains", icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', run: () => { onOpenTab('todos'); onClose() } },
      { id: 'backup', label: '数据备份', labelEn: "Backup & restore", hint: '选范围导出 / 导入恢复', hintEn: "Export a range / import to restore", icon: 'M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v8', run: () => { onOpenTab('backup'); onClose() } },
      { id: 'shortcuts', label: '快捷键一览', labelEn: "Keyboard shortcuts", hint: '查看全部快捷键', hintEn: "See all shortcuts", icon: 'M3 6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm4 4h.01M11 10h.01M15 10h.01M7 14h10', run: () => { onOpenTab('shortcuts'); onClose() } },
      { id: 'settings', label: '打开设置', labelEn: "Open settings", hint: '推理 / 外观 / 安全', hintEn: "Reasoning / appearance / security", icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', run: () => { onOpenTab('settings'); onClose() } },
    ]
    const chatCmds: CmdItem[] = sessions.slice(0, 30).map(s => ({
      id: `chat_${s.id}`,
      label: typeof s.title === 'string' && s.title.trim() ? s.title : '新对话',
      hint: '切换到该对话',
      icon: 'M8 10h8M8 14h5M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
      run: () => { onSelectSession(s.id); onClose() },
    }))
    // 1024 彩蛋（v12.3）：节日窗口内，输入 1024 才能命中，平时不出现在列表
    if (q.trim() === '1024') {
      cmds.unshift({
        id: 'egg1024', label: '1024 · 程序员节彩蛋', hint: '点开看看',
        icon: 'M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3L4.3 7.6l5.3-.8z',
        run: () => { window.dispatchEvent(new CustomEvent('open-festival-egg')); onClose() },
      })
    }
    const all = [...cmds, ...chatCmds]
    const query = q.trim().toLowerCase()
    if (!query) return [...cmds, ...chatCmds.slice(0, 6)]
    return all.filter(i => i.label.toLowerCase().includes(query) || (i.hint || '').toLowerCase().includes(query)).slice(0, 12)
  }, [q, sessions, onOpenTab, onSelectSession, onCreateSession, onClose])

  useEffect(() => { setCursor(0) }, [q])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(i => Math.min(i + 1, items.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); items[cursor]?.run() }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [open, items, cursor, onClose])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[14vh]" style={{ background: 'rgba(0,0,0,0.35)' }} onMouseDown={onClose}>
      <div className="modal-fullscreen-mobile w-[560px] max-w-[92%] rounded-2xl overflow-hidden shadow-2xl animate-cmd-in glass-strong"
        style={{ border: `1px solid ${c.border}` }} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-12 border-b" style={{ borderColor: c.borderLight }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: c.textTertiary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder={t("搜索命令或对话…", "Search commands or chats…")} className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: c.text }} />
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>Esc</span>
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5 scrollbar-thin">
          {items.length === 0 && <div className="px-4 py-6 text-center text-[12.5px]" style={{ color: c.textMuted }}>{t('没有匹配的命令', 'No matching commands')}</div>}
          {items.map((item, i) => (
            <button key={item.id} data-idx={i}
              onMouseEnter={() => setCursor(i)} onClick={() => item.run()}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
              style={{ background: i === cursor ? c.bgHover : 'transparent' }}>
              <svg className="w-4 h-4 shrink-0" style={{ color: i === cursor ? c.accent : c.textTertiary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="text-[13.5px] font-medium truncate" style={{ color: i === cursor ? c.textHead : c.text }}>{lang === 'en' && item.labelEn ? item.labelEn : item.label}</span>
              {item.hint && <span className="ml-auto text-[11px] truncate max-w-[40%]" style={{ color: c.textMuted }}>{lang === 'en' && item.hintEn ? item.hintEn : item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
      <style>{`@keyframes cmd-in { from { opacity: 0; transform: translateY(-8px) scale(.98) } to { opacity: 1; transform: none } }
        .animate-cmd-in { animation: cmd-in .16s ease }`}</style>
    </div>
  )
}
