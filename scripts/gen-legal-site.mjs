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

// ─── 巨天agent 官网：复用 docs 的设计系统（tokens/base/layout/components/pages）───
const AGENT_BRAND = `<span class="brand__mark" aria-hidden="true"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 8h11.2"/><path d="M17.6 8v8"/><path d="M6.4 16h11.2"/><path d="M6.4 8v8"/><path d="M6.4 12h11.2"/></svg></span>`

const agentNav = `  <div class="nav__inner">
    <a class="brand" href="index.html" aria-label="巨天agent 首页">${AGENT_BRAND}巨天agent</a>
    <nav class="nav__links" aria-label="主导航">
      <a class="nav__link" href="index.html">首页</a>
      <a class="nav__link" href="highlights.html">亮点</a>
      <a class="nav__link" href="features.html">特性</a>
      <a class="nav__link" href="scenarios.html">场景</a>
      <a class="nav__link" href="about.html">关于</a>
    </nav>
    <div class="nav__actions">
      <button class="icon-btn" data-theme-toggle aria-label="切换到深色">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="display:none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      </button>
      <a class="btn btn--sm" href="index.html#download" data-magnetic="0.2">下载</a>
      <button class="icon-btn nav__burger" data-burger aria-label="打开菜单" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    </div>
  </div>
  <span class="nav__progress" aria-hidden="true"></span>`

const agentFooter = `  <div class="container">
    <div class="footer__grid">
      <div class="footer__col">
        <a class="brand" href="index.html" style="color:var(--c-on-dark)">${AGENT_BRAND}巨天agent</a>
        <p class="t-sm" style="margin-top:var(--sp-4);max-width:280px;color:var(--c-on-dark-3)">桌面 AI 工作台。对话、代码、终端，和一支数字员工团队。</p>
      </div>
      <div class="footer__col"><h4>产品</h4><ul>
        <li><a href="highlights.html">核心亮点</a></li>
        <li><a href="features.html">特性与参数</a></li>
        <li><a href="scenarios.html">使用场景</a></li>
        <li><a href="index.html#download">下载</a></li>
      </ul></div>
      <div class="footer__col"><h4>资源</h4><ul>
        <li><a href="features.html#specs">系统要求</a></li>
        <li><a href="about.html">关于我们</a></li>
        <li><a href="legal.html">用户协议与隐私政策</a></li>
      </ul></div>
      <div class="footer__col"><h4>工作室</h4><ul>
        <li><a href="about.html">巨天工作室</a></li>
        <li><a href="https://deepseekv5.github.io/ly-ai-hub/" target="_blank" rel="noopener">LY AI HUB ↗</a></li>
        <li><a href="https://github.com/deepseekv5/jutian-agent" target="_blank" rel="noopener">GitHub ↗</a></li>
      </ul></div>
    </div>
    <div class="footer__bottom">
      <span>© 2026 巨天工作室 (Jutian Studio)</span>
      <span>本地优先 · 数据归你</span>
    </div>
  </div>`

const agentLegalStyle = `
/* legal.html —— 由 scripts/gen-legal-site.mjs 从 src/shared/legal.ts 生成，勿手改 */
.legal-wrap{max-width:820px;margin:0 auto;padding-block:clamp(48px,8vw,96px)}
.legal-head{margin-bottom:var(--sp-8)}
.legal-head h1{font-size:var(--fs-h2);line-height:var(--lh-snug);font-weight:var(--w-semibold);letter-spacing:var(--track-tight)}
.legal-meta{color:var(--c-ink-3);font-family:var(--font-mono);font-size:var(--fs-xs);margin-top:var(--sp-4);line-height:1.7}
.legal-toc{display:flex;gap:var(--sp-3);flex-wrap:wrap;margin-top:var(--sp-6);padding-top:var(--sp-6);border-top:1px solid var(--c-line)}
.legal-toc a{font-size:var(--fs-sm);color:var(--c-ink-2);border:1px solid var(--c-line);border-radius:999px;padding:6px 16px;transition:.2s}
.legal-toc a:hover{color:var(--c-ink);border-color:var(--c-line-strong)}
.legal-doc{padding-top:var(--sp-12);scroll-margin-top:96px}
.legal-doc+.legal-doc{margin-top:var(--sp-8);border-top:1px solid var(--c-line)}
.legal-doc__title{font-size:var(--fs-h3);font-weight:var(--w-semibold);margin-bottom:var(--sp-4)}
.legal-doc__intro{color:var(--c-ink-2);line-height:var(--lh-body);background:var(--c-bg-sunken);border-radius:var(--radius-md);padding:var(--sp-5) var(--sp-6);margin-bottom:var(--sp-8);font-size:var(--fs-sm)}
.legal-doc h3{font-size:1.05rem;font-weight:var(--w-semibold);margin:var(--sp-8) 0 var(--sp-3)}
.legal-doc ul{padding-left:1.15em;margin:0}
.legal-doc li{color:var(--c-ink-2);line-height:var(--lh-body);margin:var(--sp-3) 0;font-size:var(--fs-body)}
.legal-doc li::marker{color:var(--c-accent)}
@media (prefers-reduced-motion:no-preference){.legal-doc{opacity:0;transform:translateY(20px);transition:opacity .7s var(--ease-out-expo),transform .7s var(--ease-out-expo)}.legal-doc.in{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.legal-doc{opacity:1;transform:none}}`

const agentHtml = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>用户协议与隐私政策 — 巨天agent</title>
<meta name="description" content="巨天agent 用户协议与隐私政策（应用级，覆盖全部功能）。本地优先，数据不出本机。">
<meta name="theme-color" content="#0a0a0b">
<link rel="icon" type="image/svg+xml" href="assets/img/favicon.svg">
<link rel="stylesheet" href="assets/css/tokens.css">
<link rel="stylesheet" href="assets/css/base.css">
<link rel="stylesheet" href="assets/css/layout.css">
<link rel="stylesheet" href="assets/css/components.css">
<link rel="stylesheet" href="assets/css/motion.css">
<link rel="stylesheet" href="assets/css/pages.css">
<style>${agentLegalStyle}</style>
</head>
<body>
<a class="skip-link" href="#main">跳到主内容</a>
<header class="nav">
${agentNav}
</header>
<main id="main">
  <div class="container">
    <div class="legal-wrap">
      <div class="legal-head">
        <h1>用户协议与隐私政策</h1>
        <p class="legal-meta">适用于巨天agent 全部功能 · 版本 ${esc(legal.LEGAL_VERSION)}<br>本页与软件内「设置 → 关于 → 用户协议与隐私政策」为同一文本，由同一数据源生成。</p>
        <nav class="legal-toc" aria-label="文档导航">
          <a href="#agreement">用户协议</a>
          <a href="#privacy">隐私政策</a>
        </nav>
      </div>
${docSection(legal.USER_AGREEMENT, 'agreement')}
${docSection(legal.PRIVACY_POLICY, 'privacy')}
    </div>
  </div>
</main>
<footer class="footer dark">
${agentFooter}
</footer>
<div class="transition-veil" aria-hidden="true"></div>
<script src="assets/js/scroll.js" defer></script>
<script src="assets/js/interactions.js" defer></script>
<script src="assets/js/app.js" defer></script>
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
