/**
 * 视口断点（v13.5）—— 多端适配的唯一判据来源
 *
 * 之前整个应用只有 40 处 sm:/md: 类，布局基本按桌面写死：
 * 手机上侧栏挤占一半宽度、设置弹窗溢出、触摸目标太小。
 *
 * 断点约定（与 Tailwind 默认一致，避免两套语义）：
 *   mobile  < 768px   手机
 *   tablet  768-1099  平板/小窗
 *   desktop >= 1100   桌面
 */
import { useEffect, useState } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

export function breakpointOf(width: number): Breakpoint {
  if (width < 768) return 'mobile'
  if (width < 1100) return 'tablet'
  return 'desktop'
}

/** 触摸设备判定：触摸目标要放大到 44px（Apple HIG / Material 共同建议） */
export function isCoarsePointer(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

export interface Viewport {
  width: number
  height: number
  bp: Breakpoint
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  /** 触摸优先设备（手机/平板） */
  touch: boolean
}

function read(): Viewport {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  const bp = breakpointOf(w)
  return {
    width: w,
    height: h,
    bp,
    isMobile: bp === 'mobile',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
    touch: typeof window !== 'undefined' ? isCoarsePointer() : false,
  }
}

/** 订阅视口变化（resize 节流到动画帧） */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(read)
  useEffect(() => {
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setVp(read()))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])
  return vp
}

/**
 * 移动端软键盘高度（visualViewport 方案）。
 * iOS/Android WebView 里键盘弹出会压缩可视区，输入框必须跟着抬起来，
 * 否则正在打的字被键盘盖住。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = (window as any).visualViewport
    if (!vv) return
    const onResize = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setInset(hidden > 80 ? hidden : 0) // 小于 80px 是地址栏抖动，不算键盘
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])
  return inset
}
