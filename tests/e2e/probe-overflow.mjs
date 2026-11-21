import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
for (const name of ['highlights', 'features']) {
  await p.goto(`http://127.0.0.1:8923/${name}.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 800));
  const wide = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth
    return [...document.querySelectorAll('*')]
      .filter(el => el.getBoundingClientRect().right > vw + 2 && el.offsetWidth > 40)
      .slice(0, 6)
      .map(el => `${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(el.getBoundingClientRect().right)}`)
  });
  console.log(name, '溢出元素:', JSON.stringify(wide, null, 1));
}
await b.close();
