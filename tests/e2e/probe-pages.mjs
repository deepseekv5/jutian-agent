import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
for (const name of ['highlights', 'features', 'scenarios', 'about']) {
  await p.goto(`http://127.0.0.1:8923/${name}.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1200));
  await p.screenshot({ path: `/tmp/jt-wi-${name}.png` });
  const glass = await p.$$eval('.wi-glass', a => a.length).catch(() => 0);
  const glow = await p.$$eval('.wi-glow', a => a.length).catch(() => 0);
  const hscroll = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`${name}: glass=${glass} glow=${glow} 横向滚动=${hscroll}`);
}
await b.close();
