/**
 * 联网搜索域（v13.8.2 自 serve.ts 抽出）
 *
 * 多引擎聚合：Bing SERP 直抓 → DuckDuckGo HTML → SearXNG（动态发现实例）→
 * Electron 真实浏览器指纹。带 10 分钟结果缓存与相关性排序。
 * 依赖：仅 Node 内置（fetch/Buffer），Electron 不可用时自动跳过该引擎。
 */

'use strict'

// 搜索专用 UA（与主文件其它抓取场景解耦，避免一处改动影响全部）
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function cleanHtml(text) {
  return text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return " "; } }).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// 解码 Bing 点击追踪链接（u=a1 + base64 编码的真实网址）
function decodeBingUrl(url) {
  try {
    if (url.includes("bing.com/ck/a")) {
      const m = url.match(/u=a1([A-Za-z0-9+/=]+)/);
      if (m) return Buffer.from(m[1], "base64").toString("utf-8");
    }
  } catch {}
  return url;
}

async function fetchHtml(url, timeout = 12000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" }, signal: AbortSignal.timeout(timeout) });
  return r.text();
}

// ─── 搜索源：SearXNG 优先（动态发现可用实例）+ Bing 应急保险丝 ───
const SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://search.bus-hit.me",
  "https://priv.au",
  "https://searx.tiekoetter.com",
  "https://searxng.site",
  "https://paulgo.io",
  "https://opnxng.com",
  "https://search.ononoki.org",
];

// 从 searx.space 动态拉取健康实例清单（社区维护，含引擎状态）
let cachedInstances = null;
let cachedAt = 0;
async function discoverInstances() {
  try {
    if (cachedInstances && Date.now() - cachedAt < 10 * 60 * 1000) return cachedInstances;
    const r = await fetch("https://searx.space/data/instances.json", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const list = [];
    for (const [url, meta] of Object.entries(d.instances || {})) {
      if (!meta) continue;
      const info = meta.json || {};
      // 偏好支持 json 格式且状态 ok 的实例
      if (info.format === false) continue;
      const health = meta.health || {};
      const status = Object.values(health).find((h) => typeof h === "object");
      if (status && status.status === "ok") list.push(url);
      else list.push(url); // 无健康信息也纳入，请求时逐个验证
    }
    cachedInstances = list.slice(0, 15);
    cachedAt = Date.now();
    return cachedInstances;
  } catch { return []; }
}

async function searxngSearch(q) {
  // 动态实例（优先）+ 静态实例，全部并行探测，谁先出结果用谁
  const candidates = [...(await discoverInstances()), ...SEARXNG_INSTANCES];
  const unique = [...new Set(candidates)].slice(0, 12);
  const probe = async (inst) => {
    try {
      // 实例清单来自第三方(searx.space 社区维护)，被污染就可能指向内网，
      // 与 web_fetch 同等对待
      await assertFetchableUrl(inst);
      const r = await fetch(`${inst}/search?q=${encodeURIComponent(q)}&format=json&language=zh-CN&safesearch=0`, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) return [];
      const text = await r.text();
      // 反爬验证页（Cloudflare 等）→ 跳过
      if (/verifying your browser|cf-challenge|captcha/i.test(text.slice(0, 500))) return [];
      const d = JSON.parse(text);
      return (Array.isArray(d.results) ? d.results : [])
        .filter((x) => x && x.url && x.title)
        .map((x) => ({ title: cleanHtml(x.title), url: x.url, snippet: cleanHtml(x.content || "") }))
        .slice(0, 8);
    } catch { return []; }
  };
  const settled = await Promise.allSettled(unique.map(probe));
  // 汇总所有成功实例的结果，去重合并（避免单个实例返回错误缓存污染结果）
  const merged = [];
  const seen = new Set();
  for (const s of settled) {
    if (s.status !== "fulfilled" || s.value.length === 0) continue;
    for (const item of s.value) {
      const key = item.url || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= 10) break;
    }
    if (merged.length >= 10) break;
  }
  return merged;
}

// 应急保险丝：SearXNG 全灭时用 Bing 兜底（HTML 抓取）
async function bingSearch(q) {
  try {
    const html = await fetchHtml(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-hans`);
    const out = [];
    const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;
    let m;
    while ((m = re.exec(html)) && out.length < 8) {
      out.push({ title: cleanHtml(m[2]), url: m[1], snippet: cleanHtml(m[3] || "") });
    }
    return out;
  } catch { return []; }
}

// DuckDuckGo HTML 端点直抓(结果链接经 /l/?uddg= 包装,需解码真实网址)
async function ddgSearch(q) {
  try {
    const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    const out = [];
    const snippets = [];
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let s;
    while ((s = sn.exec(html)) && snippets.length < 10) snippets.push(cleanHtml(s[1]));
    const re = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && out.length < 8) {
      let url = m[1];
      const u = url.match(/[?&]uddg=([^&]+)/);
      if (u) { try { url = decodeURIComponent(u[1]); } catch {} }
      out.push({ title: cleanHtml(m[2]), url, snippet: snippets[out.length] || "" });
    }
    return out.filter((x) => x.title && x.url && !x.url.includes("duckduckgo.com"));
  } catch { return []; }
}

// 多来源合并:解码追踪链接 + 去重 + 限量
function mergeSources(lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of list || []) {
      if (item.url) item.url = decodeBingUrl(item.url);
      const key = item.url || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 12) return out;
    }
    if (out.length >= 12) break;
  }
  return out;
}

// ─── Electron 真实浏览器搜索（隐藏窗口访问 Google/Bing，真实指纹反爬免疫）───
let searchWin = null;
async function electronSearch(q) {
  let electron = null;
  try { electron = require("electron"); } catch { return []; }
  if (!electron?.BrowserWindow) return [];
  const engines = [
    {
      name: "Google",
      url: `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=zh-CN&num=10`,
      extract: `(() => { const out = []; for (const g of document.querySelectorAll('#search .g')) { const a = g.querySelector('a'); if (!a || !a.href) continue; const h3 = a.querySelector('h3'); const p = g.querySelector('.VwiC3b, .aCOpRe'); out.push({ title: (h3 ? h3.innerText : a.innerText) || '', url: a.href, snippet: (p ? p.innerText : '') }); if (out.length >= 8) break; } return out; })()`,
    },
    {
      name: "Bing",
      url: `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-hans`,
      extract: `(() => { const out = []; for (const x of document.querySelectorAll('.b_algo')) { const a = x.querySelector('h2 a'); if (!a || !a.href) continue; const p = x.querySelector('.b_caption p, p'); out.push({ title: a.innerText || '', url: a.href, snippet: (p ? p.innerText : '') }); if (out.length >= 8) break; } return out; })()`,
    },
  ];
  for (const eng of engines) {
    try {
      if (!searchWin || searchWin.isDestroyed()) {
        searchWin = new electron.BrowserWindow({
          show: false,
          width: 1280,
          height: 900,
          webPreferences: { offscreen: true, contextIsolation: true },
        });
      }
      await searchWin.loadURL(eng.url, { userAgent: UA });
      // 等页面渲染与结果加载
      await new Promise((r) => setTimeout(r, 2800));
      const res = await searchWin.webContents.executeJavaScript(eng.extract);
      if (Array.isArray(res) && res.length > 0) {
        return res.map((x) => ({ title: cleanHtml(x.title), url: x.url, snippet: cleanHtml(x.snippet || "") })).filter((x) => x.title && x.url);
      }
    } catch (e) {
      console.error(`[search] ${eng.name} 引擎失败: ${e.message}`);
      try { searchWin?.webContents.stop(); } catch {}
    }
  }
  return [];
}

// 搜索结果缓存（v13.6，10 分钟 TTL）：agent 调研常同词反复搜，命中省 2-5 秒
const SEARCH_CACHE = new Map();
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
async function web_search(args) {
  try {
    const q = args.query || args.q || "";
    if (!q) return { success: false, error: "缺少 query 参数" };
    const cacheKey = q.trim().toLowerCase();
    const cached = SEARCH_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
      return { ...cached.result, cached: true };
    }
    // 策略一(首选):直接抓搜索引擎结果页——零依赖、无需 key、1-2s 出结果。
    // Bing SERP 直抓优先;不足 5 条再补 DuckDuckGo HTML 端点。
    let results = mergeSources([await bingSearch(q), await ddgSearch(q)]);
    if (results.length < 5) {
      // 策略二(补强):Electron 真实浏览器指纹 + SearXNG 并行,合并去重
      const [searxResults, electronResults] = await Promise.all([searxngSearch(q), electronSearch(q)]);
      results = mergeSources([results, searxResults, electronResults]);
    }
    // 相关性排序：标题包含查询关键词的结果排前面（压制垃圾/缓存污染）
    const tokens = q.replace(/[^\u4e00-\u9fff\w]/g, " ").split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const score = (s) => {
        let n = 0;
        for (const t of tokens) if (s.includes(t)) n++;
        // 中文按双字片段匹配
        if (/[\u4e00-\u9fff]/.test(q)) {
          const bigrams = [];
          for (let i = 0; i < q.length - 1; i++) {
            const g = q.slice(i, i + 2);
            if (/[\u4e00-\u9fff]{2}/.test(g)) bigrams.push(g);
          }
          for (const g of bigrams) if (s.includes(g)) n++;
        }
        return n;
      };
      results.sort((a, b) => score(b.title || "") - score(a.title || ""));
    }
    results.length = Math.min(results.length, 10);
    if (results.length === 0) {
      return { success: false, error: "搜索无结果：所有搜索引擎均未返回内容，请稍后重试或换个关键词" };
    }
    const RESULT = { success: true, output: JSON.stringify(results.slice(0, 10), null, 2) };
    SEARCH_CACHE.set(cacheKey, { at: Date.now(), result: RESULT });
    if (SEARCH_CACHE.size > 50) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
    return RESULT;
  } catch (e) { return { success: false, error: e.message }; }
}


module.exports = { web_search }
