/**
 * 背景层：图片 / 视频，透明度随主题。关键优化：窗口隐藏时暂停视频解码，
 * 避免 60fps 满分辨率后台烧 CPU/GPU。
 */
import { useRef, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'

interface Props {
  bgImage: string
  opacity: number
}

export default function BackgroundLayer({ bgImage, opacity: bgOpacity }: Props) {
  const { theme } = useTheme()
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const isVideo = /\.(mp4|mov|webm)$/i.test(bgImage)
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const ext = bgImage.split('.').pop()?.toLowerCase() || 'mp4'
  const mimeType = ext === 'mov' ? 'video/quicktime' : `video/${ext}`

  // 窗口隐藏/不可见时暂停视频
  useEffect(() => {
    if (!isVideo) return
    const onVis = () => {
      const v = videoRef.current
      if (!v) return
      if (document.hidden) v.pause()
      else v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [isVideo])

  if (!bgImage) {
    // 关闭壁纸 → 高级渐变背景（随主题，双层径向光晕 + 细网格；纯静态无动画，GPU 友好）
    const party = theme === 'party'
    // v15.6.0：默认纯净实底。Codex 的核心是「纸面留白 + 一条细分隔线」，
    // 满屏径向光晕/网格/视频会让文字发虚、界面发脏。党政红保留极淡暖纸色。
    if (party) return (
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, background: '#faf7f0' }} aria-hidden />
    )
    return (
      // v16.4.0：走 --jt-paper token（值与原硬编码一致，但跟随主题变量，避免与主题机制脱节）
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, background: 'var(--jt-paper)' }} aria-hidden />
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }} aria-hidden>
      {isVideo && !reduceMotion ? (
        <video ref={videoRef} autoPlay={!reduceMotion} loop={!reduceMotion} muted playsInline preload="auto"
          onCanPlay={(e) => { const v = e.currentTarget; v.play().catch(() => {}) }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: bgOpacity, filter: 'brightness(1.1)' }}>
          <source src={bgImage} type={mimeType} />
        </video>
      ) : (
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url('${bgImage}')`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: bgOpacity, filter: 'brightness(1.1)' }} />
      )}
    </div>
  )
}
