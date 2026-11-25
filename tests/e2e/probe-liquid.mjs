import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1366, height: 900 });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await p.evaluateOnNewDocument(() => { localStorage.setItem('lyclaw_legal_consent', '2026-11-19'); });
await p.goto('http://127.0.0.1:7453/', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
// 默认（on）
await p.screenshot({ path: '/tmp/jt-lg-on.png' });
// 统计生效的玻璃元素数
const onCount = await p.evaluate(() => ({
  flag: document.documentElement.getAttribute('data-liquid-glass'),
  intensity: getComputedStyle(document.documentElement).getPropertyValue('--glass-intensity'),
  buttons: document.querySelectorAll('button').length,
}));
// 关闭
await p.evaluate(() => { document.documentElement.setAttribute('data-liquid-glass', 'off'); });
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: '/tmp/jt-lg-off.png' });
console.log(JSON.stringify(onCount));
await b.close();
