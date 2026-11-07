#!/usr/bin/env node
/**
 * Gitee 存量发行版说明回填（v14.13.1）
 *
 *   GITEE_USER=deepseekv5 GITEE_TOKEN=xxx node scripts/backfill-gitee-notes.mjs
 *
 * Gitee 的 sync-gitee-releases.mjs 只「新建」不「更新」，本脚本补存量：
 * body 过短的发行版用 release-notes.mjs 同一逻辑 PATCH（token 走 query string，
 * 放 body 会 401——Gitee API 的老坑）。
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const USER = process.env.GITEE_USER || 'deepseekv5'
const TOKEN = process.env.GITEE_TOKEN || ''
if (!TOKEN) { console.error('缺少 GITEE_TOKEN'); process.exit(1) }

const gitee = (path, opts = {}) => {
  const sep = path.includes('?') ? '&' : '?'
  const args = ['-s', '-H', 'Content-Type: application/json', `${'https://gitee.com/api/v5'}${path}${sep}access_token=${TOKEN}`]
  if (opts.data) args.push('--data', JSON.stringify(opts.data), '-X', opts.method || 'POST')
  const r = spawnSync('curl', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  try { return JSON.parse(r.stdout) } catch { return { __raw: r.stdout } }
}

const gen = (tag) => {
  const r = spawnSync('node', ['scripts/release-notes.mjs', '--tag', tag], { cwd: ROOT, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
  return r.stdout || ''
}

// 翻页拉全量（Gitee per_page 上限 20）
const all = []
for (let page = 1; page <= 15; page++) {
  const rs = gitee(`/repos/${USER}/jutian-agent/releases?page=${page}&per_page=20&direction=desc`)
  if (!Array.isArray(rs) || rs.length === 0) break
  all.push(...rs)
  if (rs.length < 20) break
}
console.log(`Gitee 共 ${all.length} 个发行版`)

let patched = 0, skipped = 0, failed = 0
for (const rel of all) {
  const body = String(rel.body || '').trim()
  if (body.length >= 50) { skipped++; continue }
  const tag = rel.tag_name || ''
  if (!/^v?\d+\.\d+/.test(tag)) { skipped++; continue }
  const notes = gen(tag)
  if (!notes.trim()) { failed++; console.log(`  ✗ ${tag} 生成失败`); continue }
  const r = gitee(`/repos/${USER}/jutian-agent/releases/${rel.id}`, {
    method: 'PATCH',
    data: { tag_name: tag, name: rel.name || tag, body: notes, target_commitish: 'main' },
  })
  if (r && (r.id || r.tag_name)) { patched++; console.log(`  ✓ ${tag} ← ${notes.length} 字`) }
  else { failed++; console.log(`  ✗ ${tag} PATCH 失败: ${JSON.stringify(r).slice(0, 120)}`) }
}
console.log(`完成：回填 ${patched}，跳过 ${skipped}，失败 ${failed}`)
