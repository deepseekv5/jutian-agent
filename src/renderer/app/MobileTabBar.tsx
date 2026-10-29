import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { PageType } from './TabBar'

/**
 * 手机底部导航（v13.5）
 *
 * 桌面靠侧栏切换工作区；手机上侧栏是抽屉，抽屉关着时没有任何入口，
 * 所以补一条底部导航：对话 / 代码 / 文件 / 设置 四个高频入口。
 * 仅在 <768px 显示（CSS .mobile-tabbar 控制），桌面零影响。
 */
const ITEMS: { type: PageType; key: string; icon: string }[] = [
  { type: 'chat', key: 'nav.chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { type: 'code', key: 'nav.code', icon: 'M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z' },
  { type: 'files', key: 'nav.files', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
  { type: 'settings', key: 'nav.settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
]

export default function MobileTabBar({ activeType, onPick }: { activeType: PageType | null; onPick: (t: PageType) => void }) {
  const { c } = useTheme()
  const { tt } = useLanguage()
  return (
    <nav className="mobile-tabbar items-stretch shrink-0 border-t" style={{ borderColor: c.border, background: c.bg }} aria-label={tt('mobile.menu')}>
      {ITEMS.map(it => {
        const active = activeType === it.type
        return (
          <button key={it.type} onClick={() => onPick(it.type)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
            style={{ color: active ? c.accent : c.textTertiary }}
            aria-label={tt(it.key)} aria-current={active ? 'page' : undefined}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={it.icon} />
            </svg>
            <span className="text-[10px] leading-none">{tt(it.key)}</span>
          </button>
        )
      })}
    </nav>
  )
}
