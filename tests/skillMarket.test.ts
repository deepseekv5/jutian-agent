import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter, sanitizeSkillId, isAllowedSkillFile,
  normalizeRemoteSkill, SKILL_SOURCES, SKILL_INSTALL_LIMITS,
} from '../src/shared/skillMarket'

// 真实技能市场（anthropics/skills 官方 + superpowers 社区）的纯逻辑对齐测试。
// 白名单与限额是安全边界：错放一个 id = 任意路径写盘，错放一个扩展名 = 可执行载荷落地。

describe('parseFrontmatter', () => {
  it('标准 frontmatter：name/description/version', () => {
    const fm = parseFrontmatter('---\nname: pdf\ndescription: PDF 处理\nversion: 1.2.0\n---\n\n# 正文')
    expect(fm.name).toBe('pdf')
    expect(fm.description).toBe('PDF 处理')
    expect(fm.version).toBe('1.2.0')
  })
  it('引号包裹的值会被剥掉', () => {
    const fm = parseFrontmatter('---\nname: "quoted"\ndescription: \'single\'\n---')
    expect(fm.name).toBe('quoted')
    expect(fm.description).toBe('single')
  })
  it('无 frontmatter 返回空对象', () => {
    expect(parseFrontmatter('# 只有正文\n没有元数据')).toEqual({})
  })
  it('非字符串输入安全返回空', () => {
    expect(parseFrontmatter(undefined as any)).toEqual({})
    expect(parseFrontmatter(null as any)).toEqual({})
  })
  it('frontmatter 未闭合视为无', () => {
    expect(parseFrontmatter('---\nname: x\n没有结束线')).toEqual({})
  })
  it('YAML 折叠块（description: >）把缩进续行归并成一行', () => {
    const fm = parseFrontmatter('---\nname: x\ndescription: >\n  第一行说明\n  第二行说明\nversion: 1.0.0\n---')
    expect(fm.description).toBe('第一行说明 第二行说明')
  })
  it('块标量指示符若没有续行，值为空不产出 ">" 脏数据', () => {
    const fm = parseFrontmatter('---\nname: x\ndescription: >\n---')
    expect(fm.description).toBe('')
  })
})

describe('sanitizeSkillId', () => {
  it('常规 id 原样通过', () => {
    expect(sanitizeSkillId('algorithmic-art')).toBe('algorithmic-art')
    expect(sanitizeSkillId('PDF-Tools')).toBe('pdf-tools')
  })
  it('空格与非法字符折成连字符', () => {
    expect(sanitizeSkillId('my skill v2')).toBe('my-skill-v2')
  })
  it('拒绝路径逃逸', () => {
    expect(sanitizeSkillId('..')).toBeNull()
    expect(sanitizeSkillId('a..b')).toBeNull()
    expect(sanitizeSkillId('.hidden')).toBeNull()
  })
  it('拒绝空与超长', () => {
    expect(sanitizeSkillId('')).toBeNull()
    expect(sanitizeSkillId('   ')).toBeNull()
    expect(sanitizeSkillId('a'.repeat(65))).toBeNull()
  })
  it('非字符串输入返回 null', () => {
    expect(sanitizeSkillId(undefined as any)).toBeNull()
  })
})

describe('isAllowedSkillFile', () => {
  it('技能常用文本扩展放行', () => {
    for (const f of ['SKILL.md', 'scripts/run.py', 'notes.txt', 'config.json', 'setup.sh', 'main.ts']) {
      expect(isAllowedSkillFile(f)).toBe(true)
    }
  })
  it('二进制/可执行载荷拒绝', () => {
    for (const f of ['evil.exe', 'payload.bin', 'lib.so', 'run.dll', 'x.msi', 'a.deb']) {
      expect(isAllowedSkillFile(f)).toBe(false)
    }
  })
  it('隐藏文件与无扩展名拒绝', () => {
    expect(isAllowedSkillFile('.gitignore')).toBe(false)
    expect(isAllowedSkillFile('Makefile')).toBe(false)
    expect(isAllowedSkillFile('')).toBe(false)
  })
  it('按最后一段取扩展名', () => {
    expect(isAllowedSkillFile('a/b/c.md')).toBe(true)
    expect(isAllowedSkillFile('a/b/c.exe')).toBe(false)
  })
})

describe('normalizeRemoteSkill', () => {
  const src = SKILL_SOURCES[0]
  it('官方源 + frontmatter → 完整条目', () => {
    const item = normalizeRemoteSkill(
      { name: 'pdf', path: 'skills/pdf' }, src,
      '---\nname: pdf\ndescription: PDF 处理技能\nversion: 2.0.0\n---\n# PDF',
    )
    expect(item).toMatchObject({
      id: 'pdf', name: 'pdf', description: 'PDF 处理技能', version: '2.0.0',
      author: 'anthropics', source: 'official', repo: 'anthropics/skills', path: 'skills/pdf',
    })
  })
  it('无描述的目录不是技能（模板/配置目录剔除）', () => {
    expect(normalizeRemoteSkill({ name: 'template', path: 'skills/template' }, src, '---\nname: template\n---')).toBeNull()
    expect(normalizeRemoteSkill({ name: 'x', path: 'skills/x' }, src, undefined)).toBeNull()
  })
  it('目录名不安全时拒绝', () => {
    expect(normalizeRemoteSkill({ name: '..', path: 'skills/..' }, src, '---\ndescription: x\n---')).toBeNull()
  })
  it('frontmatter 缺 name 用目录名兜底', () => {
    const item = normalizeRemoteSkill({ name: 'tooling', path: 'skills/tooling' }, src, '---\ndescription: 工具集\n---')
    expect(item?.name).toBe('tooling')
  })
  it('市场源配置：官方与社区各一个真实仓库', () => {
    expect(SKILL_SOURCES).toHaveLength(2)
    expect(SKILL_SOURCES[0]).toMatchObject({ repo: 'anthropics/skills', dir: 'skills', source: 'official' })
    expect(SKILL_SOURCES[1].source).toBe('community')
  })
  it('安装限额存在且合理', () => {
    expect(SKILL_INSTALL_LIMITS.maxFileBytes).toBeLessThanOrEqual(1024 * 1024)
    expect(SKILL_INSTALL_LIMITS.maxFiles).toBeGreaterThanOrEqual(20)
    expect(SKILL_INSTALL_LIMITS.maxTotalBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(SKILL_INSTALL_LIMITS.maxDepth).toBeGreaterThanOrEqual(2)
  })
})
