#!/usr/bin/env node
/**
 * 发行版清理（v14.13.2）：
 *   GitHub：删除 untagged-* 匿名草稿（CI 重复上传的残片）——仅当其资产
 *           全部被对应版本正式发行版覆盖时才删，否则保留并报告。
 *   Gitee：删除 untagged-* 垃圾记录（文本同步误建，无资产）。
 *
 *   GH_TOKEN=xxx GITEE_TOKEN=xxx node scripts/cleanup-release-drafts.mjs [--apply]
 * 不带 --apply 只审计不删。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')
let GH = process.env.GH_TOKEN || ''
try {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf-8' })
  GH = GH || (url.match(/https:\/\/[^:]+:([^@]+)@/)?.[1] || '')
} catch { /* ignore */ }
const GITEE = process.env.GITEE_TOKEN || ''

const gh = (path, opts = {}) => {
  const args = ['-s', '-H', `Authorization: Bearer ${GH}`, `https://api.github.com/repos/deepseekv5/jutian-agent/${path}`]
  if (opts.data) args.push('--data', JSON.stringify(opts.data), '-X', opts.method)
  const r = spawnSync('curl', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  try { return JSON.parse(r.stdout) } catch { return null }
}

const all = []
for (let page = 1; page <= 10; page++) {
  const rs = gh(`releases?per_page=100&page=${page}`)
  if (!Array.isArray(rs) || !rs.length) break
  all.push(...rs)
  if (rs.length < 100) break
}
const tagged = all.filter((r) => !r.draft && /^v?\d+/.test(r.tag_name || ''))
const drafts = all.filter((r) => r.draft && (r.tag_name || '').startsWith('untagged-'))
console.log(`正式 ${tagged.length} · 匿名草稿 ${drafts.length}`)

let deleted = 0, kept = 0, promoted = 0
for (const d of drafts) {
  const versions = new Set((d.assets || []).map((a) => (a.name.match(/-(\d+\.\d+\.\d+)-/) || [])[1]).filter(Boolean))
  const ver = [...versions][0]
  if (!ver) { console.log(`  ⚠ 保留 ${d.tag_name.slice(0, 18)}（资产无版本号）`); kept++; continue }
  const target = tagged.find((t) => (t.tag_name || '').replace(/^v/, '') === ver)

  if (!target) {
    // 无正式版 → 草稿转正（tag 绑定 + 发布）
    if (!APPLY) { console.log(`  转正（可执行） ${d.tag_name.slice(0, 18)} → v${ver}`); continue }
    const r = gh(`releases/${d.id}`, { method: 'PATCH', data: { tag_name: `v${ver}`, name: `v${ver}`, draft: false } })
    if (r && r.id) { promoted++; console.log(`  ✓ 转正 v${ver}（${d.assets.length} 资产）`) }
    else { kept++; console.log(`  ✗ 转正失败 ${d.tag_name.slice(0, 18)}: ${JSON.stringify(r).slice(0, 100)}`) }
    continue
  }

  const have = new Set(target.assets.map((a) => a.name))
  const draftUniques = (d.assets || []).filter((a) => !have.has(a.name))
  const taggedUniques = target.assets.filter((a) => !(d.assets || []).some((x) => x.name === a.name))
  if (!draftUniques.length) {
    // 草稿是子集 → 直接删
    if (!APPLY) { console.log(`  删（可执行） ${d.tag_name.slice(0, 18)} → v${ver} 草稿全被正式版覆盖`); continue }
    gh(`releases/${d.id}`, { method: 'DELETE' })
    deleted++; console.log(`  ✓ 已删 ${d.tag_name.slice(0, 18)}（v${ver} 全覆盖）`)
    continue
  }
  // 两边都有独有资产 → 谁更全谁当正式版（正式版 = 最大集），换位必然丢一边，报告清楚
  console.log(`  ⚠ v${ver} 两边各有独有：草稿 ${d.assets.length}（独 ${draftUniques.length}） vs 正式 ${target.assets.length}（独 ${taggedUniques.length}）${APPLY ? '' : '（审计模式未动）'}`)
  kept++
  for (const a of draftUniques.slice(0, 3)) console.log(`     草稿独有: ${a.name}`)
  for (const a of taggedUniques.slice(0, 3)) console.log(`     正式独有: ${a.name}`)
}
console.log(`GitHub 完成：删 ${deleted} · 转正 ${promoted} · 留 ${kept}`)
console.log(`GitHub 完成：删 ${deleted} 留 ${kept}`)


// ── 去「洗」：通用填充文的发行版改为一行诚实说明（有真实公告段的不动） ──
const oneliner = (tag) => `${tag} —— 本版本早于公告体系，完整更新内容见 [GitHub Release 同名版本](https://github.com/deepseekv5/jutian-agent/releases/tag/${tag}) 与仓库提交历史。`
const isFiller = (b) => b.includes('本版本以稳定性与安全为主') && !b.split('\n').some((l) => /v\d+\.\d+\.\d+：/.test(l))
const genNotes = (tag) => {
  const r = spawnSync('node', ['scripts/release-notes.mjs', '--tag', tag], { cwd: ROOT, encoding: 'utf-8' })
  return r.stdout || ''
}
for (const rel of all) {
  const b = String(rel.body || '')
  const tag = rel.tag_name
  if (!isFiller(b, tag)) continue
  const real = genNotes(tag)
  const body = real.includes('本版本以稳定性与安全为主') ? oneliner(tag) : real
  if (!APPLY) { console.log(`  GH 一行化（可执行） ${tag}`); continue }
  gh(`releases/${rel.id}`, { method: 'PATCH', data: { body } })
}
console.log('GitHub 一行化完成')

// ── Gitee：untagged 垃圾（无资产） ──
if (GITEE) {
  const gitee = (path, opts = {}) => {
    const sep = path.includes('?') ? '&' : '?'
    const args = ['-s', '-H', 'Content-Type: application/json', `https://gitee.com/api/v5${path}${sep}access_token=${GITEE}`]
    if (opts.data) args.push('--data', JSON.stringify(opts.data), '-X', opts.method || 'POST')
    const r = spawnSync('curl', args, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 })
    try { return JSON.parse(r.stdout) } catch { return null }
  }
  let gdel = 0
  for (let page = 1; page <= 15; page++) {
    const rs = gitee(`/repos/deepseekv5/jutian-agent/releases?page=${page}&per_page=20`)
    if (!Array.isArray(rs) || !rs.length) break
    for (const rel of rs) {
      if ((rel.tag_name || '').startsWith('untagged-')) {
        if (!APPLY) { console.log(`  Gitee 垃圾（可删） ${rel.tag_name.slice(0, 20)}`); continue }
        gitee(`/repos/deepseekv5/jutian-agent/releases/${rel.id}`, { method: 'DELETE' })
        gdel++
        continue
      }
      const b = String(rel.body || '')
      const tag = rel.tag_name
      if (!/^v?\d/.test(tag) || !isFiller(b, tag)) continue
      const real = genNotes(tag)
      const body = real.includes('本版本以稳定性与安全为主') ? oneliner(tag) : real
      if (!APPLY) { console.log(`  Gitee 一行化（可执行） ${tag}`); continue }
      gitee(`/repos/deepseekv5/jutian-agent/releases/${rel.id}`, { method: 'PATCH', data: { tag_name: tag, name: rel.name || tag, body } })
    }
    if (rs.length < 20) break
  }
  console.log(APPLY ? `Gitee 完成：删 ${gdel} 个 untagged` : 'Gitee 审计完成（未删）')
} else {
  console.log('（未提供 GITEE_TOKEN，跳过 Gitee 清理）')
}
