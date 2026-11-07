#!/usr/bin/env node
/**
 * 存量发行版说明回填（v14.13.1）
 *
 *   GH_TOKEN=xxx node scripts/backfill-release-notes.mjs
 *
 * 遍历全部 GitHub 发行版（含草稿，自动翻页），body 为空/过短的用
 * release-notes.mjs 同一逻辑补齐；已有正文的跳过不覆盖。
 */
import { execFileSync } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'deepseekv5/jutian-agent'
let TOKEN = process.env.GH_TOKEN || ''
if (!TOKEN) {
  // 从 origin remote URL 里取（origin 已内嵌 token）
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf-8' })
    const m = url.match(/https:\/\/[^:]+:([^@]+)@/)
    if (m) TOKEN = m[1]
  } catch { /* ignore */ }
}
if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(1) }

const gh = (path, opts = {}) => {
  const r = spawnSync('curl', ['-s', '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Accept: application/vnd.github+json',
    ...(opts.data ? ['--data', JSON.stringify(opts.data), '-X', opts.method || 'POST'] : []),
    `https://api.github.com/repos/${REPO}/${path}`], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  try { return JSON.parse(r.stdout) } catch { return { __raw: r.stdout } }
}

const gen = (tag) => {
  const r = spawnSync('node', ['scripts/release-notes.mjs', '--tag', tag], { cwd: ROOT, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
  return r.stdout || ''
}

// 翻页拉全量（含草稿）
const all = []
for (let page = 1; page <= 10; page++) {
  const rs = gh(`releases?per_page=100&page=${page}`)
  if (!Array.isArray(rs) || rs.length === 0) break
  all.push(...rs)
  if (rs.length < 100) break
}
console.log(`共 ${all.length} 个发行版`)

let patched = 0, skipped = 0, failed = 0
for (const rel of all) {
  const body = String(rel.body || '').trim()
  if (body.length >= 50) { skipped++; continue }
  const tag = rel.tag_name || rel.name || ''
  if (!/^v?\d+\.\d+/.test(tag)) { skipped++; continue }
  const notes = gen(tag)
  if (!notes.trim()) { failed++; console.log(`  ✗ ${tag} 生成失败`); continue }
  const r = gh(`releases/${rel.id}`, { method: 'PATCH', data: { body: notes } })
  if (r && (r.id || r.tag_name)) { patched++; console.log(`  ✓ ${tag}${rel.draft ? '（草稿）' : ''} ← ${notes.length} 字`) }
  else { failed++; console.log(`  ✗ ${tag} PATCH 失败: ${JSON.stringify(r).slice(0, 100)}`) }
}
console.log(`完成：回填 ${patched}，跳过 ${skipped}，失败 ${failed}`)
