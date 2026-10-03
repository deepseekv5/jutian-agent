const { chromium } = require('/tmp/jutian-video/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--force-device-scale-factor=1','--force-color-profile=srgb','--enable-gpu-rasterization','--ignore-gpu-blocklist','--no-first-run'] });
  const p = await b.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor:1 });
  const errs=[]; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8899/promo.html');
  await p.waitForTimeout(1100);
  await p.evaluate(() => window.__reset());
  await p.waitForTimeout(60);
  const TOTAL = await p.evaluate(() => window.__total);
  let t = 0, step = 116, f = 0, hiccups = 0;
  const stamps = [];                     // 每帧的精确时间线时间(ms)
  while (t < TOTAL && f < 1500) {
    await p.evaluate(x => window.__applyTime(x), t);
    stamps.push(t);
    const s = Date.now();
    await p.screenshot({ path: `/tmp/jutian-video/film2/frames/f${String(f).padStart(4,'0')}.jpg`, type:'jpeg', quality:96, timeout:20000 });
    const d = Date.now() - s;
    if (d > 400) { hiccups++; console.log('HICCUP', f, d + 'ms'); }
    t += step; f++;
    step = Math.min(200, Math.max(88, d + 8));
  }
  await b.close();
  console.log('帧数:', f, ' 覆盖:', (t/1000).toFixed(2)+'s / TOTAL '+(TOTAL/1000).toFixed(2)+'s  卡顿:', hiccups, ' 错误:', errs.length||'无');
  require('fs').writeFileSync('/tmp/jutian-video/film2/stamps.json', JSON.stringify(stamps));
  // 尾帧:片尾定格 0.6s
  const tail = 6;
  for (let i = 1; i <= tail; i++) {
    const src = `frames/f${String(f-1).padStart(4,'0')}.jpg`;
    require('fs').copyFileSync(src, `frames/f${String(f-1+i).padStart(4,'0')}.jpg`);
    stamps.push(t + i * 100);
  }
  require('fs').writeFileSync('/tmp/jutian-video/film2/stamps.json', JSON.stringify(stamps));
  console.log('含尾帧总帧数:', stamps.length);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
