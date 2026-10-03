import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'

interface Props {
  onClose: () => void
  title?: string
  /** 页面副标题（企业级页头：标题 + 描述 + 操作区） */
  description?: string
  /** 页头右侧操作区（保存/新建等按钮） */
  actions?: React.ReactNode
  children: React.ReactNode
  icon?: string
  /** 内容区是否通铺（表格/文件类页面用），默认限宽居中 */
  wide?: boolean
  /** 内容区撑满高度、无内边距（笔记/图谱等自管布局的多栏页面用） */
  fill?: boolean
}

export default function PageShell({ onClose, title, description, actions, children, icon, wide, fill }: Props) {
  const { c } = useTheme()

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 页头：面包屑层级 + 标题 + 描述 + 操作区 */}
      <div className="shrink-0 px-5 pt-4 pb-3 border-b glass" style={{ borderColor: c.borderLight }}>
        <div className="flex items-start gap-3">
          {icon && (
            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: c.bgInput, color: c.textSecondary }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold leading-5" style={{ color: c.textHead }}>{title}</h2>
            {description && <p className="text-[11.5px] mt-0.5" style={{ color: c.textTertiary }}>{description}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: c.textTertiary }}
              onMouseEnter={e => e.currentTarget.style.background = c.bgHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              title="关闭" aria-label="关闭">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      {fill ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className={wide ? 'px-5 py-4' : 'max-w-4xl mx-auto px-6 py-5'}>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
