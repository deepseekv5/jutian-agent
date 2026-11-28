/**
 * 液态玻璃性能保险丝（v18.6.1）。
 *
 * backdrop-filter 是最贵的 CSS 效果：每个玻璃元素每帧都要对背后区域做
 * 离屏重采样，滚动/打字时开销线性叠加。本模块监测真实帧率，持续掉帧时
 * 在 <html> 上挂 data-glass-lite="1"（CSS 侧收敛实时模糊，保留染色/高光/
 * 柔影），负载恢复后自动还原——默认观感不变，只在机器撑不住时降级保流畅。
 *
 * 仅在 data-liquid-glass="on" 时运行 rAF 循环；玻璃关闭时完全零开销。
 * 低配设备（data-low-power，App.tsx 启动时判定）由 CSS 规则直接常驻 lite。
 */
export function startGlassPerfGuard(): () => void {
  const root = document.documentElement
  let raf = 0
  let windowStart = 0
  let frames = 0
  let okSince = 0

  const isLite = (): boolean => root.getAttribute('data-glass-lite') === '1'

  const tick = (now: number): void => {
    if (document.hidden) {
      // 后台不计帧（Electron 隐藏窗口 rAF 本就停摆，重置窗口防止假低帧率）
      windowStart = 0
      frames = 0
    } else {
      if (!windowStart) { windowStart = now; frames = 0 }
      frames++
      if (now - windowStart >= 2000) {
        const fps = (frames * 1000) / (now - windowStart)
        frames = 0
        windowStart = now
        if (!isLite() && fps < 45) {
          root.setAttribute('data-glass-lite', '1')
          okSince = 0
        } else if (isLite() && fps >= 55) {
          if (!okSince) okSince = now
          if (now - okSince >= 3000) {
            root.removeAttribute('data-glass-lite')
            okSince = 0
          }
        } else if (isLite()) {
          okSince = 0
        }
      }
    }
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(raf)
    root.removeAttribute('data-glass-lite')
  }
}
