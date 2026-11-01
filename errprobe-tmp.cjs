const puppeteer = require('puppeteer-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const pages = await browser.pages()
  const page = pages.find(p => p.url().includes('localhost:3211'))
  const logs = []
  page.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 400)))
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.stack?.slice(0, 500)))
  page.on('requestfailed', r => logs.push('REQFAIL: ' + r.url().slice(0, 120) + ' ' + r.failure()?.errorText))
  page.on('response', r => { if (r.status() >= 400) logs.push('HTTP' + r.status() + ': ' + r.url().slice(0, 120)) })

  await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '你好')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(500)
  await page.keyboard.press('Enter')
  await sleep(12000)
  console.log('=== 日志 ===')
  for (const l of logs.slice(-25)) console.log(l)
  await browser.disconnect()
  process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
