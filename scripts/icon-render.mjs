#!/usr/bin/env node
/**
 * Logo 渲染管线（v16.5.0）：SVG 设计稿 → 全尺寸 PNG → iconset → icns/ico
 * 用法：node scripts/icon-render.mjs electron/logo.svg
 * 依赖系统 iconutil/sips；PNG 栅格化走 CDP（本机 9333 调试实例，或自动拉起 puppeteer 浏览器）
 */
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const svgPath = process.argv[2] || 'electron/logo.svg'
const OUT = path.resolve('electron/icon.iconset')
mkdirSync(OUT, { recursive: true })

// 1) 栅格化 1024px：用系统 Chrome headless 截 SVG（Electron CDP 不支持建新 target，不再走 puppeteer）
// headless=new 下透明背景要写 ARGB 8 位且给 html/body 显式 transparent；老参数只对旧 headless 有效
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const work = mkdtempSync(path.join(tmpdir(), 'jt-logo-'))
const html = path.join(work, 'logo.html')
writeFileSync(html, `<html style="background:transparent"><body style="margin:0;background:transparent"><svg width="1024" height="1024">${readFileSync(svgPath, 'utf-8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg></body></html>`)
const big = '/tmp/jt-logo-1024.png'
execSync(`"${CHROME}" --headless=new --disable-gpu --screenshot="${big}" --window-size=1024,1024 --default-background-color=00000000 --hide-scrollbars "file://${html}"`, { stdio: 'ignore' })
rmSync(work, { recursive: true, force: true })

// 2) iconset 全尺寸
const sizes = ['16', '32', '128', '256', '512']
for (const s of sizes) {
  execSync(`sips -z ${s} ${s} "${big}" --out "${OUT}/icon_${s}x${s}.png" >/dev/null`)
  const s2 = Number(s) * 2
  execSync(`sips -z ${s2} ${s2} "${big}" --out "${OUT}/icon_${s}x${s}@2x.png" >/dev/null`)
}
// 3) icns + 原生 ico（PNG 嵌入式，Vista+ 支持）
execSync(`iconutil -c icns "${OUT}" -o electron/icon.icns`)
const ico = icoFromPngs([
  ['16', `${OUT}/icon_16x16.png`],
  ['32', `${OUT}/icon_32x32.png`],
  ['256', `${OUT}/icon_256x256.png`],
])
writeFileSync('electron/icon.ico', ico)
console.log('✅ icon.icns + icon.ico + iconset 全部已更新（来自', svgPath + '）')

function icoFromPngs(entries) {
  // ICO 容器：6 字节头 + 每项 16 字节目录 + PNG 数据（尺寸字段用实际像素）
  const pngs = entries.map(([, f]) => readFileSync(f))
  const dims = pngs.map(b => ({ w: b.readUInt32LE(16), h: b.readUInt32LE(20) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4)
  const offset = 6 + entries.length * 16
  const dirs = []
  let cur = offset
  pngs.forEach((b, i) => {
    const d = Buffer.alloc(16)
    d[0] = dims[i].w >= 256 ? 0 : dims[i].w
    d[1] = dims[i].h >= 256 ? 0 : dims[i].h
    d[2] = 0; d[3] = 0
    d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6)
    d.writeUInt32LE(b.length, 8); d.writeUInt32LE(cur, 12)
    dirs.push(d); cur += b.length
  })
  return Buffer.concat([header, ...dirs, ...pngs])
}
