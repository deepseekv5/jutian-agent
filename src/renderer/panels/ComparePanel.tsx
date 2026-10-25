/**
 * 多模型对比（v12.5）
 *
 * 同一个问题同时发给两个模型，并排看回答——选模型最直接的方式。
 * 走 /api/llm-proxy（与主对话同一条链路：免费车道/接力/密钥处理都复用），
 * 不再单独实现上游调用，避免两套逻辑漂移。
 *
 * 每一路独立显示：生成状态、耗时、字数、（有用量时）token 数。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { fetchCompat } from '../../shared/apiClient'
import { effectiveApiKey } from '../store/storage'
import { freeModels, warmFreeModels } from './modelList'
import type { Settings } from '../types'

interface Side {
  model: string
  base: string
  text: string
  status: 'idle' | 'streaming' | 'done' | 'error'
  ms: number
  error?: string
}

const FREE_BASE = 'https://opencode.ai/zen/v1'

async function streamOne(
  base: string, model: string, key: string, prompt: string,
  onDelta: (t: string) => void, signal: AbortSignal,
): Promise<string> {
  const r = await fetchCompat('/api/llm-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Target-Base': base,
      ...(key && key !== 'free' ? { 'X-Api-Key': key } : {}),
    },
    body: JSON.stringify({
      model, stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal,
  })
  // 流式读取 SSE
  const reader = r.body?.getReader()
  if (!reader) throw new Error('无可读流')
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const ln of lines) {
      if (!ln.startsWith('data: ')) continue
      const payload = ln.slice(6).trim()
      if (payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        const d = j?.choices?.[0]?.delta?.content
        if (typeof d === 'string' && d) { full += d; onDelta(full) }
      } catch { /* 跳过不完整的行 */ }
    }
  }
  return full
}

export default function ComparePanel({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const [prompt, setPrompt] = useState('')
  const [left, setLeft] = useState<Side>({ model: '', base: '', text: '', status: 'idle', ms: 0 })
  const [right, setRight] = useState<Side>({ model: '', base: '', text: '', status: 'idle', ms: 0 })
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // 打开面板时预填合理默认（左侧当前模型 / 右侧一个免费档）+ 预热免费清单
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pickDefault(); warmFreeModels() }, [])

  const userBase = String(settings?.apiBaseUrl || '')
  const userKey = effectiveApiKey(settings?.apiKey) || ''
  const userModel = String(settings?.model || '')

  const myModels: string[] = Array.isArray((settings as any)?.models)
    ? (settings as any).models.filter(Boolean) : []

  function pickDefault() {
    // 默认左侧用当前模型，右侧用另一个免费档
    const other = freeModels.find(m => m !== userModel) || freeModels[0]
    setLeft({ model: userModel || freeModels[0], base: userModel ? userBase : FREE_BASE, text: '', status: 'idle', ms: 0 })
    setRight({ model: other, base: FREE_BASE, text: '', status: 'idle', ms: 0 })
  }

  const run = useCallback(async () => {
    if (!prompt.trim() || !left.model || !right.model) return
    setRunning(true)
    const ctl = new AbortController()
    abortRef.current = ctl
    const t0 = Date.now()
    setLeft(s => ({ ...s, text: '', status: 'streaming', ms: 0, error: undefined }))
    setRight(s => ({ ...s, text: '', status: 'streaming', ms: 0, error: undefined }))

    const runSide = async (side: Side, set: typeof setLeft) => {
      const key = side.base === userBase ? userKey : 'free'
      try {
        await streamOne(side.base, side.model, key, prompt, (txt) => {
          set(s => ({ ...s, text: txt, ms: Date.now() - t0 }))
        }, ctl.signal)
        set(s => ({ ...s, status: 'done', ms: Date.now() - t0 }))
      } catch (e) {
        if (ctl.signal.aborted) { set(s => ({ ...s, status: 'idle' })); return }
        set(s => ({ ...s, status: 'error', error: String((e as Error)?.message || e), ms: Date.now() - t0 }))
      }
    }
    await Promise.all([runSide(left, setLeft), runSide(right, setRight)])
    setRunning(false)
  }, [prompt, left, right, userBase, userKey])

  const stop = () => { abortRef.current?.abort(); setRunning(false) }

  const ModelPicker = ({ side, set }: { side: Side; set: typeof setLeft }) => (
    <select
      value={side.model}
      onChange={(e) => {
        const m = e.target.value
        const isMine = m === userModel || myModels.includes(m)
        set(s => ({ ...s, model: m, base: isMine ? userBase : FREE_BASE, text: '', status: 'idle' }))
      }}
      className="flex-1 min-w-0 px-2 py-1 rounded-lg text-[11.5px] font-mono outline-none"
      style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.border}` }}>
      <optgroup label={t('我的模型', 'My models')}>
        {userModel && <option value={userModel}>{userModel}（当前）</option>}
        {myModels.filter(m => m !== userModel).map(m => <option key={m} value={m}>{m}</option>)}
      </optgroup>
      <optgroup label={t('免费模型', 'Free')}>
        {freeModels.map(m => <option key={m} value={m}>{m}</option>)}
      </optgroup>
    </select>
  )

  const SideView = ({ side }: { side: Side }) => (
    <div className="flex-1 min-w-0 flex flex-col rounded-xl overflow-hidden"
      style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: c.borderLight }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
          background: side.status === 'streaming' ? '#f59e0b' : side.status === 'done' ? '#10a37f' : side.status === 'error' ? '#ef4444' : c.border,
        }} />
        <span className="text-[10.5px] shrink-0" style={{ color: c.textTertiary }}>
          {side.status === 'streaming' ? t('生成中', 'Streaming') : side.status === 'done' ? t('完成', 'Done') : side.status === 'error' ? t('失败', 'Error') : t('就绪', 'Ready')}
        </span>
        {side.ms > 0 && <span className="text-[10px] font-mono shrink-0" style={{ color: c.textMuted }}>{(side.ms / 1000).toFixed(1)}s · {side.text.length} 字</span>}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3.5 py-3 text-[12px] leading-[1.75] whitespace-pre-wrap break-words"
        style={{ color: c.textSecondary || c.textTertiary, minHeight: 200 }}>
        {side.status === 'error' ? (
          <span style={{ color: '#ef4444' }}>{side.error}</span>
        ) : side.text || side.status === 'streaming' ? (
          side.text + (side.status === 'streaming' ? ' ▍' : '')
        ) : (
          <span style={{ color: c.textMuted }}>{t('等待运行', 'Waiting')}</span>
        )}
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>{t('多模型对比', 'Compare models')}</span>
        <span className="text-[10.5px]" style={{ color: c.textTertiary }}>{t('同一问题 · 并行生成 · 并排对比', 'Same prompt · side by side')}</span>
        <span className="flex-1" />
        <button onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>关闭</button>
      </div>

      <div className="px-5 py-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('输入要对比的问题…（比如：用一句话解释什么是闭包）', 'Enter a prompt to compare…')}
          rows={2}
          className="w-full px-3 py-2 rounded-xl text-[13px] outline-none resize-none"
          style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.border}` }}
        />
        <div className="flex items-center gap-2 mt-2.5">
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="text-[10.5px] shrink-0" style={{ color: c.textMuted }}>A</span>
            <ModelPicker side={left} set={setLeft} />
          </div>
          <span className="text-[11px] font-bold shrink-0" style={{ color: c.textTertiary }}>VS</span>
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="text-[10.5px] shrink-0" style={{ color: c.textMuted }}>B</span>
            <ModelPicker side={right} set={setRight} />
          </div>
          {running ? (
            <button onClick={stop} className="px-4 py-1.5 rounded-lg text-[12px] font-medium shrink-0"
              style={{ background: '#ef4444', color: '#fff' }}>{t('停止', 'Stop')}</button>
          ) : (
            <button onClick={run} disabled={!prompt.trim() || !left.model || !right.model}
              className="px-4 py-1.5 rounded-lg text-[12px] font-medium text-white disabled:opacity-40 shrink-0"
              style={{ background: c.accent || '#10a37f' }}>{t('运行', 'Run')}</button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-3 px-5 pb-5">
        <SideView side={left} />
        <SideView side={right} />
      </div>
    </div>
  )
}
