import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('https://winisland.cn/WinIsland/#/zh', { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('goto:', e.message.slice(0, 80)));
await new Promise(r => setTimeout(r, 3000));
await p.screenshot({ path: '/tmp/jt-ref-winisland.png' });
const info = await p.evaluate(() => {
  const body = getComputedStyle(document.body);
  const grab = (sel) => [...document.querySelectorAll(sel)].slice(0, 4).map(el => {
    const s = getComputedStyle(el);
    return { tag: el.tagName, cls: String(el.className).slice(0, 50), bg: s.backgroundColor, color: s.color, radius: s.borderRadius, border: s.border.slice(0, 40), fs: s.fontSize, backdrop: s.backdropFilter.slice(0, 60) };
  });
  return {
    title: document.title,
    bodyBg: body.backgroundColor, bodyColor: body.color, bodyFont: body.fontFamily.slice(0, 80),
    text: document.body.textContent.slice(0, 500),
    headers: grab('h1,h2,h3'),
    cards: grab('[class*="card"],[class*="panel"],[class*="tile"],[class*="item"]').slice(0, 4),
    nav: grab('nav,header,[class*="nav"],[class*="sidebar"]').slice(0, 3),
    btns: grab('a[class*="btn"],button').slice(0, 3),
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
