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

import { execFileSync } from 'node:child_process'

// runner 的 Node fetch 连 Gitee 偶发 ConnectTimeoutError，统一用 curl（同 git push 的系统网络栈）
const curl = (args, timeoutSec = 60) => execFileSync('curl', ['-sS', '-m', String(timeoutSec), ...args], {
  encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
})
const giteeJson = (url, timeoutSec = 30) => JSON.parse(curl(['-H', 'Accept: application/json', url], timeoutSec) || '{}')

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
    // tag push 时构建工作流刚启动，GitHub Release 还不存在——
    // 用 tag + commit 信息直接建 Gitee 发行版（资产由 release 工作流随后补）
    const tagInfo = await ghApi(`https://api.github.com/repos/${GH_REPO}/git/ref/tags/${encodeURIComponent(onlyTag)}`)
    let sha = ''
    if (tagInfo.ok) {
      const t = await tagInfo.json()
      sha = String(t.object?.sha || '')
      if (t.object?.type === 'tag') {
        const at = await ghApi(`https://api.github.com/repos/${GH_REPO}/git/tags/${sha}`)
        if (at.ok) sha = String((await at.json()).object?.sha || sha)
      }
    }
    if (!sha) {
      console.log(`::warning::GitHub 上既无 ${onlyTag} 的发行版也无该 tag，跳过`)
      process.exit(0)
    }
    let msg = ''
    const c = await ghApi(`https://api.github.com/repos/${GH_REPO}/commits/${sha}`)
    if (c.ok) msg = String((await c.json()).commit?.message || '').split('\n')[0]
    releases.push({
      tag: onlyTag,
      name: onlyTag,
      body: `${onlyTag}\n\n${msg || '见 GitHub Release。'}`.slice(0, 1000),
      sha,
    })
    console.log(`· GitHub Release 尚未创建，用 tag ${onlyTag} (${sha.slice(0,7)}) 直接建 Gitee 发行版`)
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
  const list = giteeJson(GEE('/releases', `per_page=100&page=${page}`))
  if (!Array.isArray(list) || !list.length) break
  for (const x of list) have.add(x.tag_name)
  if (list.length < 100) break
}
console.log(`Gitee 已有: ${have.size}`)

// ── 3. 只补缺失的文本 ──
let done = 0, fail = 0
for (const rel of releases) {
  // 跳过 GitHub 匿名草稿（CI 残片）：镜像它们只会在 Gitee 造出删不掉顺序的垃圾记录
  if (rel.draft || String(rel.tag_name || '').startsWith('untagged-')) continue
  if (have.has(rel.tag)) continue
  let ok = false
  for (let i = 0; i < 3 && !ok; i++) {
    // Gitee POST token 必须 query；target_commitish 必填
    const res = curl([
      '-X', 'POST', '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({
        tag_name: rel.tag,
        name: rel.name,
        body: rel.body || `${rel.name}：见 GitHub Release 完整说明。`,
        target_commitish: rel.sha,
      }),
      '-w', '\n%{http_code}', GEE('/releases'),
    ], 30)
    const code = Number(res.trim().split('\n').pop())
    ok = code >= 200 && code < 300
    if (!ok) await sleep(2000 * (i + 1))
  }
  if (ok) { done++; console.log('✓', rel.tag) }
  else { fail++; console.log('✗', rel.tag) }
}
console.log(`\n新建 ${done} 个发行版，失败 ${fail} 个`)
if (fail > 0) process.exit(1)
