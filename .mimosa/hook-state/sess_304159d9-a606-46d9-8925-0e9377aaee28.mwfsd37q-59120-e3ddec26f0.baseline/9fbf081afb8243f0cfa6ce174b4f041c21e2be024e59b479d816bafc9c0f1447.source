/**
 * 安全存储封装（v12 底层重构）
 *
 * 全项目 167 处裸 localStorage 调用，各自 try/catch（也有不少没 catch，
 * 隐私模式下直接抛异常炸组件）。这里统一：
 *   - 永不抛异常（存储不可用/配额满时降级为内存）
 *   - 类型安全的 JSON 读写（坏数据自动丢弃并回默认值，不把 undefined 传下去）
 *   - 命名空间前缀，避免与其他应用/旧版本键冲突
 *   - 变更广播（同窗口 + storage 事件跨窗口），替代散落的自建事件
 *
 * 不做加密：localStorage 本身不适合存密钥（密钥在 SQLite + 设置页），
 * 这里只解决可靠性问题，避免给出"已加密"的错觉。
 */

type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 内存兜底：存储不可用（隐私模式/配额满）时保证 API 行为一致 */
const memory = new Map<string, string>()
let backendOk = true

function backend(): StoreLike {
  if (!backendOk) return memoryBackend
  try {
    if (typeof localStorage === 'undefined') { backendOk = false; return memoryBackend }
    // 探测写权限：某些环境 localStorage 存在但写入抛异常
    const probe = '__jt_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    backendOk = false
    return memoryBackend
  }
}

const memoryBackend: StoreLike = {
  getItem: (k) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k, v) => { memory.set(k, v) },
  removeItem: (k) => { memory.delete(k) },
}

const NS = 'jt:'
function nsKey(key: string): string {
  return key.startsWith(NS) ? key : NS + key
}

export const STORE_EVENT = 'jt-storage'

/** 存储是否真的持久化（false 表示已降级到内存，重启即丢） */
export function isPersistent(): boolean {
  return backendOk
}

export function readString(key: string, fallback = ''): string {
  try {
    const v = backend().getItem(nsKey(key))
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

export function writeString(key: string, value: string): boolean {
  try {
    backend().setItem(nsKey(key), value)
    broadcast(key)
    return true
  } catch {
    // 配额满：退回内存，至少本次会话可用
    memory.set(nsKey(key), value)
    return false
  }
}

export function removeKey(key: string): void {
  try { backend().removeItem(nsKey(key)) } catch { /* ignore */ }
  memory.delete(nsKey(key))
  broadcast(key)
}

/**
 * 读 JSON，坏数据自动丢弃。
 * 传入 validate 可以更进一步：形状不对也丢弃（避免旧版本残留结构导致崩溃）。
 */
export function readJson<T>(key: string, fallback: T, validate?: (v: unknown) => v is T): T {
  const raw = readString(key, '')
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    if (validate && !validate(parsed)) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    return writeString(key, JSON.stringify(value))
  } catch {
    return false
  }
}

function broadcast(key: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: { key } }))
    }
  } catch { /* ignore */ }
}

/** 订阅某个 key（或全部）的变化；返回退订函数 */
export function onStoreChange(handler: (key: string) => void, key?: string): () => void {
  if (typeof window === 'undefined') return () => {}
  const onLocal = (e: Event) => {
    const k = (e as CustomEvent).detail?.key
    if (!key || k === key) handler(k || '')
  }
  const onCross = (e: StorageEvent) => {
    // 跨窗口：浏览器给的是带前缀的真实键名，去掉前缀后比对
    const k = String(e.key || '').startsWith(NS) ? String(e.key).slice(NS.length) : String(e.key || '')
    if (!key || k === key) handler(k)
  }
  window.addEventListener(STORE_EVENT, onLocal)
  window.addEventListener('storage', onCross)
  return () => {
    window.removeEventListener(STORE_EVENT, onLocal)
    window.removeEventListener('storage', onCross)
  }
}

/** 常用形状校验器 */
export const validators = {
  stringArray: (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  object: (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v),
  number: (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v),
  boolean: (v: unknown): v is boolean => typeof v === 'boolean',
}
