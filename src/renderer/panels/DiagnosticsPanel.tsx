/**
 * 环境诊断面板（v12）
 *
 * 一键跑完所有检查项，生成可复制报告。设计上刻意只做"能确认"的判断
 * （见 shared/diagnostics），拿不到的信息标 skip 而不是判失败。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { buildReport, reportToMarkdown, checkApiConfig, checkWorkDir, checkNodeVersion, checkStorage, checkServer, type CheckResult } from '../../shared/diagnostics'
import { isPersistent } from '../utils/safeStorage'
import { APP_VERSION } from '../brand'
import { fetchCompat } from '../api'
import { perfSummary } from '../engine/agentPerf'
import type { PerfReport } from '../engine/agentPerf'



/** Agent 耗时（v13.10.1）：渲染端 agent 循环上报的每请求耗时结构。
 *  慢在哪一目了然——LLM 首字/流时长 vs 工具执行 vs 轮数。 */
function AgentPerfSection() {
  const { c } = useTheme()
  const [items, setItems] = useState<PerfReport[] | null>(null)

  const load = useCallback(() => {
    fetchCompat('/api/perf-log').then((r) => r.json()).then((j) => setItems(j.items || [])).catch(() => setItems([]))
  }, [])
  useEffect(() => { load() }, [load])

  if (items === null) return <div className="text-[11.5px] py-3" style={{ color: c.textTertiary }}>加载 Agent 耗时…</div>

  // 聚合：中位总耗时 + 最耗时工具 Top3（按累计执行时长）
  const sorted = [...items].sort((a, b) => a.totalMs - b.totalMs)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].totalMs : 0
  const toolAgg = new Map<string, { ms: number; n: number; err: number }>()
  for (const it of items) {
    for (const rd of it.roundsDetail || []) {
      for (const t of rd.tools || []) {
        const cur = toolAgg.get(t.name) || { ms: 0, n: 0, err: 0 }
        cur.ms += t.ms; cur.n += 1; if (!t.ok) cur.err += 1
        toolAgg.set(t.name, cur)
      }
    }
  }
  const topTools = [...toolAgg.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 3)

  return (
    <details className="rounded-xl px-3.5 py-2.5" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }} open={items.length > 0}>
      <summary className="flex items-center gap-2 cursor-pointer list-none">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#6366f1' }} />
        <span className="text-[12.5px] font-medium" style={{ color: c.textHead }}>Agent 耗时</span>
        <span className="text-[11.5px] truncate ml-1" style={{ color: c.textTertiary }}>
          {items.length ? `${items.length} 次请求 · 中位 ${(median / 1000).toFixed(1)}s` : '暂无数据（跑一次 agent 任务后出现）'}
        </span>
        <span className="flex-1" />
        <button onClick={(e) => { e.preventDefault(); load() }}
          className="px-2 py-0.5 rounded text-[10.5px]" style={{ color: c.textTertiary, border: `1px solid ${c.borderLight}` }}>刷新</button>
      </summary>
      {topTools.length > 0 && (
        <div className="mt-2 pl-4 flex flex-wrap gap-1.5">
          {topTools.map(([name, agg]) => (
            <span key={name} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: c.surfaceCard, color: c.textTertiary }}>
              {name} ×{agg.n} · {(agg.ms / 1000).toFixed(1)}s{agg.err ? ` · 错${agg.err}` : ''}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 pl-4 space-y-1">
        {items.slice(0, 10).map((it, i) => (
          <details key={i} className="text-[11px]">
            <summary className="cursor-pointer list-none flex gap-2 items-baseline flex-wrap">
              <span style={{ color: c.textTertiary }}>{new Date(it.ts).toLocaleTimeString()}</span>
              <span style={{ color: c.textSecondary || c.textTertiary }}>{it.model || '未知模型'}</span>
              <span style={{ color: c.textTertiary }}>{perfSummary(it)}</span>
            </summary>
            <pre className="mt-1 px-2 py-1.5 rounded-lg text-[10px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto scrollbar-thin"
              style={{ background: c.surfaceCard, color: c.textTertiary }}>
              {(it.roundsDetail || []).map((rd) =>
                `第${rd.round}轮 · 首字 ${rd.firstTokenMs != null ? Math.round(rd.firstTokenMs) + 'ms' : '-'} · 流 ${rd.llmMs != null ? Math.round(rd.llmMs) + 'ms' : '-'} · 工具 ${(rd.tools || []).map((t) => t.name + ':' + Math.round(t.ms) + 'ms' + (t.ok ? '' : '(错)')).join(' ')}`
              ).join('\n') || '无轮次明细'}
            </pre>
          </details>
        ))}
      </div>
    </details>
  )
}

export default function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [results, setResults] = useState<CheckResult[]>([])
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    const out: CheckResult[] = []

    // 本地服务
    let serverOk = false
    let version: string | undefined
    try {
      const r = await fetchCompat('/api/health', { signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const j = await r.json()
        serverOk = true
        version = j.version
      }
    } catch { serverOk = false }
    out.push(checkServer(serverOk, version))

    // API 配置
    try {
      const s = await fetchCompat('/api/settings').then((r) => r.json())
      out.push(checkApiConfig({ apiBaseUrl: s.apiBaseUrl, apiKey: s.apiKey, model: s.model }))
      // 工作目录：让后端判断存在性，避免前端 file:// 限制误判
      if (s.workDir) {
        try {
          const r = await fetchCompat('/api/tools/execute', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'get_file_info', args: { path: s.workDir } }),
          }).then((x) => x.json())
          out.push(checkWorkDir(s.workDir, !!r?.success))
        } catch {
          out.push({ id: 'workdir', name: '工作目录', status: 'skip', message: '无法确认目录状态', detail: s.workDir })
        }
      } else {
        out.push(checkWorkDir('', false))
      }
    } catch {
      out.push({ id: 'api', name: 'API 配置', status: 'skip', message: '无法读取设置' })
    }

    // Node 版本（后端暴露的 system_info 里有）
    try {
      const r = await fetchCompat('/api/tools/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'system_info', args: {} }),
      }).then((x) => x.json())
      if (r?.success) {
        const info = JSON.parse(r.output)
        out.push(checkNodeVersion(info.node))
        out.push({
          id: 'sys', name: '系统信息', status: 'pass',
          message: `${info.os} · ${info.arch} · ${info.cpu} · 内存 ${info.memory}`,
          detail: JSON.stringify(info.tools, null, 2),
        })
      }
    } catch { /* 忽略 */ }

    out.push(checkStorage(isPersistent()))
    setResults(out)
    setRunning(false)
  }, [])

  useEffect(() => { run() }, [run])

  const report = buildReport({ version: APP_VERSION, platform: navigator.platform || 'unknown', results })

  const copy = async () => {
    const md = reportToMarkdown(report)
    try {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时退回下载
      const blob = new Blob([md], { type: 'text/markdown' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'jutian-diagnostics.md'
      a.click()
      URL.revokeObjectURL(a.href)
    }
  }

  const tone = (s: CheckResult['status']) =>
    s === 'pass' ? '#10a37f' : s === 'warn' ? '#f59e0b' : s === 'fail' ? '#ef4444' : '#8f8f8f'
  const label = (s: CheckResult['status']) =>
    s === 'pass' ? '通过' : s === 'warn' ? '警告' : s === 'fail' ? '失败' : '跳过'

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>环境诊断</span>
        <span className="text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: tone(report.overall) }}>
          {label(report.overall)}
        </span>
        <span className="flex-1" />
        <button onClick={run} disabled={running}
          className="px-2.5 py-1 rounded-lg text-[11.5px] transition-colors disabled:opacity-50"
          style={{ color: c.textTertiary, border: `1px solid ${c.borderLight}` }}>
          {running ? '检查中…' : '重新检查'}
        </button>
        <button onClick={copy}
          className="px-2.5 py-1 rounded-lg text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: c.accent || '#10a37f' }}>
          {copied ? '已复制' : '复制报告'}
        </button>
        <button onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>关闭</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-2">
        <AgentPerfSection />
        {results.map((r) => (
          <details key={r.id} className="rounded-xl px-3.5 py-2.5" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
            <summary className="flex items-center gap-2 cursor-pointer list-none">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tone(r.status) }} />
              <span className="text-[12.5px] font-medium" style={{ color: c.textHead }}>{r.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: c.surfaceCard, color: tone(r.status) }}>{label(r.status)}</span>
              <span className="text-[11.5px] truncate ml-1" style={{ color: c.textTertiary }}>{r.message}</span>
            </summary>
            {r.fix && <div className="mt-2 text-[11.5px] pl-4" style={{ color: c.textSecondary || c.textTertiary }}>建议：{r.fix}</div>}
            {r.detail && (
              <pre className="mt-2 ml-4 px-2.5 py-2 rounded-lg text-[10.5px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto scrollbar-thin"
                style={{ background: c.surfaceCard, color: c.textTertiary }}>{r.detail}</pre>
            )}
          </details>
        ))}
        {results.length === 0 && <div className="text-center text-[11.5px] py-8" style={{ color: c.textTertiary }}>正在检查…</div>}
      </div>
    </div>
  )
}
