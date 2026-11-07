import puppeteer from 'puppeteer-core'
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => !p.url().startsWith('devtools')) || pages[0]
await new Promise(r => setTimeout(r, 2000))
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button,[role=button],[class*=cursor-pointer]')].find(el => el.textContent?.trim() === '设置')
  if (btn) btn.click()
})
await new Promise(r => setTimeout(r, 1500))
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find(el => el.querySelector('path')?.getAttribute('d') === 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z')
  if (b) b.click()
})
await new Promise(r => setTimeout(r, 1500))
const info = await page.evaluate(() => {
  const txt = document.body.innerText
  return {
    hasShield: txt.includes('巨天安全'), hasCmdGuard: txt.includes('危险命令拦截'),
    hasInjection: txt.includes('提示词注入扫描'), hasKeyShield: txt.includes('密钥屏蔽与占位符'),
    hasLog: txt.includes('安全记录'),
    logEntries: (txt.match(/已拦截|注入标记|密钥打码|占位符/g) || []).length,
  }
})
await page.screenshot({ path: '/tmp/security-tab3.png' })
console.log(JSON.stringify(info))
browser.disconnect()
process.exit(0)
