/**
 * 权限判定（v14.4 重写）
 *
 * 我们原来的「需要我确认」档其实是**硬拒绝**：命中敏感操作就直接把错误
 * 回给模型，用户根本没有机会点头。正确做法是结构化审批请求：
 * 判定 → 生成可读预览 → 交给 UI 决定（本次允许 / 本会话允许 / 拒绝）。
 *
 * 这里只做「判定 + 预览」这一半（纯函数，可测），UI 与放行集合在渲染层。
 * 判定维度（按工具类型落地）：
 *   dangerous-command  命令本身危险（rm -rf / dd / mkfs / curl|sh …）
 *   outside-cwd        写操作落在工作目录之外
 *   system-dir         命中系统目录（/etc /usr /System …）
 *   sensitive-tool     工具本身高危（删文件、装技能、git 强推）
 *   empty-overwrite    覆盖写且内容为空（潜在数据丢失）
 */

import { checkSensitiveTool } from './sensitiveOps'

export type PermissionReason =
  | 'dangerous-command'
  | 'outside-cwd'
  | 'system-dir'
  | 'sensitive-tool'
  | 'empty-overwrite'

export interface PermissionRequest {
  /** 调用 id（与工具调用一一对应，UI 回执用） */
  id: string
  tool: string
  args: Record<string, unknown>
  reason: PermissionReason
  risk: 'dangerous' | 'normal'
  /** 一句话说明（标题） */
  title: string
  /** 预览：命令原文或文件路径 + 变化摘要 */
  preview: string
  /** 供「本会话允许」生成匹配键（同一工具 + 同一目标不再问） */
  scopeKey: string
}

const SYSTEM_DIRS = [
  '/etc', '/usr', '/bin', '/sbin', '/System', '/Library', '/var', '/boot', '/opt',
  'C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData',
]

function norm(p: string): string {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 路径是否在工作目录内（工作目录为空时不做限制） */
export function isOutsideWorkDir(target: string, workDir: string): boolean {
  if (!workDir) return false
  const t = norm(target)
  const w = norm(workDir)
  if (!t) return false
  // 相对路径视为在工作目录内
  if (!t.startsWith('/') && !/^[a-zA-Z]:\//.test(t)) return false
  return !(t === w || t.startsWith(w + '/'))
}

export function isSystemDir(target: string): boolean {
  const t = norm(target)
  return SYSTEM_DIRS.some((d) => {
    const dd = norm(d)
    return t === dd || t.startsWith(dd + '/')
  })
}

/** 取工具调用里的目标路径（不同工具字段不同） */
function targetPathOf(tool: string, args: Record<string, unknown>): string {
  const pick = (k: string) => (typeof args[k] === 'string' ? String(args[k]) : '')
  switch (tool) {
    case 'write_file':
    case 'edit_file':
    case 'read_file':
    case 'list_dir':
    case 'delete_file':
    case 'get_file_info':
      return pick('path')
    case 'move_file':
      return pick('dest') || pick('src')
    default:
      return ''
  }
}

/**
 * 构造审批请求。返回 null = 不需要询问（放行）。
 * @param id 工具调用 id
 * @param workDir 当前工作目录（空则跳过「工作目录外」判定）
 */
export function buildPermissionRequest(
  id: string,
  tool: string,
  args: Record<string, unknown>,
  workDir = '',
): PermissionRequest | null {
  const base = { id, tool, args }

  // 1) 命令危险
  if (tool === 'shell' || tool === 'npm_run' || tool === 'git_operation') {
    const cmd = String(args.command || args.script || args.args || '').trim()
    const hit = checkSensitiveTool(tool, args)
    if (hit && hit.level === 'high') {
      return {
        ...base, reason: 'dangerous-command', risk: 'dangerous',
        title: hit.label,
        preview: cmd.slice(0, 300) || '(空命令)',
        scopeKey: `cmd:${tool}:${hit.label}`,
      }
    }
    // 写系统目录的命令（cp/mv 到 /etc 等）
    const sysHit = SYSTEM_DIRS.find((d) => cmd.includes(d))
    if (sysHit) {
      return {
        ...base, reason: 'system-dir', risk: 'dangerous',
        title: '命令涉及系统目录',
        preview: cmd.slice(0, 300),
        scopeKey: `sys:${tool}:${sysHit}`,
      }
    }
    return null
  }

  // 2) 写文件类
  const target = targetPathOf(tool, args)
  if (tool === 'delete_file') {
    return {
      ...base, reason: 'sensitive-tool', risk: 'dangerous',
      title: '删除文件',
      preview: target || '(未提供路径)',
      scopeKey: `del:${target}`,
    }
  }
  if (tool === 'move_file') {
    return {
      ...base, reason: 'sensitive-tool', risk: 'normal',
      title: '移动/重命名文件',
      preview: `${String(args.src || '')} → ${String(args.dest || '')}`,
      scopeKey: `mv:${target}`,
    }
  }
  if (tool === 'write_file' || tool === 'edit_file') {
    if (isSystemDir(target)) {
      return {
        ...base, reason: 'system-dir', risk: 'dangerous',
        title: '修改系统目录文件',
        preview: target,
        scopeKey: `sysfile:${target}`,
      }
    }
    if (isOutsideWorkDir(target, workDir)) {
      return {
        ...base, reason: 'outside-cwd', risk: 'normal',
        title: '修改工作目录之外的文件',
        preview: target,
        scopeKey: `outside:${target}`,
      }
    }
    if (tool === 'write_file' && String(args.content ?? '') === '') {
      return {
        ...base, reason: 'empty-overwrite', risk: 'normal',
        title: '清空文件内容',
        preview: target,
        scopeKey: `empty:${target}`,
      }
    }
    return null
  }

  // 3) 其他高危工具
  const hit = checkSensitiveTool(tool, args)
  if (hit && hit.level === 'high') {
    return {
      ...base, reason: 'sensitive-tool', risk: 'dangerous',
      title: hit.label,
      preview: JSON.stringify(args).slice(0, 300),
      scopeKey: `tool:${tool}`,
    }
  }
  return null
}

/** 审批结果 → 拒绝时回给模型的文案（模型据此换方案，而不是反复重试） */
export function denialMessage(req: PermissionRequest): string {
  return JSON.stringify({
    ok: false,
    error: `【用户拒绝】「${req.title}」需要用户确认，用户本次未批准。`
      + `请改用非破坏性方案，或先向用户说明将要做什么、征得同意后再试。`,
  })
}
