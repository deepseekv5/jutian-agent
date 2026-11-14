/**
 * 用户扩展层（UXL, User Extension Layer）契约 —— v14.11
 *
 * 设计取向：对齐 the agent harness Creator Mode 的「检查运行时 → 写插件 →
 * 批准 → 热挂载 → 可回滚」，但不引入 Cordis、不重构现有 PageType。
 *
 * 与官方发版不冲突的物理基础：electron/updater.cjs 只替换 app.asar，
 * ~/.lyclaw/ 完整保留。扩展一律落在 ~/.lyclaw/extensions/<id>/。
 *
 * 扩展载体刻意选 **HTML 单文件 + 声明式 manifest + postMessage API 桥**，
 * 而不是 JS 模块：渲染层无 require、Vite 的 import() 全是编译期字面量、
 * CSP script-src 'self'。iframe sandbox 是现成的安全容器。
 *
 * 纯逻辑、可测；服务端与渲染层共用同一套校验规则。
 */

/** 当前宿主 API 版本。asar 主版本升级后不兼容的扩展会被自动禁用，绝不白屏 */
export const EXT_API_VERSION = 1

/** 扩展可挂载的 UI 插槽 */
export type ExtSlot = 'tab' | 'sidebar' | 'statusbar'

/** manifest.json 的形状 */
export interface ExtManifest {
  id: string
  name: string
  version: string
  description?: string
  /** 宿主 API 契约版本；与主版本不符 → 自动禁用 */
  apiVersion: number
  /** UI 挂载位置，默认 tab */
  slot?: ExtSlot
  /** 面板入口文件，默认 panel.html（只能是相对路径，且必须在扩展目录内） */
  entry?: string
  /** 图标（emoji 或单字符，不用外部图片，避免加载外部资源） */
  icon?: string
  /** 需要的宿主能力（只读白名单），空数组=纯展示 */
  capabilities?: ExtCapability[]
  author?: string
  createdAt?: string
  /** 是否被用户批准加载（服务端写入，AI 创建时默认 false） */
  approved?: boolean
  /** 是否启用 */
  enabled?: boolean
}

/** 宿主能力白名单：扩展只能读，不能写；写操作一律走二次审批（Phase 2） */
export type ExtCapability = 'settings' | 'sessions' | 'notices' | 'workspace'

export const EXT_CAPABILITIES: ExtCapability[] = ['settings', 'sessions', 'notices', 'workspace']

/** 单文件大小上限（防把大文件塞进扩展目录撑爆内存） */
export const EXT_MAX_FILE_BYTES = 512 * 1024

/** 允许的静态资源后缀 */
export const EXT_ALLOWED_FILE_RE = /\.(html?|css|js|json|svg|png|jpe?g|gif|webp|txt|md)$/i

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const ENTRY_RE = /^[a-z0-9][a-z0-9_./-]{0,127}$/i

/** id 清洗：AI 生成的名字可能含空格/中文，统一成合法目录名 */
export function normalizeExtId(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** 相对路径安全判定：拒绝绝对路径、.. 穿越、反斜杠、非法字符 */
export function isSafeExtPath(raw: unknown): boolean {
  const p = String(raw || '')
  if (!p || !ENTRY_RE.test(p)) return false
  if (pathIsAbsolute(p) || p.includes('..') || p.includes('\\')) return false
  if (p.startsWith('/') || p.startsWith('./')) return false
  return EXT_ALLOWED_FILE_RE.test(p)
}

function pathIsAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:/.test(p)
}

/** manifest 校验：返回 { ok, errors, manifest }；严格模式用于批准加载 */
export function validateExtManifest(raw: unknown, opts?: { strict?: boolean }): {
  ok: boolean
  errors: string[]
  manifest: ExtManifest | null
} {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['manifest 不是对象'], manifest: null }
  const m = raw as Record<string, unknown>

  const id = normalizeExtId(m.id)
  if (!id || !ID_RE.test(id)) errors.push('id 非法（需字母数字开头，仅 a-z0-9_-，≤64 字符）')
  const name = String(m.name || '').trim().slice(0, 60)
  if (!name) errors.push('缺少 name')
  const version = String(m.version || '0.1.0').slice(0, 32)
  const apiVersion = Number(m.apiVersion)
  if (!Number.isInteger(apiVersion) || apiVersion < 1) errors.push('apiVersion 必须是正整数')
  else if (Math.floor(apiVersion) !== Math.floor(EXT_API_VERSION)) {
    errors.push(`apiVersion ${apiVersion} 与宿主 ${EXT_API_VERSION} 不兼容`)
  }

  const slot = (m.slot ? String(m.slot) : 'tab') as ExtSlot
  if (!['tab', 'sidebar', 'statusbar'].includes(slot)) errors.push('slot 非法')

  const entry = String(m.entry || 'panel.html')
  if (!isSafeExtPath(entry)) errors.push('entry 路径非法（必须相对、无穿越、后缀在白名单内）')

  const rawCaps = Array.isArray(m.capabilities) ? m.capabilities : []
  const caps = rawCaps.map(String).filter((c): c is ExtCapability => EXT_CAPABILITIES.includes(c as ExtCapability))
  if (rawCaps.some(c => !EXT_CAPABILITIES.includes(String(c) as ExtCapability))) {
    errors.push('capabilities 含未知项（只允许 settings/sessions/notices/workspace）')
  }

  const icon = String(m.icon || '🧩').slice(0, 8)
  const description = String(m.description || '').slice(0, 300)
  const author = String(m.author || 'AI 生成').slice(0, 60)

  if (opts?.strict && m.approved !== true) errors.push('尚未经用户批准')
  if (opts?.strict && m.enabled === false) errors.push('已禁用')

  const manifest: ExtManifest | null = errors.length ? null : {
    id, name, version, description, apiVersion, slot, entry, icon,
    capabilities: caps, author,
    createdAt: String(m.createdAt || new Date().toISOString()),
    approved: m.approved === true,
    enabled: m.enabled !== false,
  }
  return { ok: errors.length === 0, errors, manifest }
}

/** 版本契约：宿主 asar 大版本变化时旧扩展自动禁用（不删文件，用户可手动改 manifest） */
export function isExtCompatible(hostApiVersion: number, ext: Pick<ExtManifest, 'apiVersion'>): boolean {
  return Math.floor(ext.apiVersion) === Math.floor(hostApiVersion)
}

/** 生成默认 manifest（create_extension 工具用） */
export function defaultExtManifest(input: {
  id: string; name?: string; description?: string; icon?: string; slot?: ExtSlot
}): ExtManifest {
  const id = normalizeExtId(input.id)
  return {
    id,
    name: String(input.name || id).slice(0, 60),
    version: '0.1.0',
    description: String(input.description || '').slice(0, 300),
    apiVersion: EXT_API_VERSION,
    slot: input.slot || 'tab',
    entry: 'panel.html',
    icon: String(input.icon || '🧩').slice(0, 8),
    capabilities: [],
    author: 'AI 生成',
    createdAt: new Date().toISOString(),
    approved: false,
    enabled: true,
  }
}

/** 宿主 → 扩展 的 API 桥消息（postMessage） */
export interface ExtApiRequest {
  type: 'ext:api'
  requestId: string
  capability: ExtCapability
  method: 'get'
  params?: Record<string, unknown>
}
export interface ExtApiResponse {
  type: 'ext:api-result'
  requestId: string
  ok: boolean
  data?: unknown
  error?: string
}
