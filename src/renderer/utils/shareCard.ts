// 消息分享卡：把一条消息画成品牌卡片导出 PNG。
//
// 不引第三方渲染库：一张卡只有头像/标题/正文/落款四个元素，
// 2D canvas 十几行就够，引 html2canvas 反而拖首屏。
// 断行逻辑抽成纯函数（测量函数注入），node 里也能测。

export interface ShareCardInput {
  role: string
  content: string
  /** 会话标题，画在卡片头部 */
  title?: string
  /** 展示时间，如 2026-10-28 07:10 */
  dateText?: string
  /** 主题色（种子色），缺省用品牌绿 */
  accent?: string
  /** 深浅：亮色卡（默认）或暗色卡 */
  dark?: boolean
}

export interface ShareCardTheme {
  bg: string
  surface: string
  text: string
  textSecondary: string
  border: string
}

export const SHARE_THEMES: Record<'light' | 'dark', ShareCardTheme> = {
  light: { bg: '#f6f7f9', surface: '#ffffff', text: '#1a1d21', textSecondary: '#6b7280', border: '#e5e7eb' },
  dark: { bg: '#141518', surface: '#1e2024', text: '#f3f4f6', textSecondary: '#9ca3af', border: '#2d3036' },
}

export const ROLE_LABEL: Record<string, string> = {
  user: '我',
  assistant: '巨天 Agent',
}

/** CJK 可任意断行、拉丁词不断行的贪心折行。measure 注入（浏览器=ctx.measureText）。 */
export function wrapByWidth(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  const paras = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  for (const para of paras) {
    if (!para) { lines.push(''); continue }
    let line = ''
    let i = 0
    while (i < para.length) {
      const ch = para[i]
      const next = line + ch
      if (measure(next) <= maxWidth || !line) {
        line = next
        i++
        continue
      }
      // 溢出：若断点落在拉丁词中间，回退到行内最后一个空格
      if (/[A-Za-z0-9]$/.test(line) && /[A-Za-z0-9]/.test(ch)) {
        const sp = line.lastIndexOf(' ')
        if (sp > 0 && sp > line.length - 24) {
          lines.push(line.slice(0, sp))
          line = line.slice(sp + 1) + ch
          i++
          continue
        }
      }
      lines.push(line)
      line = ''
    }
    if (line) lines.push(line)
  }
  return lines
}

const BRAND_FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

/** 画分享卡，返回 PNG dataUrl。canvas 缺失（测试/异常环境）返回 null。 */
export function drawShareCard(input: ShareCardInput): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const theme = SHARE_THEMES[input.dark ? 'dark' : 'light']
  const W = 900
  const PAD = 56
  const TEXT_W = W - PAD * 2
  const role = ROLE_LABEL[input.role] || input.role || '巨天 Agent'
  const accent = input.accent || '#10a37f'

  // 正文测量与折行（上限 22 行，超出截断）
  const bodyFont = `19px ${BRAND_FONT}`
  ctx.font = bodyFont
  const maxBodyLines = 22
  let bodyLines = wrapByWidth(input.content || '', TEXT_W, (s) => ctx.measureText(s).width)
  let truncated = false
  if (bodyLines.length > maxBodyLines) {
    bodyLines = bodyLines.slice(0, maxBodyLines)
    truncated = true
  }

  // 标题（可选）
  ctx.font = `15px ${BRAND_FONT}`
  const titleLines = input.title ? wrapByWidth(input.title, TEXT_W, (s) => ctx.measureText(s).width).slice(0, 1) : []

  // 布局计算
  const headH = 84            // 头像+角色+时间
  const titleH = titleLines.length ? 34 : 0
  const lineH = 30
  const bodyH = bodyLines.length * lineH + (truncated ? 26 : 0)
  const footH = 72
  const H = PAD + headH + titleH + bodyH + PAD + footH

  const dpr = 2 // 输出 2x，分享到手机上不糊
  canvas.width = W * dpr
  canvas.height = H * dpr
  ctx.scale(dpr, dpr)

  // 背景 + 卡面
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, H)
  roundRect(ctx, 24, 24, W - 48, H - 48, 28)
  ctx.fillStyle = theme.surface
  ctx.fill()
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 1
  ctx.stroke()

  // 头像：圆角色块 + 首字
  const avX = PAD, avY = PAD + 8, avR = 26
  roundRect(ctx, avX, avY, avR * 2, avR * 2, 18)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 20px ${BRAND_FONT}`
  ctx.textBaseline = 'middle'
  ctx.fillText(role.slice(0, 1), avX + avR - ctx.measureText(role.slice(0, 1)).width / 2, avY + avR + 1)

  // 角色名 + 时间
  ctx.fillStyle = theme.text
  ctx.font = `600 17px ${BRAND_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(role, avX + avR * 2 + 16, avY + 24)
  ctx.fillStyle = theme.textSecondary
  ctx.font = `13px ${BRAND_FONT}`
  if (input.dateText) ctx.fillText(input.dateText, avX + avR * 2 + 16, avY + 46)

  // 会话标题
  let y = PAD + headH
  if (titleLines.length) {
    ctx.fillStyle = theme.textSecondary
    ctx.font = `15px ${BRAND_FONT}`
    ctx.fillText(titleLines[0], PAD, y + 8)
    y += titleH
  }

  // 正文
  ctx.font = bodyFont
  ctx.fillStyle = theme.text
  for (const line of bodyLines) {
    ctx.fillText(line, PAD, y + 22)
    y += lineH
  }
  if (truncated) {
    ctx.fillStyle = theme.textSecondary
    ctx.font = `14px ${BRAND_FONT}`
    ctx.fillText('…… 内容较长，完整版见巨天 Agent', PAD, y + 22)
    y += 26
  }

  // 落款
  ctx.fillStyle = theme.textSecondary
  ctx.font = `14px ${BRAND_FONT}`
  ctx.fillText('巨天 Agent · 本地优先的 AI 工作台', PAD, H - PAD - 16)

  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** dataUrl → 触发下载。命名含日期防覆盖。 */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
