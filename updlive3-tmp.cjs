const puppeteer = require('puppeteer-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const targets = browser.targets()
  let page = null
  for (const t of targets) {
    if (t.type() === 'page' && t.url().includes('localhost:3211')) { page = await t.page(); break }
  }
  if (!page) throw new Error('未找到页面 target')
  console.log('页面 OK:', page.url().slice(0, 50))
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-panel', { detail: 'settings' })))
  await sleep(1500)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const b = btns.find(x => x.querySelector('svg path[d*="M4 4v5h.582"]'))
    if (b) b.click()
    return !!b
  })
  await sleep(7000)
  const state = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')]
    const status = all.filter(d => d.children.length === 0 && /可更新至|已是最新|正在检查/.test(d.textContent || '')).map(d => d.textContent.trim())
    const notes = all.filter(d => (d.textContent || '').includes('一键更新')).length
    return { status: status.slice(-2), hasApplyBtn: notes > 0 }
  })
  console.log('状态:', JSON.stringify(state))
  await browser.disconnect(); process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
