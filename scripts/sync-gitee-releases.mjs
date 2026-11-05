// Gitee 发行版同步脚本（v14.9.1）—— 文本 + 安装包资产
//
// 在 GitHub Actions 上运行：GitHub 服务器下载资产 → 直传 Gitee。
// 流量路径：GitHub Releases CDN ↔ runner ↔ Gitee，用户本机零流量。
//
// 环境变量：
//   GITHUB_TOKEN    GitHub 自动注入（读 Releases、下载资产）
//   GITEE_USER      Gitee 用户名
//   GITEE_TOKEN     Gitee 私人令牌
//   GITEE_ONLY_TAG  只同步该 tag（tag push 触发时用）
//   GITEE_SYNC_ASSETS=0  跳过资产同步（只同步文本）

const GH_REPO = 'deepseekv5/jutian-agent'
const GITEE_REPO = `${process.env.GITEE_USER || ''}/jutian-agent`
const GH_TOKEN = process.env.GITHUB_TOKEN
const GITEE_TOKEN = process.env.GITEE_TOKEN
const onlyTag = process.env.GITEE_ONLY_TAG || ''
const syncAssets = process.env.GITEE_SYNC_ASSETS !== '0'

if (!GITEE_TOKEN || !process.env.GITEE_USER) {
  console.log('::warning::未配置 GITEE_USER/GITEE_TOKEN，跳过')
  process.exit(0)
}

const ghApi = async (url) => {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${GH_TOKEN || ''}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000),
  })
  return r
}

// ── 1. GitHub 发行版（指定 tag 或全量）──
const releases = []
if (onlyTag) {
  // 轮询等待资产（v14.9.1）：tag 推送时 Release 构建工作流还在跑，
  // 资产要 15~40 分钟后才出现。同步立即跑只会拿到空资产列表。
  let j = null, lastAssets = -1, waited = 0
  while (waited < 45) {
    const r = await ghApi(`https://api.github.com/repos/${GH_REPO}/releases/tags/${encodeURIComponent(onlyTag)}`)
    if (r.ok) {
      j = await r.json()
      const n = Array.isArray(j.assets) ? j.assets.length : 0
      if (n > 0 && n === lastAssets) break   // 资产数稳定 1 轮即就绪
      lastAssets = n
    }
    if (!j) { console.log(`· 等待 GitHub release 创建（${waited}min）...`); }
    else console.log(`· 等待资产就绪（${waited}min，当前 ${Array.isArray(j.assets) ? j.assets.length : 0} 个）...`)
    if (waited >= 45) break
    waited += 3
    await new Promise(s2 => setTimeout(s2, 60_000))
  }
  if (j) {
    releases.push({
      tag: String(j.tag_name || ''),
      name: String(j.name || j.tag_name || '').slice(0, 50),
      body: String(j.body || '').trim(),
      sha: String(j.target_commitish || ''),
      assets: Array.isArray(j.assets) ? j.assets.map(a => ({ name: a.name, url: a.browser_download_url, size: a.size })) : [],
    })
  } else {
    console.log(`::warning::GitHub 上没有 ${onlyTag} 的发行版，跳过`)
    process.exit(0)
  }
} else {
  for (let page = 1; page <= 2; page++) {
    const r = await ghApi(`https://api.github.com/repos/${GH_REPO}/releases?per_page=100&page=${page}`)
    if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`)
    const list = await r.json()
    if (!Array.isArray(list) || !list.length) break
    for (const x of list) {
      releases.push({
        tag: String(x.tag_name || ''),
        name: String(x.name || x.tag_name || '').slice(0, 50),
        body: String(x.body || '').trim(),
        sha: String(x.target_commitish || ''),
        assets: [], // 全量模式不取资产（历史版本资产太多，只补新发布的）
      })
    }
    if (list.length < 100) break
  }
}
console.log(`待同步发行版: ${releases.length}`)

// ── 2. Gitee 已有发行版（tag → release id）──
const geMap = new Map()
try {
  const r = await fetch(`https://gitee.com/api/v5/repos/${GITEE_REPO}/releases?access_token=${encodeURIComponent(GITEE_TOKEN)}&per_page=100`, { signal: AbortSignal.timeout(30000) })
  if (r.ok) {
    for (const x of await r.json()) geMap.set(x.tag_name, { id: String(x.id || ''), assets: Array.isArray(x.assets) ? x.assets.map(a => a.name) : [] })
  }
} catch (e) { console.log('Gitee 列表失败:', e.message) }
console.log(`Gitee 已有: ${geMap.size}`)

// ── 3. 逐版：建/更新发行版文本 → 同步资产 ──
let textDone = 0, textFail = 0, assetDone = 0, assetFail = 0

for (const rel of releases) {
  // ── 3a. 文本 ──
  let geId = geMap.get(rel.tag)?.id || ''
  if (!geId) {
    // 新建发行版（Gitee POST token 必须 query；target_commitish 必填）
    let created = null
    for (let i = 0; i < 3 && !created; i++) {
      const r = await fetch(`https://gitee.com/api/v5/repos/${GITEE_REPO}/releases?access_token=${encodeURIComponent(GITEE_TOKEN)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          tag_name: rel.tag,
          name: rel.name,
          body: rel.body || `${rel.name}：见 GitHub Release 完整说明。`,
          target_commitish: rel.sha,
        }),
      })
      if (r.ok) created = await r.json()
      else if (!r.ok) await new Promise(s => setTimeout(s, 2000 * (i + 1)))
    }
    if (created?.id) { geId = String(created.id); textDone++; console.log('✓ 文本', rel.tag) }
    else { textFail++; console.log('✗ 文本', rel.tag) }
  } else {
    console.log('· 文本已存在', rel.tag)
  }

  // ── 3b. 资产（只处理当前 tag，且该 tag 资产非空）──
  if (syncAssets && rel.assets.length > 0 && geId) {
    const existingAssets = new Set(geMap.get(rel.tag)?.assets || [])
    for (const a of rel.assets) {
      if (existingAssets.has(a.name)) { console.log('· 资产已存在', a.name); continue }
      // runner 下载（GitHub CDN → runner，零用户流量）
      let ok = false
      for (let i = 0; i < 3 && !ok; i++) {
        try {
          const dl = await fetch(a.url, {
            headers: { Authorization: `Bearer ${GH_TOKEN || ''}`, 'User-Agent': 'jutian-sync' },
            signal: AbortSignal.timeout(600_000), // 大文件最长 10 分钟
          })
          if (!dl.ok) throw new Error('HTTP ' + dl.status)
          const buf = Buffer.from(await dl.arrayBuffer())
          // 上传到 Gitee 发行版附件
          const up = await fetch(`https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/${geId}/attachments?access_token=${encodeURIComponent(GITEE_TOKEN)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data' },
            signal: AbortSignal.timeout(600_000),
            body: (() => {
              const fs = require('node:fs')
              const fd = new FormData()
              fd.append('file', new Blob([buf], { type: 'application/octet-stream' }), a.name)
              return fd
            })(),
          })
          if (up.ok) { assetDone++; console.log(`✓ 资产 ${a.name}（${Math.round(a.size / 1048576)}MB）`) }
          else throw new Error('HTTP ' + up.status + ' ' + (await up.text()).slice(0, 120))
          ok = true
        } catch (e) {
          console.log(`· 资产 ${a.name} 失败：${String(e.message || e).slice(0, 150)}，重试...`)
          await new Promise(s => setTimeout(s, 3000 * (i + 1)))
        }
      }
      if (!ok) assetFail++
    }
  }
}

console.log(`\n文本：新建 ${textDone}，失败 ${textFail}；资产：上传 ${assetDone}，失败 ${assetFail}`)
if (textFail > 0) process.exit(1)
