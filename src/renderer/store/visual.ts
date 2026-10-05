/**
 * 视觉设置（毛玻璃强度 / 壁纸 / 壁纸透明度）的持久化读写。
 * 设置页与主界面都要读同一份默认值，故集中在此，避免两处默认值漂移。
 */

const KEY = 'visual-settings'

export interface VisualSettings {
  glassBlur: number
  bgImage: string
  bgOpacityLight: number
  bgOpacityDark: number
}

export const DEFAULT_VISUAL: VisualSettings = {
  glassBlur: 12,
  bgImage: '/bg_upload.mp4',
  bgOpacityLight: 0.5,
  bgOpacityDark: 0.6,
}

/** 读取视觉设置；解析失败时回落到默认值 */
export function loadVisualSettings(): VisualSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_VISUAL, ...JSON.parse(raw) } : { ...DEFAULT_VISUAL }
  } catch {
    return { ...DEFAULT_VISUAL }
  }
}

/** 写入视觉设置并广播变更（设置页 → 主界面实时生效） */
export function saveVisualSettings(v: VisualSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch { /* 隐私模式下 localStorage 不可写，忽略 */ }
  document.documentElement.style.setProperty('--glass-blur', `${v.glassBlur}px`)
  window.dispatchEvent(new Event('visual-changed'))
}

/**
 * 解析实际使用的壁纸地址。
 * 缺失或旧默认 /bg.jpg 一律回落到内置动态视频壁纸；用户显式设 '' 表示关闭壁纸。
 */
export function resolveWallpaper(bgImage?: string): string {
  if (bgImage === '') return ''
  return !bgImage || bgImage === '/bg.jpg' ? DEFAULT_VISUAL.bgImage : bgImage
}