const puppeteer = require('puppeteer-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const contexts = browser.contexts()
  const page = contexts[0] ? contexts[0].pages().find(p => p.url().includes('localhost:3211')) : null
  if (!page) {
    // 遍历所有 targets 找 page
    const targets = browser.targets()
    for (const t of targets) {
      if (t.type() === 'page' && t.url().includes('localhost:3211')) {
        const p = await t.page()
        console.log('找到页面:', p.url().slice(0, 50))
        break
      }
    }
  } else { console.log('页面:', page.url().slice(0, 50)) }
  await browser.disconnect(); process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
