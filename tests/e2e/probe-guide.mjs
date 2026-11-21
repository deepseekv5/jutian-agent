import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await p.goto('http://127.0.0.1:8923/guide.html#/quickstart', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: '/tmp/jt-guide-wi.png' });
await b.close();
