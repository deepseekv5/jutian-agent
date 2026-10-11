/**
 * 模态行为 —— Esc 关闭 + 焦点圈定 + 打开时聚焦
 *
 * 审计发现：4 个模态里只有 CommandPalette 有 Esc 与焦点管理，
 * SettingsModal（全应用最重的面板）、NewProjectDialog、CliInstallModal
 * 都没有——键盘用户按 Esc 无反应，Tab 会跑到模态背后的界面上。
 *
 * 用法（挂在外层模态容器上）：
 *   const ref = useModalBehavior(onClose)
 *   <div ref={ref} role="dialog" aria-modal="true">…</div>
 *
 * 只在非 embedded 模式启用 Esc 关闭：设置页作为标签页内嵌时，
 * Esc 不应该把它关掉（那会与"关闭标签页"的语义冲突）。
 */
import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalBehavior(onClose?: () => void, opts?: {
  /** 关闭禁用（如 embedded 内嵌模式），只保留焦点圈定 */
  disableEsc?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const disableEscRef = useRef(!!opts?.disableEsc)
  disableEscRef.current = !!opts?.disableEsc

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // 打开时把焦点移进模态（否则 Tab 从背后界面开始）
    const first = el.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disableEscRef.current) {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      // 焦点圈定：Tab 在模态内循环，不逃到背后的界面
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(n => n.offsetParent !== null)  // 跳过不可见元素
      if (items.length === 0) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === firstEl || !el.contains(active))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    // 捕获阶段监听：先于模态内部输入框自己的 Esc 处理（如搜索框清空）
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  return ref
}
