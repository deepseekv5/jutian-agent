// Code 项目存储层 — localStorage 主存储 + SQLite 后端备份
import type { CodeProject } from '../types/code'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function now(): string {
  return new Date().toISOString()
}

const STORAGE_KEY = 'lyclaw_code_projects'
const ACTIVE_KEY = 'lyclaw_code_active'
const OPEN_TABS_KEY = 'lyclaw_code_tabs'

// ─── API helpers ───
async function apiPost(path: string, body: any): Promise<any | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok ? await res.json() : null
  } catch { return null }
}

async function apiGet(path: string): Promise<any | null> {
  try {
    const res = await fetch(path)
    return res.ok ? await res.json() : null
  } catch { return null }
}

async function apiDelete(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: 'DELETE' })
    return res.ok
  } catch { return false }
}

// ─── 同步读（localStorage 优先，瞬时响应）───
export function listProjects(): CodeProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function getActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_KEY) || null
}

export function setActiveProjectId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}

export interface SavedTab {
  path: string
  name: string
  language: string
}

export function getOpenTabs(): SavedTab[] {
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

// ─── 写操作（localStorage + 后台 SQLite 双写）───
export function createProject(name: string, rootPath: string): CodeProject {
  const id = uid()
  const project: CodeProject = {
    id, name, rootPath, created_at: now(), updated_at: now(),
  }
  // 同步写 localStorage
  const projects = listProjects()
  localStorage.setItem(STORAGE_KEY, JSON.stringify([project, ...projects]))
  // 后台同步到 SQLite
  apiPost('/api/code/projects', { id, name, rootPath }).catch(() => {})
  return project
}

export function deleteProject(id: string): void {
  // 同步删 localStorage
  const projects = listProjects().filter(p => p.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  // 后台删 SQLite
  apiDelete('/api/code/projects/' + encodeURIComponent(id)).catch(() => {})
}

export function saveOpenTabs(tabs: SavedTab[]): void {
  localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs))
}

export function syncTabsToBackend(projectId: string, tabs: SavedTab[]): void {
  apiPost('/api/code/projects/' + encodeURIComponent(projectId) + '/tabs', { tabs }).catch(() => {})
}

// ─── 冷启动恢复：localStorage 为空时从 SQLite 拉取 ───
export async function restoreFromBackend(): Promise<CodeProject[]> {
  const local = listProjects()
  if (local.length > 0) {
    // localStorage 有数据，后台同步到 SQLite 补全漏写
    for (const p of local) {
      apiPost('/api/code/projects', { id: p.id, name: p.name, rootPath: p.rootPath }).catch(() => {})
    }
    return local
  }
  // localStorage 为空，尝试从 SQLite 恢复
  try {
    const data = await apiGet('/api/code/projects')
    if (data && Array.isArray(data) && data.length > 0) {
      const projects: CodeProject[] = data.map((row: any) => ({
        id: row.id,
        name: row.name,
        rootPath: row.root_path,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
      // 恢复到 localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
      return projects
    }
  } catch { /* ignore */ }
  return []
}
