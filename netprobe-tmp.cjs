const puppeteer = require('puppeteer-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const pages = await browser.pages()
  const page = pages.find(p => p.url().includes('localhost:3211'))
  const bad = [], errs = []
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()) })
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message.slice(0, 300)))

  await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '你好')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(400)
  await page.keyboard.press('Enter')
  await sleep(10000)
  console.log('=== HTTP >=400 ===')
  for (const b of bad.slice(0, 8)) console.log(b)
  console.log('=== console errors ===')
  for (const e of errs.slice(0, 8)) console.log(e)
  await browser.disconnect(); process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
