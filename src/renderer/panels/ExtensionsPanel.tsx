/**
 * 扩展管理页（v14.11）—— UXL 的治理面
 *
 * 对齐 the agent harness Creator Mode 的可逆性：列出 / 批准 / 启用 / 禁用 / 删除。
 * AI 创建的扩展默认 pending，必须用户显式批准才挂载（安全边界）。
 * 复用现有玻璃卡片样式，不引入新依赖。
 */

import { useEffect, useState, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import { fetchCompat } from '../api'
import { manageExt } from '../app/extensions'

interface ExtRow {
  id: string
  name: string
  version?: string
  description?: string
  icon?: string
  status: 'active' | 'pending' | 'disabled' | 'invalid'
  errors?: string[]
  capabilities?: string[]
  slot?: string
  author?: string
  createdAt?: string
}

export default function ExtensionsPanel() {
  const { c } = useTheme()
  const [rows, setRows] = useState<ExtRow[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetchCompat('/api/extensions/list', {})
      const d = await r.json()
      setRows(Array.isArray(d?.items) ? d.items : [])
    } catch (e) { setMsg('加载失败：' + String((e as Error)?.message || e)) }
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('extensions-changed', load)
    window.addEventListener('focus', load)
    return () => { window.removeEventListener('extensions-changed', load); window.removeEventListener('focus', load) }
  }, [load])

  const act = async (id: string, action: 'approve' | 'enable' | 'disable' | 'delete') => {
    if (action === 'delete' && !window.confirm(`确定删除扩展「${id}」？此操作会删除 ~/.lyclaw/extensions/${id}/ 整个目录。`)) return
    setBusy(id + action)
    const r = await manageExt(id, action)
    setBusy('')
    if (!r.ok) { setMsg('操作失败：' + (r.error || '未知')); return }
    setMsg(action === 'approve' ? '已批准，扩展现在可以打开了' : action === 'delete' ? '已删除' : action === 'enable' ? '已启用' : '已禁用')
    await load()
    window.dispatchEvent(new CustomEvent('extensions-changed'))
  }

  const statusLabel: Record<string, string> = { active: '已启用', pending: '待批准', disabled: '已禁用', invalid: '异常' }
  const statusColor: Record<string, string> = { active: 'var(--brand, #10a37f)', pending: '#f59e0b', disabled: c.textTertiary, invalid: '#ef4444' }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ color: c.text }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[22px]">🧩</span>
          <h1 className="text-[18px] font-semibold" style={{ color: c.textHead }}>扩展</h1>
        </div>
        <p className="text-[12.5px] leading-relaxed mb-5" style={{ color: c.textTertiary }}>
          让 AI 为自己创建界面面板与小工具。所有扩展保存在 <code className="font-mono">~/.lyclaw/extensions/</code>，
          官方更新只替换 app.asar，<strong style={{ color: c.textSecondary }}>不会覆盖它们</strong>。
          AI 生成的扩展默认待批准，经你确认后才会在界面中出现；随时可禁用或删除。
        </p>

        {msg && (
          <div className="mb-4 px-3.5 py-2 rounded-xl text-[12px]" style={{ background: c.bgInput, color: c.textSecondary }}>{msg}</div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
            <div className="text-[13px] mb-2" style={{ color: c.textSecondary }}>还没有扩展</div>
            <div className="text-[11.5px] leading-relaxed" style={{ color: c.textTertiary }}>
              在对话里说「给我做个番茄钟面板」，AI 会用 create_extension 工具生成一个；
              回来这里点「批准」即可使用。
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {rows.map(r => (
              <div key={r.id} className="rounded-2xl p-4" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                <div className="flex items-start gap-3">
                  <span className="text-[22px] shrink-0">{r.icon || '🧩'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold" style={{ color: c.textHead }}>{r.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,.04)', color: statusColor[r.status] }}>
                        {statusLabel[r.status] || r.status}
                      </span>
                    </div>
                    {r.description && <div className="text-[11.5px] mt-1" style={{ color: c.textSecondary }}>{r.description}</div>}
                    <div className="text-[10.5px] font-mono mt-1.5" style={{ color: c.textTertiary }}>
                      {r.id}{r.version ? ' · v' + r.version : ''}{r.slot ? ' · ' + r.slot : ''}
                      {r.author ? ' · ' + r.author : ''}
                    </div>
                    {r.errors?.length ? (
                      <div className="text-[10.5px] mt-1" style={{ color: '#ef4444' }}>{r.errors.join('；')}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 pl-9 flex-wrap">
                  {r.status === 'pending' && (
                    <button disabled={busy === r.id + 'approve'} onClick={() => act(r.id, 'approve')}
                      className="px-3 h-7 rounded-full text-[11.5px] font-semibold disabled:opacity-40"
                      style={{ background: 'var(--brand, #10a37f)', color: '#fff' }}>批准并启用</button>
                  )}
                  {r.status === 'active' && (
                    <>
                      <button onClick={() => window.dispatchEvent(new CustomEvent('open-panel', { detail: 'ext:' + r.id }))}
                        className="px-3 h-7 rounded-full text-[11.5px]" style={{ background: c.surfaceHover || c.bgInput, color: c.textSecondary }}>打开面板</button>
                      <button disabled={busy === r.id + 'disable'} onClick={() => act(r.id, 'disable')}
                        className="px-3 h-7 rounded-full text-[11.5px]" style={{ background: c.surfaceHover || c.bgInput, color: c.textSecondary }}>禁用</button>
                    </>
                  )}
                  {r.status === 'disabled' && (
                    <button disabled={busy === r.id + 'enable'} onClick={() => act(r.id, 'enable')}
                      className="px-3 h-7 rounded-full text-[11.5px]" style={{ background: c.surfaceHover || c.bgInput, color: c.textSecondary }}>启用</button>
                  )}
                  <span className="flex-1" />
                  <button disabled={busy === r.id + 'delete'} onClick={() => act(r.id, 'delete')}
                    className="px-3 h-7 rounded-full text-[11.5px]" style={{ color: '#ef4444' }}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-xl p-3.5 text-[11px] leading-relaxed" style={{ background: c.bgInput, color: c.textTertiary }}>
          安全说明：扩展面板运行在无同源权限的 iframe 沙箱中，拿不到本应用的 Cookie / localStorage / API 密钥；
          只能通过白名单桥读取 settings / sessions / notices / workspace，且禁止写操作。
          扩展 manifest 带 apiVersion，宿主大版本升级后不兼容的扩展会自动禁用，不会白屏。
        </div>
      </div>
    </div>
  )
}
