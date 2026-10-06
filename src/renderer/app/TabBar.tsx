import { useEffect, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

export type PageType = 'chat' | 'files' | 'terminal' | 'ppt' | 'outputs' | 'skills' | 'code' | 'memory' | 'tasks' | 'qqbot' | 'settings' | 'about' | 'call' | 'kb' | 'diary' | 'employees' | 'employee' | 'group' | 'plugins' | 'newtab' | 'freemodels'

export interface WorkTab {
  id: string
  type: PageType
  title: string
  sessionId?: string
  /** employee/group 标签指向的员工或群组 id */
  refId?: string
  /** 覆盖默认图标（员工/群组用专属 svg path） */
  iconPath?: string
}

export const PAGE_META: Record<PageType, { label: string; labelEn?: string; icon: string }> = {
  chat: { label: '对话', labelEn: 'Chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  files: { label: '文件', labelEn: 'Files', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
  terminal: { label: '终端', labelEn: 'Terminal', icon: 'M8 9l3 3-3 3m5 0h3M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z' },
  ppt: { label: 'PPT', labelEn: 'PPT', icon: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5' },
  outputs: { label: '产出', labelEn: 'Outputs', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  skills: { label: 'Skills', labelEn: 'Skills', icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
  code: { label: 'Code', labelEn: 'Code', icon: 'M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z' },
  memory: { label: '记忆', labelEn: 'Memory', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
  tasks: { label: '任务', labelEn: 'Tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  qqbot: { label: 'QQ', labelEn: 'QQ', icon: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z' },
  settings: { label: '设置', labelEn: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  about: { label: '关于', labelEn: 'About', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  call: { label: '通话', labelEn: 'Call', icon: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 011.11-.21 11.36 11.36 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.57 1 1 0 01-.21 1.11z' },
  kb: { label: '知识库', labelEn: 'Knowledge', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  diary: { label: '日记', labelEn: 'Diary', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  employees: { label: '集群', labelEn: 'Swarm', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  plugins: { label: '插件', labelEn: 'Plugins', icon: 'M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3L4.3 7.6l5.3-.8z' },
  employee: { label: '员工对话', labelEn: 'Employee', icon: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z' },
  group: { label: '群组', labelEn: 'Group', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z' },
  newtab: { label: '新建标签页', labelEn: 'New Tab', icon: 'M12 4v16m8-8H4' },
  freemodels: { label: '免费模型', labelEn: 'Free AI', icon: 'M12 3l1.9 5.6L20 10l-5.1 2.4L16 18l-4-3-4 3 1.1-5.6L4 10l6.1-1.4L12 3z' },
}

export const SINGLE_INSTANCE: PageType[] = ['ppt', 'outputs', 'skills', 'code', 'memory', 'tasks', 'qqbot', 'settings', 'about', 'call', 'kb', 'diary', 'employees', 'plugins', 'newtab', 'freemodels']

interface Props {
  tabs: WorkTab[]
  activeTabId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onOpenType: (type: PageType) => void
  toolServerOk: boolean | null
  onOpenSettings: () => void
  onOpenWorkDir?: () => void
  workingSessionIds?: Set<string>
}

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onOpenType, toolServerOk, onOpenSettings, onOpenWorkDir, workingSessionIds }: Props) {
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
  return (
    <div className="h-10 flex items-center shrink-0 border-b px-2 gap-1 glass titlebar-drag" style={{ borderColor: c.border, paddingLeft: isMac ? 14 : 8 }}>
      {/* 标签条 */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {tabs.map(tab => {
          const active = tab.id === activeTabId
          const meta = PAGE_META[tab.type]
          const isWorking = !!(tab.sessionId && workingSessionIds?.has(tab.sessionId))
          return (
            <div key={tab.id}
              onClick={() => onSelect(tab.id)}
              onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
              onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
              title={`${tab.title}${tabs.length > 1 ? '（中键关闭）' : ''}`}
              className="group relative flex items-center gap-2 px-2.5 h-7 rounded-lg cursor-pointer transition-colors shrink-0 max-w-[180px] titlebar-nodrag"
              style={{
                background: active ? c.surfaceActive : 'transparent',
                color: active ? c.textHead : c.textTertiary,
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.surfaceHover }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
              {isWorking ? (
                <svg className="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: c.accent }}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.iconPath || meta.icon} />
                </svg>
              )}
              <span className="text-[12.5px] font-medium truncate">{lang === 'en' && !tab.sessionId && !tab.refId && meta.labelEn ? meta.labelEn : tab.title}</span>
              {active && <span className="absolute left-2.5 right-2.5 -bottom-[5px] h-[2px] rounded-full" style={{ background: c.accent }} />}
              {tabs.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                  className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  style={{ color: c.textTertiary }}
                  onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}

        <button
          onClick={() => onOpenType('newtab')}
          className="w-7 h-7 ml-0.5 rounded-lg flex items-center justify-center transition-colors shrink-0 titlebar-nodrag"
          style={{ color: c.textTertiary }}
          onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          title="新建标签页" aria-label="新建标签页">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* 右侧状态区 */}
      <div className="flex items-center gap-1 shrink-0 titlebar-nodrag">

        {onOpenWorkDir && (
          <button onClick={onOpenWorkDir} className="btn-icon" title="打开工作目录" aria-label="打开工作目录">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        )}
        <div className="flex items-center px-1" title={toolServerOk === null ? '连接中' : toolServerOk ? '服务在线' : '服务离线'}>
          <div className="w-2 h-2 rounded-full" style={{ background: toolServerOk === null ? c.toolWarn : toolServerOk ? c.toolOk : c.toolErr }} />
        </div>
        <button onClick={() => onOpenType('call')} className="btn-icon" title="语音通话（打电话模式）" aria-label="语音通话">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 011.11-.21 11.36 11.36 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.57 1 1 0 01-.21 1.11z" />
          </svg>
        </button>
        <button onClick={onOpenSettings} className="btn-icon" title="设置" aria-label="设置">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
