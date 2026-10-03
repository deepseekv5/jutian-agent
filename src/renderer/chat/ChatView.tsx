import { useEffect, useRef, useState, useCallback } from 'react'
import type { Message } from '../types'
import MessageBubble from './MessageBubble'
import BrandMark from '../app/BrandMark'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { ASSISTANT_NAME } from '../brand'

interface Props {
  messages: Message[]
  streamingId: string | null
  onAbort?: () => void
  onRegenerate?: () => void
  /** 对任意 assistant 消息就地重新生成（消息分支） */
  onRegenerateAt?: (messageIndex: number) => void
  onQuickSend?: (text: string) => void
  onOpenBrowser?: (url: string) => void
  onRollback?: (messageIndex: number) => void
  onEditMessage?: (messageIndex: number, newContent: string) => void
}

const QUICK_PROMPTS = [
  { label: '解释代码', labelEn: 'Explain code', text: '帮我解释一下这段代码的作用', textEn: 'Explain what this piece of code does' },
  { label: 'Python 脚本', labelEn: 'Python script', text: '用 Python 写一个快速排序算法，并解释每一步', textEn: 'Write a quicksort in Python and explain each step' },
  { label: '总结文档', labelEn: 'Summarize', text: '总结以下文档的核心要点', textEn: 'Summarize the key points of the following document' },
  { label: '生成 PPT', labelEn: 'Make slides', text: '帮我生成一份关于 AI 发展趋势的 PPT 大纲', textEn: 'Draft a slide outline about AI trends' },
  { label: '代码审查', labelEn: 'Code review', text: '请帮我审查这段代码，找出潜在问题并给出改进建议', textEn: 'Review this code for issues and improvements' },
  { label: '写测试', labelEn: 'Write tests', text: '为这段代码编写单元测试，覆盖主要分支', textEn: 'Write unit tests for this code covering the main branches' },
]

export default function ChatView({ messages, streamingId, onAbort, onRegenerate, onRegenerateAt, onQuickSend, onOpenBrowser, onRollback, onEditMessage }: Props) {
  const { lang, t } = useLanguage()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const isStreaming = streamingId !== null
  const { c } = useTheme()

  // 消息内搜索（Cmd/Ctrl+F）
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchHits, setSearchHits] = useState<number[]>([])  // 命中消息 idx 列表
  const [hitCursor, setHitCursor] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // {t('回到底部', 'Back to bottom')}悬浮按钮
  const [showJump, setShowJump] = useState(false)

  // 宽屏模式：860 ↔ 1100，与输入框联动（ChatTab 工作区条切换）
  const [wide, setWide] = useState(() => localStorage.getItem('lyclaw_chat_wide') === '1')
  useEffect(() => {
    const h = () => setWide(localStorage.getItem('lyclaw_chat_wide') === '1')
    window.addEventListener('chat-wide-changed', h)
    return () => window.removeEventListener('chat-wide-changed', h)
  }, [])
  const contentWidth = wide ? 1100 : 860

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = dist < 200
    setShowJump(dist > 360)
  }, [])

  const jumpToBottom = () => {
    stickToBottomRef.current = true
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const scrollToMessage = useCallback((idx: number) => {
    const el = scrollRef.current?.querySelector(`[data-msg-idx="${idx}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // 外部跳转：全局搜索点「消息命中」时，滚动到该消息并高亮闪一下
  // 消息列表可能还在异步加载，重试查找直到出现（最多 ~2s）
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent).detail
      if (!id) return
      let tries = 0
      const attempt = () => {
        const el = scrollRef.current?.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null
        if (!el) {
          if (++tries < 14) setTimeout(attempt, 140)
          return
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.style.transition = 'background-color .3s'
        el.style.backgroundColor = `${c.accent}22`
        setTimeout(() => { el.style.backgroundColor = 'transparent' }, 1600)
      }
      setTimeout(attempt, 100)
    }
    window.addEventListener('chat-jump-to-message', h)
    return () => window.removeEventListener('chat-jump-to-message', h)
  }, [c.accent])

  // 只有用户本就停留在底部时才自动跟随滚动（否则显示「{t('回到底部', 'Back to bottom')}」）
  useEffect(() => {
    if (stickToBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingId])

  // 搜索：内容过滤命中 → ↑↓ 循环定位
  useEffect(() => {
    if (!searchQ.trim()) { setSearchHits([]); return }
    const q = searchQ.toLowerCase()
    const hits = messages.reduce<number[]>((acc, m, i) => {
      if ((m.content || '').toLowerCase().includes(q)) acc.push(i)
      return acc
    }, [])
    setSearchHits(hits)
    setHitCursor(0)
    if (hits.length > 0) setTimeout(() => scrollToMessage(hits[0]), 30)
  }, [searchQ, messages, scrollToMessage])

  // 全局快捷键：Cmd+F 开搜索 / Esc 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault(); setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 30)
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false); setSearchQ('')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [searchOpen])

  // ─── 空状态 —— ChatGPT 风格欢迎页 ───
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6">
        <div className="flex flex-col items-center text-center -mt-8">
          <BrandMark size={56} color={c.textHead} className="mb-6" title="巨天agent" />

          <h2 className="welcome-title">有什么可以帮忙的？</h2>

          <p className="welcome-subtitle">
            我可以回答问题、编写代码、分析文档、生成 PPT、操作终端、管理文件。
            <br />
            {ASSISTANT_NAME} 可能会犯错，请核查重要信息。
          </p>

          <div className="welcome-prompts">
            {QUICK_PROMPTS.map(hint => (
              <button key={hint.label} onClick={() => onQuickSend?.(lang === 'en' ? hint.textEn : hint.text)}
                className="welcome-prompt" title={lang === 'en' ? hint.textEn : hint.text}>
                {lang === 'en' ? hint.labelEn : hint.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ─── 对话消息 ───
  return (
    <div className="flex-1 relative overflow-hidden">
      {/* 消息内搜索条 */}
      {searchOpen && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full shadow-lg px-3 h-9 glass-strong"
          style={{ border: `1px solid ${c.border}`, minWidth: 300 }}>
          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: c.textTertiary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input ref={searchInputRef} value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="在对话中搜索…" className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: c.text }} />
          <span className="text-[11px] font-mono shrink-0" style={{ color: c.textTertiary }}>
            {searchQ.trim() ? (searchHits.length ? `${hitCursor + 1}/${searchHits.length}` : '无结果') : ''}
          </span>
          <button onClick={() => { if (searchHits.length) { const n = (hitCursor - 1 + searchHits.length) % searchHits.length; setHitCursor(n); scrollToMessage(searchHits[n]) } }}
            className="w-5 h-5 flex items-center justify-center text-[12px]" style={{ color: c.textTertiary }} title="上一个">↑</button>
          <button onClick={() => { if (searchHits.length) { const n = (hitCursor + 1) % searchHits.length; setHitCursor(n); scrollToMessage(searchHits[n]) } }}
            className="w-5 h-5 flex items-center justify-center text-[12px]" style={{ color: c.textTertiary }} title="下一个">↓</button>
          <button onClick={() => { setSearchOpen(false); setSearchQ('') }}
            className="w-5 h-5 flex items-center justify-center text-[12px]" style={{ color: c.textTertiary }} title="关闭">✕</button>
        </div>
      )}

      <div ref={scrollRef} className="h-full overflow-y-auto" onScroll={onScroll}>
        <div className="mx-auto px-6 pt-8 pb-4" style={{ maxWidth: contentWidth }}>
          {messages.map((msg, idx) => (
            <div key={msg.id} data-msg-idx={idx} data-msg-id={msg.id}
              style={{
                // 长对话性能:非尾部消息视口外跳过绘制
                ...(idx < messages.length - 8 ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' } : null),
                ...(searchOpen && searchHits[hitCursor] === idx ? { boxShadow: `inset 3px 0 0 ${c.accent}`, transition: 'box-shadow .2s' } : null),
              }}>
              <MessageBubble
                content={msg.content}
                thinking={(msg as any).thinking || ''}
                role={msg.role as 'user' | 'assistant'}
                isStreaming={msg.id === streamingId}
                toolCalls={msg.tool_calls || []}
                isLast={idx === messages.length - 1}
                msgId={msg.id}
                variants={(msg as any).variants}
                onRegenerate={msg.role === 'assistant' && !isStreaming
                  ? () => { if (idx === messages.length - 1 && onRegenerate) onRegenerate(); else onRegenerateAt?.(idx) }
                  : undefined}
                onOpenBrowser={onOpenBrowser}
                onRollback={msg.role === 'user' && !isStreaming ? () => onRollback?.(idx) : undefined}
                onEdit={msg.role === 'user' && !isStreaming && onEditMessage ? (text: string) => onEditMessage(idx, text) : undefined}
                createdAt={(msg as any).created_at}
              />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* {t('回到底部', 'Back to bottom')} —— 右下悬浮 */}
      {showJump && !isStreaming && (
        <button onClick={jumpToBottom} title="{t('回到底部', 'Back to bottom')}" aria-label="{t('回到底部', 'Back to bottom')}"
          className="absolute bottom-5 right-6 w-9 h-9 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 z-10 glass"
          style={{ border: `1px solid ${c.border}`, color: c.textSecondary }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7-7-7m7 7V3" />
          </svg>
        </button>
      )}

      {/* 停止生成 —— 悬浮于输入框上方 */}
      {isStreaming && onAbort && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <button onClick={onAbort}
            className="h-9 pl-3 pr-3.5 rounded-full flex items-center gap-2 shadow-lg transition-transform hover:scale-[1.03] active:scale-95"
            style={{ background: c.accent, color: c.accentText, border: `1px solid ${c.border}` }}
            title="停止生成" aria-label="停止生成">
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><rect x="2.5" y="2.5" width="11" height="11" rx="2" /></svg>
            <span className="text-[12.5px] font-medium">停止</span>
          </button>
        </div>
      )}
    </div>
  )
}
