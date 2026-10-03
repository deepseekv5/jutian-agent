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
    const dark = theme === 'dark'
    return (
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }} aria-hidden>
        <div style={{ position: 'absolute', inset: 0, background: dark ? '#0a0a0c' : '#f7f7f9' }} />
        <div style={{
          position: 'absolute', width: '58vw', height: '58vw', left: '-12vw', top: '-18vw', borderRadius: '50%',
          background: dark ? 'radial-gradient(circle, rgba(16,163,127,.15), transparent 62%)' : 'radial-gradient(circle, rgba(16,163,127,.10), transparent 62%)',
        }} />
        <div style={{
          position: 'absolute', width: '50vw', height: '50vw', right: '-14vw', bottom: '-16vw', borderRadius: '50%',
          background: dark ? 'radial-gradient(circle, rgba(56,189,248,.08), transparent 64%)' : 'radial-gradient(circle, rgba(59,130,246,.06), transparent 64%)',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(${dark ? 'rgba(255,255,255,.016)' : 'rgba(0,0,0,.014)'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? 'rgba(255,255,255,.016)' : 'rgba(0,0,0,.014)'} 1px, transparent 1px)`,
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 90% 80% at 50% 45%, black 30%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 80% at 50% 45%, black 30%, transparent 85%)',
        }} />
      </div>
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
