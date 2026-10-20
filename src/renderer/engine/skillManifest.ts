export interface SkillBrief { id: string; name: string; description: string }
import { fetchCompat } from '../api'

/** 服务端 /api/skills/list 返回的原始技能条目（字段可能缺失，读取时统一 String() 兜底） */
interface RawSkill { name?: string; display_name?: string; description?: string; status?: string }

let cache: SkillBrief[] = []
let inflight: Promise<void> | null = null

function apply(list: unknown) {
  const arr: RawSkill[] = Array.isArray(list) ? (list as RawSkill[]) : []
  cache = arr
    .filter((s: RawSkill) => s && s.name && s.name !== 'builtin' && s.status !== 'incomplete')
    .map((s: RawSkill) => ({
      id: String(s.name),
      name: String(s.display_name || s.name),
      description: String(s.description || '').slice(0, 120),
    }))
}

/** 当前会话缓存的已安装技能清单（供系统提示词同步读取） */
export function getSkillManifest(): SkillBrief[] { return cache }

/**
 * 从服务端拉取已安装技能清单并更新缓存。
 * 启动时、技能变动后、窗口聚焦时调用；失败时保留旧缓存。
 */
export function refreshSkillManifest(): Promise<void> {
  if (inflight) return inflight
  inflight = fetchCompat('/api/skills/list')
    .then((res) => (res.ok ? res.json() : null))
    .then((data: RawSkill[] | { output?: string } | null) => {
      if (!data) return
      try {
        apply(Array.isArray(data) ? data : JSON.parse(data.output || '[]'))
      } catch { /* 响应形状异常时保留旧缓存 */ }
    })
    .catch(() => { /* 网络异常时保留旧缓存 */ })
    .finally(() => { inflight = null })
  return inflight
}
