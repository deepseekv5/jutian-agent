#!/usr/bin/env node
/**
 * 发行说明单一来源生成器（v14.13.1）
 *
 *   node scripts/release-notes.mjs [--tag vX.Y.Z] [--platform mac|win|linux|android]
 *
 * 内容 = docs/notice.md 中该版本的公告段（唯一真相）+ 下载表 + 安装/更新 + 尾注。
 * 4 个 release-* 工作流在 gh-release 前执行并把 stdout 写入 body_path；
 * backfill-release-notes.mjs 复用同一逻辑回填存量发行版。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const tag = argOf('--tag') || ''
const platform = argOf('--platform') || ''

const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const version = (tag || '').replace(/^v/, '') || PKG.version

/** 从 notice.md 抽指定版本的公告段（无匹配返回 null） */
function noticeSection(ver) {
  let md = ''
  try { md = readFileSync(join(ROOT, 'docs', 'notice.md'), 'utf-8') } catch { return null }
  const re = new RegExp(`^v${ver.replace(/\./g, '\\.')}\\b`)
  // 新式条目：<!-- id: --> 分隔
  const parts = md.split(/<!--\s*id:\s*[^>]+-->/).slice(1)
  for (const part of parts) {
    const text = part.replace(/^\s*(<!--[^>]*-->\s*)+/, '').trim()
    if (re.test(text)) return text
  }
  // 旧式条目：直接扫描「vX.Y.Z：」开头的段落，到下一条目/注释/标题为止
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue
    const out = [lines[i]]
    for (let j = i + 1; j < lines.length; j++) {
      if (/^(<!--|v\d+\.\d+\.\d+：|#)/.test(lines[j].trim())) break
      out.push(lines[j])
    }
    return out.join('\n').trim()
  }
  return null
}

const section = noticeSection(version)
const DATE = new Date().toISOString().slice(0, 10)

const lines = []
lines.push(`# 巨天agent v${version}`)
lines.push('')
if (section) {
  lines.push(section)
  lines.push('')
} else {
  lines.push(`本版本以稳定性与安全为主。完整更新轨迹见 [公告文档](https://github.com/deepseekv5/jutian-agent/blob/main/docs/notice.md)。`)
  lines.push('')
}
lines.push('---')
lines.push('')
lines.push('## 下载')
lines.push('')
lines.push('| 平台 | 文件 |')
lines.push('|---|---|')
lines.push(`| macOS Apple Silicon | \`jutian-agent-${version}-arm64.dmg\` |`)
lines.push(`| macOS Intel | \`jutian-agent-${version}-x64.dmg\` |`)
lines.push(`| Windows | \`jutian-agent-${version}-x64-setup.exe\` |`)
if (platform === 'android') lines.push(`| Android | \`jutian-agent-${version}.apk\`（本地独立运行，无需手机装 App 以外的东西） |`)
else lines.push(`| Linux / Android | AppImage · .deb · .apk（见下方资产） |`)
lines.push('')
lines.push('## 安装与更新')
lines.push('')
lines.push('- **macOS**：拖入「应用程序」；首次打开若提示未公证，执行 `xattr -cr /Applications/巨天agent.app`')
lines.push('- **Windows**：下载 setup.exe 直接安装')
lines.push('- **已安装用户**：应用内「关于」页一键更新（asar 热更新，无需重下安装包）')
lines.push('- **终端**：`npm run tui` 或桌面 App 安装的 `jtcode`——Claude Code 式终端对话，同一套工具与安全门禁')
lines.push('')
lines.push('## 内置安全（默认开启）')
lines.push('')
lines.push('危险命令拦截（关机/抹盘/反弹 shell 等全位置判定 + 恶意命令库）· 提示词注入扫描 · 密钥屏蔽与 `{{KEY}}` 占位符——密钥全程不出本机、不进对话上下文。')
lines.push('')
lines.push('---')
lines.push('')
lines.push('本地优先 · MIT 许可 · 无遥测 · 全部数据存于 `~/.lyclaw/`')
lines.push('')
lines.push('巨天工作室 © 2026')

console.log(lines.join('\n'))
