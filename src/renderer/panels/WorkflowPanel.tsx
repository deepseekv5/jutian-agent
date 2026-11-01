/**
 * 工作流面板（v14.1）
 *
 * 与定时任务互补：定时任务解决「什么时候跑」，工作流解决「按什么顺序跑、
 * 上一步结果怎么给下一步用」。两者可在定时任务的 agent 模式里手动串联。
 *
 * 交互：左侧列表 → 右侧步骤编排；运行时弹出输入表单，逐步显示状态与输出。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import PageShell from '../app/PageShell'
import { useTheme } from '../hooks/useTheme'
import { fetchCompat } from '../api'
import type { Workflow, WorkflowStep, WorkflowInput, StepResult } from '../../shared/workflow'

const STEP_TYPES: { id: 'prompt' | 'tool'; zh: string }[] = [
  { id: 'prompt', zh: '模型' },
  { id: 'tool', zh: '工具' },
]

const emptyWorkflow = (): Workflow => ({
  id: '',
  name: '',
  description: '',
  inputs: [],
  steps: [{ id: 'step1', type: 'prompt', title: '第一步', prompt: '' }],
})

export default function WorkflowPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [list, setList] = useState<Workflow[]>([])
  const [editing, setEditing] = useState<Workflow | null>(null)
  const [running, setRunning] = useState<Workflow | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [results, setResults] = useState<StepResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [openStep, setOpenStep] = useState<string | null>(null)
  // AI 生成（v14.2）：自然语言描述 → 工作流草稿（后端调模型 + 校验，这里只负责收集与预填）
  const [aiOpen, setAiOpen] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await fetchCompat('/api/workflows').then(x => x.json())
      setList(Array.isArray(r?.workflows) ? r.workflows : [])
    } catch { setMsg('无法读取工作流列表') }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const save = async () => {
    if (!editing) return
    setBusy(true); setMsg('')
    try {
      const isNew = !editing.id
      const r = await fetchCompat(isNew ? '/api/workflows' : `/api/workflows/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      }).then(x => x.json())
      if (r.error) { setMsg(r.error); return }
      setEditing(null); await refresh()
    } catch (e: any) { setMsg(String(e.message || e)) }
    finally { setBusy(false) }
  }

  const del = async (wf: Workflow) => {
    setBusy(true)
    try { await fetchCompat(`/api/workflows/${wf.id}`, { method: 'DELETE' }); await refresh() }
    finally { setBusy(false) }
  }

  const startRun = (wf: Workflow) => {
    setRunning(wf); setResults(null); setMsg('')
    const init: Record<string, string> = {}
    for (const i of wf.inputs || []) init[i.key] = i.default || ''
    setInputs(init)
  }

  const run = async () => {
    if (!running) return
    setBusy(true); setMsg('')
    try {
      const r = await fetchCompat(`/api/workflows/${running.id}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs }),
      }).then(x => x.json())
      if (r.error) { setMsg(r.error); return }
      setResults(r.steps || [])
      await refresh()
    } catch (e: any) { setMsg(String(e.message || e)) }
    finally { setBusy(false) }
  }

  const patchStep = (idx: number, patch: Partial<WorkflowStep>) => {
    if (!editing) return
    const steps = [...editing.steps]
    steps[idx] = { ...steps[idx], ...patch }
    setEditing({ ...editing, steps })
  }
  const addStep = () => {
    if (!editing) return
    const n = editing.steps.length + 1
    setEditing({ ...editing, steps: [...editing.steps, { id: `step${n}`, type: 'prompt', title: `第 ${n} 步`, prompt: '' }] })
  }
  const delStep = (idx: number) => {
    if (!editing) return
    setEditing({ ...editing, steps: editing.steps.filter((_, i) => i !== idx) })
  }
  const patchInput = (idx: number, patch: Partial<WorkflowInput>) => {
    if (!editing) return
    const inputs2 = [...(editing.inputs || [])]
    inputs2[idx] = { ...inputs2[idx], ...patch }
    setEditing({ ...editing, inputs: inputs2 })
  }

  const generate = async () => {
    if (!aiDesc.trim()) { setMsg('请先描述你想要的自动化流程'); return }
    setAiBusy(true); setMsg('')
    try {
      const r = await fetchCompat('/api/workflows/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: aiDesc.trim() }),
      }).then(x => x.json())
      if (r.error) { setMsg(r.error); return }
      setEditing(r.workflow)
      setAiOpen(false); setAiDesc('')
      setMsg('已生成草稿，请检查步骤与参数后保存')
    } catch (e: any) { setMsg(String(e.message || e)) }
    finally { setAiBusy(false) }
  }

  const placeholderHelp = useMemo(() => [
    { code: '{{input.KEY}}', desc: '运行时填的输入' },
    { code: '{{step.ID.output}}', desc: '某一步的输出' },
    { code: '{{prev.output}}', desc: '上一步的输出' },
  ], [])

  const statusColor = (s: string) => s === 'done' ? '#059669' : s === 'error' ? '#ef4444' : c.textMuted

  return (
    <PageShell onClose={onClose} title="工作流" description="多步骤自动化：上一步的输出喂给下一步" icon="M4 6h16M4 12h10M4 18h7">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap">
        <button onClick={() => { setEditing(emptyWorkflow()); setMsg('') }}
          className="h-9 px-4 rounded-lg text-[13px] font-medium" style={{ background: c.textHead, color: c.bg }}>
          新建工作流
        </button>
        <button onClick={() => setAiOpen(true)} className="h-9 px-3 rounded-lg text-[12.5px] font-medium"
          style={{ background: `${c.accent}18`, color: c.accent }}>
          AI 生成
        </button>
        <span className="text-[11px]" style={{ color: c.textMuted }}>
          步骤可用 {'{{input.x}}'} / {'{{step.id.output}}'} / {'{{prev.output}}'} 传值
        </span>
        {msg && <span className="text-[11px]" style={{ color: c.toolErr }}>{msg}</span>}
      </div>

      <div className="px-4 pb-4 space-y-1">
        {list.length === 0 && (
          <div className="text-center py-14">
            <p className="text-[13px]" style={{ color: c.textMuted }}>还没有工作流</p>
            <p className="text-[11.5px] mt-1" style={{ color: c.textTertiary }}>
              例：抓取网页 → 总结要点 → 写入知识库
            </p>
          </div>
        )}
        {list.map(wf => (
          <div key={wf.id} className="rounded-xl glass px-4 py-3" style={{ border: `1px solid ${c.borderLight}` }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium truncate" style={{ color: c.text }}>{wf.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>
                    {wf.steps?.length || 0} 步
                  </span>
                  {wf.lastStatus && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: wf.lastStatus === 'error' ? '#ef444422' : '#34d39922', color: statusColor(wf.lastStatus) }}>
                      上次{wf.lastStatus === 'error' ? '失败' : '成功'}{wf.lastSummary ? ` · ${wf.lastSummary}` : ''}
                    </span>
                  )}
                </div>
                {wf.description && <div className="text-[11px] mt-0.5 truncate" style={{ color: c.textTertiary }}>{wf.description}</div>}
              </div>
              <button onClick={() => startRun(wf)} className="shrink-0 h-7 px-2.5 rounded-lg text-[11px] font-medium"
                style={{ background: c.accent, color: c.accentText }}>运行</button>
              <button onClick={() => { setEditing(JSON.parse(JSON.stringify(wf))); setMsg('') }} className="shrink-0 h-7 px-2.5 rounded-lg text-[11px]"
                style={{ background: c.bgInput, color: c.textSecondary }}>编辑</button>
              <button onClick={() => del(wf)} className="shrink-0 h-7 px-2 rounded-lg text-[11px]" style={{ color: c.toolErr }}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {/* AI 生成 */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: c.modalOverlay }} onClick={() => setAiOpen(false)}>
          <div className="rounded-xl p-5 space-y-3 glass-strong" style={{ width: 520, border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold" style={{ color: c.textHead }}>AI 生成工作流</h3>
            <textarea value={aiDesc} onChange={e => setAiDesc(e.target.value)} rows={4} autoFocus
              placeholder="用自然语言描述自动化流程，例如：抓取 https://example.com 的正文，总结成 3 条要点，保存到 knowledge.md"
              className="w-full px-3 py-2 rounded-lg text-[12.5px] outline-none resize-y"
              style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            <p className="text-[10.5px]" style={{ color: c.textMuted }}>
              生成的是草稿——保存前请在编辑器里检查每一步的工具与参数。
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAiOpen(false)} className="px-4 py-2 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>取消</button>
              <button onClick={generate} disabled={aiBusy} className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30"
                style={{ background: c.accent, color: c.accentText }}>{aiBusy ? '生成中…' : '生成草稿'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑器 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: c.modalOverlay }} onClick={() => setEditing(null)}>
          <div className="rounded-xl p-5 space-y-3 glass-strong overflow-y-auto scrollbar-thin"
            style={{ width: 720, maxHeight: '86vh', border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold" style={{ color: c.textHead }}>{editing.id ? '编辑工作流' : '新建工作流'}</h3>
            <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="名称，如：每日技术简报"
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="一句话说明（可选）"
              className="w-full px-3 py-2 rounded-lg text-[12.5px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />

            {/* 输入 */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-bold tracking-wider" style={{ color: c.textTertiary }}>运行时输入</span>
                <button onClick={() => setEditing({ ...editing, inputs: [...(editing.inputs || []), { key: `in${(editing.inputs?.length || 0) + 1}`, label: '' }] })}
                  className="text-[10.5px]" style={{ color: c.accent }}>+ 添加</button>
              </div>
              {(editing.inputs || []).map((inp, i) => (
                <div key={i} className="flex gap-1.5 mb-1">
                  <input value={inp.key} onChange={e => patchInput(i, { key: e.target.value })} placeholder="key"
                    className="w-28 px-2 py-1 rounded text-[11px] font-mono outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
                  <input value={inp.label} onChange={e => patchInput(i, { label: e.target.value })} placeholder="显示名"
                    className="flex-1 px-2 py-1 rounded text-[11px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
                  <input value={inp.default || ''} onChange={e => patchInput(i, { default: e.target.value })} placeholder="默认值"
                    className="flex-1 px-2 py-1 rounded text-[11px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
                  <button onClick={() => setEditing({ ...editing, inputs: (editing.inputs || []).filter((_, x) => x !== i) })}
                    className="px-1.5 text-[11px]" style={{ color: c.toolErr }}>×</button>
                </div>
              ))}
            </div>

            {/* 步骤 */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-bold tracking-wider" style={{ color: c.textTertiary }}>步骤（按顺序执行）</span>
                <button onClick={addStep} className="text-[10.5px]" style={{ color: c.accent }}>+ 添加步骤</button>
              </div>
              <div className="space-y-1.5">
                {editing.steps.map((st, i) => {
                  const open = openStep === st.id
                  return (
                    <div key={i} className="rounded-lg p-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] w-5 text-center" style={{ color: c.textMuted }}>{i + 1}</span>
                        <input value={st.id} onChange={e => patchStep(i, { id: e.target.value })} placeholder="id"
                          className="w-24 px-2 py-1 rounded text-[11px] font-mono outline-none" style={{ border: `1px solid ${c.border}`, background: c.surfaceCard, color: c.text }} />
                        <select value={st.type} onChange={e => patchStep(i, { type: e.target.value as 'prompt' | 'tool' })}
                          className="px-1.5 py-1 rounded text-[11px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.surfaceCard, color: c.text }}>
                          {STEP_TYPES.map(t => <option key={t.id} value={t.id}>{t.zh}</option>)}
                        </select>
                        <input value={st.title} onChange={e => patchStep(i, { title: e.target.value })} placeholder="步骤名"
                          className="flex-1 px-2 py-1 rounded text-[11px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.surfaceCard, color: c.text }} />
                        <button onClick={() => setOpenStep(open ? null : st.id)} className="px-1.5 text-[10.5px]" style={{ color: c.textTertiary }}>{open ? '收起' : '内容'}</button>
                        <button onClick={() => delStep(i)} className="px-1.5 text-[11px]" style={{ color: c.toolErr }}>×</button>
                      </div>
                      {open && (
                        <div className="mt-1.5 space-y-1">
                          {st.type === 'prompt' ? (
                            <textarea value={st.prompt || ''} onChange={e => patchStep(i, { prompt: e.target.value })} rows={3}
                              placeholder="给模型的指令，可用 {{input.x}} 与 {{prev.output}}"
                              className="w-full px-2 py-1.5 rounded text-[11px] outline-none resize-y font-mono"
                              style={{ border: `1px solid ${c.border}`, background: c.surfaceCard, color: c.text }} />
                          ) : (
                            <>
                              <input value={st.tool || ''} onChange={e => patchStep(i, { tool: e.target.value })} placeholder="工具名，如 web_fetch"
                                className="w-full px-2 py-1 rounded text-[11px] font-mono outline-none" style={{ border: `1px solid ${c.border}`, background: c.surfaceCard, color: c.text }} />
                              <textarea value={st.args || '{}'} onChange={e => patchStep(i, { args: e.target.value })} rows={2}
                                placeholder='{"url":"{{input.url}}"}'
                                className="w-full px-2 py-1.5 rounded text-[11px] font-mono outline-none resize-y"
                                style={{ border: `1px solid ${c.border}`, background: c.surfaceCard, color: c.text }} />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="text-[10.5px] leading-relaxed" style={{ color: c.textMuted }}>
              占位符：{placeholderHelp.map(p => `${p.code}（${p.desc}）`).join(' · ')}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>取消</button>
              <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30"
                style={{ background: c.textHead, color: c.bg }}>{busy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 运行 */}
      {running && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: c.modalOverlay }} onClick={() => setRunning(null)}>
          <div className="rounded-xl p-5 space-y-3 glass-strong overflow-y-auto scrollbar-thin"
            style={{ width: 620, maxHeight: '86vh', border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold" style={{ color: c.textHead }}>运行：{running.name}</h3>
            {(running.inputs || []).length > 0 && (
              <div className="space-y-1.5">
                {running.inputs.map(inp => (
                  <div key={inp.key}>
                    <div className="text-[11px] mb-0.5" style={{ color: c.textTertiary }}>
                      {inp.label || inp.key}{inp.required ? ' *' : ''}
                    </div>
                    <input value={inputs[inp.key] || ''} onChange={e => setInputs(v => ({ ...v, [inp.key]: e.target.value }))}
                      placeholder={inp.placeholder || inp.default || ''}
                      className="w-full px-3 py-1.5 rounded-lg text-[12.5px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
                  </div>
                ))}
              </div>
            )}
            {msg && <div className="text-[11px]" style={{ color: c.toolErr }}>{msg}</div>}
            {results && (
              <div className="space-y-1.5">
                {results.map(r => (
                  <div key={r.id} className="rounded-lg p-2" style={{ background: c.bgInput }}>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(r.status) }} />
                      <span className="text-[12px] font-medium" style={{ color: c.text }}>{r.title}</span>
                      <span className="text-[10px]" style={{ color: c.textTertiary }}>{r.type === 'prompt' ? '模型' : '工具'}</span>
                      <span className="flex-1" />
                      <span className="text-[10px]" style={{ color: statusColor(r.status) }}>
                        {r.status === 'done' ? '完成' : r.status === 'error' ? '失败' : '跳过'}{r.ms != null ? ` · ${r.ms}ms` : ''}
                      </span>
                    </div>
                    {(r.output || r.error) && (
                      <pre className="mt-1 text-[10.5px] whitespace-pre-wrap break-words max-h-40 overflow-y-auto scrollbar-thin px-2 py-1 rounded"
                        style={{ background: c.surfaceCard, color: r.error ? c.toolErr : c.textSecondary }}>
                        {(r.error || r.output).slice(0, 4000)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setRunning(null)} className="px-4 py-2 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>关闭</button>
              <button onClick={run} disabled={busy} className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30"
                style={{ background: c.accent, color: c.accentText }}>{busy ? '执行中…' : results ? '再运行一次' : '开始运行'}</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
