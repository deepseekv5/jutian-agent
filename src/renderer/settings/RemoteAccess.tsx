/**
 * RemoteAccess — 手机远程访问（v5.5）
 * 局域网内手机扫码/输入地址即可使用电脑上的巨天agent。
 * 配对码仅本机可读；重新配对后旧链接立即失效。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

interface RemoteInfo { ip: string; port: number; token: string; url: string; model?: string }

export default function RemoteAccess() {
  const { c } = useTheme()
  const { t } = useLanguage()
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/remote/info')
      const d = await r.json()
      if (d.error) { setErr(d.error); return }
      setInfo(d)
      const QR = await import('qrcode')
      setQr(await QR.toDataURL(d.url, { width: 220, margin: 1, color: { dark: '#0a0a0b', light: '#ffffff' } }))
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])

  useEffect(() => { load() }, [load])

  const rotate = async () => {
    try {
      await fetch('/api/remote/rotate', { method: 'POST' })
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  const copy = async () => {
    if (!info) return
    try { await navigator.clipboard.writeText(info.url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  return (
    <div className="flex items-start gap-5 flex-wrap">
      {/* QR */}
      <div className="shrink-0 p-2 rounded-xl inline-block" style={{ background: '#ffffff', border: `1px solid ${c.border}` }}>
        {qr ? <img src={qr} alt="配对二维码" width={116} height={116} style={{ display: 'block' }} /> : <div style={{ width: 116, height: 116, display: 'grid', placeItems: 'center', color: c.textTertiary, fontSize: 11 }}>{err || '…'}</div>}
      </div>

      <div className="flex-1 min-w-[240px] space-y-2.5">
        <p className="text-[11px] leading-relaxed" style={{ color: c.textTertiary }}>
          {t('手机与电脑连同一 Wi-Fi，扫码即可在手机上使用电脑的巨天agent：发消息、建会话、看回复。密钥不出电脑。', 'Same Wi-Fi, scan to use Jutian Agent from your phone. Chats sync with this computer. Keys never leave the machine.')}
        </p>
        {info && (
          <>
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg font-mono text-[11px] cursor-pointer" style={{ background: c.bgInput, color: c.textSecondary }} onClick={copy} title={t('点击复制', 'Click to copy')}>
              <span className="truncate flex-1">{info.url}</span>
              <span className="shrink-0" style={{ color: copied ? c.accent : c.textTertiary }}>{copied ? '✓' : t('复制', 'Copy')}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={rotate} className="px-2.5 h-7 rounded-md text-[11px]" style={{ background: c.bgInput, color: c.textSecondary }} title={t('旧的配对链接立即失效', 'Old pairing links expire immediately')}>
                {t('重新配对', 'Re-pair')}
              </button>
              <span className="text-[10.5px]" style={{ color: c.textTertiary }}>
                {t('需保持巨天agent 运行；仅限同一局域网', 'Keep Jutian Agent running · LAN only')}
              </span>
            </div>
          </>
        )}
        {err && <div className="text-[11px]" style={{ color: '#ef4444' }}>{err}</div>}
      </div>
    </div>
  )
}
