import { describe, it, expect } from 'vitest'
import { filterTools, repairToolCallJson, stepToolFilter } from '../src/shared/toolFilter'
import type { ToolDef } from '../src/shared/toolFilter'

const mk = (name: string, desc = name): ToolDef => ({ name, description: desc, parameters: { type: 'object', properties: {} } })
const ALL: ToolDef[] = [
  mk('read_file'), mk('write_file'), mk('edit_file'), mk('list_dir'),
  mk('search_content'), mk('search_files'), mk('shell'), mk('npm_run'),
  mk('web_search'), mk('web_fetch'), mk('http_request'),
  mk('json_process'), mk('text_tools'), mk('base64_tools'), mk('hash_tools'),
  mk('remember'), mk('recall'), mk('save_knowledge'), mk('forget'),
  mk('git_operation'), mk('code_analysis'), mk('image_generate'),
  mk('system_info'), mk('process_list'), mk('port_check'),
  mk('screenshot'), mk('timestamp_tools'), mk('url_tools'), mk('color_tools'),
  mk('create_skill'), mk('install_skill'), mk('get_file_info'),
  mk('move_file'), mk('delete_file'), mk('random_tools'),
  mk('uuid_generate'), mk('code_analysis'), mk('text_diff'),
]

describe('filterTools（动态工具过滤）', () => {
  it('全量 ≤ maxTools 时原样返回', () => {
    const small = ALL.slice(0, 10)
    expect(filterTools(small, '测试')).toBe(small)
  })
  it('超量时截断到 maxTools', () => {
    expect(filterTools(ALL, '随便看看', 15).length).toBeLessThanOrEqual(15)
  })
  it('核心工具永远保留', () => {
    const r = filterTools(ALL, '帮我查一下数据', 15)
    for (const name of ['read_file', 'write_file', 'list_dir', 'search_content', 'shell', 'system_info']) {
      expect(r.some(t => t.name === name), name).toBe(true)
    }
  })
  it('提到代码时保留代码分析工具', () => {
    const r = filterTools(ALL, '帮我分析这段代码的问题', 20)
    expect(r.some(t => t.name === 'code_analysis')).toBe(true)
  })
  it('提到网络搜索时保留搜索工具', () => {
    const r = filterTools(ALL, '帮我搜索一下最新的 AI 框架', 20)
    expect(r.some(t => t.name === 'web_search')).toBe(true)
  })
  it('提到文件操作时保留文件工具', () => {
    const r = filterTools(ALL, '帮我读取 config.json 然后编辑', 20)
    expect(r.some(t => t.name === 'edit_file')).toBe(true)
  })
  it('中文关键词也能匹配', () => {
    const r = filterTools(ALL, '帮我记住我喜欢用深色主题', 20)
    expect(r.some(t => t.name === 'remember')).toBe(true)
  })
})

describe('repairToolCallJson（工具调用修复）', () => {
  it('合法 JSON 直接通过', () => {
    expect(repairToolCallJson('{"path":"a.txt"}')).toEqual({ path: 'a.txt' })
  })
  it('空字符串返回空对象', () => {
    expect(repairToolCallJson('')).toEqual({})
    expect(repairToolCallJson('  ')).toEqual({})
  })
  it('尾逗号修复', () => {
    expect(repairToolCallJson('{"path":"a.txt",}')).toEqual({ path: 'a.txt' })
  })
  it('单引号修复', () => {
    expect(repairToolCallJson("{'path':'a.txt'}")).toEqual({ path: 'a.txt' })
  })
  it('键没引号修复', () => {
    expect(repairToolCallJson('{path:"a.txt"}')).toEqual({ path: 'a.txt' })
  })
  it('字符串内换行转义', () => {
    expect(repairToolCallJson('{"content":"line1\nline2"}')).toEqual({ content: 'line1\nline2' })
  })
  it('完全无法修复返回 null', () => {
    expect(repairToolCallJson('not json at all')).toBeNull()
  })
})

describe('stepToolFilter（智能步骤控制）', () => {
  it('第一步只给只读工具', () => {
    const r = stepToolFilter(0)
    expect(r).toBeDefined()
    expect(r).toContain('read_file')
    expect(r).toContain('search_content')
    expect(r).not.toContain('write_file')
    expect(r).not.toContain('shell')
  })
  it('后续步骤不限工具', () => {
    expect(stepToolFilter(1)).toBeUndefined()
    expect(stepToolFilter(5)).toBeUndefined()
  })
})
