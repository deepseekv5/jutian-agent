/**
 * 模态行为 —— Esc 关闭 + 焦点圈定 + 打开时聚焦
 *
 * 供模态容器统一使用：键盘用户按 Esc 关闭，Tab 焦点在模态内循环，
 * 不逃到背后的界面上；打开时自动聚焦首个可聚焦元素。
 *
 * 用法（挂在外层模态容器上）：
 *   const ref = useModalBehavior(onClose)
 *   <div ref={ref} role="dialog" aria-modal="true">…</div>
 *
 * 内嵌模式（设置页作为标签页）传 disableEsc：此时 Esc 留给"关闭标签页"，
 * 避免与标签语义冲突。
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
