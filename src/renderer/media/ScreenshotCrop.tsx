/**
 * 截图框选浮层：全屏展示截到的画面，拖拽框选区域，框选后可画笔标注，
 * 确认后把标注一并裁剪合成输出 dataURL。Esc 取消，Enter 确认。
 */
import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  dataUrl: string
  onConfirm: (croppedDataUrl: string) => void
  onCancel: () => void
}

interface Stroke { color: string; width: number; points: { x: number; y: number }[] }

const PEN_COLORS = ['#ef4444', '#f59e0b', '#10b981']

export default function ScreenshotCrop({ dataUrl, onConfirm, onCancel }: Props) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [imgRect, setImgRect] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 })
  // 标注：画笔模式 / 笔画列表 / 当前颜色
  const [penOn, setPenOn] = useState(false)
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const drawingRef = useRef(false)
  const annoCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // 图片按 contain 布局，记录其显示区域（用于坐标换算与裁剪）
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const wrap = wrapRef.current
      if (!wrap) return
      const W = wrap.clientWidth, H = wrap.clientHeight
      const scale = Math.min(W / img.width, H / img.height)
      const w = img.width * scale, h = img.height * scale
      setImgRect({ x: (W - w) / 2, y: (H - h) / 2, w, h })
      imgRef.current = img
    }
    img.src = dataUrl
  }, [dataUrl])

  // 笔画重绘到标注画布
  useEffect(() => {
    const cv = annoCanvasRef.current
    if (!cv) return
    cv.width = Math.max(1, Math.round(imgRect.w))
    cv.height = Math.max(1, Math.round(imgRect.h))
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const s of strokes) {
      if (s.points.length < 2) continue
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width
      ctx.beginPath()
      ctx.moveTo(s.points[0].x, s.points[0].y)
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }, [strokes, imgRect])

  const toLocal = useCallback((e: React.MouseEvent) => {
    const wrap = wrapRef.current
    if (!wrap) return { x: 0, y: 0 }
    const r = wrap.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if (penOn && rect) {
      // 画笔模式：在框选区域内起笔
      const p = toLocal(e)
      if (p.x < rect.x || p.y < rect.y || p.x > rect.x + rect.w || p.y > rect.y + rect.h) return
      drawingRef.current = true
      setStrokes(prev => [...prev, { color: penColor, width: 3, points: [p] }])
      return
    }
    const p = toLocal(e)
    dragRef.current = p
    setRect({ x: p.x, y: p.y, w: 0, h: 0 })
    setStrokes([])
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (drawingRef.current) {
      const p = toLocal(e)
      setStrokes(prev => {
        const next = [...prev]
        const cur = next[next.length - 1]
        if (cur) next[next.length - 1] = { ...cur, points: [...cur.points, p] }
        return next
      })
      return
    }
    if (!dragRef.current) return
    const p = toLocal(e)
    const d = dragRef.current
    setRect({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) })
  }
  const onMouseUp = () => { dragRef.current = null; drawingRef.current = false }

  const confirm = useCallback(() => {
    const img = imgRef.current
    if (!img || !rect || rect.w < 8 || rect.h < 8) { onCancel(); return }
    const sx = (rect.x - imgRect.x) / imgRect.w * img.width
    const sy = (rect.y - imgRect.y) / imgRect.h * img.height
    const sw = rect.w / imgRect.w * img.width
    const sh = rect.h / imgRect.h * img.height
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw))
    canvas.height = Math.max(1, Math.round(sh))
    const ctx = canvas.getContext('2d')
    if (!ctx) { onCancel(); return }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    // 合成标注层（标注画布与 imgRect 显示区域 1:1 对应）
    const anno = annoCanvasRef.current
    if (anno && strokes.length > 0) {
      const asx = (rect.x - imgRect.x), asy = (rect.y - imgRect.y)
      ctx.drawImage(anno, asx, asy, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
    }
    onConfirm(canvas.toDataURL('image/png'))
  }, [rect, imgRect, onConfirm, onCancel, strokes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (penOn) { setPenOn(false) } else onCancel() }
      if (e.key === 'Enter') confirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, onCancel, penOn])

  return (
    <div ref={wrapRef}
      className="fixed inset-0 z-[200]"
      style={{ background: 'rgba(0,0,0,0.82)', cursor: penOn ? 'crosshair' : 'crosshair' }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <img src={dataUrl} alt="" draggable={false}
        className="absolute select-none pointer-events-none"
        style={{ left: imgRect.x, top: imgRect.y, width: imgRect.w, height: imgRect.h, opacity: 0.55 }} />

      {/* 已框选区域高亮 */}
      {rect && rect.w > 2 && (
        <div className="absolute pointer-events-none" style={{
          left: rect.x, top: rect.y, width: rect.w, height: rect.h,
          backgroundImage: `url(${dataUrl})`,
          backgroundPosition: `${-(rect.x - imgRect.x)}px ${-(rect.y - imgRect.y)}px`,
          backgroundSize: `${imgRect.w}px ${imgRect.h}px`,
          border: `1.5px solid #34d399`,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
        }} />
      )}

      {/* 标注画布：覆盖整个截图显示区域，笔画裁剪到框选区内（置于遮罩之上） */}
      {rect && (
        <canvas ref={annoCanvasRef} className="absolute pointer-events-none"
          style={{
            left: imgRect.x, top: imgRect.y, width: imgRect.w, height: imgRect.h,
            clipPath: `inset(${Math.max(0, rect.y - imgRect.y)}px ${Math.max(0, imgRect.x + imgRect.w - rect.x - rect.w)}px ${Math.max(0, imgRect.y + imgRect.h - rect.y - rect.h)}px ${Math.max(0, rect.x - imgRect.x)}px)`,
          }} />
      )}

      {rect && rect.w > 2 && (
        <div className="absolute text-[11px] font-mono px-1.5 py-0.5 rounded"
          style={{ left: rect.x, top: rect.y - 22, background: '#34d399', color: '#06281c' }}>
          {Math.round(rect.w)}×{Math.round(rect.h)}
        </div>
      )}

      {/* 顶部提示 / 工具条 */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[12.5px]">
        {(!rect || rect.w < 8) ? (
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>拖拽框选要提问的区域</span>
        ) : (
          <>
            {/* 画笔开关 */}
            <button onClick={() => setPenOn(v => !v)}
              className="px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{ background: penOn ? '#34d399' : 'rgba(255,255,255,0.12)', color: penOn ? '#06281c' : '#fff' }}>
              画笔
            </button>
            {/* 颜色选择（画笔开启时） */}
            {penOn && PEN_COLORS.map(color => (
              <button key={color} onClick={() => setPenColor(color)}
                className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                style={{ background: color, outline: penColor === color ? '2px solid #fff' : 'none', outlineOffset: 2 }} />
            ))}
            {/* 撤销 / 重选 */}
            <button onClick={() => setStrokes(prev => prev.slice(0, -1))}
              className="px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} title="撤销一笔">撤销</button>
            <button onClick={() => { setRect(null); setStrokes([]); setPenOn(false) }}
              className="px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>重选</button>
            <span className="w-px h-5 mx-1" style={{ background: 'rgba(255,255,255,0.25)' }} />
            <button onClick={confirm} className="px-3 py-1.5 rounded-lg font-medium" style={{ background: '#10b981', color: '#04281c' }}>确认 (Enter)</button>
            <button onClick={onCancel} className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>取消 (Esc)</button>
          </>
        )}
      </div>
      {penOn && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
          在框选区域内拖拽绘制 · Esc 退出画笔
        </div>
      )}
    </div>
  )
}
