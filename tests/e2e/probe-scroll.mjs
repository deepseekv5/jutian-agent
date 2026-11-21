import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
for (const name of ['highlights', 'features']) {
  await p.goto(`http://127.0.0.1:8923/${name}.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  const r = await p.evaluate(() => { window.scrollTo(80, 0); return { scrollX: window.scrollX, canScroll: window.scrollX > 0 } });
  console.log(name, JSON.stringify(r));
}
await b.close();
