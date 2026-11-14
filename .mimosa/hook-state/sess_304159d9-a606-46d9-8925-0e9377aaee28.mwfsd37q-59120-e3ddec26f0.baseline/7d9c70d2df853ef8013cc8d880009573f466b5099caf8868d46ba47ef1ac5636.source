/**
 * JT Core Ultra / policy —— gemini-cli confirmation.ts + policy.ts + Codex 编排层概念移植
 * 审批需求四态（Skip|Forbidden|NeedsApproval|NeedsHumanApproval）、
 * 沙箱首次尝试 + 拒绝后升级重试、ApprovalMode 三档、作用域键记忆。
 * 零依赖（Apache-2.0 / MIT 概念）。
 */
export type ApprovalRequirement = 'Skip' | 'Forbidden' | 'NeedsApproval' | 'NeedsHumanApproval'
export type ApprovalMode = 'never' | 'on-request' | 'on-failure' | 'always'
export interface SandboxOverride { level: 'restricted' | 'standard' | 'full'; reason: string }

export function approvalFor(tool: string, mode: ApprovalMode, dangerous: Set<string>, denied: Set<string>): ApprovalRequirement {
  if (denied.has(tool)) return 'Forbidden'
  if (mode === 'never') return 'Skip'
  if (mode === 'always') return 'NeedsApproval'
  if (mode === 'on-request' && dangerous.has(tool)) return 'NeedsApproval'
  if (mode === 'on-failure' && dangerous.has(tool)) return 'NeedsHumanApproval'
  return 'Skip'
}

/** 沙箱首次尝试（尽量最小权限），沙箱拒绝后升级重试一次 */
export class SandboxEscalation {
  private escalated = false
  firstAttempt(): SandboxOverride { return { level: 'standard', reason: '最小权限首次尝试' } }
  /** 返回升级后的覆盖；只允许升级一次，防止无限提权 */
  onSandboxDenial(): SandboxOverride | null {
    if (this.escalated) return null
    this.escalated = true
    return { level: 'full', reason: '沙箱拒绝，升级一次后重试' }
  }
  get used(): boolean { return this.escalated }
}

/** 作用域键记忆（本会话允许）：key 由工具+参数归一化生成 */
export class ApprovedScopes {
  private scopes = new Set<string>()
  scopeKeyOf(tool: string, args: Record<string, unknown>): string {
    const norm = JSON.stringify(args, Object.keys(args).sort())
    return tool + '::' + norm
  }
  approve(key: string): void { this.scopes.add(key) }
  isApproved(key: string): boolean { return this.scopes.has(key) }
  get all(): string[] { return [...this.scopes] }
  clear(): void { this.scopes.clear() }
}

/** 权限档位映射（巨天 ask|edit|full ↔ gemini-cli ApprovalMode） */
export function modeFromLevel(level: string): ApprovalMode {
  if (level === 'full') return 'never'
  if (level === 'ask' || level === 'restricted') return 'always'
  return 'on-request'
}
