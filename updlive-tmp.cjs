const puppeteer = require('puppeteer-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const pages = await b.pages()
  const page = pages.find(p => p.url().includes('localhost:3211'))
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-panel', { detail: 'settings' })))
  await sleep(1500)
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const b = btns.find(x => x.querySelector('svg path[d*="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"]'))
    if (b) { b.click(); return true }
    return false
  })
  console.log('点检查更新:', clicked)
  await sleep(7000)
  const state = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')]
    const status = all.filter(d => d.children.length === 0 && /可更新至|已是最新|正在检查/.test(d.textContent || '')).map(d => d.textContent.trim())
    const btns = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(t => t.includes('更新') || t.includes('重启'))
    return { status: status.slice(-2), btns: btns.slice(0, 5) }
  })
  console.log('状态:', JSON.stringify(state))
  await b.disconnect(); process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
