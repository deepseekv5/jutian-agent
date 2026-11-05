// 把 release 构建产物上传到 Gitee 发行版附件（v14.9.3）
//
// 由 release-* 工作流在「上传到 GitHub Release」之后调用。
// 文件已经在 runner 的 dist-out/ 里（刚构建出来的），直接读本地文件直传 Gitee——
// 零下载、零用户流量，也不依赖 GitHub CDN 速率。
//
// 环境变量（由 workflow 提供）：
//   GITEE_USER       Gitee 用户名
//   GITEE_TOKEN      Gitee 私人令牌
//   GITEE_TAG        tag 名（如 v14.9.0）
//   GITEE_DIST_DIR   产物目录（默认 dist-out）

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const USER = process.env.GITEE_USER || ''
const TOKEN = process.env.GITEE_TOKEN || ''
const TAG = process.env.GITEE_TAG || ''
const DIR = process.env.GITEE_DIST_DIR || 'dist-out'
const REPO = `${USER}/jutian-agent`

if (!USER || !TOKEN || !TAG) {
  console.log('::warning::未配置 GITEE_USER/GITEE_TOKEN/GITEE_TAG，跳过 Gitee 附件上传')
  process.exit(0)
}

const GEE = (path, query = '') => `https://gitee.com/api/v5/repos/${REPO}${path}?access_token=${encodeURIComponent(TOKEN)}${query ? '&' + query : ''}`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// 1. 找该 tag 的 Gitee 发行版 id（分页）
let releaseId = ''
for (let page = 1; page <= 3 && !releaseId; page++) {
  const r = await fetch(GEE('/releases', `per_page=100&page=${page}`), { signal: AbortSignal.timeout(30000) })
  if (!r.ok) break
  const list = await r.json()
  if (!Array.isArray(list)) break
  const hit = list.find(x => x.tag_name === TAG)
  if (hit) releaseId = String(hit.id)
  if (list.length < 100) break
}
if (!releaseId) {
  console.log(`::warning::Gitee 上还没有 ${TAG} 的发行版（sync-gitee 可能尚未创建），跳过附件上传`)
  process.exit(0)
}
console.log(`Gitee ${TAG} 发行版 id: ${releaseId}`)

// 2. 已有附件名（去重）
const have = new Set()
try {
  const r = await fetch(GEE(`/releases/${releaseId}/attach_files`), { signal: AbortSignal.timeout(30000) })
  if (r.ok) {
    const list = await r.json()
    if (Array.isArray(list)) for (const a of list) have.add(a.name)
  }
} catch { /* 查不到就按不去重 */ }
console.log(`已有附件: ${have.size}`)

// 3. 上传 dist-out 里的文件
const files = readdirSync(DIR).filter(f => !f.endsWith('.blockmap') && !f.startsWith('latest'))
let done = 0, fail = 0
for (const name of files) {
  if (have.has(name)) { console.log('· 已存在', name); continue }
  const buf = readFileSync(join(DIR, name))
  let ok = false
  for (let i = 0; i < 3 && !ok; i++) {
    try {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: 'application/octet-stream' }), name)
      const r = await fetch(GEE(`/releases/${releaseId}/attach_files`), {
        method: 'POST', body: fd, signal: AbortSignal.timeout(300_000),
      })
      if (r.ok) { done++; console.log(`✓ ${name}（${Math.round(buf.length / 1048576)}MB）`); ok = true }
      else throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120))
    } catch (e) {
      console.log(`· ${name} 失败：${String(e.message || e).slice(0, 120)}，重试...`)
      await sleep(3000 * (i + 1))
    }
  }
  if (!ok) fail++
}
console.log(`\n上传 ${done}，失败 ${fail}`)
