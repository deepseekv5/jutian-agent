/**
 * 从 src/shared/legal.ts 生成两站的「用户协议与隐私政策」静态页。
 *
 * legal.ts 是应用内 LegalGate/LegalPage 渲染的唯一来源；官网若手抄一份，
 * 改协议时必然漂移。这里用 esbuild 把 legal.ts 打成 cjs 读出来，
 * 生成与各自设计系统一致的 legal.html，保证「与软件内为同一文本」是真的。
 *
 * 用法：node scripts/gen-legal-site.mjs
 * 产物：docs/legal.html（巨天agent 官网）+ ../ly-ai-hub/legal.html（AI Hub）
 */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HUB = path.resolve(ROOT, '../ly-ai-hub')

// 1) 把 legal.ts 编译成可 require 的 cjs（纯数据，无副作用）
const tmp = path.join(ROOT, '.legal-tmp.cjs')
await build({
  entryPoints: [path.join(ROOT, 'src/shared/legal.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile: tmp, logLevel: 'silent',
})
const legal = createRequire(import.meta.url)(tmp)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 2) 通用：把一份 LegalDoc 渲染成 <section> 块
function docSection(doc, id) {
  const secs = doc.sections.map(s =>
    `      <h3>${esc(s.heading)}</h3>\n      <ul>\n${s.items.map(i => `        <li>${esc(i)}</li>`).join('\n')}\n      </ul>`
  ).join('\n')
  return `    <section class="legal-doc" id="${id}">
      <h2 class="legal-doc__title">${esc(doc.title)}</h2>
      <p class="legal-doc__intro">${esc(doc.intro)}</p>
${secs}
    </section>`
}

// ─── 巨天agent 官网：v16.6 Apple 底（自包含样式，与全站 .a-* 体系一致）───
const AGENT_BRAND = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 16.6 Q12 10.1 20 16.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12 2.7c.42 2.3 1.08 2.96 3.38 3.38-2.3.42-2.96 1.08-3.38 3.38-.42-2.3-1.08-2.96-3.38-3.38 2.3-.42 2.96-1.08 3.38-3.38z" fill="#30d158"/></svg>`

const agentNav = `  <div class="a-nav__inner">
    <a class="a-nav__brand" href="index.html" aria-label="巨天agent 首页">${AGENT_BRAND}巨天agent</a>
    <nav class="a-nav__links" aria-label="主导航">
      <a href="index.html">首页</a>
      <a href="highlights.html">亮点</a>
      <a href="features.html">特性</a>
      <a href="scenarios.html">场景</a>
      <a href="about.html">关于</a>
    </nav>
    <a class="a-nav__cta" href="index.html#download">下载</a>
  </div>`

const agentFooter = `  <div class="a-footer__grid">
      <div>
        <a class="a-footer__brand" href="index.html">${AGENT_BRAND}巨天agent</a>
        <p style="line-height:1.6;max-width:260px">桌面 AI 工作台。对话、代码、终端，和一支数字员工团队。</p>
      </div>
      <div><h4>产品</h4><ul>
        <li><a href="highlights.html">核心亮点</a></li>
        <li><a href="features.html">特性与参数</a></li>
        <li><a href="scenarios.html">使用场景</a></li>
        <li><a href="index.html#download">下载</a></li>
      </ul></div>
      <div><h4>资源</h4><ul>
        <li><a href="features.html">系统要求</a></li>
        <li><a href="about.html">关于我们</a></li>
        <li><a href="legal.html">用户协议与隐私政策</a></li>
      </ul></div>
      <div><h4>工作室</h4><ul>
        <li><a href="about.html">巨天工作室</a></li>
        <li><a href="https://deepseekv5.github.io/ly-ai-hub/" target="_blank" rel="noopener">LY AI HUB ↗</a></li>
        <li><a href="https://github.com/deepseekv5/jutian-agent" target="_blank" rel="noopener">GitHub ↗</a></li>
      </ul></div>
    </div>
    <div class="a-footer__bottom">
      <span>© 2026 巨天工作室</span>
      <span>本地优先 · 数据归你</span>
    </div>`

const agentLegalStyle = `
/* legal.html —— 由 scripts/gen-legal-site.mjs 从 src/shared/legal.ts 生成，勿手改。
   v16.6 Apple 底：与全站 .a-* 体系一致（引用 assets/css/apple.css 提供基础样式）。 */
.legal-wrap{max-width:820px;margin:0 auto;padding-block:clamp(48px,8vw,96px)}
.legal-head{margin-bottom:56px}
.legal-head h1{font-size:clamp(40px,6vw,64px);font-weight:700;letter-spacing:-.02em;line-height:1.08;color:#f5f5f7}
.legal-meta{color:#86868b;font-size:14px;margin-top:20px;line-height:1.8}
.legal-toc{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}
.legal-toc a{font-size:13.5px;color:#2997ff;border:1px solid rgba(41,151,255,.35);border-radius:999px;padding:7px 18px;transition:.2s}
.legal-toc a:hover{background:rgba(41,151,255,.12)}
.legal-doc{padding-top:64px;scroll-margin-top:80px}
.legal-doc+.legal-doc{margin-top:48px;border-top:1px solid rgba(255,255,255,.1)}
.legal-doc__title{font-size:clamp(26px,3.4vw,34px);font-weight:700;letter-spacing:-.015em;margin-bottom:18px;color:#f5f5f7}
.legal-doc__intro{color:#c9c9ce;line-height:1.75;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px 24px;margin-bottom:36px;font-size:14.5px}
.legal-doc h3{font-size:17px;font-weight:700;color:#f5f5f7;margin:34px 0 12px}
.legal-doc ul{padding-left:1.2em;margin:0}
.legal-doc li{color:#a1a1a6;line-height:1.75;margin:11px 0;font-size:14.5px}
.legal-doc li::marker{color:#30d158}
.legal-foot{max-width:820px;margin:64px auto 0;padding-top:26px;border-top:1px solid rgba(255,255,255,.1);color:#6e6e73;font-size:12.5px;line-height:1.8}
.legal-foot a{color:#2997ff}
@media (prefers-reduced-motion:no-preference){.legal-doc{opacity:0;transform:translateY(20px);transition:opacity .7s cubic-bezier(.22,.61,.36,1),transform .7s cubic-bezier(.22,.61,.36,1)}.legal-doc.in{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.legal-doc{opacity:1;transform:none}}`

const agentHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>用户协议与隐私政策 — 巨天agent</title>
<meta name="description" content="巨天agent 用户协议与隐私政策（应用级，覆盖全部功能）。本地优先，数据不出本机。">
<meta name="theme-color" content="#000000">
<link rel="icon" type="image/svg+xml" href="assets/img/favicon.svg">
<link rel="stylesheet" href="assets/css/apple.css">
<style>${agentLegalStyle}</style>
</head>
<body>
<header class="a-nav">
${agentNav}
</header>
<main id="main">
  <div class="a-wrap">
    <div class="legal-wrap">
      <div class="legal-head">
        <h1>用户协议与隐私政策</h1>
        <p class="legal-meta">适用于巨天agent 全部功能（macOS / Windows / Linux / Android）· 版本 ${esc(legal.LEGAL_VERSION)}<br>本页与软件内「设置 → 关于 → 用户协议与隐私政策」为同一文本，由同一数据源生成。</p>
        <nav class="legal-toc" aria-label="文档导航">
          <a href="#agreement">用户协议</a>
          <a href="#privacy">隐私政策</a>
        </nav>
      </div>
${docSection(legal.USER_AGREEMENT, 'agreement')}
${docSection(legal.PRIVACY_POLICY, 'privacy')}
      <div class="legal-foot">
        本页由 ${esc(legal.LEGAL_VERSION)} 版本文本生成，与软件内展示保持一致；历史版本随软件仓库保留。
        对本协议或隐私政策有任何疑问，欢迎在 <a href="https://github.com/deepseekv5/jutian-agent/issues" target="_blank" rel="noopener">GitHub Issues</a> 或 <a href="https://gitee.com/deepseekv5/jutian-agent" target="_blank" rel="noopener">Gitee 镜像</a> 提出。
      </div>
    </div>
  </div>
</main>
<footer class="a-footer">
${agentFooter}
</footer>
<script>
(function () {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
    })
  }, { threshold: .06 })
  document.querySelectorAll('.legal-doc').forEach(function (el) { io.observe(el) })
})()
</script>
</body>
</html>
`

// ─── AI Hub：复用其液态玻璃设计系统（assets/style.css）───
const hubNav = `<nav class="nav">
  <div class="nav-in">
    <a class="brand" href="index.html"><span class="dot"></span>LY AI HUB</a>
    <div class="links">
      <a href="index.html">首页</a>
      <a href="projects.html">项目</a>
      <a href="research.html">研究</a>
    </div>
    <a class="gh" href="https://github.com/deepseekv5" target="_blank" rel="noopener">GitHub ↗</a>
  </div>
</nav>`

const hubFooter = `<footer>
  <div class="wrap">
    <div class="col">
      <b>LY AI HUB</b>
      <div class="fine">巨天agent 背后的研究与工程实验室。本地优先 · 数据归你 · MIT。</div>
    </div>
    <div class="col"><b>导航</b>
      <a href="index.html">首页</a>
      <a href="projects.html">项目</a>
      <a href="research.html">研究</a>
    </div>
    <div class="col"><b>条款</b>
      <a href="legal.html">用户协议与隐私政策</a>
    </div>
    <div class="col"><b>链接</b>
      <a href="https://github.com/deepseekv5/jutian-agent" target="_blank" rel="noopener">巨天agent · GitHub ↗</a>
      <a href="https://deepseekv5.github.io/jutian-agent/" target="_blank" rel="noopener">巨天agent 官网 ↗</a>
      <a href="https://github.com/deepseekv5" target="_blank" rel="noopener">GitHub 组织 ↗</a>
    </div>
  </div>
</footer>`

const hubLegalStyle = `
/* legal.html —— 由巨天agent 仓库 scripts/gen-legal-site.mjs 从 src/shared/legal.ts 生成，勿手改 */
.hub-legal{max-width:820px;margin:0 auto;padding:96px 28px 80px}
.hub-legal h1{font-size:clamp(30px,5vw,48px);font-weight:600;letter-spacing:-0.028em;line-height:1.14;margin-bottom:14px}
.hub-legal .meta{color:var(--ink-3);font-family:var(--mono);font-size:13px;line-height:1.7;margin-bottom:28px}
.hub-legal .toc{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
.hub-legal .toc a{font-size:13px;color:var(--ink-2);background:var(--glass);border:1px solid var(--line);border-radius:999px;padding:7px 16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.85);transition:.2s}
.hub-legal .toc a:hover{color:var(--green-deep);border-color:var(--green-2)}
.hub-doc{padding-top:44px;scroll-margin-top:88px}
.hub-doc+.hub-doc{margin-top:36px;border-top:1px solid var(--line-soft)}
.hub-doc h2{font-size:26px;font-weight:650;letter-spacing:-0.02em;margin-bottom:16px}
.hub-doc .intro{color:var(--ink-2);line-height:1.85;background:var(--glass);border:1px solid var(--line);border-radius:16px;padding:18px 22px;margin-bottom:28px;font-size:15px;box-shadow:var(--glass-hi)}
.hub-doc h3{font-size:17px;font-weight:600;margin:28px 0 10px}
.hub-doc ul{padding-left:1.15em;margin:0}
.hub-doc li{color:var(--ink-2);line-height:1.85;margin:8px 0;font-size:15px}
.hub-doc li::marker{color:var(--green-2)}`

function hubDocSection(doc, id) {
  const secs = doc.sections.map(s =>
    `      <h3>${esc(s.heading)}</h3>\n      <ul>\n${s.items.map(i => `        <li>${esc(i)}</li>`).join('\n')}\n      </ul>`
  ).join('\n')
  return `    <section class="hub-doc" id="${id}">
      <h2>${esc(doc.title)}</h2>
      <p class="intro">${esc(doc.intro)}</p>
${secs}
    </section>`
}

const hubHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>用户协议与隐私政策 — LY AI HUB</title>
<meta name="description" content="巨天agent 用户协议与隐私政策。本地优先，数据不出本机。">
<link rel="stylesheet" href="assets/style.css">
<style>${hubLegalStyle}</style>
</head>
<body>
${hubNav}
<div class="hub-legal">
  <h1>用户协议与隐私政策</h1>
  <p class="meta">适用于巨天agent 全部功能 · 版本 ${esc(legal.LEGAL_VERSION)}<br>本页与软件内「设置 → 关于 → 用户协议与隐私政策」为同一文本。</p>
  <nav class="toc" aria-label="文档导航"><a href="#agreement">用户协议</a><a href="#privacy">隐私政策</a></nav>
${hubDocSection(legal.USER_AGREEMENT, 'agreement')}
${hubDocSection(legal.PRIVACY_POLICY, 'privacy')}
</div>
${hubFooter}
</body>
</html>
`

writeFileSync(path.join(ROOT, 'docs/legal.html'), agentHtml)
console.log('✓ docs/legal.html')
if (existsSync(HUB)) { writeFileSync(path.join(HUB, 'legal.html'), hubHtml); console.log('✓ ly-ai-hub/legal.html') }
else console.log('（未找到 ly-ai-hub 仓库，跳过 Hub 生成）')
