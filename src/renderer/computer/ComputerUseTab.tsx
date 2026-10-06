/**
 * ComputerUseTab — Computer Use 专属标签页（v5.0）
 *
 * 左：屏幕实时画面（截屏预览，可手动刷新/选显示器）+ 权限状态
 * 右：目标输入 → 代理循环时间线（观察/思考/动作/结果）
 * 权限未就绪时先给引导（屏幕录制 + 辅助功能），避免用户懵。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { Settings } from '../types'
import { runComputerAgent, captureScreen, describeAction, type CuAction, type CuExecResult, type CuStep } from '../engine/computerAgent'
import { pushNotice } from '../notify'

interface StepRow {
  step: CuStep
  exec?: CuExecResult
  dur?: string | null
}

export default function ComputerUseTab({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const { t } = useLanguage()
  const { c } = useTheme()
  const [perms, setPerms] = useState<{ screen?: boolean; accessibility?: boolean; cliclick?: boolean; platform?: string } | null>(null)
  const [displays, setDisplays] = useState<{ id: string; w: number; h: number; primary: boolean }[]>([])
  const [displayId, setDisplayId] = useState<string>('')
  const [shot, setShot] = useState<string>('')
  const [shotErr, setShotErr] = useState('')
  const [monitoring, setMonitoring] = useState(false)
  const [goal, setGoal] = useState('')
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<StepRow[]>([])
  const stepT0 = useRef<number>(0)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')
  const [confirmEach, setConfirmEach] = useState<boolean>(() => { try { return localStorage.getItem('jutian-cu-confirm') === '1' } catch { return false } })
  const [pendingAction, setPendingAction] = useState<CuAction | null>(null)
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const monitorTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  const refreshPerms = useCallback(async () => {
    try {
      const api = (window as any).electronAPI
      if (!api?.cuPermission) { setPerms(null); return }
      setPerms(await api.cuPermission())
      setDisplays(await api.cuDisplays())
    } catch { setPerms(null) }
  }, [])

  const refreshShot = useCallback(async () => {
    try {
      const r = await captureScreen(displayId || undefined, 'preview')
      if ('dataUrl' in r) { setShot(r.dataUrl); setShotErr('') }
      else setShotErr(r.error || '截屏失败')
    } catch (e: any) { setShotErr(String(e?.message || e) || '截屏失败') }
  }, [displayId])

  useEffect(() => { refreshPerms() }, [refreshPerms])
  useEffect(() => {
    if (monitoring && !running) {
      refreshShot()
      monitorTimer.current = setInterval(refreshShot, 2500)
    }
    return () => { if (monitorTimer.current) clearInterval(monitorTimer.current) }
  }, [monitoring, running, refreshShot])

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }) }, [rows])

  const canControl = perms ? (perms.platform === 'darwin' ? perms.accessibility : true) : false
  const permsOk = canControl

  const stop = () => { abortRef.current?.abort(); abortRef.current = null; setRunning(false); setPendingAction(null); confirmResolveRef.current?.(false); confirmResolveRef.current = null }

  const run = useCallback(async () => {
    const g = goal.trim()
    if (!g || running) return
    setError(''); setDoneMsg(''); setRows([])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    try {
      const { steps } = await runComputerAgent({
        goal: g,
        settings,
        signal: ctrl.signal,
        confirmEach,
        onConfirm: (action) => new Promise<boolean>(resolve => {
          setPendingAction(action)
          confirmResolveRef.current = resolve
        }),
        onShot: d => setShot(d),
        onStep: s => {
          const dur = stepT0.current ? ((Date.now() - stepT0.current) / 1000).toFixed(1) : null
          stepT0.current = Date.now()
          setRows(prev => [...prev, { step: s, dur }])
        },
        onExec: (a, r) => setRows(prev => prev.map((row, i) => i === prev.length - 1 ? { ...row, exec: r } : row)),
      })
      const last = steps[steps.length - 1]
      if (last?.status === 'done') { setDoneMsg(last.summary || '已完成。'); pushNotice({ type: 'computer', title: 'Computer Use 已完成', body: (goal || '').slice(0, 60) }) }
      else if (last?.status === 'stuck') { setDoneMsg(''); setError('卡住了：' + (last.summary || '反复尝试未成功，试试点「重试」或换个说法。')) }
      else if (!ctrl.signal.aborted) setError('步数用尽，未确认完成。可继续下达更明确的指令。')
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setRunning(false)
      abortRef.current = null
      refreshShot()
    }
  }, [goal, running, settings, refreshShot])

  const accent = '#10a37f'

  return (
    <div className="flex-1 flex min-h-0" style={{ background: c.bg }}>
      {/* ═══ 左：屏幕预览 ═══ */}
      <div className="flex flex-col border-r min-w-0" style={{ borderColor: c.border, width: 380, flexShrink: 0 }}>
        <div className="flex items-center gap-2 px-4 h-12 border-b shrink-0" style={{ borderColor: c.border }}>
          <span className="w-2 h-2 rounded-full" style={{ background: monitoring ? accent : c.textTertiary, animation: monitoring ? 'b 2s infinite' : 'none' }} />
          <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{t('屏幕', 'Screen')}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {displays.length > 1 && (
              <select value={displayId} onChange={e => setDisplayId(e.target.value)} className="text-[11px] rounded-md px-1.5 py-1" style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                <option value="">主屏</option>
                {displays.map(d => <option key={d.id} value={d.id}>屏幕 {d.id.slice(-4)}{d.primary ? '（主）' : ''}</option>)}
              </select>
            )}
            <button onClick={refreshShot} className="px-2 py-1 rounded-md text-[11px]" style={{ background: c.bgInput, color: c.textSecondary }}>{t('刷新', 'Refresh')}</button>
            <button onClick={() => setMonitoring(v => !v)} className="px-2 py-1 rounded-md text-[11px] font-medium" style={{ background: monitoring ? 'rgba(16,163,127,.15)' : c.bgInput, color: monitoring ? accent : c.textSecondary }}>
              {monitoring ? t('监视中', 'Live') : t('监视', 'Live view')}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3 min-h-0">
          {shotErr && (
            <div className="mb-2 rounded-lg p-2.5 text-[12px]" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}>
              {shotErr}
              {shotErr.includes('屏幕录制') && (
                <button onClick={() => (window as any).electronAPI?.cuOpenPerms?.('screen')}
                  className="ml-2 underline font-medium">{t('打开设置授权', 'Open Settings')}</button>
              )}
            </div>
          )}
          {shot
            ? <img src={shot} alt="屏幕截图" decoding="async" className="w-full rounded-lg" style={{ border: `1px solid ${c.border}`, aspectRatio: '16 / 10', objectFit: 'contain', background: '#0a0a0b' }} />
            : <div className="h-full grid place-items-center text-[12px]" style={{ color: c.textTertiary }}>{t('点「刷新」或开启「监视」查看屏幕', 'Refresh or turn on Live view')}</div>}
        </div>
        {/* 权限状态 */}
        <div className="shrink-0 border-t p-3 space-y-1.5" style={{ borderColor: c.border }}>
          <PermRow ok={!!perms?.screen} label={t('屏幕录制（截屏）', 'Screen recording')} hint={perms?.screen ? t('已授权', 'Granted') : (perms ? t('未授权——截屏为空/黑屏的根因', 'Not granted — blank captures') : '仅在 App 内可用')} c={c} />
          {!perms?.screen && perms && (
            <button onClick={() => (window as any).electronAPI?.cuOpenPerms?.('screen')}
              className="w-full h-8 rounded-lg text-[12px] font-medium" style={{ background: c.accent, color: c.accentText }}>
              {t('打开「屏幕录制」授权', 'Grant Screen Recording')}
            </button>
          )}
          <PermRow ok={!!canControl} label={t('辅助功能（控制权限）', 'Accessibility (control)')} hint={canControl ? (perms?.cliclick ? 'cliclick 已就绪（支持拖拽）' : t('已授权（osascript 模式）', 'Granted (osascript mode)')) : t('需要授权后才能点击/键入', 'Grant to enable clicks & typing')} c={c} />
          {!canControl && perms && (
            <button onClick={() => (window as any).electronAPI?.cuOpenPerms?.('access')}
              className="w-full mt-1 h-8 rounded-lg text-[12px] font-medium" style={{ background: c.accent, color: c.accentText }}>
              {t('打开系统设置授权', 'Open System Settings to grant')}
            </button>
          )}
        </div>
      </div>

      {/* ═══ 右：代理循环 ═══ */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-5 h-12 border-b shrink-0" style={{ borderColor: c.border }}>
          <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: 'rgba(16,163,127,.12)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={accent} stroke-width="1.8" stroke-linecap="round"><path d="M15 7a3 3 0 10-6 0v2a3 3 0 006 0V7z" /><path d="M9 21h6M12 3v4" /></svg>
          </span>
          <span className="text-[14px] font-bold" style={{ color: c.textHead }}>Computer Use</span>
          <span className="text-[11px]" style={{ color: c.textTertiary }}>{t('说目标，它操作这台电脑', 'Say the goal; it drives this computer')}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11.5px] cursor-pointer select-none" style={{ background: c.bgInput, color: c.textSecondary }} title="每个动作执行前先等你确认（更安全）">
              <input type="checkbox" checked={confirmEach} onChange={e => { setConfirmEach(e.target.checked); try { localStorage.setItem('jutian-cu-confirm', e.target.checked ? '1' : '0') } catch {} }} className="accent-[#10a37f]" />
              逐步确认
            </label>
            {rows.length > 0 && !running && (
              <button onClick={() => { setRows([]); setDoneMsg(''); setError('') }} className="px-2.5 h-8 rounded-lg text-[12px]" style={{ background: c.bgInput, color: c.textSecondary }}>{t('清空', 'Clear')}</button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: c.bgInput, color: c.textSecondary }} title="关闭标签页">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </header>

        <div ref={feedRef} className="flex-1 overflow-y-auto p-5 min-h-0">
          {rows.length === 0 && !running && (
            <div className="max-w-[560px] mx-auto text-center pt-10 space-y-4">
              <div className="text-[19px] font-bold" style={{ color: c.textHead }}>{t('把目标交给它', 'Hand it a goal')}</div>
              <p className="text-[13.5px] leading-relaxed" style={{ color: c.textSecondary }}>
                它会截屏观察屏幕，决定点哪里、输入什么，执行后再截图确认，直到完成。全程可见、随时可停。
              </p>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                {['打开系统设置，把外观切换成深色', '找到并打开「计算器」，算 128×46', '把桌面上的截图拖进废纸篓'].map(s => (
                  <button key={s} onClick={() => setGoal(s)} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ background: c.surfaceCard, border: `1px solid ${c.border}`, color: c.textSecondary }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          <div className="max-w-[620px] mx-auto space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="rounded-xl p-3.5" style={{ background: c.surfaceCard, border: `1px solid ${c.border}` }}>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: c.textTertiary }}>
                  <span className="px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(16,163,127,.12)', color: accent }}>STEP {i + 1}</span>
                  {row.dur && <span style={{ color: c.textTertiary }}>{row.dur}s</span>}
                  {row.exec && <span style={{ color: row.exec.ok ? '#22c55e' : '#ef4444' }}>{row.exec.ok ? '✓ 执行成功' : '✕ ' + (row.exec.err || '失败')}</span>}
                </div>
                {row.step.thought && <div className="text-[13px] mt-2 leading-relaxed" style={{ color: c.textSecondary }}>{row.step.thought}</div>}
                {row.step.action && (
                  <div className="mt-2 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-mono text-[11.5px]" style={{ background: c.bgInput, color: c.textHead }}>
                    <span style={{ color: accent }}>{describeAction(row.step.action)}</span>
                  </div>
                )}
                {row.step.summary && row.step.status !== 'continue' && (
                  <div className="text-[13px] mt-2" style={{ color: c.textHead }}>{row.step.summary}</div>
                )}
              </div>
            ))}
            {pendingAction && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.35)' }}>
                <div className="text-[11px] font-semibold mb-1.5" style={{ color: '#f59e0b' }}>等待确认 · 下一步动作</div>
                <div className="font-mono text-[12.5px] mb-3" style={{ color: c.textHead }}>{describeAction(pendingAction)}</div>
                <div className="flex gap-2">
                  <button onClick={() => { setPendingAction(null); confirmResolveRef.current?.(true); confirmResolveRef.current = null }}
                    className="px-4 h-8 rounded-lg text-[12.5px] font-semibold" style={{ background: accent, color: '#fff' }}>{t('继续执行', 'Run it')}</button>
                  <button onClick={stop} className="px-4 h-8 rounded-lg text-[12.5px]" style={{ background: c.bgInput, color: c.textSecondary }}>{t('停止', 'Stop')}</button>
                </div>
              </div>
            )}
            {running && !pendingAction && (
              <div className="rounded-xl p-3.5 flex items-center gap-2.5" style={{ background: c.surfaceCard, border: `1px solid ${c.border}` }}>
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: accent }} />
                <span className="text-[12.5px]" style={{ color: c.textTertiary }}>正在观察屏幕并决定下一步…</span>
              </div>
            )}
            {doneMsg && (
              <div className="rounded-xl p-3.5 flex items-center gap-2.5" style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)' }}>
                <span style={{ color: '#22c55e' }}>✓</span>
                <span className="text-[13px]" style={{ color: c.textHead }}>{doneMsg}</span>
              </div>
            )}
            {error && (
              <div className="rounded-xl p-3.5 text-[13px]" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}>{error}</div>
            )}
          </div>
        </div>

        {/* 输入区 */}
        <div className="shrink-0 p-4 border-t" style={{ borderColor: c.border }}>
          <div className="max-w-[620px] mx-auto flex items-end gap-2 rounded-[22px] px-4 py-2.5" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() } }}
              rows={1}
              placeholder={permsOk ? '描述目标，如：打开浏览器搜索今天的日期' : '先完成上方权限授权…'}
              disabled={!permsOk || running}
              className="flex-1 bg-transparent outline-none resize-none text-[14.5px] leading-[1.6] py-1 max-h-[120px] disabled:opacity-50"
              style={{ color: c.textHead }}
            />
            {running ? (
              <button onClick={stop} className="px-4 h-9 rounded-full text-[13px] font-semibold" style={{ background: 'rgba(239,68,68,.14)', color: '#ef4444' }}>{t('停止', 'Stop')}</button>
            ) : (
              <button onClick={run} disabled={!goal.trim() || !permsOk} className="px-4 h-9 rounded-full text-[13px] font-semibold disabled:opacity-40" style={{ background: accent, color: '#fff' }}>
                执行
              </button>
            )}
          </div>
          <div className="text-center text-[10.5px] mt-2" style={{ color: c.textTertiary }}>
            {t('每一步都会截图确认 · 随时可停 · 它做的每个动作都有记录', 'Every step verified by screenshot · stop anytime · fully logged')}
          </div>
        </div>
      </div>
    </div>
  )
}

function PermRow({ ok, label, hint, c }: { ok: boolean; label: string; hint: string; c: any }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ok ? '#22c55e' : '#f59e0b' }} />
      <span style={{ color: c.textSecondary }}>{label}</span>
      <span className="ml-auto truncate" style={{ color: c.textTertiary }}>{hint}</span>
    </div>
  )
}
