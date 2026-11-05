// Gitee 发行版文本同步（v14.9.3）
//
// 只同步发行版「文本」（tag/name/body/commit）。安装包附件由 4 个 release-*
// 工作流在构建完成后直接上传（scripts/upload-gitee-assets.mjs）——它们本地就有
// 产物，零额外下载、零用户本机流量，比在这里从 GitHub CDN 再下载一遍快得多。
//
// 环境变量：
//   GITHUB_TOKEN      GitHub 自动注入（读 Releases）
//   GITEE_USER        Gitee 用户名
//   GITEE_TOKEN       Gitee 私人令牌
//   GITEE_ONLY_TAG    只同步该 tag；为空=补全部历史

const GH_REPO = 'deepseekv5/jutian-agent'
const GITEE_REPO = `${process.env.GITEE_USER || ''}/jutian-agent`
const GH_TOKEN = process.env.GITHUB_TOKEN
const GITEE_TOKEN = process.env.GITEE_TOKEN
const onlyTag = process.env.GITEE_ONLY_TAG || ''

if (!GITEE_TOKEN || !process.env.GITEE_USER) {
  console.log('::warning::未配置 GITEE_USER/GITEE_TOKEN，跳过')
  process.exit(0)
}

const GEE = (path, query = '') => `https://gitee.com/api/v5/repos/${GITEE_REPO}${path}?access_token=${encodeURIComponent(GITEE_TOKEN)}${query ? '&' + query : ''}`
const ghApi = (url) => fetch(url, {
  headers: { Authorization: `Bearer ${GH_TOKEN || ''}`, Accept: 'application/vnd.github+json' },
  signal: AbortSignal.timeout(30000),
})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 1. GitHub 发行版 ──
const releases = []
if (onlyTag) {
  const r = await ghApi(`https://api.github.com/repos/${GH_REPO}/releases/tags/${encodeURIComponent(onlyTag)}`)
  if (r.ok) {
    const j = await r.json()
    releases.push({
      tag: String(j.tag_name || ''),
      name: String(j.name || j.tag_name || '').slice(0, 50),
      body: String(j.body || '').trim(),
      sha: String(j.target_commitish || ''),
    })
  } else {
    console.log(`::warning::GitHub 上没有 ${onlyTag} 的发行版（构建工作流可能尚未创建），跳过`)
    process.exit(0)
  }
} else {
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
      })
    }
    if (list.length < 100) break
  }
}
console.log(`待同步发行版: ${releases.length}`)

// ── 2. Gitee 已有发行版 ──
const have = new Set()
for (let page = 1; page <= 3; page++) {
  const r = await fetch(GEE('/releases', `per_page=100&page=${page}`), { signal: AbortSignal.timeout(30000) })
  if (!r.ok) break
  const list = await r.json()
  if (!Array.isArray(list) || !list.length) break
  for (const x of list) have.add(x.tag_name)
  if (list.length < 100) break
}
console.log(`Gitee 已有: ${have.size}`)

// ── 3. 只补缺失的文本 ──
let done = 0, fail = 0
for (const rel of releases) {
  if (have.has(rel.tag)) continue
  let ok = false
  for (let i = 0; i < 3 && !ok; i++) {
    // Gitee POST token 必须 query；target_commitish 必填
    const r = await fetch(GEE('/releases'), {
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
    ok = r.ok
    if (!ok) await sleep(2000 * (i + 1))
  }
  if (ok) { done++; console.log('✓', rel.tag) }
  else { fail++; console.log('✗', rel.tag) }
}
console.log(`\n新建 ${done} 个发行版，失败 ${fail} 个`)
if (fail > 0) process.exit(1)
