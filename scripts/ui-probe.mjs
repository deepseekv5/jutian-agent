#!/usr/bin/env node
/** 视觉打磨辅助：连本机 Electron CDP，切页面 / 执行 JS / 截图。
 * 用法: node scripts/ui-probe.mjs [--eval "JS"] [--shot name] [--click "text"] */
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const argOf = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('3211') || p.url().includes('index')) || pages[0]
await page.setViewport({ width: 1672, height: 899, deviceScaleFactor: 2 })

const js = argOf('--eval')
if (js) {
  try {
    const r = await page.evaluate(js)
    console.log('EVAL:', JSON.stringify(r))
  } catch (e) { console.log('EVAL_ERR:', e.message) }
}
const click = argOf('--click')
if (click) {
  try {
    const r = await page.evaluate((txt) => {
      const els = [...document.querySelectorAll('button, [role="button"], a')]
      const el = els.find(e => (e.textContent || '').trim().includes(txt) && e.getBoundingClientRect().width > 0)
      if (!el) return 'NOT_FOUND'
      el.click(); return 'CLICKED ' + (el.textContent || '').trim().slice(0, 30)
    }, click)
    console.log(r)
  } catch (e) { console.log('CLICK_ERR:', e.message) }
}
await new Promise(r => setTimeout(r, Number(argOf('--wait') || 700)))
const shot = argOf('--shot')
if (shot) {
  const path = `/tmp/jt-probe-${shot}.png`
  await page.screenshot({ path })
  console.log('SHOT:', path)
  // 同时输出关键度量
  try {
    const metrics = await page.evaluate(() => ({
      title: document.title,
      activeTab: [...document.querySelectorAll('.tab-strip > div')].filter(e => e.getAttribute('style')?.includes('surfaceActive') || e.querySelector('span.absolute')).map(e => e.textContent.trim()).slice(0, 3),
      buttons: document.querySelectorAll('button').length,
      visibleButtons: [...document.querySelectorAll('button')].filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0).length,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      sidebarBg: (() => { const e = document.querySelector('.jt-in-left'); return e ? getComputedStyle(e).backgroundColor : null })(),
      headerBorder: (() => { const e = document.querySelector('.jt-in-top'); return e ? getComputedStyle(e).borderBottomColor : null })(),
    }))
    console.log('METRICS:', JSON.stringify(metrics))
  } catch (e) { console.log('METRIC_ERR:', e.message) }
}
await browser.disconnect()
