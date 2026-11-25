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
  /** 液态玻璃总开关（v18.5.0）：全标签页覆盖按钮/输入/卡片/面板，可一键关闭回到纯净实底 */
  liquidGlass: boolean
  /** 光学强度 0-100：控制折射高光/弹性反馈的显著程度 */
  glassIntensity: number
}

export const DEFAULT_VISUAL: VisualSettings = {
  glassBlur: 12,
  bgImage: '',  // v15.6.0：默认纯净实底（Codex 风）；用户可在设置里手动开内置视频/自定义壁纸
  bgOpacityLight: 0.5,
  bgOpacityDark: 0.6,
  liquidGlass: true,      // v18.5.0：默认开启液态玻璃
  glassIntensity: 60,
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
  document.documentElement.style.setProperty('--glass-intensity', String(v.glassIntensity ?? DEFAULT_VISUAL.glassIntensity))
  document.documentElement.setAttribute('data-liquid-glass', v.liquidGlass === false ? 'off' : 'on')
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