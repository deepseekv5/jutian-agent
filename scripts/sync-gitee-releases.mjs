// Gitee 发行版同步脚本（v14.8.3）
//
// 从 GitHub Releases API 拉取发行版 → 在 Gitee 创建对应发行版。
// 在 GitHub Actions 上运行：GitHub 服务器 → GitHub API（零本机流量）→ Gitee API。
//
// 环境变量：
//   GITHUB_TOKEN   GitHub 自动注入（读 Releases）
//   GITEE_USER     Gitee 用户名（Secrets 或 workflow_dispatch input）
//   GITEE_TOKEN    Gitee 私人令牌（Secrets 或 workflow_dispatch input）
//
// 用法：node scripts/sync-gitee-releases.mjs

const GH_REPO = 'deepseekv5/jutian-agent'
const GITEE_REPO = `${process.env.GITEE_USER || ''}/jutian-agent`
const GH_TOKEN = process.env.GITHUB_TOKEN
const GITEE_TOKEN = process.env.GITEE_TOKEN

if (!GITEE_TOKEN || !process.env.GITEE_USER) {
  console.log('::warning::未配置 GITEE_USER/GITEE_TOKEN，跳过')
  process.exit(0)
}

// ── 1. GitHub 发行版（分页，每页 100）──
const releases = []
for (let page = 1; page <= 2; page++) {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/releases?per_page=100&page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${GH_TOKEN || ''}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(30000),
    }
  )
  if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const list = await r.json()
  if (!Array.isArray(list) || !list.length) break
  for (const x of list) {
    releases.push({
      tag: String(x.tag_name || ''),
      name: String(x.name || x.tag_name || '').slice(0, 50),
      body: String(x.body || '').trim(),
    })
  }
  if (list.length < 100) break
}
console.log(`GitHub 发行版: ${releases.length}`)

// ── 2. Gitee 已有发行版 tag 集合 ──
const existing = new Set()
try {
  const r = await fetch(
    `https://gitee.com/api/v5/repos/${GITEE_REPO}/releases?access_token=${GITEE_TOKEN}&per_page=100`,
    { signal: AbortSignal.timeout(30000) }
  )
  if (r.ok) {
    for (const x of await r.json()) existing.add(x.tag_name)
  } else {
    console.log(`Gitee 列表 HTTP ${r.status}（可能无发行版，继续创建）`)
  }
} catch (e) {
  console.log('Gitee 列表获取失败:', e.message)
}
console.log(`Gitee 已有: ${existing.size}`)

// ── 3. 逐版创建（退避重试 3 次）──
let done = 0, fail = 0
for (const rel of releases) {
  if (existing.has(rel.tag)) continue
  const body = rel.body || `${rel.name}：见 GitHub Release 完整说明。`
  let ok = false
  for (let i = 0; i < 3 && !ok; i++) {
    // Gitee POST API 的 access_token 必须放 query（放 body 会 401 "Access token does not exist"）
    const r = await fetch(`https://gitee.com/api/v5/repos/${GITEE_REPO}/releases?access_token=${encodeURIComponent(GITEE_TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ tag_name: rel.tag, name: rel.name, body }),
    })
    ok = r.ok
    if (!ok) {
      console.log(`${rel.tag} HTTP ${r.status}，重试...`)
      await new Promise(s => setTimeout(s, 2000 * (i + 1)))
    }
  }
  if (ok) { done++; console.log('✓', rel.tag) }
  else { fail++; console.log('✗', rel.tag) }
}

console.log(`\n新建 ${done} 个发行版，失败 ${fail} 个`)
if (fail > 0) process.exit(1)
