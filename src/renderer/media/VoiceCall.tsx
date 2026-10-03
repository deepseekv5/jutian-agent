/**
 * 打电话模式：近黑画布 + 环形声纹带（Siri 风格）。
 * 状态机：idle → listening（静默检测断句）→ thinking（LLM+工具）→ speaking（TTS）→ listening…
 * 支持语音与手动打字（打断当前播报）。能执行任务：走 streamChat 完整工具链。
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import { streamChat } from '../engine/stream'
import { BUILTIN_TOOLS } from '../types'
import { buildChatSystemPrompt } from '../engine/chatPrompt'
import BrandMark from '../app/BrandMark'
import type { Settings, ToolCall } from '../types'

type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

interface Props {
  settings: Settings
  onClose: () => void
}

const PHASE_TEXT: Record<Phase, string> = {
  idle: '点击开始通话',
  listening: '正在聆听 · 说完点中央发送',
  transcribing: '识别中',
  thinking: '思考中',
  speaking: '正在说',
}

// 各阶段主色（低饱和，深色画布上的一点点色相）
const PHASE_HUE: Record<Phase, string> = {
  idle: '#5b6470',
  listening: '#34d399',
  transcribing: '#22d3ee',
  thinking: '#f59e0b',
  speaking: '#22d3ee',
}

const RING_BARS = 56
const RING_RADIUS = 108

// 静默检测参数
const SILENCE_MS = 1300
const MIN_SPEECH_MS = 350
const VOLUME_GATE = 0.045

export default function VoiceCall({ settings, onClose }: Props) {
  const { c } = useTheme()
  const [phase, setPhase] = useState<Phase>('idle')
  const [muted, setMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [lastHeard, setLastHeard] = useState('')
  const [replyText, setReplyText] = useState('')
  const [toolStatus, setToolStatus] = useState('')
  const [error, setError] = useState('')
  const [hasUtterance, setHasUtterance] = useState(false)
  const [showTextInput, setShowTextInput] = useState(false)
  const [textInput, setTextInput] = useState('')

  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const mutedRef = useRef(false)
  mutedRef.current = muted

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const processorRef = useRef<any>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const rafRef = useRef<number | null>(null)
  const speechStartRef = useRef(0)
  const silenceStartRef = useRef(0)
  const hadSpeechRef = useRef(false)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  const stopAllRef = useRef<() => void>(() => {})
  const startedAtRef = useRef(0)
  const bargeStartRef = useRef(0)
  const bargeInRef = useRef<() => void>(() => {})
  const ringRef = useRef<(HTMLSpanElement | null)[]>([])
  const coreRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rainRef = useRef<{ x: number; y: number; speed: number }[]>([])

  useEffect(() => {
    if (phase === 'idle') return
    const t = setInterval(() => setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase])

  // ─── 视觉驱动：环形声纹条高度（rAF 直写 DOM） ───
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let sim = 0
    let frame = 0
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      frame++
      if (document.hidden) return
      if (reduceMotion && phaseRef.current !== 'listening' && phaseRef.current !== 'speaking') return
      const p = phaseRef.current
      if (p === 'idle' && frame % 4 !== 0) return  // 空闲：降到 ~15fps
      let level = 0
      const analyser = analyserRef.current
      let bins: Uint8Array | null = null
      if (p === 'listening' && analyser) {
        bins = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(bins)
        let sum = 0
        for (let i = 0; i < bins.length; i++) sum += bins[i]
        level = Math.min(1, (sum / bins.length / 255) * 2.4)
      } else if (p === 'speaking') {
        sim += 0.085
        level = 0.42 + 0.26 * (Math.sin(sim) * 0.5 + Math.sin(sim * 2.17) * 0.5)
      } else if (p === 'thinking') {
        sim += 0.045
        level = 0.22 + 0.09 * Math.sin(sim)
      } else {
        sim += 0.018
        level = 0.1 + 0.045 * Math.sin(sim)
      }
      const hue = PHASE_HUE[p]
      const bars = ringRef.current
      for (let i = 0; i < bars.length; i++) {
        const el = bars[i]
        if (!el) continue
        let v = level
        if (bins && p === 'listening') {
          // 真实频段：低频→底部条，高频→顶部，环形对称展开
          const idx = i <= bars.length / 2 ? i * 2 : (bars.length - i) * 2
          const bi = Math.min(bins.length - 1, 4 + Math.floor(idx * 1.6))
          v = Math.max(level * 0.5, (bins[bi] / 255) * 1.6)
        }
        const h = 4 + Math.min(30, v * 30 * (0.55 + 0.45 * Math.sin(Date.now() / (p === 'speaking' ? 120 : 300) + i * 0.55)))
        el.style.height = `${h.toFixed(1)}px`
        el.style.background = hue
        el.style.opacity = String(0.35 + v * 0.65)
      }
      const core = coreRef.current
      if (core) {
        core.style.transform = `scale(${(1 + level * 0.06).toFixed(3)})`
      }
      // ─── 0101 绿色数字雨：密度/亮度随声纹律动 ───
      const cv = canvasRef.current
      const ctx2d = cv?.getContext('2d')
      if (cv && ctx2d && frame % 2 === 0) {
        if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) {
          cv.width = cv.clientWidth || 800
          cv.height = cv.clientHeight || 600
          ctx2d.fillStyle = '#0a0a0c'
          ctx2d.fillRect(0, 0, cv.width, cv.height)
          if (rainRef.current.length === 0) {
            const cols = Math.floor(cv.width / 18)
            rainRef.current = Array.from({ length: cols }, (_, i) => ({
              x: i * 18 + 6,
              y: Math.random() * cv.height,
              speed: 0.6 + Math.random() * 1.8,
            }))
          }
        }
        ctx2d.fillStyle = 'rgba(10,10,12,0.12)'
        ctx2d.fillRect(0, 0, cv.width, cv.height)
        ctx2d.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
        const rainHue = p === 'speaking' ? '#2dd4bf' : p === 'thinking' ? '#f59e0b' : '#22c55e'
        ctx2d.fillStyle = rainHue
        ctx2d.globalAlpha = Math.min(0.9, 0.12 + level * 0.78)
        for (const col of rainRef.current) {
          col.y += col.speed * (0.5 + level * 1.8)
          if (col.y > cv.height + 24) { col.y = -24; col.speed = 0.6 + Math.random() * 1.8 }
          ctx2d.fillText(Math.random() < 0.5 ? '0' : '1', col.x, col.y)
        }
        ctx2d.globalAlpha = 1
      }
      // 录音电平指示：有声音时点亮「待发送」状态（改为手动点击发送，不再自动断句）
      if (p === 'listening' && level > VOLUME_GATE) {
        if (!hadSpeechRef.current) { hadSpeechRef.current = true; setHasUtterance(true) }
      }
      // Barge-in：AI 播报/思考期间检测到用户持续开口 → 打断，回到聆听
      if ((p === 'speaking' || p === 'thinking') && analyser) {
        const md = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(md)
        let ms = 0
        for (let i = 0; i < md.length; i++) ms += md[i]
        const mic = Math.min(1, (ms / md.length / 255) * 2.4)
        const now = Date.now()
        if (mic > VOLUME_GATE * 1.35) {
          if (!bargeStartRef.current) bargeStartRef.current = now
          else if (now - bargeStartRef.current > 300) { bargeStartRef.current = 0; bargeInRef.current() }
        } else bargeStartRef.current = 0
      }
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 麦克风 ───
  const startMic = useCallback(async () => {
    if (streamRef.current) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    streamRef.current = stream
    const ctx = new AudioContext({ sampleRate: 16000 })
    audioCtxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.55
    source.connect(analyser)
    analyserRef.current = analyser
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    chunksRef.current = []
    // 关键：回调动态读 chunksRef.current，发送后重置数组也能持续收音（否则第二轮塞进旧数组→听不到）
    processor.onaudioprocess = (e) => { chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0))) }
    source.connect(processor)
    processor.connect(ctx.destination)
    processorRef.current = { processor, source }
  }, [])

  const stopMic = useCallback(() => {
    try {
      processorRef.current?.processor?.disconnect()
      processorRef.current?.source?.disconnect()
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
    } catch { /* ignore */ }
    streamRef.current = null
    audioCtxRef.current = null
    analyserRef.current = null
    processorRef.current = null
  }, [])

  function wavBlob(chunks: Float32Array[]): Blob {
    const totalLen = chunks.reduce((s, c) => s + c.length, 0)
    const pcm = new Int16Array(totalLen)
    let offset = 0
    for (const c of chunks) { for (let i = 0; i < c.length; i++) pcm[offset++] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32768))) }
    const header = new ArrayBuffer(44)
    const dv = new DataView(header)
    const writeStr = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(pos + i, s.charCodeAt(i)) }
    writeStr(0, 'RIFF'); dv.setUint32(4, 36 + pcm.byteLength, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt '); dv.setUint32(16, 16, true)
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint16(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
    writeStr(36, 'data'); dv.setUint32(40, pcm.byteLength, true)
    return new Blob([header, pcm.buffer], { type: 'audio/wav' })
  }

  // ─── 说话：Edge-TTS ───
  const speak = useCallback(async (text: string): Promise<void> => {
    return new Promise((resolve) => {
      let voice = 'zh-CN-XiaoxiaoNeural'
      let speed = '1.0'
      try {
        const raw = localStorage.getItem('lyclaw_settings')
        if (raw) { const s = JSON.parse(raw); voice = s.voiceId || voice; speed = s.ttsSpeed || speed }
      } catch { /* ignore */ }
      const el = new Audio()
      audioElRef.current = el
      el.onended = () => { audioElRef.current = null; resolve() }
      el.onerror = () => { audioElRef.current = null; resolve() }
      el.onpause = () => { audioElRef.current = null; resolve() }
      fetch('/api/edge-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, speed: Number(speed) || 1.0 }),
      })
        .then(r => { if (!r.ok) throw new Error(); return r.blob() })
        .then(b => { el.src = URL.createObjectURL(b); return el.play() })
        .catch(() => resolve())
    })
  }, [])

  /** 核心：文本 → LLM（工具） → TTS → 回到聆听。语音断句与手动打字共用 */
  const runConversation = useCallback(async (userText: string) => {
    setLastHeard(userText)

    setPhase('thinking')
    setReplyText('')
    setToolStatus('')
    const history = historyRef.current.slice(-16)
    const messages: any[] = [
      {
        role: 'system',
        content: buildChatSystemPrompt(settings) +
          '\n\n【语音通话模式】当前在电话语音对话中：回答必须口语化、简短直接（一般 2~4 句话），禁止使用 Markdown、列表、代码块与符号装饰。需要执行任务时直接调用工具，并用一句话说明结果。',
      },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ]

    let full = ''
    abortRef.current = new AbortController()
    await streamChat(settings, messages, {
      onChunk: (delta) => { full += delta; setReplyText(prev => prev + delta) },
      onThinking: () => {},
      onToolStart: (tc: ToolCall) => setToolStatus(`执行：${tc.name}`),
      onToolEnd: (tc: ToolCall) => setToolStatus(tc.status === 'error' ? `工具失败：${tc.name}` : ''),
      onDone: (_full) => { full = _full || full },
      onError: (err) => { setError(err); full = '' },
      onClientTool: () => '{"ok":true}',
    }, abortRef.current.signal, BUILTIN_TOOLS)

    if (abortRef.current.signal.aborted) return
    historyRef.current.push({ role: 'user', content: userText })
    const spoken = full.trim() || '抱歉，我这边出了点问题，请再试一次。'
    historyRef.current.push({ role: 'assistant', content: spoken })
    setToolStatus('')

    setPhase('speaking')
    const spokenClean = spoken.replace(/```[\s\S]*?```/g, '（代码已省略）').replace(/[*_#>`|]/g, '').replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    await speak(spokenClean)
    if (phaseRef.current === 'speaking') {
      if (streamRef.current && !mutedRef.current) {
        setPhase('listening')
        reconnectProcessor()
      } else {
        setPhase('idle')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, speak])

  // ─── 手动发送：说完点中央光球/发送按钮 → 转写 → runConversation ───
  const sendRecording = useCallback(async () => {
    if (phaseRef.current !== 'listening') return
    const chunks = chunksRef.current
    chunksRef.current = []
    setHasUtterance(false)
    hadSpeechRef.current = false
    if (!chunks.length || chunks.reduce((s, c) => s + c.length, 0) < 8000) {
      setError('还没听到你的声音，请靠近麦克风再说一次'); setTimeout(() => setError(''), 2500)
      return
    }
    setPhase('transcribing')
    try { processorRef.current?.processor?.disconnect(); processorRef.current?.source?.disconnect() } catch { /* ignore */ }

    let userText = ''
    try {
      const fd = new FormData()
      fd.append('audio', wavBlob(chunks), 'call.wav')
      const r = await fetch('/api/speech-to-text', { method: 'POST', body: fd })
      const d = await r.json()
      userText = (d?.text || '').trim()
    } catch { /* ignore */ }
    if (!userText) { setPhase('listening'); reconnectProcessor(); return }
    await runConversation(userText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, runConversation])

  /** 重新接上录音处理器 */
  const reconnectProcessor = useCallback(() => {
    try {
      const ctx = audioCtxRef.current
      const src = processorRef.current?.source
      const processor = processorRef.current?.processor
      if (ctx && src && processor) { src.connect(processor); processor.connect(ctx.destination) }
    } catch { /* ignore */ }
  }, [])

  // ─── 通话控制 ───
  const startCall = useCallback(async () => {
    setError('')
    try {
      await startMic()
      startedAtRef.current = Date.now()
      setDuration(0)
      historyRef.current = []
      setReplyText('')
      setLastHeard('')
      setPhase('listening')
    } catch (e: any) {
      setError(e?.message || '麦克风不可用')
    }
  }, [startMic])

  const hangUp = useCallback(() => {
    stopAllRef.current()
  }, [])

  stopAllRef.current = () => {
    abortRef.current?.abort()
    try { audioElRef.current?.pause() } catch { /* ignore */ }
    stopMic()
    setPhase('idle')
    setDuration(0)
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    mutedRef.current = next
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
    if (next && phaseRef.current === 'listening') setPhase('idle')
    else if (!next && phaseRef.current === 'idle') setPhase('listening')
  }

  /** 手动打字发送：打断当前播报/生成，立即处理文本 */
  const sendText = useCallback(() => {
    const text = textInput.trim()
    if (!text) return
    setTextInput('')
    setShowTextInput(false)
    try { audioElRef.current?.pause() } catch { /* ignore */ }
    if (abortRef.current) abortRef.current.abort()
    hadSpeechRef.current = false
    silenceStartRef.current = 0
    speechStartRef.current = 0
    if (phaseRef.current === 'listening') {
      try { processorRef.current?.processor?.disconnect(); processorRef.current?.source?.disconnect() } catch { /* ignore */ }
    }
    runConversation(text)
  }, [textInput, runConversation])

  // 打断：停播报、中止进行中的生成、清缓冲、回到聆听
  function handleBargeIn() {
    try { audioElRef.current?.pause() } catch { /* ignore */ }
    try { abortRef.current?.abort() } catch { /* ignore */ }
    chunksRef.current = []
    hadSpeechRef.current = false; bargeStartRef.current = 0
    setHasUtterance(false)
    if (streamRef.current) { setPhase('listening'); reconnectProcessor() }
    else setPhase('idle')
  }
  bargeInRef.current = handleBargeIn

  useEffect(() => () => stopAllRef.current(), [])

  const mm = String(Math.floor(duration / 60)).padStart(2, '0')
  const ss = String(duration % 60).padStart(2, '0')
  const hue = PHASE_HUE[phase]
  const inCall = phase !== 'idle'

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col items-center"
      style={{ background: 'linear-gradient(180deg, rgba(8,10,14,0.45), rgba(8,10,14,0.62))', backdropFilter: 'blur(22px) saturate(1.3)', WebkitBackdropFilter: 'blur(22px) saturate(1.3)' }}>

      {/* 极淡的相位光晕（单色，不抢戏） */}
      <div className="pointer-events-none absolute inset-0" style={{
        background: `radial-gradient(42% 34% at 50% 40%, ${hue}14, transparent 72%)`,
        transition: 'background 1s ease',
      }} />

      {/* 极光背景：三枚缓漂光球，颜色跟随通话相位 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb" style={{
          width: '46vw', height: '46vw', left: '-8vw', top: '-12vw',
          background: `radial-gradient(circle, ${hue}2e, transparent 70%)`, animationDelay: '0s',
        }} />
        <div className="aurora-orb" style={{
          width: '40vw', height: '40vw', right: '-10vw', top: '30vh',
          background: `radial-gradient(circle, ${hue}24, transparent 70%)`, animationDelay: '-5s',
        }} />
        <div className="aurora-orb" style={{
          width: '36vw', height: '36vw', left: '18vw', bottom: '-14vw',
          background: `radial-gradient(circle, ${hue}1c, transparent 70%)`, animationDelay: '-9s',
        }} />
      </div>

      {/* 0101 数字雨画布 */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.55 }} />

      {/* 顶部 */}
      <div className="w-full flex items-center justify-between px-6 pt-5 z-10">
        <div className="flex items-center gap-2.5 px-3 h-8 rounded-full"
               style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: inCall ? hue : '#3f3f46', boxShadow: inCall ? `0 0 8px ${hue}` : 'none', transition: 'background 0.6s' }} />
          <span className="text-[12px] font-mono tracking-wide" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {inCall ? `${mm}:${ss} · ${PHASE_TEXT[phase]}` : '语音通话'}
          </span>
        </div>
        <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded-full transition-colors"
          style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
          收起
        </button>
      </div>

      {/* 中央：环形声纹 + 品牌字 */}
      <div className="flex-1 flex flex-col items-center justify-center z-10">
        <button
          onClick={phase === 'idle' ? startCall : phase === 'listening' ? sendRecording : undefined}
          className="relative flex items-center justify-center focus:outline-none"
          style={{ width: 280, height: 280, cursor: (phase === 'idle' || phase === 'listening') ? 'pointer' : 'default' }}>

          {/* 环形声纹条 */}
          {Array.from({ length: RING_BARS }).map((_, i) => {
            const angle = (i / RING_BARS) * 360
            return (
              <span key={i} ref={el => { ringRef.current[i] = el }}
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{
                  width: 3,
                  height: 5,
                  marginLeft: -1.5,
                  marginTop: -2.5,
                  transform: `rotate(${angle}deg) translateY(-${RING_RADIUS}px)`,
                  transformOrigin: 'center',
                  background: hue,
                  opacity: 0.5,
                  transition: 'background 0.8s ease',
                }} />
            )
          })}

          {/* 中心核：品牌字 */}
          <div ref={coreRef} className="rounded-full flex items-center justify-center"
            style={{
              width: 132, height: 132,
              background: 'radial-gradient(circle at 50% 42%, rgba(255,255,255,0.09), rgba(255,255,255,0.03) 62%)',
              border: '1px solid rgba(255,255,255,0.1)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              transition: 'transform 0.12s ease, border-color 0.8s ease',
              borderColor: `${hue}33`,
            }}>
            {phase === 'listening' ? (
              <div className="text-center pointer-events-none">
                <svg className="w-8 h-8 mx-auto" style={{ color: hasUtterance ? '#22c55e' : hue, transform: 'rotate(-90deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14m-7-7l7 7-7 7" />
                </svg>
                <div className="text-[10.5px] mt-1 font-medium" style={{ color: hasUtterance ? '#22c55e' : 'rgba(255,255,255,0.5)' }}>
                  {hasUtterance ? '点我发送' : '请说话'}
                </div>
              </div>
            ) : inCall ? (
              <BrandMark size={44} color={hue} />
            ) : (
              <svg className="w-9 h-9" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)">
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 011.11-.21 11.36 11.36 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.57 1 1 0 01-.21 1.11z" />
              </svg>
            )}
          </div>
        </button>

        {/* 状态 */}
        <div className="mt-9 text-[14px] font-medium tracking-wide" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {error ? <span style={{ color: '#f87171' }}>{error}</span> : PHASE_TEXT[phase]}
          {phase === 'thinking' && toolStatus && (
            <span className="ml-2 text-[11.5px] font-mono" style={{ color: 'rgba(255,255,255,0.45)' }}>{toolStatus}</span>
          )}
        </div>

        {/* 字幕 */}
        {(lastHeard || replyText) && (
          <div className="mt-6 max-w-xl px-6 py-3 text-center space-y-2 min-h-[64px] rounded-2xl"
                     style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
            {lastHeard && (
              <p className="text-[12.5px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.42)' }}>
                你：{lastHeard}
              </p>
            )}
            {replyText && (
              <p className="text-[15px] leading-[1.7]" style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>
                {replyText.slice(-200)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 宠物：低调陪伴 */}
      <img src="./pet.png" alt="" draggable={false}
        className="absolute right-7 bottom-28 w-[74px] h-[74px] select-none pointer-events-none"
        style={{ opacity: 0.85, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.45))' }} />

      {/* 手动打字输入条 */}
      {showTextInput && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 w-[min(560px,86%)]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-2xl"
            style={{ background: 'rgba(20,20,24,0.55)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(24px) saturate(1.25)', WebkitBackdropFilter: 'blur(24px) saturate(1.25)' }}>
            <input autoFocus value={textInput} onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendText() }}
              placeholder="打字发送，AI 会念出来并继续对话…"
              className="flex-1 bg-transparent outline-none text-[14px]"
              style={{ color: 'rgba(255,255,255,0.92)' }} />
            <button onClick={sendText} disabled={!textInput.trim()}
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
              style={{ background: hue, color: '#0a0a0c' }} title="发送">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 底部控制：三枚小圆钮 */}
      <div className="pb-9 flex items-center gap-4 z-10">
        <button onClick={toggleMute} disabled={!inCall}
          className="rounded-full flex items-center justify-center transition-all disabled:opacity-30"
          style={{ width: 46, height: 46, background: muted ? 'rgba(239,68,68,0.16)' : 'rgba(255,255,255,0.07)', color: muted ? '#f87171' : 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          title={muted ? '取消静音' : '静音'}>
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            {muted
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a5 5 0 00-9.9-.7M12 19v3m-3.75 0h7.5M19.07 4.93l-14.14 14.14" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />}
          </svg>
        </button>

        {phase === 'idle' ? (
          <button onClick={startCall}
            className="rounded-full flex items-center justify-center transition-all hover:scale-105"
            style={{ width: 60, height: 60, background: '#10b981', color: '#fff', boxShadow: '0 8px 32px rgba(16,185,129,0.35)' }}
            title="开始通话">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 011.11-.21 11.36 11.36 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.57 1 1 0 01-.21 1.11z" />
            </svg>
          </button>
        ) : (
          <button onClick={hangUp}
            className="rounded-full flex items-center justify-center transition-all hover:scale-105"
            style={{ width: 60, height: 60, background: '#ef4444', color: '#fff', boxShadow: '0 8px 32px rgba(239,68,68,0.35)', transform: 'rotate(135deg)' }}
            title="挂断">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 011.11-.21 11.36 11.36 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.57 1 1 0 01-.21 1.11z" />
            </svg>
          </button>
        )}

        <button onClick={() => setShowTextInput(v => !v)}
          className="rounded-full flex items-center justify-center transition-all"
          style={{ width: 46, height: 46, background: showTextInput ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          title="打字发送">
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8m-4-4v8M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
