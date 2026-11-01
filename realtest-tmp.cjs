const puppeteer = require('puppeteer-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const pages = await browser.pages()
  const page = pages.find(p => p.url().includes('localhost:3211'))
  if (!page) throw new Error('未找到页面')
  console.log('页面:', page.url().slice(0, 60))

  // 监听控制台错误
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 200)))

  // 1) 检查当前引擎设置
  const engine = await page.evaluate(() => {
    try { const s = JSON.parse(localStorage.getItem('lyclaw_settings') || '{}'); return s.agentEngine || '(默认 vercel)' } catch { return '?' }
  })
  console.log('引擎:', engine)

  // 2) 找输入框，输入测试消息
  const typed = await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '用 list_dir 看一下当前工作目录里有什么，然后告诉我')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  console.log('输入框:', typed)
  await sleep(600)

  // 3) 点发送
  const sent = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const send = btns.find(b => b.getAttribute('aria-label')?.includes('发送') || b.querySelector('svg path[d*="M5 12l14-9"]'))
    if (send) { send.click(); return true }
    // 回退：按 Enter
    return false
  })
  console.log('点击发送:', sent)
  if (!sent) {
    await page.focus('textarea')
    await page.keyboard.press('Enter')
  }

  // 4) 等回复（最多 90s）
  const t0 = Date.now()
  let lastLen = 0, stable = 0
  while (Date.now() - t0 < 90000) {
    await sleep(2000)
    const info = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll('.markdown-body')]
      const last = msgs[msgs.length - 1]
      return { len: (last?.textContent || '').length, text: (last?.textContent || '').slice(0, 200) }
    })
    if (info.len > 0 && info.len === lastLen) stable++
    else stable = 0
    lastLen = info.len
    if (stable >= 2) { console.log('回复:', info.text); break }
  }
  console.log('耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's')
  console.log('控制台错误:', errors.length ? errors.slice(0, 3) : '无')
  await browser.disconnect()
  process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
