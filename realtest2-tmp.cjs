const puppeteer = require('puppeteer-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const pages = await browser.pages()
  const page = pages.find(p => p.url().includes('localhost:3211'))
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

  // 清空输入框并发送多步任务
  await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '在当前工作目录创建一个 test-内核.txt，内容写"内核已就绪"，然后读回来确认')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(500)
  await page.keyboard.press('Enter')

  const t0 = Date.now()
  let last = '', stable = 0
  while (Date.now() - t0 < 120000) {
    await sleep(2500)
    const info = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[class*="tool-card"]')]
      const msgs = [...document.querySelectorAll('.markdown-body')]
      return {
        tools: cards.length,
        toolNames: cards.slice(-4).map(c => (c.textContent || '').slice(0, 40)),
        text: (msgs[msgs.length - 1]?.textContent || '').slice(0, 300),
      }
    })
    if (info.text === last && info.text.length > 0) stable++
    else stable = 0
    last = info.text
    if (stable >= 2) {
      console.log('工具卡数:', info.tools)
      console.log('最近工具:', JSON.stringify(info.toolNames))
      console.log('回复:', info.text)
      break
    }
  }
  console.log('耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's')
  console.log('错误:', errs.filter(e => !e.includes('404')).slice(0, 3))
  await browser.disconnect(); process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
