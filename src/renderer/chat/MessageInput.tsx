import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { AttachedFile, Message, Settings } from '../types'
import { BUILTIN_TOOLS } from '../types'
import ContextGauge, { type ContextPart } from './ContextGauge'
import { buildChatSystemPrompt } from '../engine/chatPrompt'
import { refreshSkillManifest } from '../engine/skillManifest'
import { estimateTokens, guessModelContext } from '../utils/tokens'
import { ASSISTANT_NAME } from '../brand'

interface InstalledSkill { name: string; display_name?: string; description?: string; version?: string }

interface Props {
  onSend: (content: string, selectedSkillIds?: string[], attachedFiles?: AttachedFile[], sendOpts?: { accessLevel?: string; thinking?: string; swarm?: boolean; team?: any; chatMode?: 'general' | 'coding'; kb?: boolean; goal?: string }) => void
  disabled?: boolean
  /** 消息队列长度：流式中发送会排队 */
  queueCount?: number
  /** 待发消息队列（可视化，可单条取消） */
  queueItems?: { id: string; content: string }[]
  onRemoveQueued?: (id: string) => void
  /** 全局截图派发下来的 dataURL */
  incomingScreenshot?: string | null
  onScreenshotConsumed?: () => void
  currentModel?: string
  onModelChange?: (model: string) => void
  messages?: Message[]
  settings?: Settings
  /** 当前会话 id：用于草稿按会话隔离 */
  sessionId?: string
}

/** 思考程度档位 —— id 与 useChat 的 thinkText 键一一对应 */
const THINK_LEVELS = [
  { id: 'none', label: '关闭', hint: '直接作答，不展开推理' },
  { id: 'low', label: '低', hint: '简短思考后作答' },
  { id: 'medium', label: '中', hint: '适度思考后作答' },
  { id: 'high', label: '高', hint: '深入思考，权衡多种方案' },
  { id: 'max', label: '最大', hint: '穷举关键细节后再作答' },
]
const THINK_DEFAULT = 'medium'
/** 档位强调色（随强度递进） */
const THINK_COLORS: Record<string, string> = {
  none: '#9ca3af', low: '#6ee7b7', medium: '#34d399', high: '#10b981', max: '#047857',
}

/** 单次任务模式开关 */
type ModeKey = 'plan' | 'search' | 'draw' | 'dev' | 'swarm'

const MODES: { key: ModeKey; label: string; color: string; title: string; icon: string }[] = [
  { key: 'plan', label: '规划', color: '#d97706', title: '任务规划：先拆解步骤再逐步执行', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { key: 'search', label: '联网', color: '#2563eb', title: '联网搜索（web_search）', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
  { key: 'draw', label: '画画', color: '#0891b2', title: 'AI 画画（image_generate）', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' },
  { key: 'dev', label: '造技能', color: '#16a34a', title: '开发新的 Skill（create_skill）', icon: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z' },
  { key: 'swarm', label: '集群', color: '#0891b2', title: 'Agent 集群：多智能体拆解并协作执行', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
]

const SWARM_TEAM_OPTIONS = [
  { id: 'auto', label: '自动' },
  { id: 'writing', label: '写作' },
  { id: 'dev', label: '开发' },
  { id: 'research', label: '研究' },
  { id: 'employees', label: '员工团队（可@接力）' },
]

/** 斜杠命令：输入 / 快速启用模式与工具（runs 引用组件内函数，定义在组件内部） */
type SlashCmd = { cmd: string; label: string; hint: string; key: string }
const SLASH_COMMANDS: SlashCmd[] = [
  { cmd: '联网', label: '联网搜索', hint: '开启 web_search 联网模式', key: 'search' },
  { cmd: '规划', label: '任务规划', hint: '先拆解步骤再逐步执行', key: 'plan' },
  { cmd: '画画', label: 'AI 画画', hint: 'image_generate 生成图片', key: 'draw' },
  { cmd: '造技能', label: '开发技能', hint: 'create_skill 开发新 Skill', key: 'dev' },
  { cmd: '集群', label: 'Agent 集群', hint: '多智能体拆解协作', key: 'swarm' },

  { cmd: '知识库', label: '知识库增强', hint: 'RAG 检索笔记/索引', key: 'kb' },
  { cmd: '截图', label: '截图提问', hint: '框选屏幕区域提问', key: 'shot' },
  { cmd: '编码', label: 'Coding 模式', hint: '工作目录边界 + 工具优先', key: 'coding' },
  { cmd: '通用', label: '通用模式', hint: '日常对话', key: 'general' },
  { cmd: '思考低', label: '思考:低', hint: '简短思考，更快回复', key: 'think-low' },
  { cmd: '思考高', label: '思考:高', hint: '深入推理，权衡方案', key: 'think-high' },
  { cmd: '思考最大', label: '思考:最大', hint: '穷举关键细节后作答', key: 'think-max' },
]

const MODES_OFF: Record<ModeKey, boolean> = { plan: false, search: false, draw: false, dev: false, swarm: false }

// ─── composer 状态条：模式 · 模型 · 工作目录 · git 分支（学 ClerkBox 输入框上方的状态行）───
function ComposerStatusBar({ chatMode, modelLabel, workDir, disabled }: { chatMode: 'general' | 'coding'; modelLabel: string; workDir: string; disabled?: boolean }) {
  const { c } = useTheme()
  const [git, setGit] = useState<{ branch: string; changes: number } | null>(null)
  useEffect(() => {
    let alive = true
    setGit(null)
    if (!workDir) return
    const t = setTimeout(() => {
      fetch(`/api/git/status?dir=${encodeURIComponent(workDir)}`)
        .then(r => r.json())
        .then(d => { if (alive && d?.success && d.isRepo) setGit({ branch: String(d.branch || ''), changes: (d.changes || []).length }) })
        .catch(() => {})
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [workDir, disabled])
  const base = workDir ? workDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : ''
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5 text-[10.5px] min-w-0" style={{ color: c.textMuted }}>
      <span className="inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m15 0h1.5M6 6l1.06 1.06m11.88-1.06-1.06 1.06M12 8.25a3 3 0 100 6 3 3 0 000-6z" /></svg>
        {chatMode === 'coding' ? '编程模式' : '通用模式'}
      </span>
      <span className="font-mono truncate max-w-[180px]" title={modelLabel}>{modelLabel || '未配置模型'}</span>
      {base && (
        <span className="inline-flex items-center gap-1 truncate max-w-[160px]" title={workDir}>
          <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
          <span className="truncate">{base}</span>
        </span>
      )}
      {git && (
        <span className="inline-flex items-center gap-1 shrink-0" title={`分支 ${git.branch}${git.changes ? ` · ${git.changes} 处变更` : ''}`}>
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v6m0 0l-3-3m3 3l3-3M6 9a3 3 0 100-6 3 3 0 000 6zm12 0a3 3 0 100-6 3 3 0 000 6zM6 9v6a3 3 0 003 3h6a3 3 0 003-3V9" /></svg>
          <span className="font-mono">{git.branch}</span>
          {git.changes > 0 && <span className="font-mono">+{git.changes}</span>}
        </span>
      )}
    </div>
  )
}

export default function MessageInput({ onSend, disabled, currentModel, onModelChange, messages, settings, queueCount = 0, queueItems, onRemoveQueued, incomingScreenshot, onScreenshotConsumed, sessionId }: Props) {
  const [value, setValue] = useState('')
  const [showToolbar, setShowToolbar] = useState(false)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [showSkillSelector, setShowSkillSelector] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [sttError, setSttError] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [transcribing, setTranscribing] = useState(false)
  const [volume, setVolume] = useState(0)
  const [focused, setFocused] = useState(false)
  // 对话模式：通用 / Coding（全局记忆，随时切换）
  const [chatMode, setChatMode] = useState<'general' | 'coding'>(() => (localStorage.getItem('lyclaw_chat_mode') as 'general' | 'coding') || 'general')
  const switchChatMode = (m: 'general' | 'coding') => { setChatMode(m); try { localStorage.setItem('lyclaw_chat_mode', m) } catch {} }
  const [thinking, setThinking] = useState<string>(() => {
    try {
      const v = localStorage.getItem('lyclaw_thinking')
      if (v && THINK_LEVELS.some(l => l.id === v)) return v
    } catch {}
    return THINK_DEFAULT
  })
  const [showThinking, setShowThinking] = useState(false)
  const [modes, setModes] = useState<Record<ModeKey, boolean>>(MODES_OFF)
  // 知识库开关（粘性：整段对话保持；默认关，避免每次悄悄注入并花 embedding）
  const [kbOn, setKbOn] = useState<boolean>(() => { try { return localStorage.getItem('lyclaw_kb_on') === '1' } catch { return false } })
  // 目标模式开关：开启后下一条消息作为「目标」，评估器逐轮检查、未达成自动续跑（≤3 轮）
  const [goalOn, setGoalOn] = useState(false)
  // 本次权限档位（粘性）：ask=需确认 / edit=可编辑 / full=完全访问；useChat 据此注入权限提示
  const [access, setAccess] = useState<string>(() => { try { return localStorage.getItem('lyclaw_access_level') || 'edit' } catch { return 'edit' } })
  const pickAccess = (v: string) => { setAccess(v); try { localStorage.setItem('lyclaw_access_level', v) } catch {} }
  const toggleKb = () => setKbOn(v => { const n = !v; try { localStorage.setItem('lyclaw_kb_on', n ? '1' : '0') } catch {} return n })
  const [swarmTeam, setSwarmTeam] = useState<string>('auto')
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const mediaRecorderRef = useRef<any>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { c, theme } = useTheme()
  const { lang, t } = useLanguage()
  const glass = theme === 'dark' ? 'rgba(45,45,48,0.62)' : 'rgba(255,255,255,0.66)'

  // --- 语音输入 ---
  const sendWav = useCallback(async (chunks: Float32Array[]) => {
    const totalLen = chunks.reduce((s, c) => s + c.length, 0)
    if (totalLen < 1600) return
    const pcm = new Int16Array(totalLen)
    let offset = 0
    for (const c of chunks) { for (let i = 0; i < c.length; i++) { pcm[offset++] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32768))) } }
    const header = new ArrayBuffer(44)
    const dv = new DataView(header)
    const writeStr = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(pos + i, s.charCodeAt(i)) }
    writeStr(0, 'RIFF'); dv.setUint32(4, 36 + pcm.byteLength, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt '); dv.setUint32(16, 16, true)
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
    writeStr(36, 'data'); dv.setUint32(40, pcm.byteLength, true)
    const wav = new Blob([header, pcm.buffer], { type: 'audio/wav' })
    setTranscribing(true)
    try {
      const formData = new FormData(); formData.append('audio', wav, 'recording.wav')
      const res = await fetch('/api/speech-to-text', { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const text = data?.text || ''
      if (text) setValue(prev => prev.trim() ? prev + ' ' + text : text)
      else setSttError('未识别到语音')
    } catch (e: any) { setSttError(e.message || '语音识别失败') }
    finally { setTranscribing(false) }
  }, [])

  const startVolumeMeter = useCallback((stream: MediaStream, audioCtx: AudioContext, source: MediaStreamAudioSourceNode) => {
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.55
    source.connect(analyser)
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.frequencyBinCount)
    const loop = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const avg = sum / data.length / 255
      setVolume(Math.min(1, avg * 2.2))
      rafRef.current = requestAnimationFrame(loop)
    }
    loop()
  }, [])

  const stopVolumeMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    analyserRef.current = null
    setVolume(0)
  }, [])

  // ─── 语音输入：优先使用浏览器原生 SpeechRecognition（实时转写、无需上传音频）───
  //     若浏览器不支持或语音服务不可用，则自动回退到服务端识别引擎。
  const [browserSttBroken, setBrowserSttBroken] = useState(false)
  const [sttEngine, setSttEngine] = useState<'browser' | 'server' | null>(null)
  const speechRef = useRef<any>(null)
  const baseTextRef = useRef('')
  const finalTextRef = useRef('')

  const browserSttCtor = () => (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  const startBrowserSTT = useCallback((): boolean => {
    const Ctor = browserSttCtor()
    if (!Ctor) return false
    try {
      const rec = new Ctor()
      rec.lang = 'zh-CN'
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = 1

      baseTextRef.current = value.trim()
      finalTextRef.current = ''

      rec.onresult = (e: any) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalTextRef.current += r[0].transcript
          else interim += r[0].transcript
        }
        const base = baseTextRef.current
        setValue((((base ? base + ' ' : '') + finalTextRef.current + interim)).replace(/\s+$/, ''))
      }
      rec.onerror = (e: any) => {
        const err = String(e?.error || '')
        if (err === 'no-speech') { setSttError('未检测到语音'); return }
        if (err === 'aborted') return
        // 浏览器语音服务不可用 → 标记并回退到服务端
        setBrowserSttBroken(true)
        setSttError('浏览器语音识别不可用，已切换为本地识别引擎')
      }
      rec.onend = () => { speechRef.current = null; setIsListening(false) }

      rec.start()
      speechRef.current = rec
      setIsListening(true)
      setSttEngine('browser')
      setSttError('')
      return true
    } catch {
      return false
    }
  }, [value])

  // 服务端识别（回退路径）
  const startServerSTT = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioCtx = new AudioContext({ sampleRate: 16000 })
      const source = audioCtx.createMediaStreamSource(stream)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      const chunks: Float32Array[] = []
      source.connect(processor); processor.connect(audioCtx.destination)
      processor.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))) }
      const rec = { stream, audioCtx, source, processor, chunks }
      mediaRecorderRef.current = rec as any; setIsListening(true)
      setSttEngine('server')
      startVolumeMeter(stream, audioCtx, source)
      const timeout = setTimeout(async () => {
        setIsListening(false); stopVolumeMeter()
        try { rec.processor.disconnect(); rec.source.disconnect(); await rec.audioCtx.close(); rec.stream.getTracks().forEach(t => t.stop()) } catch {}
        await sendWav(rec.chunks)
      }, 60000);
      (rec as any)._timeout = timeout
      ;(rec as any).stop = async () => { clearTimeout(timeout); setIsListening(false); stopVolumeMeter(); try { rec.processor.disconnect(); rec.source.disconnect(); await rec.audioCtx.close(); rec.stream.getTracks().forEach(t => t.stop()) } catch {}; if (rec.chunks.length) await sendWav(rec.chunks) }
    } catch (e: any) { setSttError(e.message || '麦克风不可用') }
  }, [sendWav, startVolumeMeter, stopVolumeMeter])

  const toggleListening = useCallback(async () => {
    setSttError('')
    if (isListening) {
      if (speechRef.current) { try { speechRef.current.stop() } catch {} }
      else mediaRecorderRef.current?.stop?.()
      return
    }
    if (!browserSttBroken && browserSttCtor()) {
      if (startBrowserSTT()) return
      setBrowserSttBroken(true)
    }
    await startServerSTT()
  }, [isListening, browserSttBroken, startBrowserSTT, startServerSTT])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = useCallback(async () => {
    const api = (window as any).electronAPI
    if (api?.openFileDialog) {
      try {
        const paths: string[] = await api.openFileDialog()
        if (!paths?.length) return
        setAttachedFiles(prev => { const existing = new Set(prev.map(f => f.path)); return [...prev, ...paths.map(p => ({ path: p, name: p.split('/').pop() || p, size: 0 })).filter(f => !existing.has(f.path))] })
      } catch {}
      return
    }
    fileInputRef.current?.click()
  }, [])

  const handleNativeFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return
    setAttachedFiles(prev => { const existing = new Set(prev.map(x => x.name)); return [...prev, ...Array.from(files).map(f => ({ path: '', name: f.name, size: f.size, file: f })).filter(x => !existing.has(x.name))] })
    e.target.value = ''
  }, [])

  // 技能列表
  const loadSkills = useCallback(() => {
    refreshSkillManifest()
    fetch('/api/skills/list').then(res => res.json()).then(data => {
      const list = Array.isArray(data) ? data : JSON.parse(data.output || '[]')
      setInstalledSkills(list.filter((s: InstalledSkill) => s.name !== 'builtin'))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    loadSkills()
    const onSkillsChanged = () => loadSkills()
    window.addEventListener('skills-changed', onSkillsChanged)
    window.addEventListener('focus', onSkillsChanged)
    return () => {
      window.removeEventListener('skills-changed', onSkillsChanged)
      window.removeEventListener('focus', onSkillsChanged)
    }
  }, [loadSkills])

  useEffect(() => { if (showSkillSelector) loadSkills() }, [showSkillSelector, loadSkills])

  // 点击浮层外部时收起（工具面板 / 思考程度面板）
  useEffect(() => {
    if (!showToolbar && !showThinking) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowToolbar(false)
        setShowThinking(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showToolbar, showThinking])

  // Textarea 自动增高
  useEffect(() => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px' }
  }, [value])

  // 集群指挥室「发起集群任务」：切到 集群 + 员工团队
  useEffect(() => {
    const h = (e: Event) => {
      const team = (e as CustomEvent).detail?.team
      setModes(prev => ({ ...prev, swarm: true, autonomy: false }))
      if (team) setSwarmTeam(String(team))
    }
    window.addEventListener('swarm-preset', h)
    return () => window.removeEventListener('swarm-preset', h)
  }, [])

  const toggleSkill = (name: string) => setSelectedSkillIds(prev => prev.includes(name) ? prev.filter(id => id !== name) : [...prev, name])

  // ─── 思考程度 ───
  const thinkIdx = Math.max(0, THINK_LEVELS.findIndex(l => l.id === thinking))
  const curThink = THINK_LEVELS[thinkIdx]
  const cycleThink = () => setThinking(THINK_LEVELS[(thinkIdx + 1) % THINK_LEVELS.length].id)

  // 档位持久化（跨会话 / 刷新保留）
  useEffect(() => { try { localStorage.setItem('lyclaw_thinking', thinking) } catch {} }, [thinking])

  const toggleMode = (k: ModeKey) => setModes(m => ({ ...m, [k]: !m[k] }))

  // ─── 斜杠命令：输入 / 弹出命令菜单，↑↓ 选择，Enter 执行 ───
  const [slashIdx, setSlashIdx] = useState(0)
  const slashActive = value.startsWith('/') && !disabled
  const slashQuery = slashActive ? value.slice(1) : ''
  const slashMatches = useMemo(() => {
    if (!slashActive) return []
    const q = slashQuery.trim().toLowerCase()
    if (!q) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(x => x.cmd.toLowerCase().includes(q) || x.label.toLowerCase().includes(q))
  }, [slashActive, slashQuery])
  useEffect(() => { setSlashIdx(0) }, [slashQuery])
  const applySlash = (sc: SlashCmd) => {
    if (sc.key === 'kb') toggleKb()
    else if (sc.key === 'shot') { setValue(''); handleScreenshot(); return }
    else if (sc.key === 'coding') switchChatMode('coding')
    else if (sc.key === 'general') switchChatMode('general')
    else if (sc.key === 'think-low') setThinking('low')
    else if (sc.key === 'think-high') setThinking('high')
    else if (sc.key === 'think-max') setThinking('max')
    else toggleMode(sc.key as ModeKey)
    // 保留命令后已输入的正文（/联网 搜天气 → 搜天气）
    setValue(v => v.replace(/^\/\S*\s?/, ''))
    setSlashIdx(0)
  }

  // 上下文上限：设置手动设置值优先；仍是默认 1M 时按模型名推断真实窗口
  const effectiveCtxLimit = useMemo(() => {
    const configured = (settings as any)?.contextWindow
    if (configured && configured >= 4000 && configured !== 1000000) return configured
    return guessModelContext(currentModel || settings?.model)
  }, [(settings as any)?.contextWindow, currentModel, settings?.model])

  // 接收全局截图（快捷键/按钮触发）→ 加入附件
  useEffect(() => {
    if (!incomingScreenshot) return
    setAttachedFiles(prev => [...prev, { path: '', name: `截图 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}.png`, size: 0, dataUrl: incomingScreenshot }])
    onScreenshotConsumed?.()
  }, [incomingScreenshot])

  /** 手动截屏：请求主进程抓屏 → 打开框选浮层（由 App 统一渲染与派发） */
  const handleScreenshot = useCallback(async () => {
    const api = (window as any).electronAPI
    if (api?.captureScreen) {
      const dataUrl = await api.captureScreen()
      if (dataUrl) window.dispatchEvent(new CustomEvent('open-screenshot-crop', { detail: dataUrl }))
      return
    }
    // 无 Electron API：网页降级 — 直接派发当前屏幕不可行，提示
    alert('截图功能仅在桌面版可用')
  }, [])

  // 框选完成 → 加入附件
  useEffect(() => {
    const h = (e: Event) => {
      const dataUrl = (e as CustomEvent).detail as string
      if (!dataUrl) return
      setAttachedFiles(prev => [...prev, { path: '', name: `截图 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}.png`, size: 0, dataUrl }])
    }
    window.addEventListener('attach-screenshot', h)
    return () => window.removeEventListener('attach-screenshot', h)
  }, [])

  // 宽屏模式（与 ChatView 联动，ChatTab 工作区条切换）
  const [wide, setWide] = useState(() => localStorage.getItem('lyclaw_chat_wide') === '1')
  useEffect(() => {
    const h = () => setWide(localStorage.getItem('lyclaw_chat_wide') === '1')
    window.addEventListener('chat-wide-changed', h)
    return () => window.removeEventListener('chat-wide-changed', h)
  }, [])

  // 全屏编辑长文（Esc 或再次点击退出）
  const [fullscreenEdit, setFullscreenEdit] = useState(false)
  useEffect(() => {
    if (!fullscreenEdit) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setFullscreenEdit(false) } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [fullscreenEdit])

  // 提示词预设库：一键对输入内容套用预设指令
  const PROMPT_PRESETS: { id: string; label: string; tpl: (t: string) => string }[] = [
    { id: 'translate', label: '翻译成英文', tpl: t => `请将以下内容翻译成地道的英文，只输出译文：\n\n${t}` },
    { id: 'polish', label: '润色中文', tpl: t => `请润色以下中文文字，使其更通顺专业，保持原意，只输出润色后结果：\n\n${t}` },
    { id: 'review', label: '代码审查', tpl: t => `请审查以下代码，指出 bug、安全隐患与可改进点，按严重程度排序：\n\n${t}` },
    { id: 'explain', label: '解释代码', tpl: t => `请逐段解释以下代码的作用，简明扼要：\n\n${t}` },
    { id: 'weekly', label: '生成周报', tpl: t => `请根据以下工作记录整理成一份结构化周报（本周成果 / 进行中 / 下周计划）：\n\n${t}` },
    { id: 'summary', label: '总结要点', tpl: t => `请把以下内容总结成不超过 5 条的要点：\n\n${t}` },
  ]
  const [presetOpen, setPresetOpen] = useState(false)
  const applyPreset = (tpl: (t: string) => string) => {
    setPresetOpen(false)
    const text = value.trim()
    if (!text) return
    setValue(tpl(text))
    setTimeout(() => textareaRef.current?.focus(), 30)
  }

  // ─── 引用回复：消息气泡「引用」按钮派发 quote-message，这里插入为引用块 ───
  useEffect(() => {
    const h = (e: Event) => {
      const text = (e as CustomEvent).detail as string
      if (!text) return
      const quoted = String(text).trim().split('\n').map(l => `> ${l}`).join('\n')
      setValue(v => (v ? `${v}\n\n${quoted}\n\n` : `${quoted}\n\n`))
      setTimeout(() => textareaRef.current?.focus(), 30)
    }
    window.addEventListener('quote-message', h)
    return () => window.removeEventListener('quote-message', h)
  }, [])

  // ─── 快捷粘贴：Cmd/Ctrl+Shift+V 把剪贴板图片直接加为附件 ───
  useEffect(() => {
    const h = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        try {
          const items = await (navigator.clipboard as any).read?.()
          if (!items) return
          for (const it of items) {
            const type = it.types?.find((t: string) => t.startsWith('image/'))
            if (type) {
              const blob = await it.getType(type)
              const name = `剪贴板图片 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}.png`
              setAttachedFiles(prev => [...prev, { path: '', name, size: blob.size, file: blob }])
              e.preventDefault()
              return
            }
          }
        } catch { /* 剪贴板无图片或权限不足 */ }
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ─── 草稿保存：按会话隔离，切换会话自动恢复 ───
  const valueRef = useRef(value)
  valueRef.current = value
  const prevSessionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    // 会话切换时先把未保存的旧草稿写回旧会话，再载入新会话草稿
    if (prevSessionRef.current !== undefined && prevSessionRef.current !== sessionId) {
      const oldKey = `lyclaw_draft_${prevSessionRef.current}`
      try { if (valueRef.current) { localStorage.setItem(oldKey, valueRef.current) } else { localStorage.removeItem(oldKey) } } catch { /* ignore */ }
    }
    prevSessionRef.current = sessionId
    if (!sessionId) return
    try { setValue(localStorage.getItem(`lyclaw_draft_${sessionId}`) || '') } catch { /* ignore */ }
  }, [sessionId])
  useEffect(() => {
    if (!sessionId) return
    const key = `lyclaw_draft_${sessionId}`
    const t = setTimeout(() => { try { if (value) { localStorage.setItem(key, value) } else { localStorage.removeItem(key) } } catch { /* ignore */ } }, 400)
    return () => clearTimeout(t)
  }, [value, sessionId])

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed) return

    // 单次任务模式：按原项目语义包装用户输入
    let content = trimmed
    if (modes.dev) content = `请使用 create_skill 工具为我开发一个新的 Skill。根据以下需求设计并创建 Skill：\n\n${content}`
    if (modes.plan) content = `【任务规划模式】\n请先分析此任务，拆解为清晰的步骤清单，然后按步骤逐一执行。格式：\n1. 第一步：xxx\n2. 第二步：xxx\n...\n然后开始执行。\n\n用户任务：${content}`
    if (modes.draw) content = `请使用 image_generate 工具生成图片，内容：${content}`
    if (modes.search) content = `请使用 web_search 工具联网搜索以下内容：\n\n${content}`

    onSend(
      content,
      selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
      attachedFiles.length > 0 ? attachedFiles : undefined,
      { thinking, swarm: modes.swarm, team: modes.swarm ? swarmTeam : undefined, chatMode, kb: kbOn, goal: goalOn ? trimmed : undefined, accessLevel: access },
    )
    // 输入历史（↑ 回溯最近 20 条）
    try {
      const hist: string[] = JSON.parse(localStorage.getItem('lyclaw_input_history') || '[]')
      localStorage.setItem('lyclaw_input_history', JSON.stringify([trimmed, ...hist.filter(h => h !== trimmed)].slice(0, 20)))
    } catch { /* ignore */ }
    histNavRef.current = { list: [], idx: -1 }
    setValue(''); setAttachedFiles([]); setSelectedSkillIds([])
    if (sessionId) { try { localStorage.removeItem(`lyclaw_draft_${sessionId}`) } catch { /* ignore */ } }
    setModes(MODES_OFF)   // 模式为单次生效，发送后复位，避免误触发
    setGoalOn(false)      // 目标模式单次生效
  }

  // ─── 输入历史导航：空输入按 ↑ 逐条回溯，↓ 返回 ───
  const histNavRef = useRef<{ list: string[]; idx: number }>({ list: [], idx: -1 })

  // 粘贴图片 → 直接加入附件（多模态会转 base64 发给模型）
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items || []
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (!f) continue
        e.preventDefault()
        setAttachedFiles(prev => [...prev, { path: '', name: f.name || `粘贴图片 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}.png`, size: f.size, file: f }])
        return
      }
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // ─── 斜杠命令菜单（优先级最高）：↑↓ 选择 / Enter·Tab 执行 / Esc 关闭 ───
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % slashMatches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => (i - 1 + slashMatches.length) % slashMatches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const sc = slashMatches[Math.min(slashIdx, slashMatches.length - 1)]
        if (sc) applySlash(sc)
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setValue(''); setSlashIdx(0); return }
    }
    // ↑/↓ 输入历史：空输入按 ↑ 开始回溯；导航中 ↓ 后退，退无可退恢复空输入
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!value) {
        try {
          const hist: string[] = JSON.parse(localStorage.getItem('lyclaw_input_history') || '[]')
          if (hist.length > 0) { e.preventDefault(); histNavRef.current = { list: hist, idx: 0 }; setValue(hist[0]) }
        } catch { /* ignore */ }
      } else if (histNavRef.current.idx >= 0) {
        const { list, idx } = histNavRef.current
        if (idx < list.length - 1) { e.preventDefault(); histNavRef.current = { list, idx: idx + 1 }; setValue(list[idx + 1]) }
      }
      return
    }
    if (e.key === 'ArrowDown' && histNavRef.current.idx >= 0) {
      const { list, idx } = histNavRef.current
      e.preventDefault()
      if (idx <= 0) { histNavRef.current = { list: [], idx: -1 }; setValue('') }
      else { histNavRef.current = { list, idx: idx - 1 }; setValue(list[idx - 1]) }
      return
    }
    if (e.key === 'Enter') {
      const ne = e.nativeEvent as any
      if (ne.isComposing || ne.keyCode === 229) return
      // enterToSend=true（默认）：Enter 发送，Shift+Enter 换行；false：Cmd/Ctrl+Enter 发送
      const enterToSend = (settings as any)?.enterToSend !== false
      if (enterToSend && !e.shiftKey) { e.preventDefault(); handleSend() }
      else if (!enterToSend && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend() }
    }
  }

  // ─── 上下文占用估算 ───
  const msgsSig = messages ? `${messages.length}:${messages[messages.length - 1]?.id || ''}:${Math.floor(((messages[messages.length - 1]?.content || '').length || 0) / 500)}` : '0'
  const contextParts: ContextPart[] = useMemo(() => {
    const parts: ContextPart[] = []
    if (settings) {
      parts.push({ label: '系统提示', tokens: estimateTokens(buildChatSystemPrompt(settings)), color: c.textTertiary })
    }
    try {
      parts.push({ label: '工具定义', tokens: estimateTokens(JSON.stringify(BUILTIN_TOOLS)), color: c.accent })
    } catch { /* ignore */ }
    if (messages && messages.length > 0) {
      const history = messages.reduce((sum, m) => {
        let tcLen = 0
        if (m.tool_calls) { try { tcLen = JSON.stringify(m.tool_calls).length } catch { tcLen = 0 } }
        return sum + estimateTokens(m.content) + estimateTokens((m as any).thinking) + estimateTokens(tcLen ? JSON.stringify(m.tool_calls) : '')
      }, 0)
      parts.push({ label: '历史消息', tokens: history, color: '#3b82f6' })
    }
    parts.push({ label: '当前输入', tokens: estimateTokens(value), color: '#f59e0b' })
    return parts
  }, [settings, msgsSig, value])

  const canSend = !!value.trim()

  return (
    <div className="px-6 pt-2 pb-4 shrink-0">
      <div ref={panelRef} className="mx-auto w-full relative" style={{ maxWidth: wide ? 1100 : 860 }}>
        {/* 工具面板 —— 位于输入框上方 */}
        {showToolbar && (
          <div className="absolute bottom-full left-0 right-0 mb-3 z-40 rounded-2xl border shadow-lg animate-fade-in overflow-hidden glass-strong"
            style={{ borderColor: c.border, maxHeight: '45vh', overflowY: 'auto' }}>
            <div className="p-3 space-y-3">
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachedFiles.map(file => (
                    <span key={file.path} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                      style={{ background: c.surfaceInput, border: `1px solid ${c.border}`, color: c.textSecondary }}>
                      {file.name}
                      <button onClick={() => setAttachedFiles(prev => prev.filter(f => f.path !== file.path))} className="ml-0.5 hover:opacity-70" style={{ color: c.textTertiary }}>&times;</button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1">
                <button onClick={() => setShowSkillSelector(!showSkillSelector)} title="技能库"
                  className="btn-ghost flex items-center gap-1.5 px-2.5 h-8" style={{ color: selectedSkillIds.length > 0 ? c.accent : c.textSecondary }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5L8 13.8 2 9.2h7.6z" />
                  </svg>
                  技能
                </button>
                <button onClick={handleFileUpload} title="附加文件"
                  className="btn-ghost flex items-center gap-1.5 px-2.5 h-8" style={{ color: attachedFiles.length > 0 ? c.accent : c.textSecondary }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  附件
                </button>
                <button onClick={() => { setShowToolbar(false); handleScreenshot() }} title="截图提问（Cmd+Shift+S 全局可用）"
                  className="btn-ghost flex items-center gap-1.5 px-2.5 h-8" style={{ color: c.textSecondary }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                  </svg>
                  截图
                </button>
              </div>

              {/* 任务模式（规划 / 联网 / 画画 / 造技能 / 集群 / 知识库） */}
              <div className="flex flex-wrap items-center gap-1">
                {MODES.map(m => {
                  const on = modes[m.key]
                  return (
                    <button key={m.key} onClick={() => toggleMode(m.key)} title={m.title} aria-pressed={on}
                      className="h-8 px-2.5 rounded-full flex items-center gap-1.5 transition-colors"
                      style={{
                        background: on ? `${m.color}1a` : 'transparent',
                        border: `1px solid ${on ? `${m.color}66` : c.border}`,
                        color: on ? m.color : c.textSecondary,
                      }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={m.icon} />
                      </svg>
                      <span className="text-[12px] font-medium">{m.label}</span>
                    </button>
                  )
                })}
                <button onClick={toggleKb} title="知识库检索增强（RAG）：开启后本条会检索你的笔记/索引并引用作答" aria-pressed={kbOn}
                  className="h-8 px-2.5 rounded-full flex items-center gap-1.5 transition-colors"
                  style={{
                    background: kbOn ? '#0596691a' : 'transparent',
                    border: `1px solid ${kbOn ? '#05966966' : c.border}`,
                    color: kbOn ? '#059669' : c.textSecondary,
                  }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <span className="text-[12px] font-medium">知识库</span>
                </button>
                {modes.swarm && (
                  <select value={swarmTeam} onChange={e => setSwarmTeam(e.target.value)}
                    className="h-8 px-2 rounded-full text-[12px] outline-none cursor-pointer shrink-0"
                    style={{ background: c.surfaceInput, color: c.textSecondary, border: `1px solid ${c.border}` }}
                    title="选择集群团队模板">
                    {SWARM_TEAM_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                )}
              </div>

              {/* 对话模式 / 思考程度 / 预设 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="h-8 p-0.5 rounded-full flex items-center shrink-0" style={{ background: c.surfaceInput }}>
                  {([['general', '通用'], ['coding', 'Coding']] as const).map(([id, label]) => {
                    const active = chatMode === id
                    return (
                      <button key={id} onClick={() => switchChatMode(id)}
                        className="h-7 px-2.5 rounded-full text-[11.5px] font-medium transition-all"
                        style={active
                          ? { background: c.surfaceCard, color: c.textHead, boxShadow: '0 1px 2px rgba(0,0,0,0.10)' }
                          : { color: c.textTertiary }}
                        title={id === 'coding' ? '编程模式：工作目录边界 + 工具优先 + 代码规范' : '通用对话模式'}>
                        {label}
                      </button>
                    )
                  })}
                </div>
                <button onClick={() => setShowThinking(v => !v)}
                  className="h-8 px-2.5 rounded-full flex items-center gap-1.5 transition-colors shrink-0"
                  style={{ background: showThinking ? c.surfaceActive : 'transparent' }}
                  title="调整思考程度" aria-label="调整思考程度">
                  <span className="relative flex">
                    {thinking === 'max' && <span className="think-halo" />}
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none"
                      stroke={THINK_COLORS[thinking]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10H12l1-8z" />
                    </svg>
                  </span>
                  <span className="text-[12.5px] font-medium" style={{ color: THINK_COLORS[thinking] }}>
                    思考:{curThink.label}
                  </span>
                </button>
                <div className="relative shrink-0">
                  <button onClick={() => setPresetOpen(v => !v)} disabled={!value.trim()}
                    className="h-8 px-2.5 rounded-full flex items-center gap-1.5 transition-colors disabled:opacity-40"
                    style={{ background: presetOpen ? c.surfaceActive : 'transparent', color: c.textSecondary }}
                    title="提示词预设：对输入内容套用常用指令">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span className="text-[12px] font-medium">预设</span>
                  </button>
                  {presetOpen && (
                    <div className="absolute left-0 bottom-9 z-30 rounded-xl py-1 shadow-lg w-44 animate-fade-in glass-strong"
                      style={{ border: `1px solid ${c.border}` }} onMouseLeave={() => setPresetOpen(false)}>
                      {PROMPT_PRESETS.map(p => (
                        <button key={p.id} onClick={() => { applyPreset(p.tpl); setPresetOpen(false) }}
                          className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
                          style={{ color: c.text }} onMouseEnter={ev => ev.currentTarget.style.background = c.surfaceHover} onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 模型切换 */}
              {(() => {
                const modelList = [...new Set([...((settings as any)?.models || []), settings?.model].filter(Boolean))]
                if (modelList.length === 0) return null
                return (
                  <select value={currentModel || ''} onChange={e => onModelChange?.(e.target.value)}
                    className="text-[12px] rounded-lg px-2.5 h-8 outline-none cursor-pointer w-full"
                    style={{ background: c.surfaceInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                    {modelList.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )
              })()}

              {showSkillSelector && (
                <div className="rounded-xl border p-2.5" style={{ borderColor: c.border, background: c.surfaceInput }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: c.textSecondary }}>技能 ({selectedSkillIds.length}/{installedSkills.length})</span>
                    <button onClick={() => selectedSkillIds.length === installedSkills.length ? setSelectedSkillIds([]) : setSelectedSkillIds(installedSkills.map(s => s.name))}
                      className="text-[11px]" style={{ color: c.accent }}>
                      {selectedSkillIds.length === installedSkills.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {installedSkills.length === 0 ? (
                      <div className="px-2 py-4 text-center text-xs" style={{ color: c.textTertiary }}>暂无已安装的技能</div>
                    ) : installedSkills.map(skill => {
                      const checked = selectedSkillIds.includes(skill.name)
                      return (
                        <label key={skill.name} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-lg transition-colors"
                          style={{ color: c.text }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleSkill(skill.name)} className="w-3.5 h-3.5 rounded" style={{ accentColor: c.accent }} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate" style={{ color: c.textHead }}>{skill.display_name || skill.name}</div>
                            {skill.description && <div className="text-[10px] truncate" style={{ color: c.textTertiary }}>{skill.description}</div>}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                  <button onClick={() => setShowSkillSelector(false)} className="w-full mt-2 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: c.accent, color: c.accentText }}>确认</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 思考程度面板 —— 参考 ChatGPT / Codex 的强度选择器 */}
        {showThinking && (
          <div className="absolute bottom-full left-0 mb-3 z-40 w-[440px] max-w-full rounded-2xl border shadow-lg animate-fade-in px-4 pt-3.5 pb-4 glass-strong"
            style={{ borderColor: c.border }}>
            {/* 头部：闪电 · 档位 · 重置（最大档带光环） */}
            <div className="relative flex items-center mb-0.5">
              <span className="relative flex shrink-0">
                {thinking === 'max' && <span className="think-halo" />}
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none"
                  stroke={THINK_COLORS[thinking]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10H12l1-8z" />
                </svg>
              </span>
              <div className="flex-1 flex items-center justify-center gap-1">
                <span className="text-[17px] font-bold tracking-tight" style={{ color: THINK_COLORS[thinking] }}>
                  {curThink.label}
                </span>
                <button onClick={cycleThink} title="切换到下一档"
                  className="w-5 h-5 rounded flex items-center justify-center transition-colors"
                  style={{ color: c.textTertiary }}
                  onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <button onClick={() => setThinking(THINK_DEFAULT)} title="恢复默认（中）"
                className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors"
                style={{ color: c.textTertiary }}
                onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M4.05 13A9 9 0 106 5.3L4 8" />
                </svg>
              </button>
            </div>

            {/* 当前模型 */}
            <div className="text-center text-[11.5px] mb-3 truncate" style={{ color: c.textTertiary }}>
              {currentModel || settings?.model || '默认模型'}
            </div>

            {/* 强度滑块（轨道上有持续游动的小点） */}
            <div className="think-slider-wrap">
              <input type="range" min={0} max={THINK_LEVELS.length - 1} step={1} value={thinkIdx}
                onChange={e => setThinking(THINK_LEVELS[Number(e.target.value)].id)}
                className="think-slider" aria-label="思考程度" />
              <div className="think-dots" aria-hidden="true" />
            </div>

            {/* 档位刻度 */}
            <div className="flex justify-between mt-2 px-[7px]">
              {THINK_LEVELS.map((l, i) => (
                <button key={l.id} onClick={() => setThinking(l.id)}
                  className="text-[10.5px] transition-colors"
                  style={{ color: i === thinkIdx ? THINK_COLORS[thinking] : c.textMuted, fontWeight: i === thinkIdx ? 600 : 400 }}>
                  {l.label}
                </button>
              ))}
            </div>

            <div className="mt-2.5 text-center text-[11.5px]" style={{ color: c.textTertiary }}>{curThink.hint}</div>
          </div>
        )}

        {/* 录音指示 */}
        {(isListening || transcribing) && (
          <div className="mb-2 h-8 flex items-center justify-center">
            {isListening && !transcribing && (
              sttEngine === 'browser' ? (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: c.toolErr }} />
                  <span className="text-[11.5px]" style={{ color: c.textSecondary }}>正在聆听…点击麦克风结束</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex items-end gap-[3px] h-5">
                    {Array.from({ length: 20 }).map((_, i) => {
                      const wave = 0.4 + 0.6 * Math.abs(Math.sin(i * 0.85 + Date.now() / 280))
                      return (
                        <span key={i} className="w-[3px] rounded-full transition-all duration-75"
                          style={{ height: `${Math.max(3, 4 + volume * 20 * wave)}px`, background: c.accent, opacity: 0.75 + 0.25 * wave }} />
                      )
                    })}
                  </div>
                  <span className="text-[11.5px]" style={{ color: c.textSecondary }}>录音中…点击麦克风结束并转写</span>
                </div>
              )
            )}
            {transcribing && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: c.accent }}>
                  <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-[11.5px]" style={{ color: c.accent }}>正在转写…</span>
              </div>
            )}
          </div>
        )}

        {/* 斜杠命令菜单：输入 / 触发，↑↓ 选择，Enter 执行 */}
        {slashActive && slashMatches.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 z-40 rounded-2xl border shadow-lg animate-fade-in overflow-hidden glass-strong"
            style={{ borderColor: c.border }}>
            <div className="py-1.5 max-h-64 overflow-y-auto scrollbar-thin">
              {slashMatches.map((sc, i) => (
                <button key={sc.key} onClick={() => applySlash(sc)} onMouseEnter={() => setSlashIdx(i)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
                  style={{ background: i === slashIdx ? c.surfaceHover : 'transparent' }}>
                  <span className="text-[12.5px] font-mono font-semibold shrink-0" style={{ color: c.accent }}>/{sc.cmd}</span>
                  <span className="text-[12.5px]" style={{ color: c.text }}>{sc.label}</span>
                  <span className="ml-auto text-[11px] shrink-0 hidden sm:inline" style={{ color: c.textTertiary }}>{sc.hint}</span>
                </button>
              ))}
            </div>
            <div className="px-4 py-1.5 text-[10.5px] border-t" style={{ color: c.textMuted, borderColor: c.borderLight }}>
              ↑↓ 选择 · Enter 确认 · Esc 取消 · 命令后的文字会保留
            </div>
          </div>
        )}

        {/* Composer —— ChatGPT 布局：文本域在上，操作行在下；毛玻璃透出动态壁纸 */}
        <div className="rounded-[26px] border transition-shadow"
          style={{
            background: glass,
            backdropFilter: 'blur(20px) saturate(1.15)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
            borderColor: focused ? c.accent : c.border,
            boxShadow: focused ? '0 2px 14px rgba(0,0,0,0.08)' : '0 1px 8px rgba(0,0,0,0.05)',
          }}>

          {/* 已附加文件 */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {attachedFiles.map(file => (
                <span key={file.path} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px]"
                  style={{ background: c.surfaceInput, border: `1px solid ${c.border}`, color: c.textSecondary }}>
                  {file.name}
                  <button onClick={() => setAttachedFiles(prev => prev.filter(f => f.path !== file.path))} className="hover:opacity-70" style={{ color: c.textTertiary }}>&times;</button>
                </span>
              ))}
            </div>
          )}

          <textarea ref={textareaRef} value={value} onChange={e => setValue(e.target.value)} onPaste={handlePaste} onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder={disabled ? t(`回复生成中，发送将排队（${queueCount} 条待发）`, `Reply in progress — queued (${queueCount})`) : chatMode === 'coding' ? t('描述编程任务，可直接粘贴报错信息…', 'Describe the coding task; paste errors directly…') : t(`给 ${ASSISTANT_NAME} 发送消息`, `Message ${ASSISTANT_NAME}`)}
            rows={fullscreenEdit ? 16 : 1}
            className="w-full bg-transparent text-[16px] px-5 pt-3.5 pb-1 resize-none outline-none disabled:opacity-50 leading-[1.6]"
            style={{ color: c.text, caretColor: c.accent, maxHeight: fullscreenEdit ? 'none' : 200, minHeight: fullscreenEdit ? 380 : 28 }} />

          {/* 操作行 —— ChatGPT 风格：+ 菜单 ·（激活标签）· 麦克风 · 发送 */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-2.5 pb-2.5 pt-0.5">
            <button onClick={() => { setShowToolbar(v => !v); setShowThinking(false) }}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0"
              style={{ color: c.textSecondary, background: showToolbar ? c.surfaceActive : 'transparent' }}
              onMouseEnter={e => { if (!showToolbar) e.currentTarget.style.background = c.surfaceHover }}
              onMouseLeave={e => { if (!showToolbar) e.currentTarget.style.background = 'transparent' }}
              title="工具 · 模式 · 模型" aria-label="工具 · 模式 · 模型">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>

            {/* 目标模式开关 */}
            <button onClick={() => setGoalOn(v => !v)} aria-pressed={goalOn}
              title="目标模式：把这轮输入当作目标，评估器逐轮检查完成度，未达成自动续跑（最多 3 轮）"
              className="h-8 pl-2.5 pr-2.5 rounded-full flex items-center gap-1.5 shrink-0 transition-colors"
              style={{
                background: goalOn ? '#7c3aed1a' : 'transparent',
                border: `1px solid ${goalOn ? '#7c3aed66' : c.border}`,
                color: goalOn ? '#7c3aed' : c.textSecondary,
              }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.75" fill="currentColor" />
              </svg>
              <span className="text-[12px] font-medium">目标</span>
            </button>

            {/* 本次权限档位：需确认 / 可编辑 / 完全访问 */}
            <button onClick={() => pickAccess(access === 'ask' ? 'edit' : access === 'edit' ? 'full' : 'ask')}
              title={`本次权限：${access === 'ask' ? '需要我确认（写/删/命令先问后做）' : access === 'edit' ? '可以编辑（删除前确认）' : '完全访问（自主完成）'} · 点击切换`}
              className="h-8 pl-2.5 pr-2 rounded-full flex items-center gap-1.5 shrink-0 transition-colors"
              style={{
                background: access === 'full' ? '#dc262614' : access === 'ask' ? '#d9770614' : 'transparent',
                border: `1px solid ${access === 'full' ? '#dc262659' : access === 'ask' ? '#d9770659' : c.border}`,
                color: access === 'full' ? '#dc2626' : access === 'ask' ? '#d97706' : c.textSecondary,
              }}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <span className="text-[12px] font-medium">{access === 'ask' ? '需确认' : access === 'edit' ? '可编辑' : '完全访问'}</span>
            </button>

            {/* 已启用项：ChatGPT 的 tools chip 位（点击即关闭，全部功能保留在 + 菜单内） */}
            {MODES.filter(m => modes[m.key]).map(m => (
              <button key={m.key} onClick={() => toggleMode(m.key)} title={`关闭${m.label}`}
                className="h-8 pl-2.5 pr-2 rounded-full flex items-center gap-1.5 shrink-0 transition-colors"
                style={{ background: `${m.color}14`, border: `1px solid ${m.color}59`, color: m.color }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={m.icon} />
                </svg>
                <span className="text-[12px] font-medium">{m.label}</span>
                <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ))}
            {kbOn && (
              <button onClick={toggleKb} title="关闭知识库增强"
                className="h-8 pl-2.5 pr-2 rounded-full flex items-center gap-1.5 shrink-0 transition-colors"
                style={{ background: '#05966914', border: '1px solid #05966959', color: '#059669' }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span className="text-[12px] font-medium">知识库</span>
                <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {thinking !== THINK_DEFAULT && (
              <button onClick={() => setThinking(THINK_DEFAULT)} title="恢复默认思考程度"
                className="h-8 pl-2.5 pr-2 rounded-full flex items-center gap-1.5 shrink-0 transition-colors"
                style={{ background: `${THINK_COLORS[thinking]}14`, border: `1px solid ${THINK_COLORS[thinking]}59`, color: THINK_COLORS[thinking] }}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10H12l1-8z" />
                </svg>
                <span className="text-[12px] font-medium">思考:{curThink.label}</span>
                <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {modes.swarm && (
              <select value={swarmTeam} onChange={e => setSwarmTeam(e.target.value)}
                className="h-8 px-2 rounded-full text-[12px] outline-none cursor-pointer shrink-0"
                style={{ background: c.surfaceInput, color: c.textSecondary, border: `1px solid ${c.border}` }}
                title="选择集群团队模板">
                {SWARM_TEAM_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}

            {(selectedSkillIds.length > 0 || attachedFiles.length > 0) && (
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: c.surfaceInput, color: c.textSecondary }}>
                {selectedSkillIds.length > 0 && `${selectedSkillIds.length} 技能`}
                {selectedSkillIds.length > 0 && attachedFiles.length > 0 && ' · '}
                {attachedFiles.length > 0 && `${attachedFiles.length} 附件`}
              </span>
            )}

            <div className="flex-1" />

            {/* 全屏编辑长文 */}
            {(value.trim().length > 80 || fullscreenEdit) && (
              <button onClick={() => setFullscreenEdit(v => !v)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0"
                style={{ color: fullscreenEdit ? c.accent : c.textSecondary, background: fullscreenEdit ? c.surfaceActive : 'transparent' }}
                title={fullscreenEdit ? '退出全屏编辑 (Esc)' : '全屏编辑长文'}>
                {fullscreenEdit ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M15 9h4.5M15 9V4.5M9 15v4.5M9 15H4.5M15 15h4.5M15 15v4.5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
                  </svg>
                )}
              </button>
            )}

            {/* 输入 Token 实时估算 */}
            {value.trim() && (
              <span className="text-[11px] font-mono select-none shrink-0" style={{ color: c.textMuted }} title="当前输入的 Token 估算">
                ≈{estimateTokens(value)} tok
              </span>
            )}

            <button onClick={toggleListening} disabled={disabled}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0"
              style={{ color: isListening ? c.toolErr : c.textSecondary, background: isListening ? `${c.toolErr}18` : 'transparent' }}
              onMouseEnter={e => { if (!isListening) e.currentTarget.style.background = c.surfaceHover }}
              onMouseLeave={e => { if (!isListening) e.currentTarget.style.background = 'transparent' }}
              title={browserSttBroken ? '语音输入（本地识别引擎）' : '语音输入（浏览器实时识别）'} aria-label="语音输入">
              <svg className={`w-[18px] h-[18px] ${isListening ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </button>

            <button onClick={handleSend} disabled={!canSend}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${thinking === 'max' && canSend ? 'think-halo-glow' : ''}`}
              style={{
                background: canSend ? c.accent : c.surfaceActive,
                color: canSend ? c.accentText : c.textMuted,
                cursor: canSend ? 'pointer' : 'not-allowed',
              }}
              title={t('发送', 'Send')} aria-label={t('发送', 'Send')}>
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 消息队列指示 */}
        {queueCount > 0 && (
          <div className="mb-1.5 rounded-xl border overflow-hidden animate-fade-in" style={{ background: c.bgCard, borderColor: c.border }}>
            <div className="flex items-center gap-2 px-3 h-8 border-b" style={{ borderColor: c.borderLight }}>
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: c.accent }}>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-[11.5px] font-medium" style={{ color: c.textSecondary }}>
                消息队列 · {queueCount} 条待发
              </span>
              <span className="ml-auto text-[10.5px]" style={{ color: c.textTertiary }}>{t('当前回复结束后自动依次发送', 'Will send automatically after the current reply')}</span>
            </div>
            <div className="max-h-32 overflow-y-auto scrollbar-thin">
              {(queueItems || []).map((q, i) => (
                <div key={q.id} className="group flex items-center gap-2 px-3 py-1.5" style={{ borderTop: i > 0 ? `1px solid ${c.borderLight}` : 'none' }}>
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                    style={{ background: c.bgInput, color: c.textTertiary }}>{i + 1}</span>
                  <span className="text-[12px] truncate flex-1" style={{ color: c.textSecondary }} title={q.content}>
                    {q.content.replace(/\s+/g, ' ').slice(0, 80) || '（空）'}
                  </span>
                  <button onClick={() => onRemoveQueued?.(q.id)}
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: c.textTertiary }}
                    onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover; e.currentTarget.style.color = c.toolErr }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.textTertiary }}
                    title="取消发送">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* composer 状态条：模式 · 模型 · 工作目录 · git 分支 */}
        <ComposerStatusBar chatMode={chatMode} modelLabel={currentModel || settings?.model || ''} workDir={settings?.workDir || ''} disabled={disabled} />

        {/* 免责声明 + 上下文仪表 */}
        <div className="mt-1 flex items-center justify-center gap-3 text-[11.5px]" style={{ color: c.textTertiary }}>
          <span className="text-center">
            {sttError ? <span style={{ color: c.toolErr }}>{sttError} </span> : null}
            {disabled ? '正在思考…' : `${ASSISTANT_NAME} 可能会犯错。请核查重要信息。`}
          </span>
          <ContextGauge parts={contextParts} limit={effectiveCtxLimit} />
        </div>

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleNativeFileChange} />
      </div>
    </div>
  )
}
