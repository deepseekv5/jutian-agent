/**
 * LiquidGlassLens —— 真实 WebGL 折射透镜 React 组件。
 *
 * 在父容器的内容之下渲染一层折射玻璃：fragment shader 用 SDF 求圆角矩形边缘法线，
 * 按 Snell 定律偏折采样「背景场」，叠加色散、边缘高光和顶部 sheen。
 * 因为浏览器无法把 DOM 直接当纹理，这里折射的是绘制进离屏 canvas 的背景场纹理
 * （CSS 渐变串 / 图片 dataUrl / 内置蓝紫绿彩光场）。
 *
 * 使用方式：父容器必须 position:relative；组件作为其绝对定位的子层，
 * z-index 放在内容之下即可（参考 CSS 文件中的说明）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import {
  LiquidGlassRenderer,
  resolveMaterial,
  type MaterialInput,
} from './liquidGlassGL'
import './LiquidGlassLens.css'

export interface LiquidGlassLensProps {
  /** 背景纹理：CSS 渐变串 / 纯色 / 图片 URL 或 dataUrl；不传则使用内置彩光场 */
  background?: string
  /** 材质预设或自定义折射/模糊/色散 */
  material?: MaterialInput
  /** 圆角（CSS 像素） */
  radius?: number
  className?: string
  style?: CSSProperties
  /** 鼠标/触摸拖动时透镜跟手并产生 jelly 弹性形变 */
  interactive?: boolean
  /** 无障碍标签（装饰性图层默认为 aria-hidden） */
  ariaLabel?: string
}

export default function LiquidGlassLens({
  background,
  material = 'soft',
  radius = 24,
  className,
  style,
  interactive = false,
  ariaLabel,
}: LiquidGlassLensProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<LiquidGlassRenderer | null>(null)
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const [fallback, setFallback] = useState(false)

  const materialKey = typeof material === 'string'
    ? material
    : `${material.refraction}:${material.blur}:${material.dispersion}:${material.thickness ?? 1}:${material.tint ?? 0.1}`

  // 初始化 WebGL 渲染器；失败/上下文丢失时切到 CSS fallback。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: LiquidGlassRenderer
    try {
      renderer = new LiquidGlassRenderer(canvas, {
        background,
        material: resolveMaterial(material),
        radius,
        reducedMotion,
        onState: (state) => setFallback(state === 'lost'),
      })
      renderer.init()
    } catch (error) {
      // 无 WebGL / shader 编译失败：静默回退到半透明 CSS 材质。
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[LiquidGlassLens] WebGL 初始化失败，使用 CSS fallback', error)
      }
      setFallback(true)
      return
    }
    rendererRef.current = renderer

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => renderer.resize())
      : null
    observer?.observe(canvas)

    const onVisibility = (): void => {
      // 回到前台时补一帧，避免页面隐藏期间的状态变化没有反映。
      if (!document.hidden) renderer.invalidate()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      renderer.destroy()
      rendererRef.current = null
    }
    // 材质/半径/背景的变化通过下方独立的 effect 增量更新，不重建 WebGL 上下文。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    rendererRef.current?.setMaterial(resolveMaterial(typeof material === 'string' ? material : {
      refraction: material.refraction,
      blur: material.blur,
      dispersion: material.dispersion,
      thickness: material.thickness,
      tint: material.tint,
    }))
    // materialKey 覆盖对象字面量每次渲染都变化的情况。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialKey])

  useEffect(() => {
    rendererRef.current?.setRadius(radius)
  }, [radius])

  useEffect(() => {
    rendererRef.current?.setBackground(background)
  }, [background])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.setPointerFromClient(event.clientX, event.clientY)
    const drag = dragRef.current
    if (interactive && drag && drag.id === event.pointerId) {
      renderer.nudge(event.clientX - drag.x, event.clientY - drag.y)
      drag.x = event.clientX
      drag.y = event.clientY
    }
  }, [interactive])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return
    const renderer = rendererRef.current
    if (!renderer) return
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    renderer.setPressed(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [interactive])

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.id !== event.pointerId) return
    dragRef.current = null
    rendererRef.current?.setPressed(false)
    rendererRef.current?.release()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onPointerEnter = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    rendererRef.current?.setPointerFromClient(event.clientX, event.clientY)
  }, [])

  return (
    <div
      className={['lg-lens', interactive ? 'lg-lens--interactive' : '', fallback ? 'lg-lens--fallback' : '', className || ''].filter(Boolean).join(' ')}
      style={{ borderRadius: radius, ...style }}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerEnter={onPointerEnter}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}>
      <canvas ref={canvasRef} className="lg-lens__canvas" aria-hidden="true" />
      {/* CSS fallback：WebGL 不可用/上下文丢失时回退到半透明磨砂材质 */}
      <div className="lg-lens__fallback" aria-hidden="true" />
    </div>
  )
}
