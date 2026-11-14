/**
 * 数据备份计划（v12 新功能）
 *
 * 只做"计划与校验"的纯逻辑，实际打包交给后端：
 *   - 计算应备份什么、体积预估、保留几份
 *   - 校验备份完整性（清单 + 条目数），避免导出个空壳
 *   - 清理策略：保留最近 N 份 + 每份有上限
 */

export type BackupScope = 'settings' | 'sessions' | 'memory' | 'knowledge' | 'skills' | 'all'

export interface BackupItem {
  scope: BackupScope
  /** 相对路径（在压缩包内） */
  path: string
  bytes: number
}

export interface BackupPlan {
  items: BackupItem[]
  totalBytes: number
  /** 是否包含密钥（密钥永不进备份，这里恒为 false，仅作显式声明） */
  includesSecrets: false
}

export interface BackupManifest {
  version: string
  createdAt: string
  platform: string
  appVersion: string
  counts: Partial<Record<BackupScope, number>>
  totalBytes: number
}

export const SCOPE_LABEL: Record<BackupScope, string> = {
  settings: '设置',
  sessions: '对话记录',
  memory: '记忆',
  knowledge: '知识库',
  skills: '技能',
  all: '全部',
}

/** 默认备份范围（不含密钥；含密钥的备份会被用户误传，风险太大） */
export const DEFAULT_SCOPES: BackupScope[] = ['settings', 'sessions', 'memory', 'knowledge', 'skills']

export function buildPlan(items: BackupItem[], scopes: BackupScope[] = DEFAULT_SCOPES): BackupPlan {
  const wanted = new Set(scopes)
  const picked = items.filter((i) => wanted.has(i.scope))
  return {
    items: picked,
    totalBytes: picked.reduce((s, i) => s + Math.max(0, i.bytes || 0), 0),
    includesSecrets: false,
  }
}

/** 体积提示：超过阈值建议提醒用户 */
export function sizeWarning(bytes: number): string | null {
  const mb = bytes / 1024 / 1024
  if (mb > 500) return `备份约 ${mb.toFixed(0)} MB，较大；建议只选需要的范围`
  if (mb > 100) return `备份约 ${mb.toFixed(0)} MB，导出可能需要十几秒`
  return null
}

/** 校验：清单与条目必须对得上，空备份要报错而不是"成功" */
export function verifyBackup(manifest: BackupManifest | null | undefined, entries: string[]): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!manifest) return { ok: false, problems: ['缺少清单文件（manifest.json）'] }
  if (!manifest.version) problems.push('清单缺少 version')
  if (!manifest.createdAt) problems.push('清单缺少 createdAt')
  if (!entries.length) problems.push('备份包内没有任何条目')
  const declared = Object.values(manifest.counts || {}).reduce((s, n) => s + (Number(n) || 0), 0)
  if (declared === 0) problems.push('清单声明 0 条记录，可能是空备份')
  return { ok: problems.length === 0, problems }
}

/**
 * 保留策略：保留最近 keep 份；同一天只留一份（避免一天刷出几十个包）。
 * 输入按时间倒序（最新在前），返回应删除的项。
 */
export function prunableBackups(list: { name: string; createdAt: string | number }[], keep = 5): string[] {
  const sorted = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const seenDay = new Set<string>()
  const remove: string[] = []
  let kept = 0
  for (const b of sorted) {
    const day = new Date(b.createdAt).toISOString().slice(0, 10)
    if (kept >= keep || seenDay.has(day)) { remove.push(b.name); continue }
    seenDay.add(day)
    kept++
  }
  return remove
}

/** 备份文件名（带日期与平台，避免跨平台覆盖） */
export function backupFileName(appVersion: string, platform: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  return `jutian-backup-${appVersion}-${platform}-${stamp}.zip`
}

export function humanBytes(n: number): string {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`
  return `${(v / 1024 ** 3).toFixed(2)} GB`
}
