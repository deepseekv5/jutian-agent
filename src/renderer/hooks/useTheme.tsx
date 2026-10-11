import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react'
import { getSettingsSync, saveSettings } from '../store/storage'
import type { Settings } from '../types'

/**
 * ChatGPT / Codex 官方设计系统
 *
 * Light —— 纯白画布 (#ffffff) + 浅灰侧边栏 (#f9f9f9)，近黑文字，极细边框，无光效
 * Dark  —— ChatGPT 深色：画布 #212121 + 侧边栏 #171717
 *
 * 说明：历史代码中存在 surface* 与 bg* 两套命名，这里统一补齐为等价别名，
 * 避免任一命名取值为 undefined 导致面板背景失效。
 */

/* 毛玻璃主题：画布保持实底（编辑器/正文可读），面板/输入/悬浮全部半透明，
   配合全局 backdrop-filter 形成层次玻璃。无壁纸时与实底视觉等价。 */
const light = {
  // ── 画布 / 表面 ──
  bg: '#ffffff',
  bgAlt: 'rgba(249, 249, 249, 0.55)',
  bgCard: 'rgba(255, 255, 255, 0.6)',
  bgInput: 'rgba(244, 244, 244, 0.55)',
  bgHover: 'rgba(0, 0, 0, 0.045)',
  bgActive: 'rgba(0, 0, 0, 0.08)',
  // 别名
  surface: '#ffffff',
  surfaceAlt: 'rgba(249, 249, 249, 0.55)',
  surfaceCard: 'rgba(255, 255, 255, 0.6)',
  surfaceInput: 'rgba(244, 244, 244, 0.55)',
  surfaceHover: 'rgba(0, 0, 0, 0.045)',
  surfaceActive: 'rgba(0, 0, 0, 0.08)',

  // ── 边框（半透明，玻璃质感的关键）──
  border: 'rgba(0, 0, 0, 0.09)',
  borderLight: 'rgba(0, 0, 0, 0.055)',
  borderFocus: '#0d0d0d',

  // ── 文本 ──
  text: '#0d0d0d',
  textHead: '#0d0d0d',
  textSecondary: '#5d5d5d',
  textTertiary: '#8f8f8f',
  textMuted: '#b4b4b4',

  // ── 强调 ──
  accent: '#0d0d0d',
  accentBg: 'rgba(0, 0, 0, 0.06)',
  accentBorder: '#d9d9d9',
  accentLight: '#6e6e6e',
  accentText: '#ffffff',

  // ── 状态 ──
  toolOk: '#16a34a',
  toolWarn: '#d97706',
  toolErr: '#dc2626',

  // ── 消息 ──
  msgBotBg: 'transparent',
  msgBotText: '#0d0d0d',
  msgUserBg: 'rgba(244, 244, 244, 0.82)',
  msgUserText: '#0d0d0d',
  userBubbleBg: 'rgba(244, 244, 244, 0.82)',
  userBubbleText: '#0d0d0d',

  // ── 品牌 ──
  brand: '#0d0d0d',
  onBrand: '#ffffff',
  onAccent: '#ffffff',
  inputText: '#0d0d0d',

  // ── 侧边栏 ──
  sidebarActiveText: '#0d0d0d',
  sidebarActiveBg: 'rgba(0, 0, 0, 0.08)',
  buttonGhost: 'rgba(244, 244, 244, 0.6)',

  // ── 弹层 ──
  modalOverlay: 'rgba(0,0,0,0.4)',
  modalBg: 'rgba(255, 255, 255, 0.8)',

  // ── 技能市场（保持深色面板）──
  skillMarketBg: '#1c1c1e',
  skillMarketCard: '#2c2c2e',
  skillMarketBorder: '#3a3a3c',
  skillMarketText: '#ffffff',
  skillMarketTextSec: '#8e8e93',
  skillMarketTextTer: '#636366',
  skillMarketSearch: '#2c2c2e',
}

const dark: typeof light = {
  // ── 画布 / 表面 ──
  bg: '#212121',
  bgAlt: 'rgba(23, 23, 23, 0.5)',
  bgCard: 'rgba(44, 44, 48, 0.55)',
  bgInput: 'rgba(58, 58, 62, 0.5)',
  bgHover: 'rgba(255, 255, 255, 0.07)',
  bgActive: 'rgba(255, 255, 255, 0.12)',
  // 别名
  surface: '#212121',
  surfaceAlt: 'rgba(23, 23, 23, 0.5)',
  surfaceCard: 'rgba(44, 44, 48, 0.55)',
  surfaceInput: 'rgba(58, 58, 62, 0.5)',
  surfaceHover: 'rgba(255, 255, 255, 0.07)',
  surfaceActive: 'rgba(255, 255, 255, 0.12)',

  // ── 边框 ──
  border: 'rgba(255, 255, 255, 0.1)',
  borderLight: 'rgba(255, 255, 255, 0.06)',
  borderFocus: '#ffffff',

  // ── 文本 ──
  text: '#ececec',
  textHead: '#ffffff',
  textSecondary: '#b4b4b4',
  textTertiary: '#8f8f8f',
  textMuted: '#5d5d5d',

  // ── 强调 ──
  accent: '#ffffff',
  accentBg: 'rgba(255,255,255,0.08)',
  accentBorder: 'rgba(255,255,255,0.16)',
  accentLight: '#b4b4b4',
  accentText: '#0d0d0d',

  // ── 状态 ──
  toolOk: '#4ade80',
  toolWarn: '#fbbf24',
  toolErr: '#f87171',

  // ── 消息 ──
  msgBotBg: 'transparent',
  msgBotText: '#ececec',
  msgUserBg: 'rgba(58, 58, 62, 0.8)',
  msgUserText: '#ffffff',
  userBubbleBg: 'rgba(58, 58, 62, 0.8)',
  userBubbleText: '#ffffff',

  // ── 品牌 ──
  brand: '#ffffff',
  onBrand: '#0d0d0d',
  onAccent: '#0d0d0d',
  inputText: '#ececec',

  // ── 侧边栏 ──
  sidebarActiveText: '#ffffff',
  sidebarActiveBg: 'rgba(255, 255, 255, 0.1)',
  buttonGhost: 'rgba(58, 58, 62, 0.6)',

  // ── 弹层 ──
  modalOverlay: 'rgba(0,0,0,0.65)',
  modalBg: 'rgba(38, 38, 42, 0.8)',

  // ── 技能市场 ──
  skillMarketBg: '#0d0d0d',
  skillMarketCard: '#1c1c1e',
  skillMarketBorder: '#2e2e32',
  skillMarketText: '#ececec',
  skillMarketTextSec: '#a1a1aa',
  skillMarketTextTer: '#6b6d76',
  skillMarketSearch: '#2a2a2d',
}

export type ThemeColors = typeof light
export type Theme = 'light' | 'dark' | 'auto'

/** 强调色预设：light/dark 各配一个变体（graphite 即默认） */
export const ACCENT_PRESETS: Record<string, { label: string; light: string; dark: string }> = {
  graphite: { label: '石墨', light: '#0d0d0d', dark: '#ffffff' },
  teal: { label: '青绿', light: '#0f766e', dark: '#2dd4bf' },
  amber: { label: '琥珀', light: '#b45309', dark: '#f59e0b' },
  rose: { label: '玫红', light: '#be123c', dark: '#fb7185' },
  blue: { label: '蓝', light: '#1d4ed8', dark: '#60a5fa' },
  violet: { label: '紫', light: '#7c3aed', dark: '#a78bfa' },
  green: { label: '绿', light: '#15803d', dark: '#4ade80' },
  orange: { label: '橙', light: '#ea580c', dark: '#fb923c' },
  cyan: { label: '青', light: '#0e7490', dark: '#22d3ee' },
  pink: { label: '粉', light: '#db2777', dark: '#f472b6' },
}
const ACCENT_KEY = 'lyclaw_accent'
const ACCENT_CUSTOM_KEY = 'lyclaw_accent_custom'

/** hex → {h,s,l} */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16) / 255, g = parseInt(m.slice(2, 4), 16) / 255, b = parseInt(m.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s: s * 100, l: l * 100 }
}
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return '#' + to(f(0)) + to(f(8)) + to(f(4))
}

/** v11 自定义种子色：亮色原样，暗色派生为同色相提亮变体（MD3 思路简化版） */
export function setCustomAccent(lightHex: string) {
  try {
    const { h, s, l } = hexToHsl(lightHex)
    const dark = hslToHex(h, Math.min(100, s + 8), Math.min(82, Math.max(62, l + 26)))
    localStorage.setItem(ACCENT_CUSTOM_KEY, JSON.stringify({ light: lightHex, dark }))
    localStorage.setItem(ACCENT_KEY, 'custom')
  } catch {}
  window.dispatchEvent(new CustomEvent('accent-changed'))
}
export function getCustomAccent() {
  try {
    const raw = localStorage.getItem(ACCENT_CUSTOM_KEY)
    if (raw) { const v = JSON.parse(raw); if (v && v.light && v.dark) return v }
  } catch {}
  return null
}

export function getAccentKey(): string {
  try { return localStorage.getItem(ACCENT_KEY) || 'graphite' } catch { return 'graphite' }
}
export function setAccentKey(k: string) {
  try { localStorage.setItem(ACCENT_KEY, k) } catch {}
  window.dispatchEvent(new CustomEvent('accent-changed'))
}

interface ThemeCtx {
  theme: Theme
  c: ThemeColors
  toggle: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'light', c: light, toggle: () => {}, setTheme: () => {} })

export function useTheme() {
  return useContext(ThemeContext)
}

const THEME_KEY = 'lyclaw_theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const [themePref, setThemePref] = useState<Theme>(() => {
    try { const raw = localStorage.getItem(THEME_KEY); if (raw === 'dark' || raw === 'light' || raw === 'auto') return raw } catch {}
    return 'auto'
  })
  const theme = themePref === 'auto' ? (systemDark ? 'dark' : 'light') : themePref

  // 强调色覆盖（设置→外观选择后实时生效）
  const [accentKey, setAccentKeyState] = useState(getAccentKey())
  useEffect(() => {
    const h = () => setAccentKeyState(getAccentKey())
    window.addEventListener('accent-changed', h)
    return () => window.removeEventListener('accent-changed', h)
  }, [])
  const cRaw = theme === 'dark' ? dark : light
  const c = useMemo(() => {
    if (accentKey === 'custom') {
      const cu = getCustomAccent()
      if (cu) return { ...cRaw, accent: theme === 'dark' ? cu.dark : cu.light, accentText: theme === 'dark' ? '#0b0b0c' : '#ffffff' }
      return cRaw
    }
    const preset = ACCENT_PRESETS[accentKey]
    if (!preset || accentKey === 'graphite') return cRaw
    return { ...cRaw, accent: theme === 'dark' ? preset.dark : preset.light, accentText: theme === 'dark' ? '#0b0b0c' : '#ffffff' }
  }, [cRaw, accentKey, theme])

  useEffect(() => {
    const s = getSettingsSync()
    const t = (s as any).theme
    if (t === 'dark' || t === 'light' || t === 'auto') setThemePref(t)
    fetch('/api/settings').then(r => r.json()).then((server: any) => {
      if (server.theme === 'dark' || server.theme === 'light' || server.theme === 'auto') setThemePref(server.theme)
    }).catch(() => {})
  }, [])

  // 跟随系统：监听系统深浅色变化
  useEffect(() => {
    if (themePref !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener?.('change', h)
    return () => mq.removeEventListener?.('change', h)
  }, [themePref])

  // 回调与 context value 全部稳定：否则每次 ThemeProvider 渲染都产生新对象，
  // 靠 useContext 拿主题的几十个组件会被无条件重渲染
  const setTheme = useCallback((t: Theme) => {
    setThemePref(t)
    localStorage.setItem(THEME_KEY, t)
    const s = getSettingsSync()
    saveSettings({ ...s, theme: t } as Settings)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 强调色 → CSS 变量：caret / 链接 / 焦点环 / 按钮全部联动
  useEffect(() => {
    const preset = ACCENT_PRESETS[accentKey]
    const a = theme === 'dark' ? (preset?.dark || '#ffffff') : (preset?.light || '#0d0d0d')
    const onA = theme === 'dark' ? '#0b0b0c' : '#ffffff'
    const root = document.documentElement
    root.style.setProperty('--accent', a)
    root.style.setProperty('--accent-text', onA)
    root.style.setProperty('--accent-bg', theme === 'dark' ? `${a}26` : `${a}14`)
    root.style.setProperty('--accent-border', `${a}55`)
    root.style.setProperty('--border-focus', a)
  }, [accentKey, theme])

  const toggle = useCallback(() => setTheme(theme === 'light' ? 'dark' : 'light'), [setTheme, theme])

  const ctxValue = useMemo(() => ({ theme, c, toggle, setTheme }), [theme, c, toggle, setTheme])

  return (
    <ThemeContext.Provider value={ctxValue}>
      {children}
    </ThemeContext.Provider>
  )
}
