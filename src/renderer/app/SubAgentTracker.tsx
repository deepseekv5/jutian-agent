/**
 * SubAgentTracker — 侧栏子代理进度条（v5.3）
 * 监听 window 'subagent-progress' 事件；单状态对象驱动，进度条纯 transform 动画。
 * 只在有批次时渲染；完成后保留可查看，点 ✕ 收起。
 */
import { useEffect, useState } from 'react'
import { useTheme } from '../hooks/useTheme'

interface AgentState { name: string; task: string; status: 'pending' | 'running' | 'done'; phase: string; outputTail: string }
interface Batch { id: string; running: boolean; agents: AgentState[] }

export default function SubAgentTracker() {
  const { c } = useTheme()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [dismissed, setDismissed] = useState('')

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (!d?.batchId) return
      setBatch({ id: d.batchId, running: !!d.running, agents: d.agents })
      if (d.batchId !== dismissed) setDismissed('')
    }
    window.addEventListener('subagent-progress', h)
    return () => window.removeEventListener('subagent-progress', h)
  }, [dismissed])

  if (!batch || dismissed === batch.id || batch.agents.length === 0) return null
  const done = batch.agents.filter(a => a.status === 'done').length
  const allDone = !batch.running

  return (
    <div className="mx-2 mb-2 rounded-xl border overflow-hidden shrink-0" style={{ borderColor: c.border, background: c.surfaceCard }}>
      {/* 标题行 */}
      <div className="flex items-center gap-2 px-2.5 h-8">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: batch.running ? '#10a37f' : '#86868b', animation: batch.running ? 'b 1.6s ease-in-out infinite' : 'none' }} />
        <span className="text-[11px] font-bold" style={{ color: c.textHead }}>
          {batch.running ? '子代理执行中' : '子代理已完成'}
        </span>
        <span className="text-[10px] font-mono" style={{ color: c.textTertiary }}>{done}/{batch.agents.length}</span>
        <button
          onClick={() => setDismissed(batch.id)}
          className="ml-auto w-5 h-5 rounded grid place-items-center"
          style={{ color: c.textTertiary }}
          title="收起">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      {/* 每个子代理 */}
      <div className="pb-1.5">
        {batch.agents.map((a, i) => (
          <div key={i} className="px-2.5 py-1.5" title={a.task}>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold truncate" style={{ color: c.textHead }}>{a.name}</span>
              <span className="text-[9.5px] ml-auto shrink-0 truncate" style={{ color: a.status === 'done' ? '#22c55e' : c.textTertiary }}>
                {a.status === 'done' ? (a.phase === '已取消' ? '已取消' : '✓ 完成') : a.phase}
              </span>
            </div>
            {/* 进度条：运行中=流动条纹,完成=满格 */}
            <div className="h-[3px] mt-1 rounded-full overflow-hidden" style={{ background: c.bgInput }}>
              {a.status === 'done' ? (
                <div className="h-full rounded-full" style={{ width: '100%', background: 'linear-gradient(90deg,#10a37f,#34d399)' }} />
              ) : a.status === 'running' ? (
                <div className="h-full rounded-full" style={{ width: '40%', background: '#10a37f', animation: 'subagent-slide 1.2s ease-in-out infinite' }} />
              ) : (
                <div className="h-full rounded-full" style={{ width: '12%', background: c.border }} />
              )}
            </div>
            {a.status === 'running' && a.outputTail && (
              <div className="text-[9.5px] mt-1 truncate font-mono" style={{ color: c.textTertiary }}>{a.outputTail}</div>
            )}
          </div>
        ))}
      </div>
      <style>{`@keyframes subagent-slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
    </div>
  )
}
