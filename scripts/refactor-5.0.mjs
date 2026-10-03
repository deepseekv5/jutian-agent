#!/usr/bin/env node
/**
 * refactor-5.0.mjs — 巨天agent v5.0 架构重构迁移脚本
 *
 * 目标：renderer 按功能域分目录，不删除任何功能。
 *   app/       应用壳（App/导航/状态栏/欢迎/命令面板）
 *   chat/      主对话
 *   code/      代码模式（原 components/code 整体上移一层）
 *   agents/    员工与集群
 *   computer/  Computer Use（v5.0 新增，目录先建好）
 *   panels/    独立功能面板
 *   media/     多媒体（通话/截图/PPT）
 *   settings/  设置与关于
 *   engine|hooks|store|types|utils 保持不变
 *
 * 做法	move → 全量重解析相对导入（先还原旧绝对目标，映射到新位置，再按新位置重写相对路径）→ 交给 tsc/vite 验证。
 * 幂等：重复运行安全（映射命中不存在的文件时跳过）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const R = path.join(ROOT, 'src/renderer')

/** 旧路径(相对 src/renderer) → 新路径 */
const MAP = {
  // 应用壳
  'App.tsx': 'app/App.tsx',
  'components/ErrorBoundary.tsx': 'app/ErrorBoundary.tsx',
  'components/BackgroundLayer.tsx': 'app/BackgroundLayer.tsx',
  'components/BrandMark.tsx': 'app/BrandMark.tsx',
  'components/BrowserOverlay.tsx': 'app/BrowserOverlay.tsx',
  'components/CommandPalette.tsx': 'app/CommandPalette.tsx',
  'components/StatusBar.tsx': 'app/StatusBar.tsx',
  'components/TabBar.tsx': 'app/TabBar.tsx',
  'components/Sidebar.tsx': 'app/Sidebar.tsx',
  'components/NewTabPage.tsx': 'app/NewTabPage.tsx',
  'components/WelcomeSplash.tsx': 'app/WelcomeSplash.tsx',
  'components/CliInstallModal.tsx': 'app/CliInstallModal.tsx',
  'components/PageShell.tsx': 'app/PageShell.tsx',
  // 主对话
  'components/ChatTab.tsx': 'chat/ChatTab.tsx',
  'components/ChatView.tsx': 'chat/ChatView.tsx',
  'components/MessageBubble.tsx': 'chat/MessageBubble.tsx',
  'components/MessageInput.tsx': 'chat/MessageInput.tsx',
  'components/ChatSidePanel.tsx': 'chat/ChatSidePanel.tsx',
  'components/GitPanel.tsx': 'chat/GitPanel.tsx',
  'components/ContextGauge.tsx': 'chat/ContextGauge.tsx',
  'components/WelcomeHero.tsx': 'chat/WelcomeHero.tsx',
  // 员工与集群
  'components/EmployeesPanel.tsx': 'agents/EmployeesPanel.tsx',
  'components/EmployeeChatTab.tsx': 'agents/EmployeeChatTab.tsx',
  'components/GroupChatTab.tsx': 'agents/GroupChatTab.tsx',
  // 面板
  'components/FilesTab.tsx': 'panels/FilesTab.tsx',
  'components/MemoryPanel.tsx': 'panels/MemoryPanel.tsx',
  'components/OutputsPanel.tsx': 'panels/OutputsPanel.tsx',
  'components/ScheduledTasksPanel.tsx': 'panels/ScheduledTasksPanel.tsx',
  'components/DiaryPanel.tsx': 'panels/DiaryPanel.tsx',
  'components/KnowledgeBase.tsx': 'panels/KnowledgeBase.tsx',
  'components/SkillMarket.tsx': 'panels/SkillMarket.tsx',
  'components/QQBotTab.tsx': 'panels/QQBotTab.tsx',
  'components/TasksPanel.tsx': 'panels/TasksPanel.tsx',
  'components/UsageStats.tsx': 'panels/UsageStats.tsx',
  // 多媒体
  'components/VoiceCall.tsx': 'media/VoiceCall.tsx',
  'components/ScreenshotCrop.tsx': 'media/ScreenshotCrop.tsx',
  'components/PPTView.tsx': 'media/PPTView.tsx',
  // 设置
  'components/SettingsModal.tsx': 'settings/SettingsModal.tsx',
  'components/AboutPage.tsx': 'settings/AboutPage.tsx',
}
// 目录整体迁移（内部相对引用不受影响，深度变化由重解析兜底）
const DIR_MAP = {
  'components/code': 'code',
  'components/agent': 'agents/agent',
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function toRel(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel.replace(/\.(tsx|ts)$/, '')
}

// 1) 目录整体迁移
for (const [from, to] of Object.entries(DIR_MAP)) {
  const src = path.join(R, from), dst = path.join(R, to)
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.renameSync(src, dst)
    console.log('dir  ', from, '→', to)
  }
}

// 2) 文件迁移
const moved = []
for (const [from, to] of Object.entries(MAP)) {
  const src = path.join(R, from), dst = path.join(R, to)
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.renameSync(src, dst)
    moved.push([from, to])
  }
}
console.log('moved', moved.length, 'files')

// 3) 全量重解析相对导入
const exts = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
function existsAs(p) { return exts.some(e => fs.existsSync(p + e)) }

const inverse = {}   // 新路径 → 旧路径
for (const [o, n] of Object.entries(MAP)) inverse[path.join(R, n)] = path.join(R, o)
// 目录整体迁移：目录下每个文件都要有 inverse（否则其相对导入会按新位置误解析）
for (const [fromDir, toDir] of Object.entries(DIR_MAP)) {
  const newDir = path.join(R, toDir)
  if (!fs.existsSync(newDir)) continue
  for (const f of walk(newDir)) {
    const rel = path.relative(newDir, f)
    inverse[f] = path.join(R, fromDir, rel)
  }
}

let fixedCount = 0
for (const file of walk(R)) {
  if (!/\.(ts|tsx)$/.test(file)) continue
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(R, file)

  // 该文件的旧位置（用于解析它迁移前的相对导入）
  const oldFile = inverse[file] || file

  const out = src.replace(/(from\s*|import\s*\(\s*|require\s*\(\s*)(['"])(\.\.?\/[^'"]+)\2/g, (m, pre, q, spec) => {
    // 以「旧位置」解析旧绝对目标
    const oldAbs = path.resolve(path.dirname(oldFile), spec)
    let base = path.relative(R, oldAbs)
    // 命中迁移映射（导入常省略扩展名，逐个尝试；目录整体迁移走 DIR_MAP 前缀替换）
    let mapped = MAP[base] || MAP[base + '.tsx'] || MAP[base + '.ts'] || MAP[base + '/index.tsx'] || MAP[base + '/index.ts']
    if (!mapped) {
      for (const [fromDir, toDir] of Object.entries(DIR_MAP)) {
        if (base === fromDir || base.startsWith(fromDir + '/')) {
          const rest = base.slice(fromDir.length)
          const cand = toDir + rest
          mapped = MAP[cand] || cand
          break
        }
      }
    }
    const targetAbs = mapped ? path.join(R, mapped) : oldAbs
    // 目标不存在 → 尝试扩展名补全；仍不存在则保持原样
    if (!existsAs(targetAbs)) return m
    const newSpec = toRel(file, targetAbs)
    if (newSpec === spec) return m
    fixedCount++
    return `${pre}${q}${newSpec}${q}`
  })

  if (out !== src) fs.writeFileSync(file, out)
}
console.log('rewrote imports in', fixedCount, 'places')

// 4) 清理空目录
const empty = []
function prune(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { prune(p); if (fs.readdirSync(p).length === 0) { fs.rmdirSync(p); empty.push(path.relative(ROOT, p)) } }
  }
}
prune(path.join(R, 'components'))
console.log('pruned:', empty.join(', ') || '(none)')
