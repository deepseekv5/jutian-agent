// 工具参数校验：把"模型传了错参数"变成清晰、可操作的错误，而不是让它
// 一路走到 fs 层才炸成 ENOENT / undefined 字符串 / 静默覆盖。
//
// 为什么要有这一层：模型调用工具时的参数是不可信输入。实测踩过的坑——
//  · write_file 的 content 缺失 → 文件被写成字符串 "undefined"
//  · move_file 目标已存在 → rename 静默覆盖，原文件没了
//  · delete_file 指向目录 → unlink 报 EISDIR，模型看不懂
// 这些错误如果只是原样抛 fs 报错，模型会反复重试同一参数。

export type FieldType = 'string' | 'number' | 'boolean'

export interface FieldSpec {
  name: string
  type: FieldType
  required?: boolean
  /** 允许空字符串（默认 false：required 的字符串字段不许为空） */
  allowEmpty?: boolean
  /** 数值范围 */
  min?: number
  max?: number
  /** 只接受这些取值 */
  enum?: string[]
}

export interface ValidationResult {
  ok: boolean
  /** 拼好的错误信息（含缺哪个字段、期望什么类型），供回传给模型 */
  error?: string
  /** 校验通过后的规范化参数 */
  value?: Record<string, unknown>
}

/** 类型名（给人看的中文） */
function typeName(t: FieldType): string {
  return t === 'string' ? '字符串' : t === 'number' ? '数字' : '布尔值'
}

/**
 * 按规格校验参数。返回第一个错误就停——一次说清一个问题，
 * 比堆一串更利于模型修正。
 */
export function validateArgs(args: unknown, specs: FieldSpec[]): ValidationResult {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: '参数必须是一个对象（JSON object），当前收到的不是。' }
  }
  const src = args as Record<string, unknown>
  const out: Record<string, unknown> = { ...src }

  for (const spec of specs) {
    const raw = src[spec.name]
    const missing = raw === undefined || raw === null

    if (missing) {
      if (spec.required) {
        return { ok: false, error: `缺少必填参数 "${spec.name}"（${typeName(spec.type)}）。` }
      }
      continue
    }

    if (spec.type === 'string') {
      if (typeof raw !== 'string') {
        return { ok: false, error: `参数 "${spec.name}" 应为${typeName(spec.type)}，实际收到 ${typeof raw}。` }
      }
      if (spec.required && !spec.allowEmpty && raw === '') {
        return { ok: false, error: `参数 "${spec.name}" 不能为空字符串。` }
      }
      if (spec.enum && !spec.enum.includes(raw)) {
        return { ok: false, error: `参数 "${spec.name}" 只能是：${spec.enum.join(' / ')}（收到 "${raw}"）。` }
      }
      out[spec.name] = raw
    } else if (spec.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) {
        return { ok: false, error: `参数 "${spec.name}" 应为${typeName(spec.type)}，实际收到 "${String(raw)}"。` }
      }
      if (spec.min !== undefined && n < spec.min) {
        return { ok: false, error: `参数 "${spec.name}" 不能小于 ${spec.min}（收到 ${n}）。` }
      }
      if (spec.max !== undefined && n > spec.max) {
        return { ok: false, error: `参数 "${spec.name}" 不能大于 ${spec.max}（收到 ${n}）。` }
      }
      out[spec.name] = n
    } else {
      if (typeof raw !== 'boolean') {
        return { ok: false, error: `参数 "${spec.name}" 应为${typeName(spec.type)}，实际收到 ${typeof raw}。` }
      }
      out[spec.name] = raw
    }
  }
  return { ok: true, value: out }
}

/** 每个工具的必填规格。没列出的工具不做强校验（如 shell 的 command 另有处理）。 */
export const TOOL_SPECS: Record<string, FieldSpec[]> = {
  read_file: [{ name: 'path', type: 'string', required: true }],
  write_file: [
    { name: 'path', type: 'string', required: true },
    // content 必须给：缺失时若放行，会把文件写成 "undefined"
    { name: 'content', type: 'string', required: true, allowEmpty: true },
  ],
  edit_file: [
    { name: 'path', type: 'string', required: true },
    { name: 'oldText', type: 'string', required: true },
    { name: 'newText', type: 'string', required: true, allowEmpty: true },
    { name: 'replaceAll', type: 'boolean' },
  ],
  list_dir: [{ name: 'path', type: 'string', required: true }],
  move_file: [
    { name: 'src', type: 'string', required: true },
    { name: 'dest', type: 'string', required: true },
  ],
  delete_file: [{ name: 'path', type: 'string', required: true }],
  get_file_info: [{ name: 'path', type: 'string', required: true }],
  search_files: [{ name: 'pattern', type: 'string', required: true }],
  search_content: [{ name: 'pattern', type: 'string', required: true }],
  shell: [{ name: 'command', type: 'string', required: true }],
  web_fetch: [{ name: 'url', type: 'string', required: true }],
  http_request: [{ name: 'url', type: 'string', required: true }],
  image_generate: [{ name: 'prompt', type: 'string', required: true }],
  web_search: [{ name: 'query', type: 'string', required: true }],
  npm_run: [{ name: 'script', type: 'string', required: true }],
}

/**
 * 覆盖已存在文件的警告。返回 null 表示无需提示。
 * 目的不是阻止写入（模型常常就是要改文件），而是让它知道"这是覆盖"，
 * 从而在回复里说明改了什么、必要时先备份。
 */
export function overwriteWarning(existedBefore: boolean, oldLen: number, newLen: number): string | null {
  if (!existedBefore) return null
  if (oldLen > 0 && newLen === 0) {
    return '注意：本次写入把原本有内容的文件清空了。'
  }
  if (oldLen > newLen * 3 && newLen > 0) {
    return `注意：原文件 ${oldLen} 字符，本次只写入 ${newLen} 字符，内容大幅减少，请确认不是误覆盖。`
  }
  return null
}
