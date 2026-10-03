import { useState, useEffect, useRef, useCallback } from 'react'
import type { Message, Settings, ToolCall, ToolDef, AttachedFile } from '../types'
import { BUILTIN_TOOLS } from '../types'
import { listMessages, createMessage, updateMessageContent, updateMessageThinking, updateMessageToolCalls, updateMessageSwarm, updateMessageVariants, deleteMessagesAfter } from '../store/storage'
import { streamChat, type StreamCallbacks } from '../engine/stream'
import { executeTool } from '../engine/tools'
import { buildChatSystemPrompt } from '../engine/chatPrompt'
import { runSubagents } from '../engine/subagent'
import { pushNotice } from '../notify'
import { estimateTokens } from '../utils/tokens'
import { addUsage } from '../store/usage'

/** 正在流式输出的消息 ID（null = 没有在输出） */
type StreamingId = string | null

/**
 * 已加载的 Skill 工具缓存
 * 格式: Map<skillName, ToolDef[]>
 */
const loadedSkills = new Map<string, ToolDef[]>()

// ─── 集群生产力：团队模板 + 敏感操作拦截 ───
export type SwarmTeam = 'auto' | 'writing' | 'dev' | 'research' | 'employees'
import { loadEmployees, type Employee } from '../../shared/employees'

export const SWARM_TEAMS: Record<Exclude<SwarmTeam, 'auto'>, { name: string; agents: { name: string; role: string; task: (topic: string) => string }[] }> = {
  // employees 走 loadEmployees 的专门分支（见下方 team === 'employees'），此处占位保持类型完整
  employees: { name: '员工集群', agents: [] },
  writing: {
    name: '写作团队',
    agents: [
      { name: '研究员', role: '素材与结构', task: (t) => `调研与「${t}」相关的素材、要点，规划文章结构与论据清单` },
      { name: '撰写者', role: '起草全文', task: (t) => `基于素材与结构，撰写「${t}」的完整初稿并保存到工作区` },
      { name: '审校员', role: '润色校对', task: (t) => `审校「${t}」初稿：修正逻辑、润色语言、校对事实，输出终稿建议` },
    ],
  },
  dev: {
    name: '开发团队',
    agents: [
      { name: '架构师', role: '设计与规划', task: (t) => `为「${t}」设计技术方案与文件结构，在工作区输出设计文档` },
      { name: '实现者', role: '编写代码', task: (t) => `按设计方案实现「${t}」的核心代码，文件保存到工作区` },
      { name: '测试者', role: '运行验证', task: (t) => `运行/检查「${t}」的实现，修复问题并输出验证报告` },
    ],
  },
  research: {
    name: '研究团队',
    agents: [
      { name: '资料员', role: '收集资料', task: (t) => `围绕「${t}」收集关键资料与数据，在工作区整理成 notes.md` },
      { name: '分析员', role: '归纳分析', task: (t) => `基于资料分析「${t}」的要点、趋势与结论，输出分析笔记` },
      { name: '报告员', role: '成稿汇报', task: (t) => `整合分析结果，输出「${t}」的完整研究报告并保存` },
    ],
  },
}

// 敏感操作：删除文件 / 高危命令在集群模式下默认拦截
function isSensitiveTool(name: string | undefined, args: any): string | null {
  if (name === 'delete_file') return '删除文件'
  if (name === 'shell') {
    const cmd = String(args?.command || '').toLowerCase()
    if (/rm\s+-rf|del\s+\/f|rd\s+\/s|format\s+[a-z]:|shutdown|diskpart|mkfs/.test(cmd)) return '高危命令'
  }
  if (name === 'move_file') return null
  return null
}

// ─── 上下文自动压缩 ───
// 每个会话的历史摘要（内存缓存 + /api/memories 持久化，跨重启有效）
const ctxSummaries = new Map<string, string>()
const COMPRESS_TOKEN_THRESHOLD = 40000  // 估算超过 40K tokens 触发压缩
const COMPRESS_MSG_THRESHOLD = 40       // 或消息数超过 40 条
const KEEP_RECENT = 10                  // 压缩时保留最近 10 条原文

async function loadCtxSummary(sid: string): Promise<string> {
  if (ctxSummaries.has(sid)) return ctxSummaries.get(sid)!
  try {
    const res = await fetch('/api/ctx-summary')
    if (res.ok) {
      const map = await res.json()
      const hit = (map && typeof map === 'object' && !Array.isArray(map)) ? map[sid] : null
      if (hit) { ctxSummaries.set(sid, String(hit)); return String(hit) }
    }
  } catch { /* ignore */ }
  return ''
}

export { ctxSummaries }

export function useChat(sessionId: string | null, settings: Settings, onFirstMessageDone?: (userContent: string) => void, onAiTitle?: (sid: string, title: string) => void) {
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingId, setStreamingId] = useState<StreamingId>(null)
  const streamingRef = useRef<StreamingId>(null)  // ref avoids stale closure in send
  streamingRef.current = streamingId
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const titleDoneRef = useRef(false)
  const onFirstMessageDoneRef = useRef(onFirstMessageDone)
  onFirstMessageDoneRef.current = onFirstMessageDone
  const onAiTitleRef = useRef(onAiTitle)
  onAiTitleRef.current = onAiTitle
  // Track the last user message content for re-send after rollback
  const lastUserContentRef = useRef<string>('')
  const lastSkillIdsRef = useRef<string[] | undefined>(undefined)
  // 消息分支：重新生成时把旧回答暂存于此，流结束后归档进新消息的 variants
  const pendingVariantRef = useRef<string[] | null>(null)

  // AI 自动生成对话标题（轻量请求，失败时静默保留截断标题；设置中可关闭）
  const generateAiTitle = useCallback(async (sid: string, userContent: string, assistantExcerpt: string) => {
    try {
      if ((settings as any)?.autoTitle === false) return
      const res = await fetch('/api/llm-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Target-Base': settings.apiBaseUrl,
          'X-Api-Key': settings.apiKey || '',
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: '你是对话标题生成器。根据对话内容生成一个简洁准确的标题：不超过10个字，概括对话主题。直接输出标题本身，不要引号、句号或任何解释。' },
            { role: 'user', content: `用户：${userContent.slice(0, 300)}${assistantExcerpt ? `\n\n助手：${assistantExcerpt.slice(0, 200)}` : ''}` },
          ],
          max_tokens: 2000,
          stream: false,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      const msg = data.choices?.[0]?.message || {}
      // 推理模型（如 step 系列）思考会吃掉 max_tokens，content 可能为空 → 回退从 reasoning 提取
      let title = (msg.content || '').trim()
      if (!title && msg.reasoning_content) {
        const rc = String(msg.reasoning_content)
        const m = rc.match(/[「『"']([^」』"']{2,20})[」』"']/) || rc.match(/(?:标题|题目|可以?[叫称])(?:是|为|用)[:：]?\s*([^\n，。,.]{2,20})/)
        if (m) title = m[1].trim()
        else {
          const ls = rc.split('\n').map((l) => l.replace(/^[#*>\-`\s]+/, '').trim()).filter(Boolean)
          title = (ls[ls.length - 1] || '').slice(0, 20).trim()
        }
      }
      title = title.replace(/^["'「『《]+|["'」』》。.\s]+$/g, '').split('\n')[0].slice(0, 20)
      if (title) onAiTitleRef.current?.(sid, title)
    } catch { /* 标题生成失败不影响主流程 */ }
  }, [settings.apiBaseUrl, settings.apiKey, settings.model])

  const loadMessages = useCallback(async () => {
    if (!sessionId) return
    const msgs = await listMessages(sessionId)
    setMessages(msgs)
  }, [sessionId])

  useEffect(() => { loadMessages() }, [sessionId])

  // ─── Agent 集群：分解 → 顺次执行（带工具）→ 主 Agent 汇报 ───
  const runAgentSwarm = useCallback(async (mid: string, task: string, apiMessages: any[], signal?: AbortSignal, team?: SwarmTeam): Promise<string> => {
    const workDir = settings.workDir || ''
    const targetBase = settings.provider === 'local' ? 'http://localhost:1234/v1' : settings.apiBaseUrl
    const targetKey = settings.provider === 'local' ? 'lm-studio' : (settings.apiKey || '')
    // OpenAI 格式工具定义（agent 可调用全部内置工具）
    const toolDefs = BUILTIN_TOOLS.map((t: any) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))

    const patchSwarm = (swarm: any) => setMessages(prev => prev.map(m => m.id === mid ? { ...m, swarm } : m))
    // swarm 状态对象：提升到函数顶层作用域，runAgent 内部才能引用（此前 const 声明在 try 块内导致 "swarm is not defined"）
    let swarm: any = { phase: '正在组建集群…', agents: [] }

    // 单个 agent：带工具循环（最多 5 轮），知道工作区
    const runAgent = async (ag: any, priorOutputs: string, task: string): Promise<string> => {
      let didWork = false
      let calledAnyTool = false
      const roster = (swarm.plan || swarm.agents || []).map((p: any) => p.name + (p.role ? `(${p.role})` : '')).join('、')
      const msgs: any[] = [
        {
          role: 'system',
          content: (ag.systemPrompt ? ag.systemPrompt + '\n\n' : '') + `你是集群中的 agent「${ag.name}」，职责：${ag.role}。全程使用中文。
当前工作区目录：${workDir || '未指定（请使用绝对路径）'}。注意：write_file 的 path 参数只放文件路径本身，不要把本提示文字当作路径。
${priorOutputs ? `前面 agent 已完成的工作（可基于它们继续）：${priorOutputs.slice(0, 3000)}` : '你是第一个执行的 agent。'}
你有完整的工具可用：read_file / write_file / edit_file / shell / list_dir / search_files 等。
【分工边界】你只负责上面分配给你的子任务，不要替其他 agent 完成他们的工作。如果该部分已被前面 agent 完成，你只需要检查/验证并报告，不要重复执行。
【硬性要求】你必须实际调用至少一次工具（write_file / edit_file / shell 等）来完成任务：真实创建/修改文件、执行命令。只输出思考或文字总结而不调用工具，视为任务未完成，会被判定为失败。
【接力】你可以在输出中用 @同事名 把下一步点名交给班表里的其他成员。当前班表：${roster || '仅你一人'}。点名格式示例：@开发 请实现登录接口。被点名的成员会接着你的产出继续。`,
        },
        ...apiMessages.slice(-4).filter((m: any) => m.role === 'user' || m.role === 'assistant').map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 400) : '' })),
        { role: 'user', content: `总任务：${task.slice(0, 800)}。你的子任务：${ag.task}。完成后输出执行结果总结（供下一个 agent 和主 Agent 参考），不要思考过程。` },
      ]
      // 工具循环
      for (let round = 0; round < 5; round++) {
        if (signal?.aborted) throw new Error('已停止')
        const res = await fetch('/api/llm-proxy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Target-Base': targetBase,
            'X-Api-Key': targetKey,
            ...(workDir ? { 'X-Work-Dir': encodeURIComponent(workDir) } : {}),
          },
          body: JSON.stringify({
            model: settings.model,
            messages: msgs,
            tools: toolDefs,
            tool_choice: 'auto',
            stream: false,
          }),
          signal,
        })
        if (!res.ok) throw new Error(`LLM ${res.status}`)
        const data = await res.json()
        const msg = data.choices?.[0]?.message
        if (!msg) throw new Error('空响应')
        // 记录思考过程（展示用，不回传模型；本地 UI 即时更新，DB 按 agent 落库）
        if (msg.reasoning_content) {
          ag.messages = [...(ag.messages || []), { role: 'thinking', content: msg.reasoning_content }].slice(-10)
          patchSwarm(swarm)
        }
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          calledAnyTool = true
          msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })
          for (const tc of msg.tool_calls) {
            let args: any = {}
            try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
            // 敏感操作拦截（设置可关闭）：删除文件 / 高危命令不允许集群自主执行
            const blocked = settings.sensitiveBlock !== false ? isSensitiveTool(tc.function?.name, args) : null
            let content: string
            if (blocked) {
              content = `【安全拦截】该操作（${blocked}）在集群模式下被拦截，请改用非破坏性方案。`
            } else {
              const r = await executeTool({ name: tc.function?.name, args }, workDir || undefined)
              if (r.success) didWork = true
              content = (r.success ? r.output : `错误: ${r.error}`).slice(0, 3000)
            }
            msgs.push({ role: 'tool', tool_call_id: tc.id, content })
            ag.messages = [...(ag.messages || []), { role: 'tool', tool_call_id: tc.id, content }].slice(-10)
          }
          ag.messages = [...(ag.messages || []), { role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls }].slice(-10)
          patchSwarm(swarm)
          continue
        }
        if (msg.content) didWork = true
        // 还没有实际调用过任何工具 → 推一把，让它真正动手，而不是只输出文字宣称完成
        if (!calledAnyTool && round < 3) {
          msgs.push({
            role: 'user',
            content: '你还没有调用任何工具！任务要求实际执行：请立即选择最合适的工具（write_file / edit_file / shell / list_dir / read_file / search_files 等）调用一次，完成真实操作，而不是只输出文字。现在调用工具。',
          })
          ag.messages = [...(ag.messages || []), { role: 'assistant', content: msg.content || '' }].slice(-10)
          patchSwarm(swarm)
          continue
        }
        const text = (msg.content || '').trim() || '（无输出）'
        const noToolNote = calledAnyTool ? '' : '\n\n（注意：本 agent 全程未实际调用工具，输出仅为文字）'
        ag.messages = [...(ag.messages || []), { role: 'assistant', content: msg.content || '' }].slice(-10)
        patchSwarm(swarm)
        return text + noToolNote
      }
      return calledAnyTool ? '（达到工具调用轮次上限，输出当前进度）' : '（多次尝试后仍未调用工具，未能实际执行）'
    }

    try {
      // 阶段 1：任务分解（顺次流水线，前一个的产出供后一个使用）
      patchSwarm({ phase: '正在组建集群…', agents: [] })
      let plan: any[] = []
      // 指定了团队模板 → 直接用预设阵容（跳过 LLM 分解，分工稳定可靠）
      if (team === 'employees') {
        // 自定义员工团队：按花名册顺序开班，动态 @ 接力
        const empList = loadEmployees()
        plan = empList.map((e: Employee) => ({ name: e.name, role: e.role, task: `按你的职责参与「${task.slice(0, 60)}」，判断是否该你出力；若轮不到你就在输出中简短说明并 @ 下一位。`, systemPrompt: e.prompt, employeeId: e.id }))
      } else if (team && team !== 'auto' && SWARM_TEAMS[team]) {
        const topic = (task as string).slice(0, 60)
        plan = SWARM_TEAMS[team].agents.map((a: any) => ({ name: a.name, role: a.role, task: a.task(topic) }))
      } else {
      let raw = ''
      try {
        const res = await fetch('/api/llm-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Target-Base': targetBase, 'X-Api-Key': targetKey },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              { role: 'system', content: '你是任务调度器。用户任务将由多个 agent 按顺序组成的流水线完成（前一个 agent 的产出作为后一个的输入），每个 agent 都能调用工具读写文件和执行命令。把任务拆解为 3-5 个按执行顺序衔接的子任务，第一个通常是调研/规划，中间是实际执行，最后是检查/整合。只输出 JSON 数组本身，禁止输出思考过程、解释或 markdown 代码块。格式：[{"name":"agent名(2-4个字)","role":"职责(10字内)","task":"子任务描述(40字内)"}]' },
              { role: 'user', content: task.slice(0, 1500) },
            ],
            max_tokens: 700,
            stream: false,
          }),
          signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        raw = (data.choices?.[0]?.message?.content || '').trim()
      } catch { raw = '' }
      const s = raw.indexOf('['); const e = raw.lastIndexOf(']')
      try { plan = JSON.parse(raw.slice(s, e + 1)) } catch { plan = [] }
      // 分解失败或不足 2 个时，使用标准流水线兜底（保证真实分工）
      if (!Array.isArray(plan) || plan.length < 2) {
        const topic = task.slice(0, 60)
        plan = [
          { name: '研究员', role: '调研与规划', task: `调研与「${topic}」相关的背景、关键要点，在工作区创建 notes.md 记录研究结论和执行计划` },
          { name: '实现者', role: '实际执行', task: `基于研究员的结论，实际完成任务「${topic}」的核心工作（创建/修改文件或执行命令），产物保存到工作区` },
          { name: '审校员', role: '检查与整合', task: `检查工作区内已产出的文件与内容质量，修正问题并输出最终整合结论` },
        ]
      }
      plan = plan.slice(0, 5)
      }

      const planById = plan.map((p: any, i: number) => ({ ...p, name: p.name || `agent${i + 1}` }))
      swarm = {
        phase: team === 'employees' ? '员工集群 · 顺次执行中（可 @ 接管任务）' : 'agents 顺次执行中',
        plan: planById,
        agents: planById.map((p: any, i: number) => ({ name: p.name, role: p.role || '', task: p.task || '', status: i === 0 ? 'running' : 'pending', output: '', messages: [], systemPrompt: p.systemPrompt, employeeId: p.employeeId })),
      }
      patchSwarm(swarm)
      updateMessageSwarm(mid, sessionId || '', swarm).catch(() => {})

      // 阶段 2：顺次执行（前一个的产出作为后一个的输入上下文）
      const priorOutputs: string[] = []
      const queue: any[] = [...swarm.agents]
      const finished = new Set<string>()
      for (let qi = 0; qi < queue.length; qi++) {
        const ag = queue[qi]
        if (signal?.aborted) break
        if (finished.has(ag.name)) continue
        finished.add(ag.name)
        ag.status = 'running'
        patchSwarm(swarm)
        try {
          const prior = priorOutputs.length > 0 ? priorOutputs.join('\n\n') : ''
          const out = await runAgent(ag, prior, task)
          // @ 接力：输出中点名了尚未出场的成员 → 把他排到下一位
          try {
            const mentions = [...String(out || '').matchAll(/@([\u4e00-\u9fa5A-Za-z\w]{1,8})/g)].map(m => m[1])
            for (const m of mentions) {
              const target = swarm.agents.find((a: any) => a.name === m && !finished.has(a.name))
              if (target) {
                const ti = queue.findIndex((x: any) => x.name === m)
                if (ti >= 0) queue.splice(ti, 1)
                queue.splice(qi + 1, 0, target)
              }
            }
          } catch { /* 解析失败不影响主流程 */ }
          // 反应时间：让"执行中"状态有可见时长，避免瞬间跳变
          await new Promise((r) => setTimeout(r, 700))
          ag.status = 'done'
          ag.output = out || '（完成，无文字总结）'
          priorOutputs.push(`【${ag.name}】${out || '（完成）'}`)
        } catch (e: any) {
          if (signal?.aborted) {
            ag.status = 'pending'
            ag.output = ag.output || '（已停止）'
            break
          }
          // 有实际产出（工具已成功执行/已有回复）→ 记成功但标注中断；纯失败才标红
          if (ag.messages && ag.messages.length > 0) {
            await new Promise((r) => setTimeout(r, 700))
            ag.status = 'done'
            const partial = ag.output || '（已产出部分结果）'
            ag.output = `${partial}\n\n（注意：后续步骤中断：${e.message}）`
            priorOutputs.push(`【${ag.name}】${partial}`)
          } else {
            ag.status = 'error'
            ag.output = `失败: ${e.message}`
            priorOutputs.push(`【${ag.name}】(失败) ${e.message}`)
          }
        }
        patchSwarm(swarm)
        updateMessageSwarm(mid, sessionId || '', swarm).catch(() => {})
      }
      if (signal?.aborted) {
        swarm.phase = '已停止'
        patchSwarm(swarm)
        updateMessageSwarm(mid, sessionId || '', swarm).catch(() => {})
        return swarm.agents.map((ag: any) => `【${ag.name}】${ag.output || '（未执行）'}`).join('\n\n')
      }

      // 阶段 3：主 Agent 汇报成果
      swarm.phase = '主 Agent 汇报中…'
      patchSwarm(swarm)
      const merged = swarm.agents.map((ag: any) => `【${ag.name}（${ag.role}）】${ag.status === 'error' ? '(失败) ' : ''}${ag.output}`).join('\n\n')
      let final = ''
      try {
        const res = await fetch('/api/llm-proxy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Target-Base': targetBase,
            'X-Api-Key': targetKey,
            ...(workDir ? { 'X-Work-Dir': encodeURIComponent(workDir) } : {}),
          },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              { role: 'system', content: `你是主 Agent（集群协调者），负责向用户汇报集群工作成果。全程使用中文。各 agent 按流水线顺次完成了任务，工作区目录：${workDir || '系统默认'}。请合并所有 agent 的产出，输出一份连贯、直接、可执行的最终汇报：说明完成了什么、产出了哪些文件（如有，列出路径）、关键结论与后续建议。直接输出汇报本身，不要思考过程。` },
              { role: 'user', content: `总任务：${task.slice(0, 800)}\n\n${merged}` },
            ],
            stream: false,
          }),
          signal,
        })
        if (res.ok) {
          const data = await res.json()
          final = (data.choices?.[0]?.message?.content || '').trim()
        }
      } catch { /* 汇总失败用原始合并 */ }
      if (!final) final = merged
      swarm.phase = 'done'
      pushNotice({ type: 'swarm', title: '集群任务完成', body: (task || '').slice(0, 60) })
      patchSwarm(swarm)
      updateMessageSwarm(mid, sessionId || '', swarm).catch(() => {})
      return final
    } catch (e: any) {
      return `集群执行失败: ${e.message}`
    }
  }, [settings, sessionId])

  /**
   * 加载 Skill 的工具定义并缓存
   */
  const loadSkillTools = useCallback(async (skillName: string): Promise<ToolDef[]> => {
    if (loadedSkills.has(skillName)) return loadedSkills.get(skillName)!
    
    try {
      const result = await executeTool({ name: 'load_skill', args: { name: skillName } })
      if (!result.success || !result.output) return []
      
      const data = JSON.parse(result.output)
      const tools: ToolDef[] = (data.tools || []).map((t: any) => ({
        name: t.name,
        description: `[${skillName}] ${t.description}`,
        parameters: t.parameters,
      }))
      
      if (tools.length > 0) loadedSkills.set(skillName, tools)
      return tools
    } catch {
      return []
    }
  }, [])

  // 消息分支：把重新生成前的旧回答归档为新消息的 variants（一次性）
  const flushPendingVariants = useCallback(async (assistantMsgId: string) => {
    const pv = pendingVariantRef.current
    if (!pv || pv.length === 0) return
    pendingVariantRef.current = null
    try { await updateMessageVariants(assistantMsgId, sessionId!, pv) } catch { /* 分支归档失败不影响主流程 */ }
  }, [sessionId])

  const send = useCallback(async (content: string, selectedSkillIds?: string[], attachedFiles?: AttachedFile[], sendOpts?: { accessLevel?: string; thinking?: string; swarm?: boolean; team?: any; chatMode?: 'general' | 'coding'; kb?: boolean }) => {    if (!sessionId || streamingRef.current !== null) return
    setError(null)

    // Store for potential rollback
    lastUserContentRef.current = content
    lastSkillIdsRef.current = selectedSkillIds

    // 构建附加文件上下文
    let userContent = content
    if (attachedFiles && attachedFiles.length > 0) {
      // 有磁盘路径的给 file:// 链接；截图等 dataUrl 附件只列名字（内容已作为 image_url 随请求发送）
      const lines: string[] = []
      for (const f of attachedFiles) {
        if (f.dataUrl) lines.push(`- ${f.name}（图片，已随消息发送）`)
        else if (f.path) lines.push(`- [${f.name}](file://${f.path})`)
        else lines.push(`- ${f.name}`)
      }
      userContent = `${content}\n\n--- 附加文件 ---\n${lines.join('\n')}`
    }

    // 保存用户消息
    await createMessage({ session_id: sessionId, role: 'user', content: userContent })
    const updated = await listMessages(sessionId)
    setMessages(updated)
    // 自动标题：仅首条消息时立即生成（避免后续消息不断改写标题）
    if (!titleDoneRef.current) {
      titleDoneRef.current = true
      generateAiTitle(sessionId, content, '')
    }

    // 创建助手占位消息
    const assistantMsg = await createMessage({ 
      session_id: sessionId, 
      role: 'assistant', 
      content: '',
      tool_calls: [],
    })

    setStreamingId(assistantMsg.id)
    setMessages([...updated, assistantMsg])

    // 构建 API 消息历史（系统提示词：通用 / Coding 双模式，随输入框开关切换）
    const chatMode = sendOpts?.chatMode === 'coding' ? 'coding' : 'general'
    const workDir = settings.workDir || ''
    const systemPrompt = chatMode === 'coding'
      ? `你是一个专业的编程助手，正在用户的本机环境中工作。\n\n【工作目录边界 — 最高优先级】\n- 用户项目目录（你的合法工作区）：${workDir || '未指定（使用系统默认）'}\n- 所有文件操作与命令执行限制在该目录内，禁止越界。\n\n你拥有完整工具能力：读/写/改文件、列目录、搜索、执行命令、联网搜索等。\n\n规则：\n1. 先读代码再改代码：修改前用 read_file 确认上下文，不确定就 list_dir/search\n2. 修改用 edit_file 精准替换，新文件用 write_file，并简要说明改动理由\n3. 回答简洁、直击要点，代码块标注语言；避免长篇大论\n4. 命令执行优先 shell 工具；破坏性操作（删除/覆盖）先说明风险\n5. 报错排查：先分析根因再给修复，不要猜测性乱改`
      : buildChatSystemPrompt(settings)

    // 本条消息的权限等级 / 思考程度（随时切换，仅影响当前请求）
    const accessText: Record<string, string> = {
      ask: '【本次权限：需要我确认】执行任何写文件、删文件、移动文件或终端命令前，必须先用一句话说明将要做什么并等待用户明确确认；未经确认不得执行任何有副作用的操作。',
      edit: '【本次权限：可以编辑】可自由读取、创建、修改文件并执行常规命令；但删除文件等不可逆操作前需征得用户确认。',
      full: '【本次权限：完全访问】无需逐步确认，直接自主完成任务。',
    }
    const thinkText: Record<string, string> = {
      none: '【思考程度：关闭】直接作答，不要长篇推理，回答尽量简短。',
      low: '【思考程度：低】简短思考后作答。',
      medium: '【思考程度：中】适度思考后作答。',
      high: '【思考程度：高】深入思考、考虑多种方案后作答。',
      max: '【思考程度：最大】进行最深入、最全面的思考，穷举关键细节后再作答。',
    }
    const perMsg = [accessText[sendOpts?.accessLevel || ''], thinkText[sendOpts?.thinking || '']].filter(Boolean).join('\n')
    let finalSystemPrompt = perMsg ? `${systemPrompt}\n\n${perMsg}` : systemPrompt
    // ─── 知识库引用（RAG）：仅当本条开启「知识库」开关时检索注入 ───
    if (sendOpts?.kb) try {
      const kbRes = await fetch('/api/kb/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: content.slice(0, 500), topK: 4 }),
      })
      if (kbRes.ok) {
        const kd = await kbRes.json()
        const hits = (kd?.hits || []).filter((h: any) => h.score > 0.35)
        if (hits.length > 0) {
          const srcLabel = (h: any) => String(h.path).startsWith('entry:') ? String(h.chunk || '').split('\n')[0].slice(0, 24) : String(h.path).split('/').pop()
          const refs = hits.map((h: any, i: number) => `[${i + 1}] 《${srcLabel(h)}》\n${String(h.chunk).slice(0, 600)}`).join('\n---\n')
          finalSystemPrompt += `\n\n【知识库参考 — 来自用户的知识库，回答时优先依据】\n${refs}`
        }
      }
    } catch { /* 知识库不可用则跳过 */ }
    let apiMessages: any[] = [
      { role: 'system', content: finalSystemPrompt },
      ...updated.filter(m => m.role !== 'system').map(m => {
        const base: any = { role: m.role }
        if (m.content) base.content = m.content
        if (m.tool_calls && m.tool_calls.length > 0) {
          base.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          }))
        }
        if (m.tool_call_id) base.tool_call_id = m.tool_call_id
        return base
      })
    ];

    // ─── 多模态：提供商开启时，把附件图片转为 base64 内容块（最多 4 张） ───
    if ((settings as any).multimodal && attachedFiles && attachedFiles.length > 0) {
      try {
        const imgs = attachedFiles.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f.name)).slice(0, 4)
        if (imgs.length > 0) {
          const imageParts: { type: string; image_url: { url: string } }[] = []
          for (const f of imgs) {
            // ① 直接携带的 dataUrl（截图提问）
            if (f.dataUrl) { imageParts.push({ type: 'image_url', image_url: { url: f.dataUrl } }); continue }
            // ② 原生 File（网页文件选择器）：前端转 base64
            if (f.file) {
              try {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const fr = new FileReader()
                  fr.onload = () => resolve(String(fr.result || ''))
                  fr.onerror = reject
                  fr.readAsDataURL(f.file!)
                })
                if (dataUrl.startsWith('data:image/')) { imageParts.push({ type: 'image_url', image_url: { url: dataUrl } }); continue }
              } catch { /* 失败走路径读取 */ }
            }
            // ③ 磁盘路径 → 后端读 base64
            if (f.path) {
              const r = await fetch(`/api/file-base64?path=${encodeURIComponent(f.path)}`)
              if (r.ok) {
                const d = await r.json()
                if (d?.data) imageParts.push({ type: 'image_url', image_url: { url: `data:${d.mime};base64,${d.data}` } })
              }
            }
          }
          if (imageParts.length > 0) {
            const lastUser = [...apiMessages].reverse().find(m => m.role === 'user')
            if (lastUser) {
              lastUser.content = [{ type: 'text', text: String(lastUser.content || '') }, ...imageParts]
            }
          }
        }
      } catch { /* 图片加载失败则按纯文本发送 */ }
    }

    // ─── 上下文自动压缩：超过阈值时，把较早的历史折叠成 AI 摘要 ───
    {
      const estTokens = apiMessages.reduce((s, m) => s + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')) + estimateTokens(m.tool_calls ? JSON.stringify(m.tool_calls) : ''), 0)
      const historyCount = apiMessages.length - 1
      if (estTokens > COMPRESS_TOKEN_THRESHOLD || historyCount > COMPRESS_MSG_THRESHOLD) {
        const oldChunk = apiMessages.slice(1, Math.max(1, apiMessages.length - KEEP_RECENT))
        const recent = apiMessages.slice(-KEEP_RECENT)
        let summary = await loadCtxSummary(sessionId)
        if (oldChunk.length > 0) {
          try {
            const res = await fetch('/api/llm-proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Target-Base': settings.apiBaseUrl, 'X-Api-Key': settings.apiKey || '' },
              body: JSON.stringify({
                model: settings.model,
                messages: [
                  { role: 'system', content: '你是对话压缩器。把提供的历史对话压缩成一份要点式摘要（400字以内），保留：用户的核心需求与偏好、已完成的操作与结果、重要文件路径/命令/数据、未完成的事项。直接输出摘要本身。' },
                  { role: 'user', content: oldChunk.map(m => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '工具'}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : JSON.stringify(m).slice(0, 400)}`).join('\n') },
                ],
                max_tokens: 3000,
                stream: false,
              }),
            })
            if (res.ok) {
              const data = await res.json()
              const cm = data.choices?.[0]?.message || {}
              const extra = ((cm.content || '') || String(cm.reasoning_content || '').split('\n').slice(-1)[0] || '').trim()
              if (extra) {
                summary = summary ? `${summary}\n${extra}` : extra
                ctxSummaries.set(sessionId, summary)
                fetch('/api/ctx-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sessionId, value: summary }) }).catch(() => {})
              }
            }
          } catch { /* 压缩失败则不压缩，照常发送 */ }
        }
        if (summary) {
          apiMessages = [
            { role: 'system', content: finalSystemPrompt },
            { role: 'system', content: `【历史对话摘要 — 早前 ${oldChunk.length} 条消息已压缩】\n${summary}` },
            ...recent,
          ]
        }
      }
    }

    // 收集 Skill 工具：如果指定了 selectedSkillIds，只加载选中的；否则加载全部已缓存
    const extraTools: ToolDef[] = []
    if (selectedSkillIds && selectedSkillIds.length > 0) {
      // 仅加载用户选中的 Skill 工具
      for (const skillName of selectedSkillIds) {
        const tools = await loadSkillTools(skillName)
        extraTools.push(...tools)
      }
    } else {
      // 未选择时加载全部已缓存 Skill 工具
      for (const [, tools] of loadedSkills) {
        extraTools.push(...tools)
      }
    }

    // ─── MCP 外部工具（v5.0，学自 Zode 的可插拔工具生态）───
    try {
      const mcpRes = await fetch('/api/mcp/tools')
      if (mcpRes.ok) {
        const mcpData = await mcpRes.json()
        for (const t of (mcpData.tools || [])) {
          extraTools.push({ name: t.name, description: t.description, parameters: t.parameters })
        }
      }
    } catch { /* MCP 不可用时静默跳过 */ }

    // ─── Agent 集群模式：拆解→顺次→主 Agent 汇报，不走单模型流式 ───
    if (sendOpts?.swarm) {
      const swarmCtrl = new AbortController()
      abortRef.current = swarmCtrl
      setStreamingId(assistantMsg.id) // 锁定输入：集群运行期间禁止再发消息，避免多集群互相干扰
      const final = await runAgentSwarm(assistantMsg.id, userContent, apiMessages, swarmCtrl.signal, sendOpts?.team)
      await updateMessageContent(assistantMsg.id, sessionId, final)
      await flushPendingVariants(assistantMsg.id)
      addUsage(settings.model, estimateTokens(userContent) * 3, estimateTokens(final))
      setStreamingId(null)
      setMessages(await listMessages(sessionId))
      abortRef.current = null
      return
    }


    let fullContent = ''
    let fullThinking = ''
    const allToolCalls: ToolCall[] = []

    // ─── 流式渲染节流：chunk 先入缓冲，50ms 批量刷新，避免每 token 全列表重渲染 ───
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleFlush = () => {
      if (flushTimer) return
      flushTimer = setTimeout(() => {
        flushTimer = null
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id ? { ...m, content: fullContent, thinking: fullThinking || (m as any).thinking } : m
        ))
      }, 50)
    }

    const callbacks: StreamCallbacks = {
      onChunk: (delta) => {
        fullContent += delta
        scheduleFlush()
      },

      onThinking: (delta) => {
        fullThinking += delta
        scheduleFlush()
      },

      onToolStart: (toolCall) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, tool_calls: [...(m.tool_calls || []), { ...toolCall, status: 'running' as const }] }
            : m
        ))
        
        // 如果 AI 调用了 load_skill，动态加载该 skill 的工具
        if (toolCall.name === 'load_skill') {
          try {
            const args = JSON.parse(toolCall.arguments || '{}')
            loadSkillTools(args.name).then(tools => {
              if (tools.length > 0) {
                console.log(`[Skill] 已加载 ${args.name}: ${tools.length} 个工具`)
              }
            })
          } catch {}
        }
      },

      onToolEnd: (toolCall) => {
        allToolCalls.push(toolCall)
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? {
                ...m,
                tool_calls: (m.tool_calls || []).map(t =>
                  t.id === toolCall.id ? toolCall : t
                ),
              }
            : m
        ))
      },

      onDone: async (_full, _toolCalls) => {
        await updateMessageContent(assistantMsg.id, sessionId, fullContent)
        await flushPendingVariants(assistantMsg.id)
        if (fullThinking) {
          await updateMessageThinking(assistantMsg.id, sessionId, fullThinking)
        }
        if (allToolCalls.length > 0) {
          await updateMessageToolCalls(assistantMsg.id, sessionId, allToolCalls)
        }
        // 用量统计
        addUsage(settings.model, sentPromptTokens, estimateTokens(fullContent) + estimateTokens(fullThinking))
        // 回复完成系统通知（设置开启且窗口在后台时）
        try {
          if ((settings as any)?.notifyDone && document.hidden && typeof Notification !== 'undefined') {
            if (Notification.permission === 'granted') {
              new Notification('巨天agent', { body: '回复已完成，回来看看吧' })
            } else if (Notification.permission !== 'denied') {
              Notification.requestPermission().then(p => { if (p === 'granted') new Notification('巨天agent', { body: '回复已完成，回来看看吧' }) }).catch(() => {})
            }
          }
        } catch { /* ignore */ }
        setStreamingId(null)
        const msgs = await listMessages(sessionId)
        setMessages(msgs)
        // 自动朗读（设置开启时）：念 AI 的最终回复
        try {
          if ((settings as any)?.autoSpeak && fullContent.trim()) {
            const spoken = fullContent.replace(/```[\s\S]*?```/g, '（代码已省略）').replace(/[*_#>`|]/g, '').slice(0, 1500)
            let voice = 'zh-CN-XiaoxiaoNeural'
            let speed = '1.0'
            try { const raw = localStorage.getItem('lyclaw_settings'); if (raw) { const ls = JSON.parse(raw); voice = ls.voiceId || voice; speed = ls.ttsSpeed || speed } } catch {}
            fetch('/api/edge-tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: spoken, voice, speed: Number(speed) || 1.0 }) })
              .then(r => { if (!r.ok) throw new Error(); return r.blob() })
              .then(b => { new Audio(URL.createObjectURL(b)).play().catch(() => {}) })
              .catch(() => {})
          }
        } catch { /* ignore */ }
        // 首次对话完成后生成标题：先截断兜底，AI 标题随后替换
        const userMsgs = msgs.filter(m => m.role === 'user')
        if (userMsgs.length === 1 && onFirstMessageDoneRef.current) {
          const firstUserContent = String(userMsgs[0].content || '')
          onFirstMessageDoneRef.current(firstUserContent)
          generateAiTitle(sessionId, firstUserContent, fullContent)
        }
      },

      onClientTool: async (tc) => {
        if (tc.name !== 'dispatch_subagents') return '{"ok":false,"error":"unknown"}'
        try {
          const args = JSON.parse(tc.arguments || '{}')
          return await runSubagents({ agents: args.agents || [], settings, signal: controller.signal })
        } catch (e: any) {
          return JSON.stringify({ ok: false, error: String(e?.message || e) })
        }
      },

      onError: async (err) => {
        console.warn('[stream error]', err)
        // 保存已累积的部分内容和工具调用
        await updateMessageContent(assistantMsg.id, sessionId, fullContent || `错误: ${err}`)
        if (fullThinking) {
          await updateMessageThinking(assistantMsg.id, sessionId, fullThinking)
        }
        if (allToolCalls.length > 0) {
          await updateMessageToolCalls(assistantMsg.id, sessionId, allToolCalls)
        }
        setStreamingId(null)
        setMessages(await listMessages(sessionId))
      },
    }

    const controller = new AbortController()
    abortRef.current = controller

    // 记录本次请求的输入规模（含工具定义）供用量统计
    const sentPromptTokens = apiMessages.reduce((s, m) => s + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')) + estimateTokens(m.tool_calls ? JSON.stringify(m.tool_calls) : ''), 0)

    try {
      await streamChat(settings, apiMessages, callbacks, controller.signal, extraTools)
    } finally {
      // 如果被中止，手动清理流状态（stream.ts 吞掉 AbortError 不会触发 onDone）
      if (controller.signal.aborted) {
        await updateMessageContent(assistantMsg.id, sessionId, fullContent || '(已中止)')
        if (allToolCalls.length > 0) {
          await updateMessageToolCalls(assistantMsg.id, sessionId, allToolCalls)
        }
        setStreamingId(null)
        setMessages(await listMessages(sessionId))
      }
      abortRef.current = null
    }
  }, [sessionId, settings, loadSkillTools, generateAiTitle, runAgentSwarm])

  const rollbackTo = useCallback(async (messageIndex: number) => {
    if (!sessionId) return
    const targetMsg = messages[messageIndex]
    if (!targetMsg || targetMsg.role !== 'user') return

    // 删除目标消息之后的所有消息（包括目标消息之后的 assistant reply）
    try {
      await deleteMessagesAfter(sessionId, targetMsg.id)
    } catch {}

    // 截断前端状态到目标消息（包含该消息）
    const truncated = messages.slice(0, messageIndex + 1)
    setMessages(truncated)

    // 自动使用目标消息的内容重新发送
    const reContent = targetMsg.content

    // Dispatch re-send after state set, using a microtask
    setTimeout(() => {
      send(reContent, lastSkillIdsRef.current)
    }, 50)
  }, [sessionId, messages, send])

  // 编辑用户消息：截断到该消息、更新内容并重新发送（ChatGPT 风格 ✏️）
  const editMessage = useCallback(async (messageIndex: number, newContent: string) => {
    if (!sessionId) return
    const targetMsg = messages[messageIndex]
    if (!targetMsg || targetMsg.role !== 'user' || !newContent.trim()) return

    try { await deleteMessagesAfter(sessionId, targetMsg.id) } catch {}
    try { await updateMessageContent(targetMsg.id, sessionId, newContent.trim()) } catch {}

    const truncated = messages.slice(0, messageIndex)
    const editedMsg = { ...targetMsg, content: newContent.trim() }
    setMessages([...truncated, editedMsg])

    setTimeout(() => {
      send(newContent.trim(), lastSkillIdsRef.current)
    }, 50)
  }, [sessionId, messages, send])

  // 消息分支：对 assistant 消息就地重新生成，旧回答归档进 variants（‹ 1/n › 可切换）
  const regenerateMessage = useCallback(async (messageIndex: number) => {
    if (!sessionId || streamingRef.current !== null) return
    const target = messages[messageIndex]
    if (!target || target.role !== 'assistant') return
    const userMsg = messages[messageIndex - 1]
    if (!userMsg || userMsg.role !== 'user') return

    // 旧回答（当前内容 + 已有历史版本）压入待归档队列
    pendingVariantRef.current = [target.content, ...(target.variants || [])].filter(Boolean)

    try { await deleteMessagesAfter(sessionId, userMsg.id) } catch {}
    setMessages(messages.slice(0, messageIndex))
    setTimeout(() => { send(userMsg.content, lastSkillIdsRef.current) }, 50)
  }, [sessionId, messages, send])

  return {
    messages, 
    streamingId,
    error, 
    send, 
    abort: () => {
      abortRef.current?.abort()
      // 集群/流式被暂停后立即解锁输入（集群会自行检测信号收尾）
      setStreamingId(null)
    },
    refresh: loadMessages,
    rollbackTo,
    editMessage,
    regenerateMessage,
    /** 手动加载 Skill */
    loadSkill: loadSkillTools,
    /** 已加载的 Skill 列表 */
    loadedSkills: Array.from(loadedSkills.keys()),
  }
}
