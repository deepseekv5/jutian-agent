// Gitee 发行版同步脚本（v14.9.2）—— 文本 + 安装包附件
//
// 在 GitHub Actions 上运行：GitHub runner 下载 GitHub Release 资产 → 直传 Gitee。
// 流量路径：GitHub Releases CDN ↔ runner ↔ Gitee，用户本机零流量。
//
// 环境变量：
//   GITHUB_TOKEN      GitHub 自动注入（读 Releases、下载资产）
//   GITEE_USER        Gitee 用户名
//   GITEE_TOKEN       Gitee 私人令牌
//   GITEE_ONLY_TAG    只同步该 tag（tag push / dispatch 指定）
//   GITEE_SYNC_ASSETS 1=同步资产 0=只同步文本

const GH_REPO = 'deepseekv5/jutian-agent'
const GITEE_REPO = `${process.env.GITEE_USER || ''}/jutian-agent`
const GH_TOKEN = process.env.GITHUB_TOKEN
const GITEE_TOKEN = process.env.GITEE_TOKEN
const onlyTag = process.env.GITEE_ONLY_TAG || ''
const syncAssets = process.env.GITEE_SYNC_ASSETS === '1'
const GEE = (path, query = '') => `https://gitee.com/api/v5/repos/${GITEE_REPO}${path}?access_token=${encodeURIComponent(GITEE_TOKEN || '')}${query ? '&' + query : ''}`

if (!GITEE_TOKEN || !process.env.GITEE_USER) {
  console.log('::warning::未配置 GITEE_USER/GITEE_TOKEN，跳过')
  process.exit(0)
}

const ghApi = (url) => fetch(url, {
  headers: { Authorization: `Bearer ${GH_TOKEN || ''}`, Accept: 'application/vnd.github+json' },
  signal: AbortSignal.timeout(30000),
})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// 资产白名单（v14.9.2）：29 个资产里含大量 blockmap / latest.yml /
// 重复别名（agent-* 与 jutian-agent-* 是同一份包），全传会耗 runner 时间且
// 触发 Gitee 附件数限制。只保留各平台主安装包 + asar 更新包。
const ASSET_ALLOW = [
  /-app\.asar$/i,
  /jutian-agent-[\d.]+-x64\.dmg$/i,
  /jutian-agent-[\d.]+-arm64\.dmg$/i,
  /jutian-agent-[\d.]+-x64-setup\.exe$/i,
  /jutian-agent-[\d.]+-arm64-setup\.exe$/i,
  /jutian-agent-[\d.]+_amd64\.deb$/i,
  /jutian-agent-[\d.]+_arm64\.deb$/i,
  /jutian-agent-[\d.]+-x86_64\.AppImage$/i,
  /jutian-agent-[\d.]+-arm64\.AppImage$/i,
  /jutian-local-[\d.]+\.apk$/i,
  /jutian-remote-[\d.]+\.apk$/i,
  /jutian-mobile-[\d.]+\.zip$/i,
]
const assetAllowed = (name) => ASSET_ALLOW.some(re => re.test(name))


// ── 1. GitHub 发行版 ──
const releases = []
if (onlyTag) {
  // tag 推送时 Release 构建工作流还在跑（15~40min），等首次出现资产即开始
  // （不等"稳定"——构建期资产数持续增长会让稳定判定永不满足）
  let j = null, waited = 0
  console.log(`· GITEE_ONLY_TAG=${onlyTag}，开始检查 GitHub release ...`)
  while (waited < 45) {
    const r = await ghApi(`https://api.github.com/repos/${GH_REPO}/releases/tags/${encodeURIComponent(onlyTag)}`)
    if (r.ok) {
      const cur = await r.json()
      const n = Array.isArray(cur.assets) ? cur.assets.length : 0
      if (n > 0) { j = cur; break }
      console.log(`· 等待资产就绪（${waited}min，当前 0 个）...`)
    } else {
      console.log(`· 等待 GitHub release 创建（${waited}min，HTTP ${r.status}）...`)
    }
    await sleep(60_000)
    waited += 1
  }
  if (j) {
    releases.push({
      tag: String(j.tag_name || ''),
      name: String(j.name || j.tag_name || '').slice(0, 50),
      body: String(j.body || '').trim(),
      sha: String(j.target_commitish || ''),
      assets: (Array.isArray(j.assets) ? j.assets : [])
        .filter(a => assetAllowed(a.name))
        .map(a => ({ name: a.name, url: a.browser_download_url, id: a.id, size: a.size })),
    })
  } else {
    console.log(`::warning::GitHub 上没有 ${onlyTag} 的发行版，跳过`)
    process.exit(0)
  }
} else {
  // 全量：最多 3 页（101 个发行版）
  for (let page = 1; page <= 3; page++) {
    const r = await ghApi(`https://api.github.com/repos/${GH_REPO}/releases?per_page=100&page=${page}`)
    if (!r.ok) break
    const list = await r.json()
    if (!Array.isArray(list) || !list.length) break
    for (const x of list) {
      releases.push({
        tag: String(x.tag_name || ''),
        name: String(x.name || x.tag_name || '').slice(0, 50),
        body: String(x.body || '').trim(),
        sha: String(x.target_commitish || ''),
        assets: [], // 历史模式不搬资产（数百个安装包会耗 runner 时间）
      })
    }
    if (list.length < 100) break
  }
}
console.log(`待同步发行版: ${releases.length} | 资产同步: ${syncAssets ? '开' : '关'}`)

// ── 2. Gitee 已有发行版（tag → id / 附件名）──
const geMap = new Map()
for (let page = 1; page <= 3; page++) {
  const r = await fetch(GEE('/releases', `per_page=100&page=${page}`), { signal: AbortSignal.timeout(30000) })
  if (!r.ok) break
  const list = await r.json()
  if (!Array.isArray(list) || !list.length) break
  for (const x of list) {
    geMap.set(x.tag_name, {
      id: String(x.id || ''),
      assets: new Set((Array.isArray(x.assets) ? x.assets : []).map(a => a.name)),
    })
  }
  if (list.length < 100) break
}
console.log(`Gitee 已有发行版: ${geMap.size}`)

// ── 3. 逐版同步 ──
let textDone = 0, textFail = 0, assetDone = 0, assetFail = 0

for (const rel of releases) {
  let info = geMap.get(rel.tag)
  let geId = info?.id || ''

  // 3a. 发行版文本
  if (!geId) {
    for (let i = 0; i < 3 && !geId; i++) {
      const r = await fetch(GEE('/releases'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
        // Gitee POST token 必须 query；target_commitish 必填
        body: JSON.stringify({
          tag_name: rel.tag,
          name: rel.name,
          body: rel.body || `${rel.name}：见 GitHub Release 完整说明。`,
          target_commitish: rel.sha,
        }),
      })
      if (r.ok) geId = String((await r.json()).id || '')
      else await sleep(2000 * (i + 1))
    }
    if (geId) { textDone++; console.log('✓ 文本', rel.tag) }
    else { textFail++; console.log('✗ 文本', rel.tag); continue }
    info = { id: geId, assets: new Set() }
  } else {
    console.log('· 文本已存在', rel.tag)
  }

  // 3b. 安装包资产（runner 下载 → Gitee attach_files）
  if (!syncAssets || rel.assets.length === 0 || !geId) continue
  // Gitee 发行版详情的 assets 只有自动生成的 zip/tar.gz，
  // 上传的附件要走 attach_files 端点单独查（去重依据）
  try {
    const af = await fetch(GEE(`/releases/${geId}/attach_files`), { signal: AbortSignal.timeout(30000) })
    if (af.ok) {
      const list = await af.json()
      if (Array.isArray(list)) for (const a of list) info.assets.add(a.name)
    }
  } catch { /* 查不到就按不去重处理（最坏重复上传，Gitee 会报错） */ }
  for (const a of rel.assets) {
    if (info.assets.has(a.name)) { console.log('· 资产已存在', a.name); continue }
    let ok = false
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        console.log(`→ 下载 ${a.name} ...`)
        // 用 GitHub API 资产端点（api.github.com/.../releases/assets/{id}）：
        // browser_download_url 会 302 到 objects.githubusercontent.com，带 Authorization
        // 头跟随重定向会被拒（runner 上卡死数分钟），API 端点由 GitHub 侧代取。
        const dl = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/assets/${a.id}`, {
          headers: {
            Authorization: `Bearer ${GH_TOKEN || ''}`,
            Accept: 'application/octet-stream',
            'User-Agent': 'jutian-sync',
          },
          signal: AbortSignal.timeout(180_000),
        })
        if (!dl.ok) throw new Error('下载 HTTP ' + dl.status)
        const buf = Buffer.from(await dl.arrayBuffer())
        console.log(`→ 上传 ${a.name}（${Math.round(buf.length / 1048576)}MB）到 Gitee ...`)
        // Gitee 附件端点：POST /releases/{id}/attach_files，字段名 file，token 在 query
        const fd = new FormData()
        fd.append('file', new Blob([buf], { type: 'application/octet-stream' }), a.name)
        const up = await fetch(GEE(`/releases/${geId}/attach_files`), {
          method: 'POST', body: fd, signal: AbortSignal.timeout(120_000),
        })
        if (up.ok) { assetDone++; console.log(`✓ 资产 ${a.name}（${Math.round(buf.length / 1048576)}MB）`); ok = true }
        else throw new Error('上传 HTTP ' + up.status + ' ' + (await up.text()).slice(0, 120))
      } catch (e) {
        console.log(`· 资产 ${a.name} 失败：${String(e.message || e).slice(0, 150)}，重试...`)
        await sleep(3000 * (i + 1))
      }
    }
    if (!ok) assetFail++
  }
}

console.log(`\n文本：新建 ${textDone}，失败 ${textFail}；资产：上传 ${assetDone}，失败 ${assetFail}`)
if (textFail > 0) process.exit(1)
