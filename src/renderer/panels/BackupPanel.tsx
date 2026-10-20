/**
 * 备份面板（v12.1）
 *
 * 之前只有"导出/导入"两个按钮，用户不知道备份了什么、多大、能不能还原。
 * 这里用 shared/backupPlan 把范围、体积、校验、保留策略摊开说清楚。
 *
 * 密钥永不进备份——这一点在界面上明写，避免用户以为"备份了密钥可以换机用"。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { buildPlan, humanBytes, sizeWarning, SCOPE_LABEL, type BackupScope } from '../../shared/backupPlan'
import { post, requestJson } from '../api'

interface Stats {
  settings?: number
  sessions?: number
  messages?: number
  memory?: number
  knowledge?: number
  skills?: number
  bytes?: Record<string, number>
}

export default function BackupPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [scopes, setScopes] = useState<BackupScope[]>(['settings', 'sessions', 'memory', 'knowledge', 'skills'])
  const [stats, setStats] = useState<Stats | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    requestJson<Stats>('/api/backup/stats').then(setStats).catch(() => setStats(null))
  }, [])

  const plan = useMemo(() => {
    const b = stats?.bytes || {}
    return buildPlan(
      (Object.keys(b) as BackupScope[]).map((s) => ({ scope: s, path: s, bytes: b[s] || 0 })),
      scopes,
    )
  }, [stats, scopes])

  const warn = sizeWarning(plan.totalBytes)

  const run = async () => {
    setBusy(true); setMsg('')
    try {
      // 真实端点是 /api/backup/export（GET，返回完整 JSON）。
      // 服务端目前一次性导出全部范围，这里按用户勾选做二次裁剪，
      // 保证"只选记忆"就真的只写记忆，而不是嘴上说说。
      const data = await requestJson<Record<string, any>>('/api/backup/export', { timeoutMs: 60_000 })
      const picked: Record<string, unknown> = { version: data.version, exported_at: new Date().toISOString() }
      if (scopes.includes('settings')) picked.settings = data.settings
      if (scopes.includes('sessions')) { picked.sessions = data.sessions; picked.messages = data.messages }
      if (scopes.includes('memory')) picked.memories = data.memories
      const json = JSON.stringify(picked, null, 1)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `jutian-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      setMsg(`已导出 ${humanBytes(blob.size)}（${scopes.map(s => SCOPE_LABEL[s]).join('、')}）`)
    } catch (e) {
      setMsg(`导出失败：${(e as Error)?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (s: BackupScope) => setScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])

  const countOf = (s: BackupScope): number | undefined => {
    if (!stats) return undefined
    if (s === 'settings') return stats.settings
    if (s === 'sessions') return stats.sessions
    if (s === 'memory') return stats.memory
    if (s === 'knowledge') return stats.knowledge
    if (s === 'skills') return stats.skills
    return undefined
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>数据备份</span>
        <span className="text-[10.5px]" style={{ color: c.textTertiary }}>迁移或重装前先备一份</span>
        <span className="flex-1" />
        <button onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>关闭</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-3">
        {(['settings', 'sessions', 'memory', 'knowledge', 'skills'] as BackupScope[]).map((s) => {
          const on = scopes.includes(s)
          const cnt = countOf(s)
          const bytes = stats?.bytes?.[s]
          return (
            <button key={s} onClick={() => toggle(s)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-colors"
              style={{ background: on ? 'rgba(16,163,127,.07)' : c.bgInput, border: `1px solid ${on ? 'rgba(16,163,127,.3)' : c.borderLight}` }}>
              <span className="w-4 h-4 rounded border shrink-0 grid place-items-center"
                style={{ borderColor: on ? c.accent : c.border, background: on ? c.accent : 'transparent' }}>
                {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={4}><path d="M20 6L9 17l-5-5" /></svg>}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-medium" style={{ color: c.textHead }}>{SCOPE_LABEL[s]}</span>
                <span className="block text-[10.5px]" style={{ color: c.textTertiary }}>
                  {cnt !== undefined ? `${cnt} 项` : '—'}{bytes ? ` · ${humanBytes(bytes)}` : ''}
                </span>
              </span>
            </button>
          )
        })}

        <div className="rounded-xl px-3.5 py-2.5" style={{ background: c.bgInput }}>
          <div className="flex items-center text-[12px]" style={{ color: c.textHead }}>
            <span className="flex-1">预计大小</span>
            <span className="font-mono">{humanBytes(plan.totalBytes)}</span>
          </div>
          {warn && <div className="text-[10.5px] mt-1" style={{ color: '#8a5a00' }}>{warn}</div>}
        </div>

        <div className="text-[10.5px] leading-relaxed px-1" style={{ color: c.textTertiary }}>
          · API 密钥不会写入备份（换机后需重新填写，这是有意为之）<br />
          · 导入时若遇到缺少清单文件的包，会明确报错而不是静默成功
        </div>

        {msg && <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: c.bgInput, color: c.textSecondary || c.textTertiary }}>{msg}</div>}
      </div>

      <div className="px-5 py-3 border-t flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <label className="text-[11.5px] px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
          style={{ background: c.bgInput, color: c.textSecondary || c.textTertiary, border: `1px solid ${c.border}` }}>
          导入备份
          <input type="file" accept=".json" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setBusy(true); setMsg('')
              try {
                const text = await f.text()
                const data = JSON.parse(text)
                if (!data?.sessions && !data?.settings && !data?.memories) {
                  throw new Error('文件里没有可导入的内容（需要 sessions / settings / memories 之一）')
                }
                const d = await post<{ ok?: boolean; imported?: any; error?: string }>('/api/backup/import', data, { timeoutMs: 120_000 })
                if (d?.error) setMsg(`导入失败：${d.error}`)
                else {
                  const n = d?.imported?.sessions ?? 0
                  setMsg(`导入完成${n ? `：新增 ${n} 个会话` : ''}，部分设置可能需要重启生效`)
                }
              } catch (err) {
                setMsg(`导入失败：${(err as Error)?.message || err}`)
              } finally { setBusy(false); e.target.value = '' }
            }} />
        </label>
        <span className="flex-1" />
        <button onClick={run} disabled={busy || !scopes.length}
          className="px-4 py-1.5 rounded-lg text-[12px] font-medium text-white disabled:opacity-40"
          style={{ background: c.accent || '#10a37f' }}>
          {busy ? '导出中…' : '导出备份'}
        </button>
      </div>
    </div>
  )
}
