#!/usr/bin/env node
/**
 * 场景插画生成脚本 — 一次性生成 assets/img/scene-*.svg
 * 风格：细线条线稿 + 品牌绿点缀，无渐变、无卡通，与站点设计系统一致。
 * 输出为静态 SVG 文件，页面用 <img loading="lazy"> 引用。
 * 重新生成：node assets/img/gen-scenes.cjs
 */
const fs = require('fs')
const path = require('path')

const OUT = __dirname
const W = 640, H = 400

/** 公共定义：窗口框、发丝线、品牌色 */
function frame(inner, { title = '巨天agent' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <rect width="${W}" height="${H}" fill="#0f1218"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="rgba(255,255,255,.09)"/>
  <g>
    <rect x="16" y="14" width="608" height="372" rx="12" fill="#14181f" stroke="rgba(255,255,255,.1)"/>
    <g>
      <circle cx="38" cy="34" r="5" fill="#ff5f57"/><circle cx="56" cy="34" r="5" fill="#febc2e"/><circle cx="74" cy="34" r="5" fill="#28c840"/>
      <text x="320" y="39" text-anchor="middle" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" fill="rgba(255,255,255,.4)">${title}</text>
    </g>
    <line x1="16" y1="56" x2="624" y2="56" stroke="rgba(255,255,255,.08)"/>
    ${inner}
  </g>
</svg>`
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const GREEN = '#10a37f'
const LINE = 'rgba(255,255,255,.14)'
const TXT = 'rgba(255,255,255,.62)'
const MUTED = 'rgba(255,255,255,.34)'

/* ─── 1. 代码模式 ─── */
function sceneCode() {
  const files = ['src', 'components', 'ChatPanel.tsx', 'CodeEditor.tsx', 'serve.cjs', 'index.css']
  const code = [
    '// 让它改,你看结果',
    'const handoff = async (t) => {',
    '  const owner = t.mentions[0] ?? boss.id',
    '  await dispatch({ to: owner, task: t })',
    '  return reorder(queue, owner)',
    '}',
  ]
  let y = 96
  const codeHtml = code.map(l => {
    const row = `<text x="216" y="${y}" font-family="SF Mono,Menlo,monospace" font-size="12" fill="rgba(255,255,255,.72)">${escapeXml(l)}</text>`
    y += 22
    return row
  }).join('\n    ')
  const filesHtml = files.map((f, i) => {
    const yy = 86 + i * 30
    const active = i === 2
    return `<rect x="28" y="${yy - 15}" width="150" height="24" rx="6" fill="${active ? 'rgba(16,163,127,.16)' : 'transparent'}"/>
    <text x="40" y="${yy}" font-family="SF Mono,Menlo,monospace" font-size="11.5" fill="${active ? '#eafff6' : 'rgba(255,255,255,.45)'}">${f}</text>`
  }).join('\n    ')
  return frame(`
    ${filesHtml}
    <line x1="190" y1="56" x2="190" y2="386" stroke="rgba(255,255,255,.07)"/>
    <g>
      <rect x="206" y="66" width="120" height="20" rx="5" fill="rgba(16,163,127,.14)"/>
      <text x="218" y="80" font-family="SF Mono,Menlo,monospace" font-size="11" fill="#eafff6">ChatPanel.tsx</text>
      <rect x="332" y="66" width="96" height="20" rx="5" fill="rgba(255,255,255,.05)"/>
      <text x="344" y="80" font-family="SF Mono,Menlo,monospace" font-size="11" fill="rgba(255,255,255,.45)">serve.cjs</text>
    </g>
    ${codeHtml}
    <g>
      <rect x="206" y="300" width="380" height="62" rx="8" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.08)"/>
      <text x="222" y="324" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="${MUTED}">检查点 · 改动前自动快照</text>
      <text x="222" y="346" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="${GREEN}">✓ 一键撤销本轮全部改动</text>
    </g>`)
}

/* ─── 2. 终端排障 ─── */
function sceneTerminal() {
  const lines = [
    ['<tspan fill="rgba(255,255,255,.4)">$</tspan> <tfill="#e6edf3"></tfill> jtcode "服务挂了,看看日志"'],
    ['<tspan fill="#34d399">❯</tspan> <tfill="#e6edf3"></tfill> tail -n 200 app.log'],
    ['<tspan fill="rgba(255,255,255,.4)">  2026-09-28 14:22:01 ERROR</tspan> <tfill="#f87171"></tfill> ECONNREFUSED db:5432'],
    ['<tspan fill="rgba(255,255,255,.4)">  2026-09-28 14:22:03 ERROR</tspan> <tfill="#f87171"></tfill> retry failed (3/3)'],
    ['<tspan fill="#34d399">❯</tspan> <tfill="#e6edf3"></tfill> ss -lntp | grep 5432'],
    ['<tspan fill="#4ade80">✓</tspan> <tfill="#e6edf3"></tfill> 根因:数据库端口未监听,连接被拒'],
    ['<tspan fill="#4ade80">✓</tspan> <tfill="#e6edf3"></tfill> 建议:启动 db 容器后重试,已写好一键命令'],
  ]
  let y = 92
  const html = lines.map(l => {
    const row = `<text x="40" y="${y}" font-family="SF Mono,Menlo,monospace" font-size="12" fill="rgba(230,237,243,.78)">${l[0]}</text>`
    y += 27
    return row
  }).join('\n    ')
  return frame(`
    <text x="40" y="78" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="${MUTED}">jtcode · 终端即入口</text>
    ${html}
    <rect x="40" y="${y - 6}" width="9" height="15" fill="${GREEN}" opacity=".9"/>`, { title: 'jtcode — zsh' })
}

/* ─── 3. 集群协作 ─── */
function sceneSwarm() {
  const nodes = [
    { x: 40, label: '目标输入', sub: '自然语言' },
    { x: 216, label: '总管', sub: '拆解 · 分派' },
    { x: 392, label: '数字员工', sub: '@互相接力' },
    { x: 536, label: '最终交付', sub: '汇总验收' },
  ]
  const nodesHtml = nodes.map((n, i) => `
    <rect x="${n.x}" y="130" width="128" height="86" rx="14" fill="${i === 1 ? 'rgba(16,163,127,.12)' : '#14181f'}" stroke="${i === 1 ? GREEN : 'rgba(255,255,255,.14)'}" stroke-width="1.5"/>
    <text x="${n.x + 64}" y="166" text-anchor="middle" font-family="-apple-system,PingFang SC,sans-serif" font-size="14" font-weight="600" fill="rgba(255,255,255,.86)">${n.label}</text>
    <text x="${n.x + 64}" y="188" text-anchor="middle" font-family="-apple-system,PingFang SC,sans-serif" font-size="11" fill="${MUTED}">${n.sub}</text>`).join('')
  const arrows = [[168, 216], [344, 392], [520, 536]].map(([x1, x2]) =>
    `<path d="M${x1} 173 H ${x2}" stroke="${GREEN}" stroke-width="1.6" fill="none" marker-end="url(#ag)"/>`).join('\n    ')
  const members = [
    { c: '#f59e0b', t: '产品', s: '需求文档', w: '100%' },
    { c: GREEN, t: '开发', s: '功能实现', w: '100%' },
    { c: '#3b82f6', t: '测试', s: '回归验证', w: '86%' },
  ]
  const membersHtml = members.map((m, i) => {
    const x = 40 + i * 190
    return `
    <rect x="${x}" y="252" width="170" height="98" rx="12" fill="#14181f" stroke="rgba(255,255,255,.1)"/>
    <circle cx="${x + 26}" cy="278" r="12" fill="${m.c}" opacity=".9"/>
    <text x="${x + 46}" y="282" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" fill="rgba(255,255,255,.8)">${m.t}</text>
    <text x="${x + 18}" y="308" font-family="-apple-system,PingFang SC,sans-serif" font-size="10.5" fill="${MUTED}">${m.s}</text>
    <rect x="${x + 18}" y="320" width="134" height="5" rx="3" fill="rgba(255,255,255,.09)"/>
    <rect x="${x + 18}" y="320" width="${Math.round(134 * parseFloat(m.w) / 100)}" height="5" rx="3" fill="${GREEN}"/>`
  }).join('')
  return frame(`
    <defs><marker id="ag" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="${GREEN}"/></marker></defs>
    ${arrows}
    ${nodesHtml}
    ${membersHtml}`, { title: '集群指挥室' })
}

/* ─── 4. 内容创作 ─── */
function sceneWrite() {
  const rows = [
    { w: 300, o: '.86' }, { w: 420, o: '.62' }, { w: 380, o: '.5' },
    { w: 440, o: '.62' }, { w: 260, o: '.4' },
  ]
  const textHtml = rows.map((r, i) => `
    <rect x="216" y="${86 + i * 22}" width="${r.w}" height="8" rx="4" fill="rgba(255,255,255,${r.o})"/>`).join('')
  return frame(`
    <rect x="28" y="70" width="160" height="300" rx="10" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.08)"/>
    <text x="46" y="96" font-family="-apple-system,PingFang SC,sans-serif" font-size="11" fill="${MUTED}">大纲</text>
    ${[0, 1, 2, 3, 4].map(i => `<rect x="46" y="${112 + i * 26}" width="${[92, 116, 78, 104, 88][i]}" height="8" rx="4" fill="rgba(255,255,255,.22)"/>`).join('\n    ')}
    <text x="216" y="82" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" font-weight="600" fill="rgba(255,255,255,.8)">初稿 · 语气克制</text>
    ${textHtml}
    <rect x="216" y="228" width="380" height="132" rx="10" fill="rgba(16,163,127,.08)" stroke="rgba(16,163,127,.28)"/>
    <text x="240" y="258" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="${GREEN}">✓ 三种开头可选</text>
    <text x="240" y="282" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="rgba(255,255,255,.6)">偏好已记住:短句、不排比、不用感叹号</text>
    <rect x="240" y="300" width="200" height="8" rx="4" fill="rgba(255,255,255,.2)"/>
    <rect x="240" y="318" width="320" height="8" rx="4" fill="rgba(255,255,255,.14)"/>`)
}

/* ─── 5. 代码审查 ─── */
function sceneReview() {
  const items = [
    { k: 'P1', c: '#f87171', t: '第 42 行:可能的空指针,user 未判空' },
    { k: 'P2', c: '#fbbf24', t: '第 88 行:并发写 map,缺少锁' },
    { k: 'P3', c: GREEN, t: '第 130 行:错误被吞,建议记日志' },
  ]
  const html = items.map((it, i) => {
    const y = 86 + i * 62
    return `
    <rect x="40" y="${y}" width="560" height="48" rx="10" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.08)"/>
    <rect x="54" y="${y + 14}" width="26" height="20" rx="5" fill="${it.c}" opacity=".18"/>
    <text x="60" y="${y + 29}" font-family="SF Mono,Menlo,monospace" font-size="11" fill="${it.c}">${it.k}</text>
    <text x="94" y="${y + 29}" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" fill="rgba(255,255,255,.74)">${it.t}</text>`
  }).join('')
  return frame(`
    ${html}
    <rect x="40" y="290" width="560" height="72" rx="10" fill="rgba(16,163,127,.08)" stroke="rgba(16,163,127,.3)"/>
    <text x="60" y="318" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" fill="${GREEN}">✓ 三个问题都给了复现步骤,点击跳到对应行</text>
    <text x="60" y="342" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="${MUTED}">结论先行,证据可点开核</text>`)
}

/* ─── 6. 数据处理 ─── */
function sceneData() {
  const rows = [0, 1, 2, 3].map(i => `
    <rect x="40" y="${82 + i * 24}" width="${[300, 340, 280, 320][i]}" height="10" rx="5" fill="rgba(255,255,255,${[0.5, 0.34, 0.42, 0.28][i]})"/>
    <rect x="420" y="${82 + i * 24}" width="${[120, 90, 140, 100][i]}" height="10" rx="5" fill="rgba(16,163,127,.3)"/>`).join('')
  const bars = [60, 96, 72, 120, 88].map((h, i) => `
    <rect x="${56 + i * 46}" y="${330 - h}" width="26" height="${h}" rx="4" fill="rgba(16,163,127,${0.35 + i * 0.12})"/>`).join('')
  return frame(`
    <text x="40" y="72" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="${MUTED}">CSV 合并去重 → 按日期分文件</text>
    ${rows}
    ${bars}
    <line x1="40" y1="332" x2="600" y2="332" stroke="rgba(255,255,255,.1)"/>
    <text x="40" y="356" font-family="-apple-system,PingFang SC,sans-serif" font-size="11.5" fill="${GREEN}">✓ 1,204 行 · 去重 37 行 · 输出 6 个文件</text>`)
}

/* ─── 7. 对话界面 ─── */
function sceneChat() {
  return frame(`
    <rect x="300" y="76" width="300" height="56" rx="18" fill="rgba(255,255,255,.08)"/>
    <text x="322" y="100" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" fill="rgba(255,255,255,.8)">这份报表哪来的?</text>
    <text x="322" y="120" font-family="-apple-system,PingFang SC,sans-serif" font-size="11" fill="${MUTED}">14:22</text>
    <circle cx="52" cy="94" r="14" fill="${GREEN}" opacity=".85"/>
    <text x="76" y="92" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" font-weight="600" fill="rgba(255,255,255,.86)">巨天</text>
    <text x="76" y="112" font-family="-apple-system,PingFang SC,sans-serif" font-size="12" fill="rgba(255,255,255,.6)">数据来自 Q3 销售明细。</text>
    <rect x="76" y="126" width="290" height="34" rx="9" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.1)"/>
    <text x="90" y="147" font-family="SF Mono,Menlo,monospace" font-size="10.5" fill="rgba(255,255,255,.62)">⚙ read_file → sales_q3.csv</text>
    <rect x="76" y="172" width="330" height="34" rx="9" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.1)"/>
    <text x="90" y="193" font-family="SF Mono,Menlo,monospace" font-size="10.5" fill="rgba(255,255,255,.62)">⚙ search_code → "汇总口径"</text>
    <rect x="40" y="300" width="560" height="60" rx="30" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.1)"/>
    <text x="66" y="335" font-family="-apple-system,PingFang SC,sans-serif" font-size="12.5" fill="${MUTED}">继续说点什么…</text>
    <circle cx="572" cy="330" r="15" fill="${GREEN}"/>`)
}

const scenes = {
  'scene-code.svg': sceneCode,
  'scene-terminal.svg': sceneTerminal,
  'scene-swarm.svg': sceneSwarm,
  'scene-write.svg': sceneWrite,
  'scene-review.svg': sceneReview,
  'scene-data.svg': sceneData,
  'scene-chat.svg': sceneChat,
}

let n = 0
for (const [file, fn] of Object.entries(scenes)) {
  fs.writeFileSync(path.join(OUT, file), fn())
  n++
}
console.log('已生成', n, '张场景插画 →', OUT)
