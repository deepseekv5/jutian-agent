import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmpHome = mkdtempSync(path.join(tmpdir(), 'jt-diag-'))
const serve = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], { cwd: ROOT, env: { ...process.env, HOME: tmpHome, PORT: '7433' }, stdio: ['ignore', 'ignore', 'pipe'] })
for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:7433/api/health'); if (r.ok) break } catch {}; await new Promise(r=>setTimeout(r,500)) }
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1366, height: 900 });
const errs = [];
p.on('pageerror', e => errs.push('page:' + String(e).slice(0, 120)));
p.on('requestfailed', r => errs.push('reqfail:' + r.url().slice(-60) + ' ' + (r.failure()?.errorText || '')));
await p.evaluateOnNewDocument(() => { localStorage.setItem('lyclaw_legal_consent', '2026-11-19'); localStorage.setItem('lyclaw_theme', 'light') });
await p.goto('http://127.0.0.1:7433/', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('对话和 AI 直接对话')); if (el) el.click() });
for (const wait of [1500, 3000, 5000]) {
  await new Promise(r => setTimeout(r, wait));
  const s = await p.evaluate(() => {
    const tabs = [...document.querySelectorAll('.jt-tab-body')].map((t, i) => ({ i, vis: t.style.display !== 'none', len: t.textContent.length, head: t.textContent.slice(0, 60) }))
    return { tas: document.querySelectorAll('textarea').length, tabs }
  });
  console.log('t+' + wait, JSON.stringify(s));
}
console.log('errors:', JSON.stringify(errs.slice(0, 8)));
await b.close();
try { serve.kill('SIGKILL'); rmSync(tmpHome, { recursive: true, force: true }) } catch {}
