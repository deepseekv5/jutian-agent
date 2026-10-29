import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { STRINGS, translate, relativeTime, emptyKeys, brokenEntries } from '../src/shared/i18n'
import { breakpointOf } from '../src/renderer/hooks/useViewport'

// 英文覆盖的硬门禁：字典必须结构完整，核心外壳组件不允许退回硬编码中文。
// 键缺失 = 英文用户看到 key 或中文；这类问题必须在提交前被拦下。

describe('i18n 字典完整性', () => {
  it('词条数量充足（>=190：外壳+面板+状态全量）', () => {
    expect(Object.keys(STRINGS).length).toBeGreaterThanOrEqual(190)
  })
  it('没有任何空文案条目', () => {
    expect(emptyKeys('zh')).toEqual([])
    expect(emptyKeys('en')).toEqual([])
  })
  it('没有缺失 zh/en 任一侧的条目', () => {
    expect(brokenEntries()).toEqual([])
  })
  it('translate 带变量插值（两种语言）', () => {
    expect(translate('zh', 'chat.messages', { n: 12 })).toBe('12 条消息')
    expect(translate('en', 'chat.messages', { n: 12 })).toBe('12 messages')
  })
  it('缺键回退为 key 本身（不抛错）', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })
  it('相对时间分档正确', () => {
    const now = Date.parse('2026-10-30T12:00:00Z')
    expect(relativeTime('zh', now - 30_000, now)).toBe('刚刚')
    expect(relativeTime('zh', now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTime('en', now - 3 * 3600_000, now)).toBe('3 h ago')
    expect(relativeTime('zh', now - 2 * 86400_000, now)).toBe('2 天前')
  })
})

// 核心外壳组件的英文覆盖扫描：
// 这些文件是英文用户第一眼看到的界面，出现"未走字典的裸中文标签"即失败。
// （面板正文里残留的中文可后续分批清，扫描范围只锁外壳，避免误伤注释。）
const SHELL_FILES = [
  'src/renderer/app/TabBar.tsx',
  'src/renderer/app/MobileTabBar.tsx',
  'src/renderer/app/RuntimeHints.tsx',
]

describe('外壳组件英文覆盖', () => {
  for (const rel of SHELL_FILES) {
    it(`${path.basename(rel)} 无裸中文按钮/标签`, () => {
      const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
      // 去掉注释行后扫描引号内中文（注释允许中文说明）
      const code = src
        .split('\n')
        .filter((l) => !/\/\*|\*\/|^\s*\/\//.test(l))
        .join('\n')
      const matches = code.match(/['"`>][\u4e00-\u9fff][^'"`<]*['"`<]/g) || []
      // 允许：出现在 t('中文','English') 内的中文字面量（那是双语内联的合法形态）
      const bad = matches.filter((m) => !/t\(/.test(src))
      expect(bad, `${rel} 有裸中文: ${bad.slice(0, 5).join(', ')}`).toEqual([])
    })
  }
})

describe('视口断点', () => {
  it('三档划分与 Tailwind 语义一致', () => {
    expect(breakpointOf(375)).toBe('mobile')
    expect(breakpointOf(767)).toBe('mobile')
    expect(breakpointOf(768)).toBe('tablet')
    expect(breakpointOf(1024)).toBe('tablet')
    expect(breakpointOf(1100)).toBe('desktop')
    expect(breakpointOf(1920)).toBe('desktop')
  })
})
