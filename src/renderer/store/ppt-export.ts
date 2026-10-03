import type { ChartBlock, Deck, DeckTheme, GraphicKind, ImageBlock, Slide, TableBlock, Block } from '../types/ppt'
import { SLIDE_W, SLIDE_H } from '../types/ppt'

/**
 * 巨天agent PPT 导出 —— 生成真正的 .pptx（PowerPoint / Keynote / WPS 可直接打开并继续编辑）
 *
 * 坐标：画布逻辑分辨率 1280×720（与编辑器、版式引擎一致）
 *      幻灯片 10 × 5.625 英寸 → 1px = 10/1280 英寸
 * 字号：1px = 0.6pt
 *
 * 覆盖全部块类型：文本 / 列表 / 数据 / 步骤 / 引言 / 分隔线 /
 * 矢量图形（转为原生形状）/ 图片（内嵌）/ 表格（原生表格）/ 图表（原生图表）
 */

const SCALE = 10 / SLIDE_W
const PT = 0.6
const SLIDE_BG_DARK = '101623'
const SLIDE_BG_LIGHT = 'FFFFFF'

interface Palette {
  text: string
  muted: string
  accent: string
  accent2: string
  surface: string
  onDark: boolean
  fontTitle: string
  fontBody: string
}

const DEFAULT_THEME: DeckTheme = {
  id: 'default',
  name: '默认',
  colors: { bg: '#ffffff', surface: '#f5f5f7', text: '#1a1a1e', muted: '#5f5f66', accent: '#4f46e5', accent2: '#7c3aed', onAccent: '#ffffff' },
  fontTitle: 'PingFang SC',
  fontBody: 'PingFang SC',
  radius: 16,
  dark: false,
}

function buildPalette(theme: DeckTheme, slide: Slide): Palette {
  const onDark = slide.background.mode === 'gradient' || slide.background.mode === 'deep'
  const c = theme.colors
  return {
    text: onDark ? '#f2f4f8' : c.text,
    muted: onDark ? '#9aa4b8' : c.muted,
    accent: c.accent,
    accent2: c.accent2,
    surface: onDark ? '#1c2230' : c.surface,
    onDark,
    fontTitle: theme.fontTitle || DEFAULT_THEME.fontTitle,
    fontBody: theme.fontBody || DEFAULT_THEME.fontBody,
  }
}

function resolveColor(token: string | undefined, pal: Palette, fallback?: string): string {
  switch (token) {
    case 'text': return pal.text
    case 'muted': return pal.muted
    case 'accent': return pal.accent
    case 'accent2': return pal.accent2
    case 'onAccent': return '#ffffff'
    case 'surface': return pal.surface
    default:
      if (token && /^#[0-9a-fA-F]{3,8}$/.test(token)) return token
      return fallback || pal.text
  }
}

/** pptxgenjs 需要不带 # 的 6 位十六进制 */
function hex(token: string, fallback = '000000'): string {
  const t = String(token || '').replace('#', '').trim()
  if (/^[0-9a-fA-F]{6}$/.test(t)) return t.toUpperCase()
  if (/^[0-9a-fA-F]{3}$/.test(t)) return (t[0] + t[0] + t[1] + t[1] + t[2] + t[2]).toUpperCase()
  if (/^[0-9a-fA-F]{8}$/.test(t)) return t.slice(0, 6).toUpperCase() // 丢弃 alpha
  return fallback
}

function px(v: number): number { return Math.round(v * SCALE * 10000) / 10000 }
function pt(v: number): number { return Math.max(8, Math.round(v * PT)) }

/** SVG data URI → PNG data URL（浏览器侧光栅化，pptxgenjs 无法嵌入 SVG） */
async function svgToPng(svgDataUri: string, width = 900, height = 660): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(null)
          ctx.drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/png'))
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = svgDataUri
    } catch { resolve(null) }
  })
}

/** 导出前把所有 SVG 图片块预转换为 PNG，确保图片真正进入 PPTX */
async function prepareImages(deck: Deck): Promise<Deck> {
  const slides = await Promise.all(deck.slides.map(async (slide) => {
    const blocks = await Promise.all(slide.blocks.map(async (block) => {
      if (block.type !== 'image') return block
      const b = block as ImageBlock
      if (!b.src || !b.src.startsWith('data:image/svg+xml')) return block
      const png = await svgToPng(b.src, Math.max(320, Math.round(b.box.w * 1.6)), Math.max(240, Math.round(b.box.h * 1.6)))
      return png ? ({ ...b, src: png } as ImageBlock) : block
    }))
    return { ...slide, blocks }
  }))
  return { ...deck, slides }
}

/** 主题入参：可为完整主题、部分主题（深合并）、或仅一个强调色 */
export type PptThemeInput =
  | string
  | (Partial<Omit<DeckTheme, 'colors'>> & { colors?: Partial<DeckTheme['colors']> })

export async function exportDeckToPptx(deck: Deck, themeInput?: PptThemeInput): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'JT_16x9', width: 10, height: 5.625 })
  pptx.layout = 'JT_16x9'
  pptx.title = deck.title || '巨天agent 演示文稿'
  pptx.author = '巨天agent'

  // 允许只传主题 id / 强调色 / 部分主题（向后兼容），并与默认主题深合并
  const theme: DeckTheme = (() => {
    if (themeInput && typeof themeInput === 'object') {
      const t: any = themeInput
      return {
        ...DEFAULT_THEME,
        ...t,
        colors: { ...DEFAULT_THEME.colors, ...(t.colors || {}) },
      }
    }
    if (typeof themeInput === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(themeInput)) {
      return { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, accent: themeInput } }
    }
    return DEFAULT_THEME
  })()

  // 预转换 SVG 图片，保证图片被真正嵌入
  const prepared = await prepareImages(deck)
  const total = prepared.slides.length

  for (let i = 0; i < total; i++) {
    const slide = prepared.slides[i]
    const s = pptx.addSlide()
    const pal = buildPalette(theme, slide)

    // ── 背景 ──
    applyBackground(s, slide, pal, pptx)

    // ── 页码（右下角，封面/结束页不显示）──
    const isEdge = slide.layout === 'cover' || slide.layout === 'closing'
    if (!isEdge && total > 1) {
      s.addText(`${i + 1} / ${total}`, {
        x: px(1040), y: px(664), w: px(160), h: px(28),
        fontSize: 10, color: hex(pal.muted), align: 'right', fontFace: pal.fontBody,
      })
    }

    // ── 内容块 ──
    for (const block of slide.blocks) addBlock(s, block, pal, pptx)

    if (slide.notes) s.addNotes(slide.notes)
  }

  const fileName = `${(deck.title || 'presentation').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'presentation'}.pptx`
  await pptx.writeFile({ fileName })
}

function applyBackground(s: any, slide: Slide, pal: Palette, pptx: any) {
  const mode = slide.background.mode
  if (mode === 'gradient' || mode === 'deep') {
    s.background = { color: SLIDE_BG_DARK }
    // 用低透明度色块近似渐变光晕
    s.addShape(pptx.ShapeType.ellipse, {
      x: px(640), y: px(-260), w: px(900), h: px(900),
      fill: { color: hex(pal.accent), transparency: 88 }, line: { color: hex(pal.accent), transparency: 100 },
    })
    s.addShape(pptx.ShapeType.ellipse, {
      x: px(-260), y: px(320), w: px(720), h: px(720),
      fill: { color: hex(pal.accent2), transparency: 90 }, line: { color: hex(pal.accent2), transparency: 100 },
    })
    return
  }
  if (mode === 'tint') {
    s.background = { color: hex(pal.surface, SLIDE_BG_LIGHT) }
    return
  }
  if (mode === 'custom') {
    const from = slide.background.from || '#ffffff'
    s.background = { color: hex(from, SLIDE_BG_LIGHT) }
    if (slide.background.to && slide.background.to !== slide.background.from) {
      s.addShape(pptx.ShapeType.ellipse, {
        x: px(760), y: px(-200), w: px(700), h: px(700),
        fill: { color: hex(slide.background.to), transparency: 82 }, line: { color: hex(slide.background.to), transparency: 100 },
      })
    }
    return
  }
  s.background = { color: SLIDE_BG_LIGHT }
}

function addBlock(s: any, block: Block, pal: Palette, pptx: any) {
  const x = px(block.box.x), y = px(block.box.y), w = px(block.box.w), h = px(block.box.h)
  const st: any = block.style || {}
  const align = (st.align || 'left') as any
  const valign = (st.valign || 'top') as any

  // 通用底/边框（卡片类）
  const fillToken = st.fill && st.fill !== 'none' ? st.fill : null
  if (fillToken) {
    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w, h,
      fill: { color: hex(resolveColor(fillToken, pal, pal.surface), SLIDE_BG_LIGHT), transparency: st.fillAlpha ? Math.round((1 - st.fillAlpha) * 100) : 0 },
      line: { color: hex(resolveColor(fillToken, pal, pal.surface), SLIDE_BG_LIGHT), transparency: 100 },
      rectRadius: Math.min(0.5, (st.radius || 12) * SCALE),
    })
  }

  const pad = (st.padding || 0) * SCALE

  switch (block.type) {
    case 'title':
    case 'subtitle':
    case 'paragraph':
    case 'eyebrow': {
      const b = block as any
      const defSize = block.type === 'title' ? 74 : block.type === 'subtitle' ? 26 : block.type === 'eyebrow' ? 18 : 22
      s.addText(b.text || '', {
        x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2,
        fontSize: pt(st.fontSize || defSize),
        bold: !!st.bold,
        italic: !!st.italic,
        charSpacing: st.letterSpacing || 0,
        color: hex(resolveColor(st.color, pal, block.type === 'eyebrow' ? pal.accent : pal.text)),
        align,
        valign,
        lineSpacingMultiple: st.lineHeight || 1.2,
        fontFace: block.type === 'title' || block.type === 'subtitle' ? pal.fontTitle : pal.fontBody,
      })
      break
    }

    case 'divider': {
      s.addShape(pptx.ShapeType.roundRect, {
        x, y, w, h: Math.max(0.03, h),
        fill: { color: hex(resolveColor(st.fill as string, pal, pal.accent)) },
        line: { color: hex(resolveColor(st.fill as string, pal, pal.accent)), transparency: 100 },
        rectRadius: 0.5,
      })
      break
    }

    case 'bullets': {
      const b = block as any
      const items: string[] = b.items || []
      const icon: string = b.icon || 'dot'
      const runs = items.map((t, i) => ({
        text: icon === 'number' ? `${i + 1}.  ${t}` : icon === 'dash' ? `–  ${t}` : t,
        options: {
          bullet: icon === 'dot' ? { code: '25CF' } : icon === 'check' ? { code: '2713' } : icon === 'none' ? false : false,
          breakLine: true,
          color: hex(resolveColor(st.color, pal)),
        },
      }))
      s.addText(runs, {
        x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2,
        fontSize: pt(st.fontSize || 21),
        align: 'left',
        valign: 'top',
        lineSpacingMultiple: 1.35,
        fontFace: pal.fontBody,
      })
      break
    }

    case 'stats': {
      const items: { value: string; label: string }[] = (block as any).items || []
      if (!items.length) break
      const cellW = (w - pad * 2) / items.length
      items.forEach((it, i) => {
        const cx = x + pad + i * cellW
        s.addText(it.value || '', {
          x: cx, y: y + h * 0.24, w: cellW, h: h * 0.36,
          fontSize: pt(46), bold: true, color: hex(pal.accent), align: 'center', valign: 'middle', fontFace: pal.fontTitle,
        })
        s.addText(it.label || '', {
          x: cx, y: y + h * 0.62, w: cellW, h: h * 0.24,
          fontSize: pt(16), color: hex(pal.muted), align: 'center', valign: 'top', fontFace: pal.fontBody,
        })
      })
      break
    }

    case 'steps': {
      const items: { title: string; desc?: string }[] = (block as any).items || []
      const numbered = (block as any).numbered !== false
      const n = items.length || 1
      const stepW = w / n
      items.forEach((it, i) => {
        const cx = x + i * stepW
        // 序号圆点
        s.addShape(pptx.ShapeType.ellipse, {
          x: cx + stepW / 2 - 0.16, y: y, w: 0.32, h: 0.32,
          fill: { color: hex(pal.accent) }, line: { color: hex(pal.accent), transparency: 100 },
        })
        s.addText(numbered ? String(i + 1) : '•', {
          x: cx + stepW / 2 - 0.16, y: y, w: 0.32, h: 0.32,
          fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
        })
        // 连接线
        if (i < n - 1) {
          s.addShape(pptx.ShapeType.rect, {
            x: cx + stepW / 2 + 0.2, y: y + 0.155, w: stepW - 0.4, h: 0.012,
            fill: { color: hex(pal.accent), transparency: 60 }, line: { color: hex(pal.accent), transparency: 100 },
          })
        }
        s.addText(it.title || '', {
          x: cx + 0.08, y: y + 0.5, w: stepW - 0.16, h: 0.34,
          fontSize: pt(20), bold: true, color: hex(pal.text), align: 'center', fontFace: pal.fontTitle,
        })
        if (it.desc) {
          s.addText(it.desc, {
            x: cx + 0.08, y: y + 0.86, w: stepW - 0.16, h: h - 0.9,
            fontSize: pt(14), color: hex(pal.muted), align: 'center', valign: 'top', fontFace: pal.fontBody,
          })
        }
      })
      break
    }

    case 'quote': {
      const b = block as any
      s.addText(`“${b.quote?.text || b.text || ''}”`, {
        x, y, w, h: h * 0.72,
        fontSize: pt(st.fontSize || 34), italic: true,
        color: hex(resolveColor(st.color, pal)), align: 'center', valign: 'middle',
        lineSpacingMultiple: 1.3, fontFace: pal.fontTitle,
      })
      if (b.quote?.author || b.author) {
        s.addText(`— ${b.quote?.author || b.author}`, {
          x, y: y + h * 0.76, w, h: h * 0.24,
          fontSize: pt(16), color: hex(pal.muted), align: 'center', valign: 'top', fontFace: pal.fontBody,
        })
      }
      break
    }

    case 'image': {
      const b = block as ImageBlock
      if (b.src) {
        const data = toPptxImageData(b.src)
        if (data) {
          try {
            s.addImage({
              data,
              x, y, w, h: b.caption ? h - 0.26 : h,
              sizing: b.fit === 'contain' ? { type: 'contain', w, h } : { type: 'cover', w, h },
              rounding: false,
            })
          } catch { /* 图片格式不支持时忽略 */ }
        }
      }
      if (b.caption) {
        s.addText(b.caption, {
          x, y: y + h - 0.24, w, h: 0.24,
          fontSize: 10, color: hex(pal.muted), align: 'center', fontFace: pal.fontBody,
        })
      }
      break
    }

    case 'table': {
      const b = block as TableBlock
      const head = b.headers || []
      const rows = b.rows || []
      if (!head.length && !rows.length) break
      const colCount = Math.max(head.length, ...rows.map(r => r.length), 1)
      const headerCells = Array.from({ length: colCount }, (_, i) => ({
        text: head[i] ?? '',
        options: { bold: true, color: 'FFFFFF', fill: { color: hex(pal.accent) }, align: 'left' as const, fontFace: pal.fontBody },
      }))
      const bodyRows = rows.map((r, ri) => Array.from({ length: colCount }, (_, ci) => ({
        text: r[ci] ?? '',
        options: {
          color: hex(pal.text),
          fill: { color: b.zebra !== false && ri % 2 === 1 ? hex(pal.surface, SLIDE_BG_LIGHT) : SLIDE_BG_LIGHT },
          align: 'left' as const,
          fontFace: pal.fontBody,
        },
      })))
      s.addTable([headerCells, ...bodyRows], {
        x, y, w, h,
        colW: Array.from({ length: colCount }, () => w / colCount),
        rowH: Math.min(0.42, h / Math.max(1, rows.length + 1)),
        fontSize: pt(15),
        border: { type: 'solid', color: hex(pal.surface, 'E5E7EB'), pt: 0.5 },
        valign: 'middle',
        autoPage: false,
      })
      break
    }

    case 'chart': {
      const b = block as ChartBlock
      if (!b.series?.length) break
      const data = b.series.map(se => ({ name: se.name || 'Series', labels: b.categories || [], values: se.values || [] }))
      const typeMap: Record<string, any> = {
        bar: pptx.ChartType.bar,
        line: pptx.ChartType.line,
        pie: pptx.ChartType.pie,
        doughnut: pptx.ChartType.doughnut,
        area: pptx.ChartType.area,
        radar: pptx.ChartType.radar,
      }
      s.addChart(typeMap[b.chart] || pptx.ChartType.bar, data, {
        x, y, w, h,
        showLegend: b.showLegend !== false && (b.series.length > 1 || b.chart === 'pie' || b.chart === 'doughnut'),
        legendPos: 'b',
        showValue: !!b.showValue,
        chartColors: [hex(pal.accent), hex(pal.accent2), 'F59E0B', '10B981', 'EF4444', '6366F1'],
        catAxisLabelColor: hex(pal.muted),
        valAxisLabelColor: hex(pal.muted),
        catAxisLabelFontFace: pal.fontBody,
        valAxisLabelFontFace: pal.fontBody,
        dataLabelColor: hex(pal.text),
        dataLabelFontFace: pal.fontBody,
        border: { color: hex(pal.surface, 'E5E7EB'), pt: 0.5 },
      })
      break
    }

    case 'graphic': {
      drawGraphic(s, block as any, pal, pptx, { x, y, w, h })
      break
    }

    default:
      break
  }
}

/** SVG data URI 无法被 pptxgenjs 直接嵌入 → 转成 PNG（浏览器侧异步完成） */
function toPptxImageData(src: string): string | null {
  if (!src) return null
  if (src.startsWith('data:image/png;base64,') || src.startsWith('data:image/jpeg;base64,') || src.startsWith('data:image/jpg;base64,')) {
    return src
  }
  // SVG / 其他格式：由调用方预转换为 PNG（见 PPTView 的预处理），此处跳过
  return null
}

/** 矢量图形 → PPTX 原生形状（可继续编辑，不再留白） */
function drawGraphic(s: any, block: any, pal: Palette, pptx: any, r: { x: number; y: number; w: number; h: number }) {
  const kind: GraphicKind = block.graphic || 'abstract'
  const { x, y, w, h } = r
  const accent = hex(pal.accent)
  const accent2 = hex(pal.accent2)

  // 底板
  s.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: pal.onDark ? '172033' : hex(pal.surface, 'F5F5F7') },
    line: { color: pal.onDark ? '172033' : hex(pal.surface, 'F5F5F7'), transparency: 100 },
    rectRadius: 0.06,
  })

  if (kind === 'bars') {
    const n = 5
    const barW = (w * 0.72) / n
    const heights = [0.28, 0.52, 0.38, 0.76, 0.6]
    heights.forEach((hh, i) => {
      s.addShape(pptx.ShapeType.roundRect, {
        x: x + w * 0.14 + i * barW * 1.18, y: y + h * 0.86 - h * hh, w: barW, h: h * hh,
        fill: { color: i % 2 ? accent2 : accent }, line: { color: i % 2 ? accent2 : accent, transparency: 100 },
        rectRadius: 0.04,
      })
    })
    return
  }
  if (kind === 'rings') {
    ;[0.86, 0.6, 0.34].forEach((f, i) => {
      s.addShape(pptx.ShapeType.ellipse, {
        x: x + w / 2 - (w * f) / 2, y: y + h / 2 - (h * f) / 2, w: w * f, h: h * f,
        fill: { color: i % 2 ? accent2 : accent, transparency: 100 },
        line: { color: i % 2 ? accent2 : accent, width: 8, transparency: 55 },
      })
    })
    return
  }
  if (kind === 'ladder') {
    ;[0, 1, 2, 3].forEach(i => {
      s.addShape(pptx.ShapeType.roundRect, {
        x: x + w * 0.12 + i * w * 0.16, y: y + h * 0.78 - i * h * 0.16, w: w * 0.22, h: h * 0.075,
        fill: { color: i % 2 ? accent2 : accent }, line: { color: i % 2 ? accent2 : accent, transparency: 100 },
        rectRadius: 0.4,
      })
    })
    return
  }
  if (kind === 'grid') {
    for (let i = 0; i < 12; i++) {
      const cx = x + w * 0.12 + (i % 4) * w * 0.2
      const cy = y + h * 0.16 + Math.floor(i / 4) * h * 0.24
      s.addShape(pptx.ShapeType.roundRect, {
        x: cx, y: cy, w: w * 0.14, h: h * 0.17,
        fill: { color: i % 3 ? accent : accent2, transparency: 55 - (i % 4) * 8 },
        line: { color: i % 3 ? accent : accent2, transparency: 100 },
        rectRadius: 0.3,
      })
    }
    return
  }
  // nodes / orbit / wave / abstract：节点 + 连线
  const pts = [
    { x: x + w * 0.28, y: y + h * 0.32 },
    { x: x + w * 0.56, y: y + h * 0.22 },
    { x: x + w * 0.74, y: y + h * 0.52 },
    { x: x + w * 0.4, y: y + h * 0.68 },
    { x: x + w * 0.82, y: y + h * 0.82 },
  ]
  const links: [number, number][] = [[0, 1], [1, 2], [2, 4], [0, 3], [3, 4], [1, 3]]
  links.forEach(([a, b]) => {
    const p1 = pts[a], p2 = pts[b]
    s.addShape(pptx.ShapeType.line, {
      x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y,
      line: { color: accent, width: 2, transparency: 62 },
    })
  })
  pts.forEach((p, i) => {
    const rad = i === 0 ? 0.17 : 0.1
    s.addShape(pptx.ShapeType.ellipse, {
      x: p.x - rad, y: p.y - rad, w: rad * 2, h: rad * 2,
      fill: { color: i % 2 ? accent2 : accent }, line: { color: i % 2 ? accent2 : accent, transparency: 100 },
    })
  })
}
