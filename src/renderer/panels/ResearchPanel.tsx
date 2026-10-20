/**
 * ResearchPanel —— 深度调研专属工作台
 *
 * 调研此前只是聊天里的一个开关：进度被塞进一条助手消息里反复覆写，
 * 来源没有独立呈现，历史报告更是只能去数据目录里翻文件。这里给它一个
 * 独立页面：提问 → 实时进度 → 来源清单 → 带引用的报告 → 历史归档。
 *
 * 数据流：POST /api/deep-research（SSE）→ 本地状态机；历史报告由后端
 * 落盘在 ~/.lyclaw/data/research/*.md，经 /api/research/history 读写。
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import PageShell from '../app/PageShell'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { reportError } from '../app/ErrorToast'
import { onResearchSeed } from '../engine/researchBridge'
import { ssePayloads } from '../../shared/sse'
import { dateCN } from '../utils/datetime'
import { fetchCompat } from '../api'

/* ─── 与服务端 SSE 事件对应的类型 ─── */
type Phase = 'idle' | 'plan' | 'search' | 'fetch' | 'write' | 'done' | 'error'

interface SourceRow { url: string; ok: boolean; relevant?: boolean; title?: string }

interface HistoryItem { file: string; at: string; ts: number; title: string; size: number }

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, { zh: string; en: string }> = {
  plan: { zh: '拆解检索策略', en: 'Planning queries' },
  search: { zh: '检索中', en: 'Searching' },
  fetch: { zh: '阅读来源', en: 'Reading sources' },
  write: { zh: '撰写报告', en: 'Writing report' },
  done: { zh: '已完成', en: 'Done' },
  error: { zh: '失败', en: 'Failed' },
}

const PHASE_ORDER: Exclude<Phase, 'idle' | 'error'>[] = ['plan', 'search', 'fetch', 'write', 'done']

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u.slice(0, 40) }
}

export default function ResearchPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const { t, lang } = useLanguage()

  const [question, setQuestion] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [phaseNote, setPhaseNote] = useState('')
  const [queries, setQueries] = useState<string[]>([])
  const [searchIdx, setSearchIdx] = useState(0)
  const [searchTotal, setSearchTotal] = useState(0)
  const [sources, setSources] = useState<SourceRow[]>([])
  const [fetchIdx, setFetchIdx] = useState(0)
  const [fetchTotal, setFetchTotal] = useState(0)
  const [report, setReport] = useState('')
  const [error, setError] = useState('')

  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewing, setViewing] = useState<{ file: string; title: string; content: string } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetchCompat('/api/research/history')
      const d = await r.json()
      setHistory(Array.isArray(d?.items) ? d.items : [])
    } catch { /* 历史读取失败不影响主流程 */ }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // 从聊天输入框带过来的初始问题（见 engine/researchBridge）
  useEffect(() => onResearchSeed(q => setQuestion(q)), [])

  // 报告生成出来后滚到底部
  useEffect(() => {
    if (phase === 'done' && reportRef.current) {
      reportRef.current.scrollTop = reportRef.current.scrollHeight
    }
  }, [phase, report])

  const running = phase !== 'idle' && phase !== 'done' && phase !== 'error'

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('idle'); setPhaseNote(''); setQueries([]); setSearchIdx(0); setSearchTotal(0)
    setSources([]); setFetchIdx(0); setFetchTotal(0); setReport(''); setError('')
  }, [])

  const start = useCallback(async () => {
    const q = question.trim()
    if (!q || running) return
    setPhase('plan'); setPhaseNote(''); setQueries([]); setSearchIdx(0); setSearchTotal(0)
    setSources([]); setFetchIdx(0); setFetchTotal(0); setReport(''); setError('')
    setViewing(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await fetchCompat('/api/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      for await (const payload of ssePayloads(res.body)) {
        let ev: Record<string, unknown>
        try { ev = JSON.parse(payload) } catch { continue }

        if (ev.error) {
          setError(String(ev.error))
          setPhase('error')
          return
        }
        const p = String(ev.phase || '')
        if (p === 'plan') {
          setPhase('plan')
          if (ev.detail) setPhaseNote(String(ev.detail))
        } else if (p === 'search') {
          setPhase('search')
          if (Array.isArray(ev.queries)) {
            const qs = (ev.queries as unknown[]).map(String)
            setQueries(qs); setSearchTotal(qs.length); setSearchIdx(0)
          }
          if (typeof ev.index === 'number') setSearchIdx(ev.index)
          if (typeof ev.total === 'number') setSearchTotal(ev.total)
          if (ev.query) setPhaseNote(String(ev.query))
          if (typeof ev.found === 'number') setPhaseNote(`${String(ev.query || '')} · ${ev.found} 条`)
        } else if (p === 'fetch') {
          setPhase('fetch')
          if (Array.isArray(ev.sources)) {
            setSources((ev.sources as unknown[]).map(String).map(u => ({ url: u, ok: true })))
            setFetchTotal((ev.sources as unknown[]).length)
          }
          if (typeof ev.index === 'number') setFetchIdx(ev.index)
          if (typeof ev.total === 'number') setFetchTotal(ev.total)
          if (ev.url) {
            const u = String(ev.url)
            setSources(prev => {
              const has = prev.some(s => s.url === u)
              const row: SourceRow = { url: u, ok: !!ev.ok, relevant: ev.relevant !== false }
              return has ? prev.map(s => s.url === u ? { ...s, ...row } : s) : [...prev, row]
            })
          }
        } else if (p === 'write') {
          setPhase('write')
          if (ev.detail) setPhaseNote(String(ev.detail))
        } else if (ev.done) {
          setReport(String(ev.report || ''))
          if (Array.isArray(ev.sources)) {
            setSources((ev.sources as unknown[]).map(String).map((u, i) => ({
              url: u,
              ok: sources[i]?.ok ?? true,
              relevant: sources[i]?.relevant,
              title: sources[i]?.title,
            })))
          }
          setPhase('done')
          loadHistory()
        }
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') { setPhase('idle'); return }
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
      reportError(`深度调研失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      abortRef.current = null
    }
  }, [question, running, loadHistory, sources])

  const openHistory = useCallback(async (item: HistoryItem) => {
    try {
      const r = await fetchCompat(`/api/research/history/${encodeURIComponent(item.file)}`)
      const d = await r.json()
      if (d?.error) { reportError(`打开失败：${d.error}`); return }
      setViewing({ file: item.file, title: item.title, content: String(d.content || '') })
      setReport('')
      setPhase('idle')
    } catch (e) {
      reportError(`打开失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const removeHistory = useCallback(async (file: string) => {
    try {
      await fetchCompat(`/api/research/history/${encodeURIComponent(file)}`, { method: 'DELETE' })
      setHistory(prev => prev.filter(h => h.file !== file))
      if (viewing?.file === file) setViewing(null)
    } catch (e) {
      reportError(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [viewing])

  const shownReport = viewing ? viewing.content : report
  const shownTitle = viewing ? viewing.title : question.trim()

  return (
    <PageShell
      onClose={onClose}
      title={t('深度调研', 'Deep Research')}
      description={t('多路检索 → 交叉验证 → 带引用的报告', 'Multi-query search → cross-check → cited report')}
      icon="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      fill
      actions={
        <button onClick={() => { setHistoryOpen(v => !v); if (!historyOpen) loadHistory() }}
          className="px-2.5 h-7 rounded-lg text-[11.5px] flex items-center gap-1.5 transition-colors"
          style={{ background: historyOpen ? c.bgActive : c.bgInput, color: historyOpen ? c.textHead : c.textSecondary, border: `1px solid ${c.border}` }}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
          </svg>
          {t('历史', 'History')}
          {history.length > 0 && <span className="opacity-60">{history.length}</span>}
        </button>
      }
    >
      <div className="flex-1 flex flex-col min-h-0" style={{ background: c.bg }}>
        {/* ─── 提问区 ─── */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b" style={{ borderColor: c.borderLight }}>
          <div className="flex gap-2 items-end">
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start() }}
              placeholder={t('想调研什么？例如：2026 年主流 AI 编码工具的横向对比', 'What to research? e.g. Compare leading AI coding tools in 2026')}
              rows={2}
              disabled={running}
              className="flex-1 resize-none rounded-xl px-3 py-2 text-[13px] leading-6 outline-none scrollbar-thin"
              style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }}
            />
            {running ? (
              <button onClick={reset}
                className="h-9 px-4 rounded-xl text-[12.5px] font-medium shrink-0"
                style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }}>
                {t('停止', 'Stop')}
              </button>
            ) : (
              <button onClick={start} disabled={!question.trim()}
                className="h-9 px-4 rounded-xl text-[12.5px] font-medium shrink-0 disabled:opacity-40"
                style={{ background: c.accent, color: c.accentText }}>
                {t('开始调研', 'Research')}
              </button>
            )}
          </div>
          <div className="mt-1.5 text-[10.5px]" style={{ color: c.textMuted }}>
            {t('⌘+回车 开始 · 检索与抓取走本机出口，来源会标注相关性与引用编号', '⌘+Enter to start · sources are relevance-checked and cited')}
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* ─── 左：进度 + 来源 ─── */}
          <div className="w-[280px] shrink-0 border-r overflow-y-auto scrollbar-thin p-4 space-y-4"
            style={{ borderColor: c.borderLight, background: c.bgAlt }}>
            {/* 阶段步骤条 */}
            <div>
              <div className="text-[10.5px] font-semibold mb-2" style={{ color: c.textTertiary }}>
                {t('进度', 'Progress')}
              </div>
              <div className="space-y-1.5">
                {PHASE_ORDER.map(p => {
                  const cur = phase === p
                  const doneIdx = PHASE_ORDER.indexOf(phase as never)
                  const pIdx = PHASE_ORDER.indexOf(p)
                  const passed = doneIdx > pIdx && phase !== 'error'
                  const failed = phase === 'error' && cur
                  return (
                    <div key={p} className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full grid place-items-center shrink-0 text-[9px]"
                        style={{
                          background: cur ? c.accent : passed ? c.toolOk : failed ? c.toolErr : c.bgInput,
                          color: cur ? c.accentText : passed || failed ? '#fff' : c.textMuted,
                        }}>
                        {passed ? '✓' : failed ? '!' : pIdx + 1}
                      </span>
                      <span className="text-[11.5px]" style={{ color: cur ? c.textHead : passed ? c.textSecondary : c.textMuted }}>
                        {lang === 'en' ? PHASE_LABEL[p].en : PHASE_LABEL[p].zh}
                      </span>
                    </div>
                  )
                })}
              </div>
              {phaseNote && running && (
                <div className="mt-2 text-[10.5px] leading-relaxed break-all" style={{ color: c.textTertiary }}>{phaseNote}</div>
              )}
            </div>

            {/* 检索词 */}
            {queries.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold mb-1.5" style={{ color: c.textTertiary }}>
                  {t('检索策略', 'Queries')} {searchTotal > 0 && `(${searchIdx}/${searchTotal})`}
                </div>
                <div className="space-y-1">
                  {queries.map((q, i) => (
                    <div key={i} className="text-[10.5px] leading-relaxed px-2 py-1 rounded-md break-all"
                      style={{
                        background: i < searchIdx ? c.bgInput : 'transparent',
                        color: i < searchIdx ? c.textSecondary : c.textMuted,
                      }}>
                      {q}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 来源清单 */}
            {sources.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold mb-1.5" style={{ color: c.textTertiary }}>
                  {t('来源', 'Sources')} {fetchTotal > 0 && `(${fetchIdx}/${fetchTotal})`}
                </div>
                <div className="space-y-1">
                  {sources.map((s, i) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer"
                      className="block px-2 py-1.5 rounded-md transition-colors hover:opacity-80"
                      style={{ background: c.bgInput }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9.5px] font-mono shrink-0" style={{ color: c.textMuted }}>[{i + 1}]</span>
                        <span className="text-[10.5px] truncate" style={{ color: c.textSecondary }}>{hostOf(s.url)}</span>
                        {s.relevant === false && (
                          <span className="text-[9px] px-1 rounded shrink-0" style={{ background: 'rgba(217,119,6,.15)', color: c.toolWarn }}>
                            {t('低相关', 'low')}
                          </span>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {phase === 'error' && (
              <div className="rounded-lg p-2.5 text-[11px] leading-relaxed"
                style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: c.toolErr }}>
                {error || t('调研失败', 'Research failed')}
              </div>
            )}
          </div>

          {/* ─── 右：报告 ─── */}
          <div ref={reportRef} className="flex-1 overflow-y-auto scrollbar-thin">
            {shownReport ? (
              <div className="max-w-3xl mx-auto px-6 py-5">
                {shownTitle && (
                  <div className="mb-4 pb-3 border-b" style={{ borderColor: c.borderLight }}>
                    <div className="text-[16px] font-semibold leading-6" style={{ color: c.textHead }}>{shownTitle}</div>
                    <div className="text-[10.5px] mt-1" style={{ color: c.textMuted }}>
                      {viewing
                        ? `${t('历史报告', 'Archived report')} · ${new Date(viewing.file.replace(/\.md$/, '').length === 13 ? Number(viewing.file.replace(/\.md$/, '')) : Date.now()).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN')}`
                        : t('本次调研', 'This run')}
                    </div>
                  </div>
                )}
                <div className="text-[13px] leading-7" style={{ color: c.text }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node: _node, ...props }) => (
                        <a {...props} target="_blank" rel="noreferrer"
                          style={{ color: c.accent, textDecoration: 'underline', textUnderlineOffset: 3 }} />
                      ),
                      pre: ({ node: _node, ...props }) => (
                        <pre {...props} className="rounded-lg p-3 overflow-x-auto my-3 text-[12px]"
                          style={{ background: c.bgInput }} />
                      ),
                      code: ({ node: _node, inline, ...props }: any) => inline
                        ? <code {...props} className="px-1 py-0.5 rounded text-[12px]" style={{ background: c.bgInput }} />
                        : <code {...props} />,
                      table: ({ node: _node, ...props }) => (
                        <div className="overflow-x-auto my-3">
                          <table {...props} className="text-[12px] w-full" style={{ borderCollapse: 'collapse' }} />
                        </div>
                      ),
                      th: ({ node: _node, ...props }) => (
                        <th {...props} className="px-2 py-1.5 text-left" style={{ borderBottom: `1px solid ${c.border}`, color: c.textHead }} />
                      ),
                      td: ({ node: _node, ...props }) => (
                        <td {...props} className="px-2 py-1.5" style={{ borderBottom: `1px solid ${c.borderLight}` }} />
                      ),
                      h1: ({ node: _node, ...props }) => <h1 {...props} className="text-[17px] font-semibold mt-5 mb-2" style={{ color: c.textHead }} />,
                      h2: ({ node: _node, ...props }) => <h2 {...props} className="text-[15px] font-semibold mt-4 mb-2" style={{ color: c.textHead }} />,
                      h3: ({ node: _node, ...props }) => <h3 {...props} className="text-[13.5px] font-semibold mt-3 mb-1.5" style={{ color: c.textHead }} />,
                      ul: ({ node: _node, ...props }) => <ul {...props} className="pl-5 my-2 space-y-1 list-disc" />,
                      ol: ({ node: _node, ...props }) => <ol {...props} className="pl-5 my-2 space-y-1 list-decimal" />,
                      blockquote: ({ node: _node, ...props }) => (
                        <blockquote {...props} className="pl-3 my-2 italic" style={{ borderLeft: `2px solid ${c.border}`, color: c.textSecondary }} />
                      ),
                    }}
                  >
                    {shownReport}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="h-full grid place-items-center px-6">
                <div className="text-center max-w-[320px]">
                  <svg className="w-10 h-10 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke={c.textMuted} strokeWidth={1.4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                  <div className="text-[13px] font-medium mb-1" style={{ color: c.textSecondary }}>
                    {t('提出一个问题，开始调研', 'Ask a question to start')}
                  </div>
                  <div className="text-[11px] leading-relaxed" style={{ color: c.textMuted }}>
                    {t(
                      '服务端会先拆解成多路检索词，逐一搜索并抓取正文，过滤掉与主题无关的来源，再基于真实来源撰写带引用的报告。',
                      'The server plans several queries, searches and reads each source, drops irrelevant ones, then writes a cited report from real sources only.'
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── 历史抽屉 ─── */}
          {historyOpen && (
            <div className="w-[240px] shrink-0 border-l overflow-y-auto scrollbar-thin p-3"
              style={{ borderColor: c.borderLight, background: c.bgAlt }}>
              <div className="text-[10.5px] font-semibold mb-2" style={{ color: c.textTertiary }}>
                {t('历史报告', 'Archived')}
              </div>
              {history.length === 0 ? (
                <div className="text-[11px] leading-relaxed" style={{ color: c.textMuted }}>
                  {t('还没有调研记录', 'No reports yet')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {history.map(h => (
                    <div key={h.file}
                      className="group rounded-lg px-2 py-1.5 cursor-pointer transition-colors"
                      style={{ background: viewing?.file === h.file ? c.bgActive : c.bgInput }}
                      onClick={() => openHistory(h)}>
                      <div className="text-[11px] leading-snug break-all" style={{ color: c.textSecondary }}>{h.title}</div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[9.5px]" style={{ color: c.textMuted }}>
                          {dateCN(h.ts, lang === 'en' ? 'en-US' : 'zh-CN')}
                        </span>
                        <button onClick={e => { e.stopPropagation(); removeHistory(h.file) }}
                          className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                          title={t('删除', 'Delete')} aria-label={t('删除', 'Delete')}>
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: c.toolErr }}>
                            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
