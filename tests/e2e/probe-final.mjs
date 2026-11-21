import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
for (const [name, path] of [['scenarios', 'scenarios.html'], ['about', 'about.html']]) {
  await p.goto(`http://127.0.0.1:8923/${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1200));
  await p.screenshot({ path: `/tmp/jt-wi2-${name}.png` });
}
await b.close();
