#!/usr/bin/env node
/**
 * 巨天agent — 后端服务（单进程：静态文件 + Tool API）
 *
 * 本文件由 src/server/ 反推重建（原 serve.ts 源码在 v7.0.0 打包时丢失），
 * 构建命令：npm run build:server   （esbuild 产出根目录 serve.cjs）
 */
import * as http from 'http'
import * as https from 'https'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import * as cp from 'child_process'
import * as util from 'util'
import * as os from 'os'

var execAsync = util.promisify(cp.execFile);

// ─── 数据目录：统一在 ~/.lyclaw（2026-10 起废弃 ~/.laoyou-agent，启动时自动迁移）───
var HOME = os.homedir();
var LYCLAW_HOME = path.join(HOME, ".lyclaw");       // 主目录：data.db / skills / scheduled_tasks.json / skill_market.json
var DATA_DIR = path.join(LYCLAW_HOME, "data");      // 运行时数据：remote.json / 记忆 / 截图 / MCP 配置 / 旧消息存档
var LEGACY_HOME = path.join(HOME, ".laoyou-agent"); // 旧目录，搬空即删
// 迁移策略与 skills 相同：旧有新无才搬（绝不覆盖新数据），全部搬空才删旧目录；
// 任何一步失败都保留现场，下次启动重试。必须先于 MCP/DB 初始化执行。
(() => {
  try {
    if (!fs.existsSync(LEGACY_HOME)) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let moved = 0, failed = 0;
    const moveOne = (from, toDir) => {
      try {
        if (!fs.existsSync(from)) return;
        const dest = path.join(toDir, path.basename(from));
        if (fs.existsSync(dest)) return;
        fs.renameSync(from, dest);
        moved++;
      } catch { failed++; }
    };
    // data/ 下的运行时数据整体并入 ~/.lyclaw/data
    const legacyData = path.join(LEGACY_HOME, "data");
    if (fs.existsSync(legacyData)) {
      for (const name of fs.readdirSync(legacyData)) moveOne(path.join(legacyData, name), DATA_DIR);
      // 旧 remote.json 是服务端生成的配对随机数:新处已有则以新为准,旧的丢弃
      // (重新生成即可),否则 data/ 永远搬空不了,旧目录永远删不掉
      const legacyRemote = path.join(legacyData, "remote.json");
      if (fs.existsSync(legacyRemote)) { try { fs.rmSync(legacyRemote); } catch {} }
      try { fs.rmdirSync(legacyData); } catch { failed++; }
    }
    // 旧根下的散件,与旧布局保持一致(主目录根)
    moveOne(path.join(LEGACY_HOME, "scheduled_tasks.json"), LYCLAW_HOME);
    moveOne(path.join(LEGACY_HOME, "skill_market.json"), LYCLAW_HOME);
    // skills:子目录逐个并入。绝不整目录删除——旧目录里可能有新目录缺的技能
    // (实测就有 regex-tester);搬不动的(重名)留在原地,日志提示人工处理
    const legacySkills = path.join(LEGACY_HOME, "skills");
    if (fs.existsSync(legacySkills)) {
      const newSkills = path.join(LYCLAW_HOME, "skills");
      fs.mkdirSync(newSkills, { recursive: true });
      for (const name of fs.readdirSync(legacySkills)) moveOne(path.join(legacySkills, name), newSkills);
      let left = 0;
      try { left = fs.readdirSync(legacySkills).length; } catch {}
      if (left > 0) console.log(`[migrate] 旧 skills 有 ${left} 个重名条目未搬,保留在 ${legacySkills}`);
    }
    if (failed === 0) {
      let rest: string[] = [];
      try { rest = fs.readdirSync(LEGACY_HOME); } catch {}
      if (rest.length === 0) fs.rmdirSync(LEGACY_HOME);
    }
    if (moved || failed) console.log(`[migrate] ~/.laoyou-agent → ~/.lyclaw: moved=${moved} failed=${failed}`);
  } catch (e) { console.error("[migrate] failed:", e.message); }
})();

// ─── STT 常驻 worker：模型只加载一次，避免每次识别冷启动 python+import（提速关键）───
var _stt = { proc: null, buf: "", queue: [], current: null };
function _sttEnsure() {
  if (_stt.proc && _stt.proc.exitCode === null) return _stt.proc;
  const pyBin = process.env.PYTHON_BIN || "python3";
  const sttScript = process.env.STT_SCRIPT || path.join(__dirname, "src", "shared", "stt.py");
  _stt.buf = ""; _stt.current = null;
  _stt.proc = cp.spawn(pyBin, [sttScript, "--serve"], {
    env: { ...process.env, PYTHONUNBUFFERED: "1", WHISPER_THREADS: "4" }, stdio: ["pipe", "pipe", "pipe"],
  });
  _stt.proc.stdout.on("data", (d) => {
    _stt.buf += d.toString("utf8");
    let nl;
    while ((nl = _stt.buf.indexOf("\n")) >= 0) {
      const line = _stt.buf.slice(0, nl); _stt.buf = _stt.buf.slice(nl + 1);
      if (_stt.current && (line.startsWith("RESULT\t") || line.startsWith("ERR:\t"))) {
        const c = _stt.current; _stt.current = null;
        if (line.startsWith("ERR:\t")) c.fail(new Error(line.slice(5))); else c.done(line.slice(7));
      }
    }
  });
  _stt.proc.on("error", () => { _stt.proc = null; });
  _stt.proc.on("exit", () => {
    _stt.proc = null;
    if (_stt.current) { const c = _stt.current; _stt.current = null; c.fail(new Error("stt worker 退出")); }
  });
  return _stt.proc;
}
function _sttPump() {
  if (_stt.current || !_stt.queue.length) return;
  const job = _stt.queue.shift();
  let proc;
  try { proc = _sttEnsure(); } catch (e) { job.reject(e); return; }
  let to = setTimeout(() => { if (_stt.current === ctx) { _stt.current = null; job.reject(new Error("识别超时")); _sttPump(); } }, 60000);
  const ctx = {
    done: (t) => { clearTimeout(to); _stt.current = null; job.resolve(t); _sttPump(); },
    fail: (e) => { clearTimeout(to); _stt.current = null; job.reject(e); _sttPump(); },
  };
  _stt.current = ctx;
  try { proc.stdin.write(job.path + "\n"); } catch (e) { ctx.fail(e); }
}
function sttTranscribe(wavPath) {
  return new Promise((resolve, reject) => { _stt.queue.push({ path: wavPath, resolve, reject }); _sttPump(); });
}
// SQLite 设置存储（与开发版共用 ~/.lyclaw/data.db，避免 settings.json 双源不一致）
var PKG = (() => { try { return require("./package.json"); } catch (e) { return { version: "unknown" }; } })();
var sharedDb = null;
/* ─── MCP（Model Context Protocol）客户端管理器 — v5.0 学自 Zode ─── */
var mcp = (() => { try { const m = require("./src/shared/mcp.cjs"); m.init(DATA_DIR); return m; } catch (e) { console.error("mcp.cjs load failed:", e.message); return null; } })();
try { sharedDb = require("./src/shared/db.cjs"); } catch (e) { console.error("db.cjs load failed:", e.message); }
// AI 角色模块（预置角色 / 免责声明 / 系统提示构造）—— 与前端共用 src/shared/personas.ts
var PERSONA_MOD = (() => { try { return require("./src/shared/personas.cjs"); } catch (e) { console.error("personas.cjs load failed:", e.message); return null; } })();
var PRESET_PERSONAS = PERSONA_MOD ? PERSONA_MOD.PRESET_PERSONAS : [];
var PERSONA_DISCLAIMER = PERSONA_MOD ? PERSONA_MOD.DISCLAIMER : { disclaimer: [], privacy: [] };
var PORT = parseInt(process.env.PORT || "3211");
var MAX_OUT = 512 * 1024;
var DIST = path.join(__dirname, "dist");
var MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
var IS_WIN = process.platform === "win32";
var USER_HOME = process.env.HOME || process.env.USERPROFILE || (IS_WIN ? "C:\\Users" : os.homedir());
var ALLOWED = [USER_HOME, "/tmp", "/Users", "/opt", "/usr/local"];
var ok = (p) => ALLOWED.some((b) => path.resolve(p).startsWith(path.resolve(b)));
// ─── 工作区（设置中指定，实时生效）───
var globalWorkDir = "";
function setWorkDir(dir) {
  globalWorkDir = (dir || "").trim();
}
function resolveWork(p) {
  var base = globalWorkDir || USER_HOME;
  if (!p) return path.resolve(base);
  return path.resolve(base, p);
}
// 工作目录兜底：目录不存在时回落到用户主目录（避免 spawn ENOENT，例如换机器后旧工作区路径失效）
function safeCwd(cwd) {
  const candidate = cwd || globalWorkDir || USER_HOME;
  try { if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate; } catch {}
  return USER_HOME;
}
// ─── CORS / Origin 门卫 ───
// 前后端同源（前端 fetch 一律用相对路径，remote.html 亦然），因此根本不需要放开 CORS。
// 旧实现对所有响应回 `Access-Control-Allow-Origin: *`，导致任意网页的 JS 可直接
// fetch('http://localhost:3211/api/settings') 读走用户 API Key，并调用 /api/tools/execute。
// 现在：只对同源/本机可信来源回显 CORS，其余请求一律不带 CORS 头（由浏览器拦截）。
var isTrustedOrigin = (origin, host) => {
  if (!origin) return true; // 同源请求无 Origin 头；Electron file:// 与 curl 属此类
  var o = String(origin);
  // 注意：`Origin: null` 不可信。sandbox iframe / file:// 页面都能发出这种请求，
  // 足以绕过 CORS 读到密钥，故只放行本机 http(s) 来源。
  if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(o)) return true;
  if (/^https?:\/\/localhost(?::\d+)?$/i.test(o)) return true;
  if (/^https?:\/\/\[::1\](?::\d+)?$/i.test(o)) return true;
  // 手机远程：页面由本服务经局域网 IP 提供，浏览器 POST 会带
  // Origin: http://<lan-ip>:3211。与 Host 头一致即「同宿主」——恶意页面无法
  // 伪造出与目标 Host 相同的 Origin；DNS-rebinding 由 421（回环 + Host 非本机）兜底。
  var h = String(host || "").toLowerCase();
  if (h && o.toLowerCase() === "http://" + h) return true;
  if (h && o.toLowerCase() === "https://" + h) return true;
  return false;
};
var corsHeaders = (req) => {
  var origin = req && req.headers ? req.headers.origin : "";
  if (!isTrustedOrigin(origin, req && req.headers && req.headers.host)) return null;
  var h = { Vary: "Origin" };
  if (origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Credentials"] = "true";
  }
  return h;
};
// 敏感字段：即便请求方可信，GET 回包也不应明文下发密钥。
// 用「包含」而非全等匹配：qq_secret / baiduApiKey 这类前缀复合键也要命中，
// 全等匹配会让它们绕过掩码直接明文出网。
var SECRET_KEYS = ["apikey", "token", "secret", "password"];
var isSecretKey = (k) => {
  var kl = String(k).toLowerCase();
  return SECRET_KEYS.some((s) => kl.indexOf(s) >= 0);
};
var maskSecrets = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSecrets);
  var out = {};
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var v = obj[k];
    if (isSecretKey(k) && typeof v === "string" && v) {
      out[k] = v.length > 8 ? `${v.slice(0, 4)}****${v.slice(-4)}` : "****";
    } else out[k] = typeof v === "object" && v !== null ? maskSecrets(v) : v;
  }
  return out;
};
var json = (res, d, s = 200) => {
  var payload = s >= 200 && s < 300 ? maskSecrets(d) : d;
  res.writeHead(s, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
};
// 不做掩码的 JSON 出口：仅用于备份导出。备份必须携带真实密钥，否则还原即丢
// 配置；该端点已被同宿主 Origin 门卫保护，只有本机与已配对设备可达。
var jsonRaw = (res, d, s = 200) => {
  res.writeHead(s, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(d));
};
// 掩码值（如 sk-6****9Ylc）一律不得写回存储：客户端整表回传设置时会带着
// GET 拿到的掩码，原样落库会把真密钥冲成掩码垃圾。
var isMasked = (v) => typeof v === "string" && v.indexOf("****") >= 0;
// 需要按请求 Origin 决定 CORS 的响应（如流式/代理响应，绕过了 json()）
var jsonAs = (req, res, d, s = 200) => {
  var c = corsHeaders(req) || {};
  res.writeHead(s, { ...c, "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(maskSecrets(d)));
};
var body = async (req) => {
  const b = [];
  for await (const c of req) b.push(c);
  return JSON.parse(Buffer.concat(b).toString() || "{}");
};
// Windows 黑名单补 PowerShell 形态(cmd 形态对 PS 无效,之前的列表漏了整个 PS 面)
var BLOCKED = IS_WIN ? ["format c:", "del /f /s /q c:\\", "rd /s /q c:\\", "diskpart", "shutdown /s", "shutdown /r",
  "remove-item -path c:\\ -recurse", "remove-item c:\\windows", "rmdir /s", "cipher /w",
  "stop-process -id 0", "remove-item $env:systemroot"] : ["rm -rf /", "mkfs", "dd if=", ":(){:|:&};:", "chmod -R 777 /", "> /dev/sda", "format", "shutdown"];
async function shell(a) {
  if (!a.command) return { success: false, error: "无命令" };
  const n = a.command.toLowerCase();
  if (BLOCKED.some((b) => n.includes(b))) return { success: false, error: "已阻止" };
  const cwd = safeCwd(a.workdir);
  try {
    let r;
    if (IS_WIN) {
      // Windows:PowerShell。两件事必须做:
      // 1) 前置 [Console]::OutputEncoding=UTF8 — PS5.1 默认按系统 ANSI 码页(GBK)输出,
      //    Node 按 UTF-8 解码会乱码;常量前缀不引入注入面。
      // 2) -NoProfile 避免用户 profile 拖慢/污染输出。
      const wrapped = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${a.command}`;
      r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", wrapped],
        { timeout: (a.timeout || 30) * 1e3, maxBuffer: MAX_OUT, env: process.env, cwd, encoding: "utf8" });
    } else {
      r = await execAsync("zsh", ["-c", a.command], { timeout: (a.timeout || 30) * 1e3, maxBuffer: MAX_OUT, env: { ...process.env, TERM: "dumb" }, cwd });
    }
    return { success: true, output: (r.stdout || "").trim() + ((r.stderr || "").trim() ? `\n[stderr]\n${r.stderr.trim()}` : "") };
  } catch (e) {
    return { success: false, output: e.stdout || "", error: e.message };
  }
}
async function read_file(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    let c = await fsp.readFile(p, "utf-8");
    if (a.offset || a.limit) {
      const ls = c.split("\n");
      c = ls.slice((a.offset || 1) - 1, a.limit ? (a.offset || 1) - 1 + a.limit : ls.length).join("\n");
    }
    return { success: true, output: c.slice(0, MAX_OUT) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
// ─── 可编辑 diff（v5.6）：写入前留底,聊天内可查看/撤销/编辑应用 ───
const DIFF_CHANGES = [];
const DIFF_FILE = path.join(DATA_DIR, "diff_changes.json");
// 变更留底持久化:重启后仍可撤销(内存版在 App 重启后全部丢失,撤销变成假动作)
try {
  const __saved = JSON.parse(fs.readFileSync(DIFF_FILE, "utf-8"));
  if (Array.isArray(__saved)) DIFF_CHANGES.push(...__saved.slice(0, 200));
} catch {}
function persistDiff() {
  try { fs.writeFileSync(DIFF_FILE, JSON.stringify(DIFF_CHANGES.slice(0, 200))); } catch {}
}
function recordChange(p, oldC, newC) {
  const id = "chg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  DIFF_CHANGES.unshift({ id, path: p, old: oldC, new: newC, ts: Date.now() });
  if (DIFF_CHANGES.length > 200) DIFF_CHANGES.length = 200;
  persistDiff();
  return id;
}

async function write_file(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    let __old = "";
    try { __old = await fsp.readFile(p, "utf-8"); } catch {}
    await fsp.writeFile(p, a.content, "utf-8");
    const __chg = recordChange(p, __old, String(a.content || ""));
    return { success: true, output: `\u2705 \u5DF2\u5199\u5165: ${p}`, changeId: __chg };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function edit_file(a) {
  const p = path.resolve(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    let c = await fsp.readFile(p, "utf-8");
    if (!c.includes(a.oldText)) return { success: false, error: "\u672A\u627E\u5230\u8981\u66FF\u6362\u7684\u6587\u672C" };
    const __oldFull = c;
    c = c.replace(a.oldText, a.newText);
    await fsp.writeFile(p, c, "utf-8");
    const __chg2 = recordChange(p, __oldFull, c);
    return { success: true, output: `\u2705 \u5DF2\u7F16\u8F91: ${p}`, changeId: __chg2 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function list_dir(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    let e = await fsp.readdir(p, { withFileTypes: true });
    if (!a.showHidden) e = e.filter((x) => !x.name.startsWith("."));
    const l = e.map((x) => `${x.isDirectory() ? "[目录]" : "[文件]"} ${x.name}${x.isDirectory() ? "/" : ""}`);
    return { success: true, output: l.join("\n") + `
${l.length} \u9879` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
/** 截屏工具（v5.6）：主进程内直接用 desktopCapturer，存盘并返回可访问的 URL */
async function screenshot(a) {
  try {
    const electron = require("electron");
    const { desktopCapturer, screen, BrowserWindow } = electron;
    const primary = screen.getPrimaryDisplay();
    const scale = Math.min(primary.scaleFactor || 1, 2);
    // 隐藏本应用窗口，避免截到自己
    const wins = BrowserWindow.getAllWindows().filter((w) => w.isVisible());
    wins.forEach((w) => w.hide());
    await new Promise((r) => setTimeout(r, 280));
    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: Math.round(primary.size.width * scale), height: Math.round(primary.size.height * scale) },
      });
    } finally {
      wins.forEach((w) => { try { w.show(); } catch {} });
    }
    let src = sources[0];
    // 竞态防护：启动后首帧捕获可能为空，延迟重试一次
    if (!src || src.thumbnail.isEmpty()) {
      await new Promise((r) => setTimeout(r, 500));
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: Math.round(primary.size.width * scale), height: Math.round(primary.size.height * scale) },
      });
      src = sources[0];
    }
    if (!src || src.thumbnail.isEmpty()) return { success: false, error: "屏幕捕获为空，请重试" };
    const dir = path.join(DATA_DIR, "screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "shot_" + Date.now().toString(36) + ".jpg");
    fs.writeFileSync(file, src.thumbnail.toJPEG(70));
    const token = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "remote.json"), "utf-8")).token } catch { return "" } })();
    const url = `/api/remote/file?path=${encodeURIComponent(file)}&t=${token}`;
    return { success: true, output: `📸 截屏完成（${src.thumbnail.getSize().width}x${src.thumbnail.getSize().height}）\n![screenshot](${url})\n文件: ${file}`, image: url, path: file };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function search_files(a) {
  const d = resolveWork(a.path);
  if (!ok(d)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    if (IS_WIN) {
      const cmd = `Get-ChildItem -Path "${d}" -Filter "${a.pattern}" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 100 -ExpandProperty FullName`;
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { timeout: 15e3, maxBuffer: MAX_OUT });
      return { success: true, output: r.stdout.trim().slice(0, MAX_OUT) };
    }
    const r = await execAsync("find", [d, "-name", a.pattern, "-maxdepth", String(a.maxDepth || 5)], { timeout: 15e3, maxBuffer: MAX_OUT });
    return { success: true, output: r.stdout.trim().slice(0, MAX_OUT) };
  } catch (e) {
    return { success: false, error: e.stderr || e.message };
  }
}
async function search_content(a) {
  const d = resolveWork(a.path);
  if (!ok(d)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    if (IS_WIN) {
      const cmd = `Get-ChildItem -Path "${d}" -Recurse -File -ErrorAction SilentlyContinue | Select-String -Pattern "${a.pattern}" -List | Select-Object -First 20 -ExpandProperty Path`;
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { timeout: 15e3, maxBuffer: MAX_OUT });
      return { success: true, output: r.stdout.trim() || "(\u65E0\u5339\u914D)" };
    }
    const r = await execAsync("grep", ["-rn", a.pattern, d, "--max-count=20"], { timeout: 15e3, maxBuffer: MAX_OUT });
    return { success: true, output: r.stdout.trim() || "(\u65E0\u5339\u914D)" };
  } catch (e) {
    return e.code === 1 ? { success: true, output: "(\u65E0\u5339\u914D)" } : { success: false, error: e.stderr || e.message };
  }
}
async function get_file_info(a) {
  try {
    const s = await fsp.stat(path.resolve(a.path));
    return { success: true, output: JSON.stringify({ size: s.size, type: s.isFile() ? "file" : "directory", modified: s.mtime.toISOString() }, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function move_file(a) {
  const s = path.resolve(a.src), d = path.resolve(a.dest);
  if (!ok(s) || !ok(d)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    await fsp.mkdir(path.dirname(d), { recursive: true });
    await fsp.rename(s, d);
    return { success: true, output: `\u2705 ${s} \u2192 ${d}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function delete_file(a) {
  const p = path.resolve(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    await fsp.unlink(p);
    return { success: true, output: `\u2705 \u5DF2\u5220\u9664` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function web_fetch(a) {
  try {
    const r = await fetch(a.url, { headers: { "User-Agent": "LaoyouAgent/1.0" }, signal: AbortSignal.timeout(2e4) });
    let t = await r.text();
    t = t.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n").replace(/\n{3,}/g, "\n").trim();
    return { success: true, output: `[${r.status}]

${t.slice(0, MAX_OUT)}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function http_request(a) {
  try {
    const r = await fetch(a.url, { method: a.method || "GET", headers: { "Content-Type": "application/json" }, body: a.body, signal: AbortSignal.timeout(2e4) });
    return { success: true, output: JSON.stringify({ status: r.status, body: (await r.text()).slice(0, MAX_OUT) }, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function git_operation(a) {
  return shell({ command: `git ${a.command}`, workdir: a.repoPath });
}
async function npm_run(a) {
  return shell({ command: `npm ${a.command || ""}`, workdir: a.projectPath });
}
async function code_analysis(a) {
  const p = path.resolve(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    const c = await fsp.readFile(p, "utf-8");
    const im = [];
    for (const pat of [/^import\s+.+\s+from\s+['"](.+)['"]/gm, /^require\(['"](.+)['"]\)/gm]) {
      let m;
      while ((m = pat.exec(c)) !== null) im.push(m[1]);
    }
    return { success: true, output: JSON.stringify({ language: path.extname(p).slice(1), lines: c.split("\n").length, imports: [...new Set(im)] }, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function system_info() {
  try {
    const mu = ((os.totalmem() - os.freemem()) / 1073741824).toFixed(1), mt = (os.totalmem() / 1073741824).toFixed(1);
    let tools: Record<string, boolean> = {};
    if (IS_WIN) {
      // Windows:用 PowerShell 的 Get-Command 探测,不依赖 zsh/which
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; foreach ($t in 'node','npm','python','pip','git','docker','go','java') { if (Get-Command $t -ErrorAction SilentlyContinue) { Write-Output \"$t=yes\" } else { Write-Output \"$t=no\" } }"],
        { timeout: 8000, maxBuffer: 65536, encoding: "utf8" });
      for (const l of r.stdout.trim().split("\n")) {
        const [k, v] = l.split("=");
        if (k && v) tools[k.trim()] = v.trim() === "yes";
      }
    } else {
      const r = await execAsync("zsh", ["-c", 'for t in node npm python3 pip3 git brew docker rustc go java ruby; do which $t 2>/dev/null && echo "$t=yes" || echo "$t=no"; done'], { timeout: 5e3, maxBuffer: 65536 });
      for (const l of r.stdout.trim().split("\n")) {
        const [k, v] = l.split("=");
        if (k && v) tools[k.trim()] = v.trim() === "yes";
      }
    }
    return { success: true, output: JSON.stringify({ os: `${os.platform()} ${os.release()}`, arch: os.arch, cpu: `${os.cpus().length} 核`, memory: `${mu}GB / ${mt}GB`, node: process.version, home: os.homedir(), tools }, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function process_list(a) {
  try {
    let r;
    if (IS_WIN) {
      // Windows:Get-Process;filter 为空时按 CPU 时间取前 40
      const ps = a.filter
        ? `Get-Process | Where-Object { $_.ProcessName -like '*${a.filter.replace(/'/g, "''")}*' } | Select-Object -First 30 Id,ProcessName,CPU,WS | Format-Table -AutoSize`
        : "Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Id,ProcessName,CPU,WS | Format-Table -AutoSize";
      r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${ps}`], { timeout: 1e4, maxBuffer: MAX_OUT, encoding: "utf8" });
    } else {
      r = await execAsync("zsh", ["-c", a.filter ? `ps aux | grep -i "${a.filter}" | head -30` : "ps aux | head -40"], { timeout: 1e4, maxBuffer: MAX_OUT });
    }
    return { success: true, output: r.stdout.trim() || "(无匹配)" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function port_check(a) {
  try {
    if (IS_WIN) {
      // Windows:netstat -ano 过滤端口(lsof 不存在)
      const r = await execAsync("cmd.exe", ["/c", `netstat -ano | findstr :${a.port}`], { timeout: 5000, maxBuffer: 65536, encoding: "utf8" });
      const out = r.stdout.trim();
      return { success: true, output: out ? `端口 ${a.port}: 被占用\n${out}` : `端口 ${a.port} 空闲 ✅` };
    }
    const r = await execAsync("lsof", ["-ti", `:${a.port}`], { timeout: 5e3 });
    const pid = r.stdout.trim();
    if (!pid) return { success: true, output: `端口 ${a.port} 空闲 ✅` };
    const i = await execAsync("ps", ["-p", pid, "-o", "pid,comm"], { timeout: 5e3 });
    return { success: true, output: `端口 ${a.port}: ${i.stdout.trim()}` };
  } catch {
    return { success: true, output: `端口 ${a.port} 空闲 ✅` };
  }
}
async function json_process(a) {
  try {
    let d = a.data.startsWith("file:") ? JSON.parse(await fsp.readFile(path.resolve(a.data.slice(5)), "utf-8")) : JSON.parse(a.data);
    if (a.query === "keys") return { success: true, output: Object.keys(d).join("\n") };
    return { success: true, output: JSON.stringify(d, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
var SKILL_DIR = path.join(os.homedir(), ".lyclaw", "skills");
// 迁移：旧目录 ~/.laoyou-agent/skills → ~/.lyclaw/skills（与开发版共用一个技能库）
(() => {
  try {
    const oldDir = path.join(os.homedir(), ".laoyou-agent", "skills");
    if (fs.existsSync(oldDir) && !fs.existsSync(SKILL_DIR)) {
      fs.mkdirSync(path.dirname(SKILL_DIR), { recursive: true });
      fs.cpSync(oldDir, SKILL_DIR, { recursive: true });
    }
    if (!fs.existsSync(SKILL_DIR)) fs.mkdirSync(SKILL_DIR, { recursive: true });
  } catch {}
})();
var TASKS_FILE = path.join(LYCLAW_HOME, "scheduled_tasks.json");
var MARKET_FILE = path.join(LYCLAW_HOME, "skill_market.json");

// 生成标准 SKILL.md（真实技能文件）
function writeSkillMd(skillDir, meta) {
  try {
    const md = `---
name: ${meta.name}
description: ${meta.description || meta.name}
version: ${meta.version || "1.0.0"}
author: ${meta.author || "巨天agent"}
---

# ${meta.display_name || meta.name}

${meta.description || "（技能说明）"}

## 使用方法

当用户请求与本技能相关的能力时，按照以下说明执行：

${meta.instructions || `- ${meta.description || "根据用户需求完成任务"}`}

## 文件说明

- \`SKILL.md\` — 技能说明（本文件，AI 加载时读取）
- \`skill.json\` — 技能元数据
${meta.hasTools ? "- `tools.json` — 工具定义列表" : ""}
`;
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), md, "utf-8");
  } catch {}
}

// 从 SKILL.md frontmatter 解析元数据
function parseSkillMd(skillDir) {
  try {
    const fp = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(fp)) return null;
    const text = fs.readFileSync(fp, "utf-8");
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const meta = { hasSkillMd: true };
    if (m) {
      for (const line of m[1].split("\n")) {
        const kv = line.match(/^(\w+):\s*(.+)$/);
        if (kv) meta[kv[1]] = kv[2].trim();
      }
    }
    return meta;
  } catch { return null; }
}

// 预设 Skill 市场数据（v10.0：每个技能带 instructions，安装时写入 SKILL.md —— 真指令，不是空壳）
var DEFAULT_MARKET = [
  { id: "file-organizer", name: "文件整理助手", version: "1.1.0", author: "巨天", description: "智能归类整理文件，支持按类型/关键词/日期分类归档", tags: ["工具", "文件"], tools: [{ name: "organize", description: "整理指定目录下的文件(按类型/日期/关键词)" }],
    instructions: `你是文件整理专家。整理前必须：
1. list_dir 列出目标目录全部内容，向用户展示分组方案并确认，未经确认不得移动任何文件
2. 分类规则优先级：项目文档(文档/表格/PPT) > 代码(按语言) > 媒体(图片/视频/音频) > 压缩包 > 其他
3. 命名规范：目标目录名用「类型_日期」(如 文档_2026-10)；已有目录则并入
4. move_file 时保持原名，不重命名；遇同名文件跳过并报告
5. 完成后输出清单：移动了几个、跳过几个、保留原地的异常文件` },
  { id: "invoice-retrieval", name: "发票识别", version: "1.1.0", author: "巨天", description: "批量识别和解析发票信息，提取结构化数据", tags: ["财务", "发票"], tools: [{ name: "detect_invoice", description: "检测发票文件" }, { name: "parse_invoice", description: "解析发票内容" }],
    instructions: `你是发票识别专家。流程：
1. list_dir 找到目标目录全部 PDF/图片发票
2. 逐张识别：金额、开票日期、销售方、购买方、税号、发票号码
3. 汇总为表格输出（文件名 + 六个字段），同时问用户是否需要导出 CSV
4. 识别不确定的字段标注「待人工核对」，不要猜测
5. 批量处理时每 5 张报告一次进度` },
  { id: "image-search", name: "图片搜索", version: "1.1.0", author: "巨天", description: "按语义搜索图片和截图，支持按内容/日期/来源筛选", tags: ["搜索", "图片"], tools: [{ name: "search_photos", description: "语义搜索图片" }],
    instructions: `你是图片搜索助手。
1. 用 web_search 找图时必须注明来源页面，盗链直链需标注「可能失效」
2. 搜索结果用列表呈现：标题 / 尺寸（如可得）/ 来源域名 / 直链
3. 用户要下载时用 http_request 下载到工作目录，文件名用「标题_来源域名.扩展名」
4. 版权风险：提醒用户注意素材授权范围，商业用途需确认 License` },
  { id: "document-writer", name: "文档撰写", version: "1.1.0", author: "巨天", description: "生成专业文档和报告：技术方案/工作总结/产品说明", tags: ["文档", "写作"], tools: [{ name: "write_doc", description: "撰写文档" }],
    instructions: `你是专业文档写手。
1. 动笔前先确认三件事：文档类型（给谁看）、篇幅、必须覆盖的要点
2. 结构先于文字：先给目录，用户确认后再写正文
3. 数据必须真实：引用数字前先用工具核实，不能编造
4. write_file 保存到工作目录，Markdown 格式，标题层级不超过三级
5. 完成后主动询问是否需要转 PPT（可调用 create_pptx）` },
  { id: "pptx", name: "PPT 制作", version: "1.1.0", author: "巨天", description: "创建和编辑演示文稿，支持模板/图表/表格", tags: ["演示", "PPT"], tools: [{ name: "create_pptx", description: "创建演示文稿" }],
    instructions: `你是演示文稿专家。
1. 先问清三件事：主题、页数（默认 10）、受众
2. 生成大纲 → 用户确认 → 再逐页制作
3. 版式优先级：封面/目录/章节页/内容页（图文/表格/图表）/结尾页
4. 每页一个观点；文字不超过 6 行；数据必须真实可溯源
5. 产出后用 PPT 编辑器打开供用户微调` },
  { id: "web-researcher", name: "联网调研", version: "1.1.0", author: "巨天", description: "多源联网调研：搜索/抓取/交叉验证，产出带引用的调研报告", tags: ["调研", "联网"], tools: [{ name: "web_search", description: "多源搜索" }, { name: "web_fetch", description: "抓取网页正文" }],
    instructions: `你是调研专家。铁律：
1. 每个结论必须带来源 URL；无法验证的说法明确标注「未证实」
2. 至少 2 个独立来源交叉验证关键事实
3. 检索词策略：先宽后窄，中英文各搜一轮
4. web_fetch 抓正文失败时降级：搜索摘要 → 缓存页面 → 官方仓库/文档
5. 产出行文：结论先行 → 证据（带链接）→ 分歧与不确定性 → 参考列表
6. 时效性：版本号/价格/政策类信息注明查询日期` },
  { id: "code-reviewer", name: "代码评审", version: "1.1.0", author: "巨天", description: "审查代码变更：安全/性能/可维护性，输出分级问题清单", tags: ["代码", "质量"], tools: [{ name: "read_file", description: "读取代码" }, { name: "search_content", description: "搜索模式" }],
    instructions: `你是资深代码评审专家。审查流程：
1. 先 git_operation diff 看变更范围，不审无关代码
2. 按严重级分级：P0 安全/数据损坏，P1 逻辑错误，P2 性能，P3 可维护性
3. 每个问题给出：文件:行号、问题描述、修复建议、影响面
4. 安全重点：注入/越权/密钥硬编码/未校验外部输入
5. 只提可执行建议，不空谈风格偏好；风格问题注明「可选」
6. 总结必须包含：总体评价 + 必须修复数量 + 建议修复数量` },
  { id: "data-analyst", name: "数据分析", version: "1.1.0", author: "巨天", description: "分析结构化数据：CSV/JSON/SQLite，产出统计与图表建议", tags: ["数据", "分析"], tools: [{ name: "read_file", description: "读取数据" }, { name: "shell", description: "执行分析脚本" }],
    instructions: `你是数据分析专家。
1. 先看数据结构（列名/类型/行数/缺失值），再决定分析方法
2. 分析脚本用 node/python 写临时文件执行，结果落盘 CSV，不在终端刷原始数据
3. 统计口径必须说明：是均值还是中位数、是否含异常值、时间窗多长
4. 图表建议具体到：坐标轴/图表类型/要对比的维度
5. 结论用数字说话，不用「大概」「较多」这类模糊词
6. 发现数据质量问题（重复/缺失/格式错误）先报告再分析` },
  { id: "git-flow-expert", name: "Git 流程助手", version: "1.1.0", author: "巨天", description: "规范 Git 操作：提交信息/分支管理/冲突解决/历史清理建议", tags: ["Git", "流程"], tools: [{ name: "git_operation", description: "Git 操作" }],
    instructions: `你是 Git 流程专家。
1. 提交信息规范：type（必需）: 描述；type ∈ feat/fix/refactor/docs/chore/test/security
2. 提交前必须 git status + git diff 过目全部改动；密钥/大文件/日志一律不提交
3. 一次提交只做一件事；混合改动先拆分或向用户说明为何不拆
4. 分支策略：feat/* 新功能，fix/* 修复；禁止直接提交到 main（用户明确要求除外）
5. 冲突解决：先理解双方意图再动手，解决后必须构建验证
6. 历史操作（push -f/rebase/reset）执行前必须说明影响并得到确认` },
  { id: "release-manager", name: "版本发布助手", version: "1.1.0", author: "巨天", description: "版本发布全流程：升级版本号/更新日志/打包/发布 Release", tags: ["发布", "运维"], tools: [{ name: "shell", description: "执行打包命令" }, { name: "git_operation", description: "标记版本" }],
    instructions: `你是版本发布助手。发布流程：
1. 确认当前工作区干净（git status），变更全部已合并
2. 版本号遵循语义化：破坏性→major，新功能→minor，修复→patch
3. package.json 版本号是单一来源，其余文件自动跟随
4. CHANGELOG.md 先写：新增/变更/修复/安全四段，面向用户不面向代码
5. 构建产物必须实测：mac 装、win 跑、更新包自更新链路
6. 发布后验证：下载链接可达、SHA256 一致、应用内自更新检查通过` },
];
function loadMarket() {
  try {
    if (fs.existsSync(MARKET_FILE)) {
      const saved = JSON.parse(fs.readFileSync(MARKET_FILE, "utf-8"));
      if (Array.isArray(saved) && saved.length > 0) {
        // v10.0：内置市场升级(旧文件条目缺 instructions 时用新版数据补齐)，
        // 用户自行添加的条目保留
        const byId = new Map(saved.map((s: { id?: string }) => [s.id as string, s]));
        let upgraded = false;
        for (const d of DEFAULT_MARKET) {
          const cur = byId.get(d.id);
          if (!cur || !cur.instructions) { byId.set(d.id, { ...d, ...cur, ...(cur && cur.instructions ? {} : d) }); upgraded = true; }
        }
        if (upgraded) { const merged = [...byId.values()]; saveMarket(merged); return merged; }
        return saved;
      }
    }
  } catch {}
  return DEFAULT_MARKET;
}

function saveMarket(skills) {
  try {
    fs.mkdirSync(path.dirname(MARKET_FILE), { recursive: true });
    fs.writeFileSync(MARKET_FILE, JSON.stringify(skills, null, 2), "utf-8");
  } catch {}
}

function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
  } catch {}
  return [];
}
function saveTasks(tasks) {
  try {
    fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
  } catch {}
}
async function list_skills() {
  try {
    const list = [{ name: "builtin", description: "内置工具集", status: "active", toolCount: 22 }];
    if (!fs.existsSync(SKILL_DIR)) return { success: true, output: JSON.stringify(list) };
    for (const s of (await fsp.readdir(SKILL_DIR, { withFileTypes: true })).filter((x) => x.isDirectory())) {
      const dir = path.join(SKILL_DIR, s.name);
      const mp = path.join(dir, "skill.json");
      if (fs.existsSync(mp)) {
        list.push({ name: s.name, ...JSON.parse(fs.readFileSync(mp, "utf-8")), status: "installed", toolCount: 0 });
      } else {
        // 兼容纯 SKILL.md 技能（GitHub 标准）
        const mdMeta = parseSkillMd(dir);
        if (mdMeta) list.push({ name: s.name, description: mdMeta.description || "", display_name: mdMeta.name || s.name, status: "installed", toolCount: 0 });
        else list.push({ name: s.name, status: "incomplete", toolCount: 0 });
      }
    }
    return { success: true, output: JSON.stringify(list) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function load_skill(a) {
  try {
    const dir = path.join(SKILL_DIR, a.name);
    const out = {};
    const jsonPath = path.join(dir, "skill.json");
    const mdPath = path.join(dir, "SKILL.md");
    if (fs.existsSync(jsonPath)) out.meta = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    if (fs.existsSync(mdPath)) {
      out.skill_md = fs.readFileSync(mdPath, "utf-8");
    }
    const toolsPath = path.join(dir, "tools.json");
    if (fs.existsSync(toolsPath)) {
      try { out.tools = JSON.parse(fs.readFileSync(toolsPath, "utf-8")); } catch {}
    }
    // 附带文件清单（脚本/资源）
    const files = [];
    (function walk(p) {
      try {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          if (e.name === ".git" || e.name === "node_modules") continue;
          if (e.isDirectory()) walk(path.join(p, e.name));
          else files.push(path.relative(dir, path.join(p, e.name)));
        }
      } catch {}
    })(dir);
    out.files = files.slice(0, 50);
    if (!out.meta && !out.skill_md) return { success: false, error: `Skill "${a.name}" 不存在` };
    return { success: true, output: JSON.stringify(out, null, 2) };
  } catch (e) {
    return { success: false, error: e.message || `Skill "${a.name}" 不存在` };
  }
}
async function install_skill(a) {
  try {
    const dir = path.join(SKILL_DIR, a.name);
    await fsp.mkdir(dir, { recursive: true });
    // v10.0：优先按市场条目的完整数据安装(元数据/指令/工具全落地)，
    // 市场里没有时才走通用兜底——不再写什么都不干的空壳
    const market = loadMarket();
    const hit = market.find((s) => s.id === a.name || s.name === a.name);
    if (hit) {
      await fsp.writeFile(path.join(dir, "skill.json"), JSON.stringify({
        name: a.name, display_name: hit.name, version: hit.version,
        author: hit.author, description: hit.description, tags: hit.tags,
        tools: hit.tools, installed_at: (/* @__PURE__ */ new Date()).toISOString(),
      }, null, 2));
      writeSkillMd(dir, {
        name: a.name, display_name: hit.name, version: hit.version,
        author: hit.author, description: hit.description,
        instructions: hit.instructions, hasTools: !!(hit.tools && hit.tools.length),
      });
      if (hit.tools && hit.tools.length) {
        await fsp.writeFile(path.join(dir, "tools.json"), JSON.stringify(hit.tools, null, 2), "utf-8");
      }
      return { success: true, output: `已安装「${hit.name}」(含完整指令与工具定义)` };
    }
    await fsp.writeFile(path.join(dir, "skill.json"), JSON.stringify({ name: a.name, display_name: a.name, version: "0.1.0", installed_at: (/* @__PURE__ */ new Date()).toISOString() }, null, 2));
    writeSkillMd(dir, { name: a.name, description: a.description || "", hasTools: false });
    return { success: true, output: "已安装（含 SKILL.md）" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
// --- 长期记忆工具 (供 AI 调用) ---
const MEM_DIR = DATA_DIR;
(() => { try { fs.mkdirSync(MEM_DIR, { recursive: true }); } catch {} })();
function memFile() { return path.join(MEM_DIR, "memories.json"); }
function loadMem() {
  try { return fs.existsSync(memFile()) ? JSON.parse(fs.readFileSync(memFile(), "utf-8")) : {}; }
  catch { return {}; }
}
function saveMem(data) {
  try { fs.mkdirSync(MEM_DIR, { recursive: true }); fs.writeFileSync(memFile(), JSON.stringify(data, null, 2), "utf-8"); }
  catch {}
}
// 记忆工具 — 统一 SQLite（与 /api/memories、上下文摘要同源）
function memIndex(all) {
  // 索引模式：只给 key + 摘要(60字) + 字数，完整内容按需传 key 读取
  const rows = all.map((m) => {
    const v = String(m.value || "");
    const brief = v.replace(/\s+/g, " ").slice(0, 60);
    return `• ${m.key} | ${v.length}字 | ${brief}${v.length > 60 ? "…" : ""}`;
  });
  return rows.length > 0
    ? `【记忆索引】共 ${rows.length} 条，以下是目录；需要某条的完整内容请调用 recall 并传对应 key。\n` + rows.join("\n")
    : "(暂无记忆)";
}
async function read_memory(args) {
  if (sharedDb) {
    try {
      if (args.key) return { success: true, output: sharedDb.getMemory(args.key) || "(无此记忆)" };
      return { success: true, output: memIndex(sharedDb.getAllMemories()) };
    } catch {}
  }
  const mem = loadMem();
  if (args.key) return { success: true, output: mem[args.key] || "(无此记忆)" };
  return { success: true, output: memIndex(Object.entries(mem).map(([key, value]) => ({ key, value }))) };
}
async function write_memory(args) {
  if (!args.key) return { success: false, error: "缺少 key 参数" };
  if (sharedDb) { try { sharedDb.setMemory(args.key, args.value || ""); return { success: true, output: `已记住: ${args.key} = ${args.value}` }; } catch {} }
  const mem = loadMem();
  mem[args.key] = args.value || "";
  saveMem(mem);
  return { success: true, output: `已记住: ${args.key} = ${args.value}` };
}
async function delete_memory(args) {
  if (!args.key) return { success: false, error: "缺少 key 参数" };
  if (sharedDb) { try { sharedDb.deleteMemory(args.key); return { success: true, output: `已删除记忆: ${args.key}` }; } catch {} }
  const mem = loadMem();
  delete mem[args.key];
  saveMem(mem);
  return { success: true, output: `已删除记忆: ${args.key}` };
}

// ─── ly-next：旧 JSON 会话/消息一次性导入 SQLite（仅当 SQLite 为空时）───
(() => {
  if (!sharedDb) return;
  try {
    const dataDir = DATA_DIR;
    const readJson = (name) => {
      const fp = path.join(dataDir, name);
      try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf-8")) : {}; } catch { return {}; }
    };
    const sessions = readJson("sessions.json");
    if (!Array.isArray(sessions.items) || sessions.items.length === 0) return;
    // 幂等合并迁移：只补「SQLite 里还没有的消息」，已导入的按 id 跳过。
    // （早期版本用 listSessions().length > 0 整体跳过，导致老历史永远导入不进来）
    const knownSessions = new Set(sharedDb.listSessions().map((s) => s.id));
    const seen = new Set();
    let created = 0, msgCount = 0;
    const pending = [];   // { m, sid }：补登的消息及其所属会话
    for (const s of sessions.items) {
      if (!s || !s.id) continue;
      if (!knownSessions.has(s.id)) { sharedDb.createSession(s.id, typeof s.title === "string" ? s.title : "新对话"); created++; }
      const inDb = new Set(sharedDb.getMessages(s.id).map((m) => m.id));
      for (const m of (readJson(`messages_${s.id}.json`).items || [])) {
        if (!m || !m.id || inDb.has(m.id) || seen.has(m.id)) continue;
        seen.add(m.id);
        pending.push({ m, sid: s.id });
      }
    }
    if (pending.length > 0) {
      try { sharedDb.db.exec("BEGIN"); } catch {}
      for (const { m, sid } of pending) {
        try {
          sharedDb.addMessage(m.id, sid, m.role || "user", m.content || "", m.thinking || "", typeof m.tool_calls === "string" ? m.tool_calls : JSON.stringify(m.tool_calls || []), m.tool_call_id || "");
          msgCount++;
        } catch { /* 单条失败不阻断整体迁移 */ }
      }
      try { sharedDb.db.exec("COMMIT"); } catch {}
    }
    if (created || msgCount) console.log(`[ly-next] 合并迁移：新增 ${created} 个会话 / ${msgCount} 条消息`);
  } catch (e) { console.error("[ly-next] JSON 合并迁移失败:", e.message); }
})();

// --- 新增工具函数 ---
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ─── 安全策略：从设置实时读取，工具入口强制生效（主对话 + 集群统一）───
function securityConfig() {
  const rows = sharedDb ? sharedDb.getAllSettings() : [];
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let dirs = [];
  try { const d = JSON.parse(s.allowedFolders || "[]"); if (Array.isArray(d)) dirs = d; } catch {}
  return {
    level: s.permissionLevel === "restricted" ? "restricted" : s.permissionLevel === "full" ? "full" : "standard",
    dirs,
    shellAccess: s.shellAccess !== "false",
    sensitiveBlock: s.sensitiveBlock !== "false",
  };
}

function inDirs(p, dirs) {
  const rp = path.resolve(p || "");
  return dirs.some((d) => { try { return rp.startsWith(path.resolve(d)); } catch { return false; } });
}

const DANGEROUS_SHELL_RE = /rm\s+-rf|del\s+\/f|rd\s+\/s|format\s+[a-z]:|shutdown|diskpart|mkfs/;
const FILE_TOOLS = ["read_file", "list_dir", "search_files", "search_content", "get_file_info", "write_file", "edit_file", "delete_file", "move_file"];
const WRITE_TOOLS = ["write_file", "edit_file", "move_file", "delete_file", "create_skill", "install_skill"];

function checkSecurity(name, args, sec) {
  // 受限模式：禁止 shell、禁止写操作
  if (sec.level === "restricted") {
    if (name === "shell") return "受限模式下不允许执行命令";
    if (WRITE_TOOLS.includes(name)) return "受限模式下不允许写入/删除操作";
  }
  // Shell 开关 / 高危命令
  if (name === "shell") {
    if (!sec.shellAccess) return "Shell 命令执行已在设置中关闭";
    if (DANGEROUS_SHELL_RE.test(String(args.command || "").toLowerCase())) {
      if (sec.level === "standard" || (sec.level === "full" && sec.sensitiveBlock)) return "高危命令已被安全策略拦截";
    }
  }
  // 删除文件：标准模式敏感拦截（可关）；受限模式一律禁止
  if (name === "delete_file") {
    if (sec.level === "restricted") return "受限模式下不允许删除文件";
    if (sec.level === "standard" && sec.sensitiveBlock) return "删除文件已被敏感拦截（可在设置中关闭）";
  }
  // 文件类工具：受限模式限定授权目录
  if (sec.level === "restricted" && FILE_TOOLS.includes(name)) {
    const p = args.path || args.src || args.dest || args.filePath || "";
    if (p && sec.dirs.length > 0 && !inDirs(p, sec.dirs)) return "路径不在授权目录内";
  }
  return null;
}

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

async function web_search(args) {
  try {
    const q = args.query || args.q || "";
    if (!q) return { success: false, error: "缺少 query 参数" };
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
    return { success: true, output: JSON.stringify(results.slice(0, 10), null, 2) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function text_tools(args) {
  try {
    const text = args.text || args.content || args.input || "";
    const op = args.operation || args.action || "stats";
    if (op === "stats" || op === "count") {
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const lines = text ? text.split("\n").length : 0;
      return { success: true, output: JSON.stringify({ chars, words, lines }) };
    }
    if (op === "frequency" || op === "freq" || op === "word_freq") {
      const wrds = text.toLowerCase().match(/\b\w+\b/g) || [];
      const freq = {};
      for (const w of wrds) freq[w] = (freq[w] || 0) + 1;
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, args.top_n || 50);
      return { success: true, output: JSON.stringify(Object.fromEntries(sorted)) };
    }
    if (op === "line_sort" || op === "sort_lines") {
      const lines = text.split("\n").filter(Boolean).sort();
      return { success: true, output: lines.join("\n") };
    }
    return { success: false, error: `未知操作: ${op}，支持 stats/frequency/word_freq/line_sort` };
  } catch (e) { return { success: false, error: e.message }; }
}

async function url_tools(args) {
  try {
    const op = args.operation || args.action || "encode";
    const val = args.value || args.text || args.input || "";
    if (op === "encode") return { success: true, output: encodeURIComponent(val) };
    if (op === "decode") return { success: true, output: decodeURIComponent(val) };
    return { success: false, error: `未知操作: ${op}，支持 encode/decode` };
  } catch (e) { return { success: false, error: e.message }; }
}

async function base64_tools(args) {
  try {
    const op = args.operation || args.action || "encode";
    const val = args.value || args.text || args.input || "";
    if (op === "encode") return { success: true, output: Buffer.from(val, "utf-8").toString("base64") };
    if (op === "decode") return { success: true, output: Buffer.from(val, "base64").toString("utf-8") };
    return { success: false, error: `未知操作: ${op}，支持 encode/decode` };
  } catch (e) { return { success: false, error: e.message }; }
}

function hash_tools(args) {
  try {
    const algo = (args.algorithm || args.algo || "sha256").toLowerCase();
    const val = args.value || args.text || args.input || "";
    const crypto = require("crypto");
    const h = crypto.createHash(algo.replace("-", "")).update(val, "utf-8").digest("hex");
    return { success: true, output: h };
  } catch (e) { return { success: false, error: e.message }; }
}

function uuid_generate(args) {
  try {
    const ver = args.version || args.v || "4";
    const count = Math.min(parseInt(args.count) || 1, 100);
    const crypto = require("crypto");
    function genOne() {
      if (ver === "7") {
        const ts = BigInt(Date.now());
        const rand = crypto.randomBytes(10);
        return [
          (ts & 0xFFFFFFFFn).toString(16).padStart(8, "0"),
          ((ts >> 32n) & 0xFFFFn).toString(16).padStart(4, "0"),
          "7" + rand[0].toString(16).padStart(3, "0").slice(0, 3),
          ((rand[1] & 0x3F) | 0x80).toString(16).padStart(2, "0") + rand[2].toString(16).padStart(2, "0"),
          rand.slice(3, 9).toString("hex")
        ].join("-");
      }
      return crypto.randomUUID();
    }
    const uuids = Array.from({ length: count }, () => genOne());
    return { success: true, output: count === 1 ? uuids[0] : JSON.stringify(uuids, null, 2) };
  } catch (e) { return { success: false, error: e.message }; }
}

function timestamp_tools(args) {
  try {
    const op = args.operation || args.action || "now";
    if (op === "now") return { success: true, output: JSON.stringify({ timestamp_ms: Date.now(), timestamp_s: Math.floor(Date.now() / 1e3), iso: (new Date()).toISOString() }) };
    if (op === "to_iso" || op === "to_date" || op === "to_datetime") {
      const ts = parseInt(args.timestamp || args.value || "0");
      return { success: true, output: new Date(ts < 1e12 ? ts * 1e3 : ts).toISOString() };
    }
    if (op === "to_ts" || op === "to_timestamp") {
      const d = new Date(args.value || args.date || Date.now());
      return { success: true, output: JSON.stringify({ timestamp_ms: d.getTime(), timestamp_s: Math.floor(d.getTime() / 1e3) }) };
    }
    return { success: false, error: `未知操作: ${op}，支持 now/to_iso/to_ts` };
  } catch (e) { return { success: false, error: e.message }; }
}

function random_tools(args) {
  try {
    const op = args.operation || args.type || "password";
    if (op === "number" || op === "int") {
      const min = parseInt(args.min || "1"), max = parseInt(args.max || "100");
      const n = Math.floor(Math.random() * (max - min + 1)) + min;
      return { success: true, output: String(n) };
    }
    if (op === "string") {
      const len = parseInt(args.length || "16");
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let s = ""; for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return { success: true, output: s };
    }
    if (op === "password") {
      const len = parseInt(args.length || "16");
      const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lower = "abcdefghijklmnopqrstuvwxyz", digits = "0123456789", syms = "!@#$%^&*";
      const all = upper + lower + digits + syms;
      let s = upper[Math.floor(Math.random() * upper.length)] + lower[Math.floor(Math.random() * lower.length)] + digits[Math.floor(Math.random() * digits.length)] + syms[Math.floor(Math.random() * syms.length)];
      for (let i = 4; i < len; i++) s += all[Math.floor(Math.random() * all.length)];
      return { success: true, output: s.split("").sort(() => Math.random() - 0.5).join("") };
    }
    return { success: false, error: `未知操作: ${op}，支持 number/string/password` };
  } catch (e) { return { success: false, error: e.message }; }
}

function color_tools(args) {
  try {
    const op = args.operation || args.action || "random";
    if (op === "random") {
      const r = Math.floor(Math.random() * 256), g = Math.floor(Math.random() * 256), b = Math.floor(Math.random() * 256);
      const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return { success: true, output: JSON.stringify({ hex, rgb: `rgb(${r},${g},${b})`, r, g, b }) };
    }
    if (op === "hex_to_rgb") {
      const val = (args.value || "").replace("#", "");
      const r = parseInt(val.slice(0, 2), 16), g = parseInt(val.slice(2, 4), 16), b = parseInt(val.slice(4, 6), 16);
      return { success: true, output: JSON.stringify({ rgb: `rgb(${r},${g},${b})`, r, g, b }) };
    }
    if (op === "rgb_to_hex") {
      const r = args.r ?? args.red ?? 0, g = args.g ?? args.green ?? 0, b = args.b ?? args.blue ?? 0;
      const hex = "#" + [r, g, b].map((x) => parseInt(x).toString(16).padStart(2, "0")).join("");
      return { success: true, output: JSON.stringify({ hex }) };
    }
    return { success: false, error: `未知操作: ${op}，支持 random/hex_to_rgb/rgb_to_hex` };
  } catch (e) { return { success: false, error: e.message }; }
}

async function image_generate(args) {
  try {
    const prompt = args.prompt || args.q || "";
    if (!prompt) return { success: false, error: "缺少 prompt 参数" };
    const width = args.width || 512, height = args.height || 512;
    const seed = args.seed || Math.floor(Math.random() * 1e9);
    const model = args.model || "flux";
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&model=${model}&nologo=true`;
    return { success: true, output: url };
  } catch (e) { return { success: false, error: e.message }; }
}

async function create_skill(args) {
  try {
    const name = (args.name || args.skill_name || "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
    if (!name) return { success: false, error: "缺少 skill 名称" };
    const desc = args.description || "";
    const skillDir = path.join(SKILL_DIR, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify({
      name, description: desc, version: args.version || "0.1.0",
      installed_at: (new Date()).toISOString(),
      tools: args.tools || []
    }, null, 2));
    // 完整 SKILL.md
    writeSkillMd(skillDir, {
      name, display_name: args.display_name || name,
      description: desc, version: args.version || "0.1.0",
      author: args.author || "本地创建",
      instructions: args.instructions || (args.knowledge ? args.knowledge.slice(0, 2000) : ""),
      hasTools: !!(args.tools && args.tools.length),
    });
    if (args.knowledge) {
      fs.writeFileSync(path.join(skillDir, "knowledge.md"), args.knowledge, "utf-8");
    }
    if (args.tools && (!Array.isArray(args.tools) ? true : args.tools.length)) {
      fs.writeFileSync(path.join(skillDir, "tools.json"), JSON.stringify(args.tools, null, 2), "utf-8");
    }
    if (args.code || args.script) {
      fs.writeFileSync(path.join(skillDir, "index.js"), args.code || args.script);
    }
    return { success: true, output: `Skill "${name}" 已创建（含 SKILL.md${args.knowledge ? " + knowledge.md" : ""}${args.tools && args.tools.length ? " + tools.json" : ""}）` };
  } catch (e) { return { success: false, error: e.message }; }
}

// 长期记忆别名
async function remember(args) { return write_memory(args); }

// ─── 知识条目 embedding helper（模块级，供工具与 API 共用）───
async function kbEmbedFor(texts) {
  const rows = sharedDb ? sharedDb.getAllSettings() : [];
  const st = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const base = st.apiBaseUrl || "";
  const key = st.apiKey || "";
  const model = st.embeddingModel || "";
  if (!base || !key || !model) throw new Error("未配置模型服务（知识库检索需要 embedding 模型）");
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(60e3),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  const d = await res.json();
  return (d.data || []).map((x) => x.embedding);
}

// AI 写入知识库：条目 + 向量 + 按标题建连线
function kbChunkText(text) {
  const CHUNK = 800, OVERLAP = 100;
  const clean = String(text || "").replace(/\r/g, "");
  if (clean.length <= CHUNK) return clean.trim() ? [clean] : [];
  const out = []; let i = 0;
  while (i < clean.length) { out.push(clean.slice(i, i + CHUNK)); i += CHUNK - OVERLAP }
  return out;
}
// 索引整篇笔记：全文切块，逐块嵌入（不是只存开头 800 字）
async function kbIndexEntry(id, title, content) {
  if (!sharedDb) return 0;
  sharedDb.kbDeleteByPath("entry:" + id);
  const body = (title ? title + "\n" : "") + (content || "");
  const chunks = kbChunkText(body);
  let n = 0;
  for (let i = 0; i < chunks.length; i += 16) {
    const batch = chunks.slice(i, i + 16);
    let vecs = [];
    try { vecs = await kbEmbedFor(batch) } catch { break }
    batch.forEach((c, j) => { if (vecs[j]) { sharedDb.kbInsert("entry:" + id, c, vecs[j]); n++ } });
  }
  return n;
}

// 解析正文中的 [[双向链接]] 标记（思源风格），返回标题数组
function kbExtractWikilinks(text) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return [...new Set(out)];
}

async function save_knowledge(args) {
  const title = String(args.title || "").trim();
  const content = String(args.content || "").trim();
  if (!title) throw new Error("title 不能为空");
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : (args.tags ? String(args.tags).split(/[,，]/).map(t => t.trim()).filter(Boolean) : []);
  const linkTitles = [...new Set([
    ...(Array.isArray(args.link_titles) ? args.link_titles.map(String) : []),
    ...kbExtractWikilinks(content),
  ])].filter(t => t && t !== title);
  const id = args.id || sharedDb.genId();
  const links = [];
  for (const lt of linkTitles) {
    const hit = sharedDb.getKbEntryByTitle(lt);
    if (hit && hit.id !== id) links.push(hit.id);
  }
  sharedDb.upsertKbEntry({
    id, title, content,
    tags: JSON.stringify(tags),
    links: JSON.stringify(links),
    source: args.source === "ai" ? "ai" : "user",
    notebook: String(args.notebook || "").trim(),
    pinned: args.pinned ? 1 : 0,
    icon: String(args.icon || "").trim(),
  });
  for (const lid of links) {
    try {
      const other = sharedDb.getKbEntry(lid);
      if (other && !JSON.parse(other.links || "[]").includes(id)) {
        sharedDb.upsertKbEntry({ ...other, links: JSON.stringify([...JSON.parse(other.links || "[]"), id]) });
      }
    } catch { /* ignore */ }
  }
  try { await kbIndexEntry(id, title, content) } catch { /* embedding 失败不阻断写入 */ }
  const backlinks = sharedDb.kbBacklinks(id).map((b) => ({ id: b.id, title: b.title }));
  return { ok: true, id, title, linked: links.length, backlinks };
}

// 工具协议适配器：统一返回 {success, output}，异常转成 error，避免 execute 未捕获
async function toolSaveKnowledge(args) {
  try {
    const r = await save_knowledge(args)
    return { success: true, output: `已存入知识库：《${r.title}》 · 关联 ${r.linked} 条 · 反链 ${r.backlinks.length} 条 (id=${r.id})` }
  } catch (e) {
    return { success: false, error: String((e && e.message) || e || 'save_knowledge 失败') }
  }
}

async function recall(args) { return read_memory(args); }
async function forget(args) { return delete_memory(args); }

// ─── consult_guidance:约束知识库检索 ───
// 规则库单一来源 src/shared/guidance/rules.json(随构建进安装包)。
// 主提示词只注入 core 铁律摘要;完整规则由模型按需检索,节省常驻上下文。
var GUIDANCE_CACHE = null;
function loadGuidance() {
  if (GUIDANCE_CACHE) return GUIDANCE_CACHE;
  try {
    GUIDANCE_CACHE = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "shared", "guidance", "rules.json"), "utf-8"));
  } catch (e) { GUIDANCE_CACHE = { domains: [] }; }
  return GUIDANCE_CACHE;
}
function guidanceRulesText(d) {
  if (!d) return "";
  return (d.rules || []).map((r) =>
    (r.level === "hard" ? "◆" : "◇") + " " + r.id + " " + r.title + ": " + r.rule
  ).join("\n");
}
async function consultGuidance(a) {
  const g = loadGuidance();
  const domains = g.domains || [];
  const topic = String((a && a.topic) || "").trim().toLowerCase();
  const kw = String((a && a.keyword) || "").trim().toLowerCase();
  if (!topic && !kw) {
    const catalog = domains.map((d) => d.id + " " + d.title + " — " + d.when).join("\n");
    const core = domains.find((d) => d.id === "core");
    return { success: true, output: "规则域目录:\n" + catalog + "\n\n【工作铁律】\n" + guidanceRulesText(core) + "\n\n用 topic 查看某域完整规则,或 keyword 跨域搜索关键词。" };
  }
  const direct = domains.filter((d) => topic && (d.id === topic || (d.title + d.when).indexOf(topic) >= 0));
  let matched = direct.length ? direct : domains.map((d) => {
    const needle = kw || topic;
    const rs = (d.rules || []).filter((r) =>
      (r.title + r.rule + (r.why || "") + " " + d.title).toLowerCase().indexOf(needle) >= 0);
    return rs.length ? { id: d.id, title: d.title, when: d.when, rules: rs } : null;
  }).filter(Boolean);
  if (!matched.length) {
    return { success: true, output: "未匹配到规则。可用 topic: " + domains.map((d) => d.id).join(" / ") };
  }
  return {
    success: true,
    output: matched.map((d) => "【" + d.id + " " + d.title + "】适用: " + d.when + "\n" + guidanceRulesText(d)).join("\n\n"),
  };
}

var TOOLS = {
  read_file, write_file, edit_file, list_dir, search_files, search_content,
  get_file_info, move_file, delete_file,
  shell, system_info, process_list, port_check,
  code_analysis, npm_run, git_operation,
  web_fetch, http_request, web_search,
  json_process, text_tools, screenshot,
  url_tools, base64_tools, hash_tools,
  uuid_generate, timestamp_tools, random_tools, color_tools, image_generate,
  list_skills, load_skill, install_skill, create_skill,
  remember, recall, forget,
  save_knowledge: toolSaveKnowledge,
  consult_guidance: consultGuidance
};
// ─── 静态资源：磁盘 LRU 缓存 + gzip 压缩 + HTTP 缓存协商 ───
// 首屏 JS 总计约 800KB；手机远程经 LAN 访问时压缩能从 ~2.1MB 降到 ~500KB。
// 磁盘缓存避免每次请求都 readfs，冷启动后首次请求也不阻塞。
var STATIC_CACHE_MAX = 64;
var staticCache = new Map();
var GZIP_MIME = /^application\/(javascript|x-json|json)|text\/|image\/svg/;
var gzipBuf = new Map();

async function serveStatic(req, res) {
  let urlPath = req.url === "/" ? "index.html" : (req.url?.split("?")[0]?.replace(/^\//, "") || "index.html");
  let p = path.join(DIST, urlPath);
  // 静态文件只允许位于 DIST 目录内（打包后 app 在 /Applications 下，不能用用户目录白名单 ok() 判断）
  const resolvedStatic = path.resolve(p);
  if (!resolvedStatic.startsWith(path.resolve(DIST))) return json(res, { error: "Forbidden" }, 403);
  try {
    // 用 fs 同步 API 判定存在性/目录：路径回退必须同步完成，避免 async stat 竞态
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, "index.html");

    // LRU 读盘缓存（键为绝对路径，值含 stat 结果用于 If-Modified-Since 协商）
    let ent = staticCache.get(p);
    if (!ent) {
      const st = fs.statSync(p);
      const data = await fsp.readFile(p);
      ent = { data, mtime: st.mtimeMs, size: data.length };
      staticCache.set(p, ent);
      while (staticCache.size > STATIC_CACHE_MAX) {
        const k = staticCache.keys().next().value;
        staticCache.delete(k);
        gzipBuf.delete(k);
      }
    }

    // If-Modified-Since 协商：命中则 304，省掉整个响应体（对长缓存资源效果最明显）
    const ims = req.headers["if-modified-since"];
    if (ims) {
      try {
        const t = Date.parse(ims);
        // Last-Modified 是秒级；mtime 若带毫秒部分会被误判为"比 IMS 新"，
        // 因此先向下取整到秒再比较，与 HTTP 语义一致。
        if (!isNaN(t) && Math.floor(ent.mtime / 1000) * 1000 <= t) { res.writeHead(304); res.end(); return; }
      } catch {}
    }

    const isHtml = p.endsWith(".html");
    const mime = MIME[path.extname(p)] || "application/octet-stream";
    const head = {
      "Content-Type": mime,
      "Cache-Control": isHtml ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable",
      "Content-Length": ent.size,
      "Last-Modified": new Date(ent.mtime).toUTCString(),
    };

    // gzip：仅对文本类且体积足够（>1KB）的资源启用，小文件压缩反而更慢
    const acceptGz = /gzip/i.test(String(req.headers["accept-encoding"] || ""));
    if (acceptGz && !isHtml && ent.size > 1024 && GZIP_MIME.test(mime)) {
      let gz = gzipBuf.get(p);
      if (!gz) {
        gz = await promisifyGzip(ent.data);
        if (gz && gz.length < ent.size) gzipBuf.set(p, gz);
      }
      if (gz && gz.length < ent.size) {
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Encoding": "gzip",
          "Vary": "Accept-Encoding",
          "Cache-Control": head["Cache-Control"],
          "Content-Length": gz.length,
          "Last-Modified": head["Last-Modified"],
        });
        res.end(gz);
        return;
      }
    }
    res.writeHead(200, head);
    res.end(ent.data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}
// gzip 压缩（node zlib）；压缩结果由调用方缓存
function promisifyGzip(buf) {
  return new Promise((resolve) => {
    try {
      import("zlib").then((z) => {
        z.gzip(buf, { level: 6 }, (err, out) => resolve(err || !out ? null : out));
      }).catch(() => resolve(null));
    } catch { resolve(null); }
  });
}
http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const c = corsHeaders(req);
    if (!c) { res.writeHead(403); res.end(); return; } // 不可信 Origin：不给 CORS 头
    res.writeHead(204, {
      ...c,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Remote-Token, X-Api-Key",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // ─── 跨站请求（CSRF / DNS-rebinding）门卫 ───
  // 浏览器发起的跨源请求必带 Origin。恶意网页 → http://localhost:3211/api/settings
  // 就是一次典型的跨站请求；即便它读不到响应（无 CORS 头），请求本身仍会执行。
  // 这里在服务端直接拒绝不信任的 Origin，并额外校验 Host 头，防 DNS-rebinding。
  if (!isTrustedOrigin(req.headers.origin, req.headers.host)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "跨站请求已拒绝" }));
    return;
  }
  // DNS-rebinding：攻击者把 evil.com 解析到 127.0.0.1，浏览器带 Host: evil.com 打到这里。
  // 特征是「来源是本机回环，但 Host 却不是本机名」——正常本机访问不会这样。
  // LAN 远程访问（Host 为局域网 IP）由下面的配对码门卫负责，不在此处拦截。
  const __hostName = String(req.headers.host || "").replace(/:\d+$/, "");
  const __hostIsLocal = __hostName === "" || __hostName === "localhost"
    || __hostName === "127.0.0.1" || __hostName === "::1" || __hostName === "[::1]";
  const __ra = String(req.socket.remoteAddress || "");
  const __fromLoopback = __ra === "127.0.0.1" || __ra === "::1" || __ra === "::ffff:127.0.0.1";
  if (__fromLoopback && !__hostIsLocal) {
    res.writeHead(421, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Host 头不被信任（疑似 DNS rebinding）" }));
    return;
  }

  // ─── 手机远程门卫（v5.5）：非本机请求必须持配对码；只放行 /remote.html 与 /api/*（health 除外） ───
  const __isLocal = (() => {
    const ra = String(req.socket.remoteAddress || "");
    return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
  })();
  if (!__isLocal) {
    const __token = (() => {
      try {
        const o = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "remote.json"), "utf-8"));
        if (o && o.token) return String(o.token);
      } catch {}
      const t = crypto.randomBytes(16).toString("hex");
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, "remote.json"), JSON.stringify({ token: t, created_at: new Date().toISOString() }));
      } catch {}
      return t;
    })();
    const __supplied = url.searchParams.get("t") || String(req.headers["x-remote-token"] || "");
    const __path = url.pathname;
    // 配对后允许访问：远程页、静态资源（/assets/、/index.html、/ 等，配对 URL 需要加载 UI 与资源）
    // 以及 /api/*（health 是公开探测端点，不需要 token）
    const __isStatic = /^\/(assets\/|index\.html|remote\.html$|\.\w+$)/.test(__path)
      || __path === "/" || __path === "/index.html" || __path === "/remote.html";
    const __allowedPath = __path === "/remote.html" || __isStatic
      || (__path.startsWith("/api/") && __path !== "/api/health");
    if (__supplied !== __token || !__allowedPath) {
      if (__path.startsWith("/api/")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "远程访问未授权：配对码无效或已重新生成" }));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
      return;
    }
    // 手机接入提醒（v7.0）：5 分钟最多一条
    try {
      if (Date.now() - (global.__lastRemotePing = global.__lastRemotePing || 0) > 300000) {
        global.__lastRemotePing = Date.now();
        pushServerNotice({ type: "system", title: "手机已连接远程", body: "来自局域网设备 " + String(req.socket.remoteAddress || "").replace("::ffff:", "") });
      }
    } catch {}
  }
  try {
    if (url.pathname === "/api/health") return json(res, { status: "ok", agent: "巨天agent", version: PKG.version, tools: Object.keys(TOOLS).length, platform: process.platform, workDir: globalWorkDir || null });
    // 数据库维护：VACUUM 回收已删除数据占用的空间
    if (url.pathname === "/api/db/vacuum" && req.method === "POST") {
      if (!sharedDb?.vacuumDb) return json(res, { success: false, error: "数据库不可用" });
      try {
        const r = sharedDb.vacuumDb();
        const mb = (n) => (n / 1024 / 1024).toFixed(1);
        return json(res, { success: true, output: `完成：${mb(r.before)} MB → ${mb(r.after)} MB（回收 ${mb(Math.max(0, r.before - r.after))} MB）` });
      } catch (e) { return json(res, { success: false, error: e.message }); }
    }
    // 环境诊断：一键体检各子系统可用性（设置 → 关于 → 环境诊断）
    if (url.pathname === "/api/diagnostics") {
      const check = [];
      const httpGet = (u, timeout = 2500) => new Promise((resolve) => {
        try {
          const mod = u.startsWith("https:") ? https : http;
          const r = mod.get(u, { timeout }, (resp) => { resp.resume(); resolve(resp.statusCode && resp.statusCode < 500) });
          r.on("timeout", () => { r.destroy(); resolve(false) });
          r.on("error", () => resolve(false));
        } catch { resolve(false) }
      });
      // 1. 核心服务（即本进程，能收到请求即健康）
      check.push({ name: "核心服务 (3211)", ok: true, detail: `${Object.keys(TOOLS).length} 个工具` });
      // 2. Edge TTS（5050）
      const ttsOk = await httpGet("http://127.0.0.1:5050/v1/voices");
      check.push({ name: "语音合成 (Edge TTS)", ok: ttsOk, detail: ttsOk ? "localhost:5050 在线" : "未启动（python-runtime 缺失或未就绪）" });
      // 3. Python
      let pyOk = false, pyVer = "";
      try {
        const { execFile } = require("child_process");
        pyVer = await new Promise((resolve) => {
          execFile(process.env.PYTHON_BIN || "python3", ["--version"], { timeout: 3000 }, (err, stdout, stderr) => resolve(err ? "" : String(stdout || stderr).trim()));
        });
        pyOk = !!pyVer;
      } catch { pyOk = false }
      check.push({ name: "Python 运行时", ok: pyOk, detail: pyVer || (process.env.PYTHON_BIN || "python3") + " 不可用" });
      // 4. STT 脚本
      let sttOk = false;
      try { sttOk = fs.existsSync(process.env.STT_SCRIPT || ""); } catch { sttOk = false }
      check.push({ name: "语音识别 (faster-whisper)", ok: sttOk, detail: sttOk ? "脚本就绪" : "stt.py 未找到" });
      // 5. 数据库
      let dbSizeMb = "";
      try {
        const st = fs.statSync(path.join(process.env.HOME || ".", ".lyclaw", "data.db"));
        dbSizeMb = (st.size / 1024 / 1024).toFixed(2);
      } catch { /* ignore */ }
      check.push({ name: "数据库 (SQLite)", ok: !!sharedDb, detail: sharedDb ? `~/.lyclaw/data.db 正常${dbSizeMb ? ` · ${dbSizeMb} MB` : ""}` : "db.cjs 加载失败" });
      // 6. 工作目录可写
      let wdOk = false;
      try {
        const wd = globalWorkDir || process.env.HOME || ".";
        fs.accessSync(wd, fs.constants.W_OK); wdOk = true;
      } catch { wdOk = false }
      check.push({ name: "工作目录", ok: wdOk, detail: (globalWorkDir || "系统默认") + (wdOk ? " 可写" : " 不可写") });
      // 7. 模型 API 连通性（用配置的 baseUrl + key 请求 /models）
      let apiOk = false, apiDetail = "";
      try {
        const rawSettings = sharedDb && sharedDb.getAllSettings ? sharedDb.getAllSettings() : [];
        const allSettings = Array.isArray(rawSettings) ? Object.fromEntries(rawSettings.map((r) => [r.key, r.value])) : (rawSettings || {});
        const base = String(allSettings.apiBaseUrl || "").replace(/\/+$/, "");
        const key = String(allSettings.apiKey || "");
        if (base && key) {
          // 状态码 <500 即视为服务可达（401/403 属鉴权口径差异，不影响对话链路）；同时尝试 Bearer 与 raw key 两种鉴权口径
          const [bearerSt, rawSt] = await Promise.all([
            new Promise((resolve) => {
              try {
                const u = new URL(base + "/models");
                const mod = u.protocol === "https:" ? https : http;
                const r = mod.get(u, { timeout: 4000, headers: { Authorization: `Bearer ${key}` } }, (resp) => { resp.resume(); resolve(resp.statusCode || 0) });
                r.on("timeout", () => { r.destroy(); resolve(0) });
                r.on("error", () => resolve(0));
              } catch { resolve(0) }
            }),
            new Promise((resolve) => {
              try {
                const u = new URL(base + "/models");
                const mod = u.protocol === "https:" ? https : http;
                const r = mod.get(u, { timeout: 4000, headers: { Authorization: key } }, (resp) => { resp.resume(); resolve(resp.statusCode || 0) });
                r.on("timeout", () => { r.destroy(); resolve(0) });
                r.on("error", () => resolve(0));
              } catch { resolve(0) }
            }),
          ]);
          const st = Math.max(bearerSt, rawSt);
          apiOk = st > 0 && st < 500;
          apiDetail = `${base.replace(/^https?:\/\//, "")} ${apiOk ? `可达 (HTTP ${st})` : "不可达"}`;
        } else { apiDetail = "未配置 API 地址或密钥" }
      } catch { apiDetail = "读取配置失败" }
      check.push({ name: "模型 API 连通", ok: apiOk, detail: apiDetail });
      return json(res, { success: true, checks: check, allOk: check.every((c) => c.ok) });
    }
    if (url.pathname === "/api/tools") return json(res, { tools: Object.keys(TOOLS).map((k) => ({ name: k })) });
    if (url.pathname === "/api/tools/execute" && req.method === "POST") {
      const { name, args = {} } = await body(req);
      const workDirHeader = req.headers["x-work-dir"] || "";
      if (workDirHeader) {
        try { setWorkDir(decodeURIComponent(workDirHeader)); } catch { setWorkDir(workDirHeader); }
      }
      // ─── 安全策略真实强制（设置页实时生效，主对话+集群统一走此入口）───
      const sec = securityConfig();
      const secError = checkSecurity(name, args, sec);
      if (secError) return json(res, { success: false, error: `【安全策略】${secError}` });
      // MCP 外部工具（学自 Zode）：mcp__<server>__<tool> 路由到对应 MCP Server
      if (name.startsWith("mcp__") && mcp) {
        const rest = name.slice(5);
        const sep = rest.indexOf("__");
        const serverName = sep > 0 ? rest.slice(0, sep) : "";
        const toolName = sep > 0 ? rest.slice(sep + 2) : "";
        if (!serverName || !toolName) return json(res, { success: false, error: "MCP 工具名不合法" });
        const r = await mcp.callTool(serverName, toolName, args);
        return json(res, r.success ? r : { success: false, error: r.error || r.output });
      }
      const h = TOOLS[name];
      if (!h) {
        // 工具乱用兜底(v9.0):模型幻觉调用了不存在的工具，不再只报 404——
        // 返回「相近工具名 + 当前可用清单」，让模型下一轮自己纠正，不空转烧钱
        let near: string[] = []
        try {
          const target = String(name || "").toLowerCase();
          near = Object.keys(TOOLS)
            .map((k) => ({ k, s: k.toLowerCase().includes(target) || target.includes(k.toLowerCase()) ? 1 : 0 }))
            .filter((x) => x.s > 0).slice(0, 5).map((x) => x.k);
        } catch {}
        return json(res, {
          success: false,
          error: `未知工具「${name}」。${near.length ? `你是不是想用: ${near.join("、")}?` : ""}当前可用工具（${Object.keys(TOOLS).length} 个）：${Object.keys(TOOLS).join("、")}`,
        }, 404);
      }
      console.log(`→ ${name}`);
      let r;
      try { r = await h(args); }
      catch (e) { r = { success: false, error: String((e && e.message) || e || "工具执行异常") }; }
      if (!r || typeof r !== "object") r = { success: true, output: String(r) };
      console.log(`← ${name} ${r.success ? "OK" : "FAIL"}`);
      return json(res, r);
    }
    // --- 定时任务 API ---
    const tasksMatch = url.pathname.match(/^\/api\/scheduled-tasks(?:\/([^/]+))?$/);
    if (tasksMatch) {
      const taskId = tasksMatch[1];
      if (!taskId) {
        if (req.method === "POST") {
          // POST /api/scheduled-tasks — 创建任务
          const task = await body(req);
          task.id = "task_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
          task.createdAt = (/* @__PURE__ */ new Date()).toISOString();
          task.enabled = task.enabled !== false;
          const tasks = loadTasks();
          tasks.push(task);
          saveTasks(tasks);
          return json(res, { ok: true, task });
        }
        // GET /api/scheduled-tasks
        return json(res, { tasks: loadTasks() });
      }
      if (req.method === "DELETE") {
        // DELETE /api/scheduled-tasks/:id
        const tasks = loadTasks();
        const updated = tasks.filter((t) => t.id !== taskId);
        saveTasks(updated);
        return json(res, { ok: true });
      }
      if (req.method === "PATCH") {
        // PATCH /api/scheduled-tasks/:id
        const tasks = loadTasks();
        const idx = tasks.findIndex((t) => t.id === taskId);
        if (idx === -1) return json(res, { error: "Not found" }, 404);
        const patch = await body(req);
        Object.assign(tasks[idx], patch);
        saveTasks(tasks);
        return json(res, { ok: true });
      }
    }

    // --- LLM 代理 (解决 AI 不回复) ---
    // ─── 日记（Beta）：按日记录，存 diary.json ───
    if (url.pathname === "/api/diary" && req.method === "GET") {
      const store = loadJson("diary.json");
      const items = (store.items || []).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return json(res, items);
    }
    if (url.pathname === "/api/diary" && req.method === "POST") {
      try {
        const entry = await body(req);
        if (!entry || typeof entry.content !== "string") return json(res, { error: "缺少 content" }, 400);
        const store = loadJson("diary.json");
        if (!Array.isArray(store.items)) store.items = [];
        const now = new Date().toISOString();
        const today = new Date().toLocaleDateString("sv-SE");
        if (entry.id) {
          const idx = store.items.findIndex((x) => x.id === entry.id);
          if (idx >= 0) {
            store.items[idx] = { ...store.items[idx], title: entry.title || "", content: entry.content, date: entry.date || store.items[idx].date, updatedAt: now };
            saveJson("diary.json", store);
            return json(res, store.items[idx]);
          }
        }
        const item = { id: "diary_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: entry.date || today, title: entry.title || "", content: entry.content, createdAt: now, updatedAt: now };
        store.items.unshift(item);
        saveJson("diary.json", store);
        return json(res, item);
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/diary/delete" && req.method === "POST") {
      try {
        const { id } = await body(req);
        const store = loadJson("diary.json");
        store.items = (store.items || []).filter((x) => x.id !== id);
        saveJson("diary.json", store);
        return json(res, { ok: true });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // ─── 内置免费 API 车道已于 v4.1 下线（外部工具请使用自己的提供商 Key）───
    if (url.pathname === "/api/free/models" || url.pathname === "/v1/models") {
      return json(res, { error: { message: "内置免费 API 服务已下线" } }, 410);
    }
    if (url.pathname === "/api/llm-proxy" && req.method === "POST") {
      try {
        const rawChunks = [];
        for await (const c of req) rawChunks.push(c);
        const bodyStr = Buffer.concat(rawChunks).toString();
        let bodyData = JSON.parse(bodyStr);
        const _tbHeader = String(req.headers["x-target-base"] || bodyData.targetBase || "");
        let targetBase = _tbHeader || "";
        let apiKey = String(req.headers["x-api-key"] || bodyData.apiKey || "").trim();
        // 掩码回显(GET /api/settings 返回 sk-6****9Ylc)不是真钥匙:
        // 头里是掩码/为空时,回退到本机存储的真实配置(密钥不出电脑)。
        // free/keyless 是免鉴权网关哨兵,一律保持原值,绝不用库内 key 覆盖。
        // SQLite 优先,遗留 settings.json 仅作兜底。
        const headerKeyUsable = apiKey !== "" && apiKey.indexOf("****") < 0 && apiKey !== "free" && apiKey !== "keyless";
        if (!headerKeyUsable || !targetBase) {
          let __dbKey = "", __dbBase = "", __dbKiloKey = "";
          try {
            const __rows = sharedDb ? sharedDb.getAllSettings() : [];
            for (const __r of __rows) {
              if (__r.key === "apiKey" && __r.value) __dbKey = String(__r.value);
              if (__r.key === "apiBaseUrl" && __r.value) __dbBase = String(__r.value);
              if (__r.key === "kilo_api_key" && __r.value) __dbKiloKey = String(__r.value);
            }
          } catch {}
          if (!__dbKey || !__dbBase) {
            try {
              const __st = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf-8"));
              if (!__dbBase && __st.apiBaseUrl) __dbBase = String(__st.apiBaseUrl);
              if (!__dbKey && __st.apiKey) __dbKey = String(__st.apiKey);
            } catch {}
          }
          // 仅掩码/为空才回退库内 key;free/keyless 哨兵不动
          if (apiKey === "" || apiKey.indexOf("****") >= 0) apiKey = __dbKey;
          if (!targetBase) targetBase = __dbBase;
          // Kilo 付费档:免费占位/空 到达但模型非免费档 → 用 Kilo 账户密钥
          const __mdl = String(bodyData?.model || "");
          const __mdlFree = __mdl.indexOf(":free") >= 0 || __mdl.endsWith("/free") || /^kilo-/.test(__mdl);
          if ((apiKey === "" || apiKey === "free" || apiKey === "keyless") && __dbKiloKey && __mdl && !__mdlFree) apiKey = __dbKiloKey;
        }
        // v7.0：未配置模型服务时明确报错,不再回退到任何默认提供商
        if (!targetBase || !apiKey) {
          res.writeHead(400, { ...(corsHeaders(req) || {}), "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "尚未配置模型服务：请在 设置 → 推理 中填写 API 地址与密钥（任意 OpenAI 兼容服务）" }));
          return;
        }
        // 从 body 中移除内部字段
        delete bodyData.targetBase;
        delete bodyData.apiKey;
        // Pollinations 的端点本身就是 /openai(chat completions),不拼后缀
        const upstreamUrl = /\/openai$/.test(targetBase) ? targetBase : `${targetBase}/chat/completions`;
        console.log(`\u2192 llm-proxy \u2192 ${targetBase}`);
        // 免 key 网关(如 Kilo Gateway):密钥填 free/keyless 时完全不带
        // Authorization 头——此类网关对任何无效 token 反而报 INVALID_TOKEN
        const keyless = apiKey === "free" || apiKey === "keyless" || apiKey === "";
        const proxyHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (!keyless) proxyHeaders["Authorization"] = `Bearer ${apiKey}`;
        const proxyRes = await fetch(upstreamUrl, {
          method: "POST",
          headers: proxyHeaders,
          body: JSON.stringify(bodyData),
          signal: AbortSignal.timeout(120000),
        });
        if (!proxyRes.ok) {
          // v7.0：透传上游真实状态码，不再统一包成 502；错误体尽量透出上游原始 message
          const detail = await proxyRes.text().catch(() => "");
          console.error(`llm-proxy upstream ${proxyRes.status} \u2190 ${upstreamUrl}`);
          let upstreamMsg = "";
          try { upstreamMsg = JSON.parse(detail)?.error?.message || JSON.parse(detail)?.message || ""; } catch { upstreamMsg = String(detail).slice(0, 300); }
          const hint = proxyRes.status === 404
            ? "API 地址可能不正确（应指向 /v1 结尾的服务根路径）"
            : proxyRes.status === 401 || proxyRes.status === 403
              ? "API Key 无效或无权限"
              : proxyRes.status === 429
                ? "请求过于频繁 / 余额或限流"
                : "请检查模型名、余额或服务状态";
          res.writeHead(proxyRes.status, {
            ...(corsHeaders(req) || {}),
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({
            error: upstreamMsg || `上游模型服务返回 ${proxyRes.status}`,
            upstreamStatus: proxyRes.status,
            upstream: upstreamUrl,
            hint,
            detail: String(detail).slice(0, 500),
          }));
          return;
        }
        // ─── 空响应自动重试(v8.1:免费模型高发 — reasoning 吃满 max_tokens 时 content 为空)───
        const isStreamReq = bodyData.stream === true;
        const basePayload = (() => { const p = { ...bodyData }; delete p.targetBase; delete p.apiKey; return p; })();
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const callUpstream = (payload) => fetch(upstreamUrl, {
          method: "POST", headers: proxyHeaders, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000),
        });
        const escalate = (payload, fr: string) =>
          (fr === "length" ? { ...payload, max_tokens: Math.min(8192, Math.max(1024, (Number(payload.max_tokens) || 256) * 4)) } : payload);
        const sseHeaders = {
          ...(corsHeaders(req) || {}),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        };
        const bodyEmpty = (j) => {
          const msg = j?.choices?.[0]?.message;
          return !msg || typeof msg.content !== "string" || msg.content.trim() === "";
        };
        if (!isStreamReq) {
          // 非流式:整体缓冲,空内容自动重试(最多 3 次)
          let payload = basePayload;
          let text = await proxyRes.text();
          let j = null; try { j = JSON.parse(text); } catch {}
          for (let att = 1; att <= 3 && bodyEmpty(j); att++) {
            console.log(`llm-proxy 空响应(attempt ${att}${j?.choices?.[0]?.finish_reason ? ", finish=" + j.choices[0].finish_reason : ""})${att < 3 ? ",重试" : ",放弃"}`);
            if (att < 3) {
              await sleep(400 * att);
              payload = escalate(payload, j?.choices?.[0]?.finish_reason || "");
              const r2 = await callUpstream(payload);
              if (r2.ok) { text = await r2.text(); try { j = JSON.parse(text); } catch { j = null; } }
              else break;
            }
          }
          res.writeHead(200, sseHeaders);
          res.end(text);
          return;
        }
        // 流式:实时透传;押后 [DONE],整条流没有任何正文内容则自动重试
        res.writeHead(200, sseHeaders);
        let payload = basePayload;
        for (let att = 1; att <= 3; att++) {
          const r = att === 1 ? proxyRes : await callUpstream(payload);
          if (!r.ok) { const t = await r.text().catch(() => ""); res.end(t || JSON.stringify({ error: `上游 ${r.status}`, upstreamStatus: r.status })); return; }
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let sawContent = false, finishFr = "", tail = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            tail += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = tail.indexOf("\n")) >= 0) {
              const line = tail.slice(0, idx); tail = tail.slice(idx + 1);
              if (line.trim() === "data: [DONE]") continue; // 押后:空了要换一发
              const m = line.match(/^data:\s*(.+)$/);
              if (m) {
                try {
                  const j = JSON.parse(m[1]);
                  const delta = j?.choices?.[0]?.delta?.content;
                  if (typeof delta === "string" && delta.length > 0) sawContent = true;
                  if (j?.choices?.[0]?.finish_reason) finishFr = j.choices[0].finish_reason;
                } catch {}
              }
              res.write(line + "\n");
            }
          }
          if (tail && tail.trim() !== "data: [DONE]") res.write(tail);
          if (sawContent) break;
          console.log(`llm-proxy 流式空响应(attempt ${att}${finishFr ? ", finish=" + finishFr : ""})${att < 3 ? ",重试" : ",放弃"}`);
          if (att < 3) { await sleep(400 * att); payload = escalate(payload, finishFr); }
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (e) {
        console.error("llm-proxy error:", e.message);
        if (!res.headersSent) json(res, { error: e.message }, 502);
      }
      return;
    }

    // --- QQ 官方机器人 AccessToken 换取 (AppID+AppSecret → QQBot token，2小时有效，本地缓存) ---
    let qqTokenCache = { key: '', token: '', expiresAt: 0 };
    if (url.pathname === "/api/qq/token" && req.method === "POST") {
      try {
        const rawChunks = [];
        for await (const c of req) rawChunks.push(c);
        const { appId, secret, sandbox } = JSON.parse(Buffer.concat(rawChunks).toString());
        if (!appId || !secret) return json(res, { error: "缺少 appId 或 secret" }, 400);
        const cacheKey = `${sandbox ? "s" : "p"}:${appId}:${secret}`;
        if (qqTokenCache.key === cacheKey && qqTokenCache.expiresAt > Date.now() + 60000) {
          return json(res, { access_token: qqTokenCache.token, expires_in: Math.round((qqTokenCache.expiresAt - Date.now()) / 1000), cached: true });
        }
        const tokenRes = await fetch(`${sandbox ? "https://sandbox.bots.qq.com" : "https://bots.qq.com"}/app/getAppAccessToken`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appId, clientSecret: secret }),
          signal: AbortSignal.timeout(20000),
        });
        const data = await tokenRes.json();
        if (!tokenRes.ok || !data.access_token) {
          return json(res, { error: data.message || `换取失败 ${tokenRes.status}`, ...data }, 502);
        }
        qqTokenCache = { key: cacheKey, token: data.access_token, expiresAt: Date.now() + (data.expires_in || 7200) * 1000 };
        return json(res, { access_token: data.access_token, expires_in: data.expires_in || 7200 });
      } catch (e) {
        console.error("qq-token error:", e.message);
        if (!res.headersSent) json(res, { error: e.message }, 502);
      }
      return;
    }

    // --- QQ 官方机器人 REST 代理 (官方 API 不允许浏览器 CORS，经本地后端转发) ---
    if (url.pathname === "/api/qq/proxy" && req.method === "POST") {
      try {
        const rawChunks = [];
        for await (const c of req) rawChunks.push(c);
        const bodyData = JSON.parse(Buffer.concat(rawChunks).toString());
        const qqUrl = bodyData.url;
        const qqMethod = bodyData.method || "GET";
        const qqToken = bodyData.token;
        if (!qqUrl || !qqToken) return json(res, { error: "缺少 url 或 token" }, 400);
        const qqHeaders = { Authorization: `QQBot ${qqToken}`, ...(bodyData.headers || {}) };
        if (bodyData.body !== undefined) qqHeaders["Content-Type"] = "application/json";
        const qqRes = await fetch(qqUrl, {
          method: qqMethod,
          headers: qqHeaders,
          body: bodyData.body !== undefined ? JSON.stringify(bodyData.body) : undefined,
          signal: AbortSignal.timeout(20000),
        });
        const qqText = await qqRes.text();
        res.writeHead(qqRes.status, { ...(corsHeaders(req) || {}), "Content-Type": "application/json" });
        res.end(qqText);
      } catch (e) {
        console.error("qq-proxy error:", e.message);
        if (!res.headersSent) json(res, { error: e.message }, 502);
      }
      return;
    }

    // --- QQ 官方机器人：发送本地文件（上传 → 发文件消息 msg_type=5） ---
    if (url.pathname === "/api/qq/send-file" && req.method === "POST") {
      try {
        const rawChunks = [];
        for await (const c of req) rawChunks.push(c);
        const { path: filePath, kind, openid, msgId, sandbox, token } = JSON.parse(Buffer.concat(rawChunks).toString());
        if (!filePath || !kind || !openid || !token) return json(res, { error: "缺少参数" }, 400);
        if (kind !== "group" && kind !== "c2c") return json(res, { error: "kind 必须为 group 或 c2c" }, 400);
        const stats = await fsp.stat(filePath).catch(() => null);
        if (!stats || !stats.isFile()) return json(res, { error: `文件不存在或不是文件: ${filePath}` }, 400);
        // 安全：仅允许发送用户目录 / tmp 内的文件
        const home = process.env.HOME || "/Users/zeroneil";
        if (!filePath.startsWith(home + "/") && !filePath.startsWith("/tmp/") && !filePath.startsWith("/private/tmp/")) {
          return json(res, { error: "仅允许发送用户目录内的文件" }, 403);
        }
        const apiBase = sandbox ? "https://sandbox.api.sgroup.qq.com" : "https://api.sgroup.qq.com";
        const tokenHeader = { Authorization: `QQBot ${token}` };
        // 1. 上传文件 → file_info
        const buf = await fsp.readFile(filePath);
        const fd = new FormData();
        fd.append("file", new Blob([buf], { type: "application/octet-stream" }), path.basename(filePath));
        const uploadUrl = kind === "group" ? `${apiBase}/v2/groups/${openid}/files` : `${apiBase}/v2/users/${openid}/files`;
        const upRes = await fetch(uploadUrl, { method: "POST", headers: tokenHeader, body: fd, signal: AbortSignal.timeout(60000) });
        const upData = await upRes.json().catch(() => ({}));
        if (!upRes.ok || !upData.file_info) {
          return json(res, { error: `上传失败 ${upRes.status}: ${upData.message || "无 file_info"}`.trim(), ...upData }, 502);
        }
        // 2. 发送文件消息（被动回复可带 msg_id）
        const msgUrl = kind === "group" ? `${apiBase}/v2/groups/${openid}/messages` : `${apiBase}/v2/users/${openid}/messages`;
        const msgBody = { msg_type: 5, content: "", file_info: upData.file_info };
        if (msgId) msgBody.msg_id = msgId;
        const mRes = await fetch(msgUrl, { method: "POST", headers: { ...tokenHeader, "Content-Type": "application/json" }, body: JSON.stringify(msgBody), signal: AbortSignal.timeout(30000) });
        const mData = await mRes.json().catch(() => ({}));
        if (!mRes.ok) {
          return json(res, { error: `发送文件消息失败 ${mRes.status}: ${mData.message || ""}`.trim(), ...mData }, 502);
        }
        return json(res, { ok: true, file_info: upData.file_info, size: buf.length });
      } catch (e) {
        console.error("qq-send-file error:", e.message);
        if (!res.headersSent) json(res, { error: e.message }, 502);
      }
      return;
    }

    // --- 多模态：读取本地图片为 base64（仅限图片、用户目录/tmp、≤8MB） ---
    if (url.pathname === "/api/file-base64" && req.method === "GET") {
      try {
        const filePath = decodeURIComponent(url.searchParams.get("path") || "");
        if (!filePath) return json(res, { error: "缺少 path" }, 400);
        const ext = path.extname(filePath).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return json(res, { error: "仅支持图片文件" }, 400);
        // 用户主动添加的附件，放开目录限制（仍是只读图片），大小上限提到 20MB
        const stats = await fsp.stat(filePath).catch(() => null);
        if (!stats || !stats.isFile()) return json(res, { error: "文件不存在" }, 404);
        if (stats.size > 20 * 1024 * 1024) return json(res, { error: "图片超过 20MB 限制" }, 413);
        const buf = await fsp.readFile(filePath);
        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/webp";
        return json(res, { data: buf.toString("base64"), mime, name: path.basename(filePath) });
      } catch (e) {
        if (!res.headersSent) json(res, { error: e.message }, 500);
      }
      return;
    }

    // --- 文件/终端按钮 (解决按钮失效) ---
    if (url.pathname === "/api/open-finder" && req.method === "GET") {
      const p = url.searchParams.get("path") || process.env.HOME;
      try {
        await execAsync("open", [p], { timeout: 5e3 });
        return json(res, { ok: true });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }
    if (url.pathname === "/api/open-terminal" && req.method === "GET") {
      const p = url.searchParams.get("path") || process.env.HOME;
      try {
        await execAsync("osascript", ["-e", `tell application "Terminal" to activate`], { timeout: 5e3 });
        return json(res, { ok: true });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // --- Skill 广场 API (解决 JSON 解析错误) ---
    if (url.pathname === "/api/skills/market" && req.method === "GET") {
      return json(res, loadMarket());
    }
    if (url.pathname === "/api/skills/search-online" && req.method === "POST") {
      const { keyword } = await body(req);
      try {
        const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(keyword + " skill agent")}&per_page=10&sort=stars`, {
          headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "JutianAgent/1.0" },
          signal: AbortSignal.timeout(1e4),
        });
        if (r.ok) {
          const d = await r.json();
          const items = (d.items || []).map((item) => ({
            id: item.full_name,
            name: item.full_name,
            version: "0.1.0",
            author: item.owner?.login || "GitHub",
            description: item.description || "",
            tags: ["GitHub"],
            tools: [],
            source_url: item.html_url,
          }));
          return json(res, { success: true, data: items });
        }
        return json(res, { success: false, error: "GitHub 搜索失败" });
      } catch (e) {
        return json(res, { success: false, error: e.message });
      }
    }
    if (url.pathname === "/api/skills/install-from-market" && req.method === "POST") {
      const { skillId } = await body(req);
      const market = loadMarket();
      const skill = market.find((s) => s.id === skillId);
      if (!skill) return json(res, { success: false, error: "Skill 不存在" });
      try {
        const dir = path.join(SKILL_DIR, skillId);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, "skill.json"), JSON.stringify({
          name: skillId, display_name: skill.name, version: skill.version,
          author: skill.author, description: skill.description, tags: skill.tags,
          tools: skill.tools, installed_at: (/* @__PURE__ */ new Date()).toISOString(),
        }, null, 2));
        // 真实技能文件：SKILL.md（含 instructions 真指令）+ tools.json
        writeSkillMd(dir, {
          name: skillId, display_name: skill.name, version: skill.version,
          author: skill.author, description: skill.description,
          instructions: skill.instructions, hasTools: !!(skill.tools && skill.tools.length),
        });
        if (skill.tools && skill.tools.length) {
          await fsp.writeFile(path.join(dir, "tools.json"), JSON.stringify(skill.tools, null, 2), "utf-8");
        }
        return json(res, { success: true });
      } catch (e) {
        return json(res, { success: false, error: e.message });
      }
    }
    if (url.pathname === "/api/skills/install-from-github" && req.method === "POST") {
      const { githubUrl } = await body(req);
      if (!githubUrl || !githubUrl.includes("github.com")) return json(res, { success: false, error: "无效的 GitHub 链接" });
      const repoName = githubUrl.split("/").slice(-1)[0].replace(/\.git$/, "");
      const destDir = path.join(SKILL_DIR, repoName);
      try {
        // 重装/更新：先清空旧目录，否则 git clone 报 "already exists and is not an empty directory"
        await fsp.rm(destDir, { recursive: true, force: true });
        const r = await execAsync("git", ["clone", "--depth", "1", githubUrl, destDir], { timeout: 6e4, maxBuffer: 524288 });
        // 清掉 .git，技能目录保持干净
        await fsp.rm(path.join(destDir, ".git"), { recursive: true, force: true });
        // 统计真实安装的文件
        const files = [];
        (function walk(p) {
          try {
            for (const e of fs.readdirSync(p, { withFileTypes: true })) {
              if (e.name === ".git" || e.name === "node_modules") continue;
              if (e.isDirectory()) walk(path.join(p, e.name));
              else files.push(path.relative(destDir, path.join(p, e.name)));
            }
          } catch {}
        })(destDir);
        // 补齐元数据
        const mdMeta = parseSkillMd(destDir);
        if (!fs.existsSync(path.join(destDir, "skill.json"))) {
          await fsp.writeFile(path.join(destDir, "skill.json"), JSON.stringify({
            name: mdMeta?.name || repoName, display_name: mdMeta?.name || repoName,
            description: mdMeta?.description || "", version: mdMeta?.version || "1.0.0",
            source_url: githubUrl, installed_at: (/* @__PURE__ */ new Date()).toISOString(),
          }, null, 2));
        }
        const market = loadMarket();
        if (!market.find((s) => s.id === repoName)) {
          market.push({
            id: repoName, name: mdMeta?.name || repoName, version: mdMeta?.version || "1.0.0", author: "GitHub",
            description: mdMeta?.description || githubUrl, tags: ["GitHub", "已安装"],
            tools: [], source_url: githubUrl,
          });
          saveMarket(market);
        }
        return json(res, { success: true, repo: repoName, fileCount: files.length, files: files.slice(0, 20) });
      } catch (e) {
        return json(res, { success: false, error: e.stderr || e.message });
      }
    }
    if (url.pathname === "/api/skills/uninstall" && req.method === "POST") {
      const { skillName } = await body(req);
      if (!skillName) return json(res, { success: false, error: "\u7F3A\u5C11 skillName" });
      try {
        const skillPath = path.join(SKILL_DIR, skillName);
        if (fs.existsSync(skillPath)) {
          await fsp.rm(skillPath, { recursive: true, force: true });
        }
        // 从市场中移除
        const market = loadMarket();
        const updated = market.filter((s) => s.id !== skillName);
        saveMarket(updated);
        return json(res, { success: true });
      } catch (e) {
        return json(res, { success: false, error: e.message });
      }
    }

    // --- 修复 /api/models 代理 URL (应是 /api/models 而非 /models) ---
    if (url.pathname === "/api/models" && req.method === "POST") {
      try {
        const { apiBaseUrl, apiKey } = await body(req);
        const r = await fetch(`${apiBaseUrl}/models`, {
          headers: apiKey ? { "Authorization": `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(1e4)
        });
        if (!r.ok) return json(res, { error: `API 返回 ${r.status}` }, r.status);
        const data2 = await r.json();
        if (data2.error) return json(res, { error: data2.error.message || 'API error' });
        const apiData = data2.data || data2;
        let models = [];
        if (Array.isArray(apiData)) {
          models = apiData.map(m => typeof m === 'string' ? m : m.id || m.name).filter(Boolean);
        } else if (typeof apiData === 'object') {
          models = [...new Set(Object.values(apiData).flat().filter(Boolean))];
        }
        return json(res, { models });
      } catch (e) {
        return json(res, { error: e.message }, 502);
      }
    }

    // === 新添加: 数据持久化 API (settings/sessions/messages/memories) ===
    // 数据目录统一用模块级 DATA_DIR(~/.lyclaw/data),不再局部重声明
    (() => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} })();
    /** 取关键词周围的一段摘要（世界级搜索的上下文预览） */
    function snippetAround(text, q) {
      const s = String(text || "").replace(/\s+/g, " ");
      const i = s.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return s.slice(0, 90);
      const start = Math.max(0, i - 38);
      const end = Math.min(s.length, i + q.length + 52);
      return (start > 0 ? "…" : "") + s.slice(start, end).trim() + (end < s.length ? "…" : "");
    }
    function loadJson(filename) {
      try {
        const fp = path.join(DATA_DIR, filename);
        return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf-8")) : {};
      } catch { return {}; }
    }
    function saveJson(filename, data) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), "utf-8");
      } catch {}
    }

    // GET /api/settings — 统一走 SQLite
    if (url.pathname === "/api/settings" && req.method === "GET") {
      let obj = null;
      if (sharedDb) {
        try {
          const rows = sharedDb.getAllSettings();
          obj = {};
          for (const r of rows) obj[r.key] = r.value ?? "";
        } catch {}
      }
      if (!obj) obj = loadJson("settings.json");
      return json(res, obj);
    }
    // POST /api/settings — 统一写 SQLite
    if (url.pathname === "/api/settings" && req.method === "POST") {
      const { key, value } = await body(req);
      if (!key) return json(res, { error: "缺少 key" }, 400);
      if (isMasked(value)) return json(res, { ok: true, skipped: "masked" });
      if (sharedDb) {
        try { sharedDb.setSetting(key, value == null ? "" : String(value)); if (key === "keepAwake") syncKeepAwake(); return json(res, { ok: true }); } catch {}
      }
      const settings = loadJson("settings.json");
      settings[key] = value;
      saveJson("settings.json", settings);
      if (key === "keepAwake") syncKeepAwake();
      return json(res, { ok: true });
    }

    // ─── MCP 服务管理（v5.0，学自 Zode 的可插拔工具生态）───
    if (url.pathname === "/api/mcp/servers" && req.method === "GET") {
      return json(res, mcp ? mcp.listServers() : []);
    }
    if (url.pathname === "/api/mcp/servers" && req.method === "POST") {
      try { return json(res, mcp.upsertServer(await body(req))); }
      catch (e) { return json(res, { error: String(e.message || e) }, 400); }
    }
    const mcpIdMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/);
    if (mcpIdMatch && req.method === "PUT") {
      const list = mcp.listServers();
      const cur = list.find((x) => x.id === mcpIdMatch[1]);
      if (!cur) return json(res, { error: "未找到该服务" }, 404);
      return json(res, mcp.upsertServer({ ...cur, ...(await body(req)), id: mcpIdMatch[1] }));
    }
    if (mcpIdMatch && req.method === "DELETE") {
      mcp.removeServer(mcpIdMatch[1]);
      return json(res, { ok: true });
    }
    if (url.pathname === "/api/mcp/tools" && req.method === "GET") {
      if (!mcp) return json(res, { tools: [], errors: [] });
      const force = url.searchParams.get("refresh") === "1";
      try { return json(res, await mcp.listTools(force)); }
      catch (e) { return json(res, { tools: [], errors: [{ error: String(e.message || e) }] }); }
    }
    if (url.pathname === "/api/mcp/call" && req.method === "POST") {
      const { server, tool, args } = await body(req);
      if (!mcp) return json(res, { success: false, error: "MCP 模块未加载" });
      const r = await mcp.callTool(String(server || ""), String(tool || ""), args || {});
      return json(res, r.success ? r : { success: false, error: r.error || r.output });
    }

    // ─── 截图文件（需配对码,仅限 screenshots 目录） ───
    if (url.pathname === "/api/remote/file" && req.method === "GET") {
      try {
        const fp = decodeURIComponent(url.searchParams.get("path") || "");
        const dir = path.join(DATA_DIR, "screenshots");
        if (!fp.startsWith(dir)) return json(res, { error: "路径不允许" }, 403);
        const data = fs.readFileSync(fp);
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-cache" });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end("not found"); }
      return;
    }

    // ─── 通知桥 API（v7.0）：GET 供渲染层合并；POST 仅本机（内部来源） ───
    if (url.pathname === "/api/notices" && req.method === "GET") {
      try { return json(res, JSON.parse(fs.readFileSync(NOTICE_FILE(), "utf-8"))); }
      catch { return json(res, []); }
    }
    if (url.pathname === "/api/notices" && req.method === "POST") {
      if (!__isLocal) return json(res, { error: "仅限本机" }, 403);
      const n = await body(req);
      pushServerNotice({ type: n.type || "system", title: String(n.title || "").slice(0, 80), body: String(n.body || "").slice(0, 200) });
      return json(res, { ok: true });
    }
    // ─── 可编辑 diff（v5.6）：查看 / 撤销 / 编辑应用 ───
    const diffIdMatch = url.pathname.match(/^\/api\/diff\/changes\/([^/]+)$/);
    if (diffIdMatch && req.method === "GET") {
      const ch = DIFF_CHANGES.find((x) => x.id === diffIdMatch[1]);
      if (!ch) return json(res, { error: "变更不存在或已过期（重启后清空）" }, 404);
      return json(res, ch);
    }
    if (url.pathname === "/api/diff/undo" && req.method === "POST") {
      const { id } = await body(req);
      const ch = DIFF_CHANGES.find((x) => x.id === id);
      if (!ch) return json(res, { error: "变更记录不存在(已超上限或数据文件被清理)" }, 404);
      try {
        if (ch.old) await fsp.writeFile(ch.path, ch.old, "utf-8");
        else { try { fs.unlinkSync(ch.path); } catch {} }
        ch.undone = true;
        persistDiff();
        return json(res, { ok: true, path: ch.path });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/diff/apply" && req.method === "POST") {
      const { id, content } = await body(req);
      const ch = DIFF_CHANGES.find((x) => x.id === id);
      if (!ch) return json(res, { error: "变更记录不存在(已超上限或数据文件被清理)" }, 404);
      try {
        await fsp.writeFile(ch.path, String(content || ""), "utf-8");
        ch.new = String(content || "");
        ch.undone = false;
        persistDiff();
        return json(res, { ok: true, path: ch.path });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // ─── 手机远程（v5.5）：配对信息仅本机可读；会话信息需配对码 ───
    if (url.pathname === "/api/remote/info" && req.method === "GET") {
      if (!__isLocal) return json(res, { error: "仅限本机" }, 403);
      const __token = (() => {
        try {
          const o = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "remote.json"), "utf-8"));
          if (o && o.token) return String(o.token);
        } catch {}
        const t = crypto.randomBytes(16).toString("hex");
        try {
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(path.join(DATA_DIR, "remote.json"), JSON.stringify({ token: t }));
        } catch {}
        return t;
      })();
      const __lan = (() => {
        const ifs = require("os").networkInterfaces();
        for (const list of Object.values(ifs)) for (const i of list) if (i.family === "IPv4" && !i.internal) return i.address;
        return "127.0.0.1";
      })();
      const __st = (() => { try { return loadJson("settings.json") || {}; } catch { return {}; } })();
      return json(res, { ip: __lan, port: PORT, token: __token, url: `http://${__lan}:${PORT}/remote.html?t=${__token}`, model: __st.model || "" });
    }
    if (url.pathname === "/api/remote/rotate" && req.method === "POST") {
      if (!__isLocal) return json(res, { error: "仅限本机" }, 403);
      const t = crypto.randomBytes(16).toString("hex");
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, "remote.json"), JSON.stringify({ token: t, rotated_at: new Date().toISOString() }));
      } catch (e) { return json(res, { error: e.message }, 500); }
      return json(res, { ok: true, token: t });
    }
    if (url.pathname === "/api/remote/tools" && req.method === "GET") {
      try {
        const all = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "shared", "builtin-tools.json"), "utf-8"));
        return json(res, { tools: all });
      } catch (e) { return json(res, { tools: [], error: e.message }, 500); }
    }
    if (url.pathname === "/api/remote/session" && req.method === "GET") {
      const __st = (() => { try { return loadJson("settings.json") || {}; } catch { return {}; } })();
      return json(res, { model: __st.model || "", agent: "巨天agent" });
    }

    // ─── 会话/消息/记忆 — 统一 SQLite（ly-next 单一数据源）───
    // GET /api/sessions
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      if (sharedDb) { try { return json(res, sharedDb.listSessions()); } catch {} }
      return json(res, loadJson("sessions.json").items || []);
    }
    // GET /api/search?q=关键词&limit=40 —— 全局全文搜索（会话标题 + 消息正文，带上下文摘要）
    if (url.pathname === "/api/search" && req.method === "GET") {
      const q = String(url.searchParams.get("q") || "").trim();
      const limit = Math.max(1, Math.min(80, parseInt(url.searchParams.get("limit") || "40", 10) || 40));
      if (!q) return json(res, { q, sessions: [], messages: [] });
      const needle = q.toLowerCase();
      try {
        // 1) 标题命中（会话列表本身就是轻量的，直接内存过滤，保证即时反馈）
        const sessions = sharedDb
          ? (() => { try { return sharedDb.listSessions(); } catch { return [] } })()
          : (loadJson("sessions.json").items || []);
        const titleHits = sessions
          .filter(s => String(s.title || "").toLowerCase().includes(needle))
          .slice(0, 8)
          .map(s => ({ id: s.id, title: s.title, updated_at: s.updated_at }));

        // 2) 正文命中：SQLite 走 LIKE；JSON 回落则逐文件扫描
        let msgHits = [];
        if (sharedDb) {
          try {
            const like = "%" + q.replace(/[%_]/g, (m) => "\\" + m) + "%";
            const rows = sharedDb.db.prepare(
              `SELECT m.id, m.session_id, m.role, m.content, m.created_at, s.title AS session_title
                 FROM messages m LEFT JOIN sessions s ON s.id = m.session_id
                WHERE m.content LIKE ? ESCAPE '\\' AND m.content <> ''
                ORDER BY m.created_at DESC LIMIT ?`
            ).all(like, limit * 4);
            msgHits = rows.map(r => ({ ...r, snippet: snippetAround(r.content, q) }))
              .filter(r => r.content.toLowerCase().includes(needle))
              .slice(0, limit);
          } catch {}
        }
        if (!sharedDb || msgHits.length === 0) {
          const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith("messages_") && f.endsWith(".json"));
          const titles = new Map(sessions.map(s => [s.id, s.title]));
          const collected = [];
          for (const f of files) {
            const sid = f.slice("messages_".length, -".json".length);
            for (const m of (loadJson(f).items || [])) {
              const c = String(m.content || "");
              if (c && c.toLowerCase().includes(needle)) {
                collected.push({ id: m.id, session_id: sid, role: m.role, content: c, created_at: m.created_at, session_title: titles.get(sid) || "新对话", snippet: snippetAround(c, q) });
              }
            }
          }
          collected.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
          msgHits = collected.slice(0, limit);
        }
        return json(res, { q, sessions: titleHits, messages: msgHits });
      } catch (e) {
        return json(res, { q, sessions: [], messages: [], error: String(e?.message || e) });
      }
    }
    // POST /api/sessions
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const s = await body(req);
      if (sharedDb) {
        try { return json(res, sharedDb.createSession(s.id || sharedDb.genId(), s.title || "新对话")); } catch {}
      }
      const sessions = loadJson("sessions.json");
      if (!sessions.items) sessions.items = [];
      sessions.items.unshift({ id: s.id, title: s.title || "新对话", created_at: s.created_at || (new Date()).toISOString(), updated_at: s.updated_at || (new Date()).toISOString() });
      saveJson("sessions.json", sessions);
      return json(res, sessions.items[0]);
    }
    // DELETE /api/sessions/:id
    if (url.pathname.startsWith("/api/sessions/") && req.method === "DELETE" && !url.pathname.includes("/messages")) {
      const sid = url.pathname.split("/")[3];
      if (sharedDb) { try { sharedDb.deleteSession(sid); return json(res, { ok: true }); } catch {} }
      const sessions = loadJson("sessions.json");
      if (sessions.items) sessions.items = sessions.items.filter((x) => x.id !== sid);
      saveJson("sessions.json", sessions);
      return json(res, { ok: true });
    }
    // PUT /api/sessions/:id
    if (url.pathname.startsWith("/api/sessions/") && req.method === "PUT" && !url.pathname.includes("/messages")) {
      const sid = url.pathname.split("/")[3];
      const patch = await body(req);
      if (sharedDb) {
        try {
          sharedDb.updateSession(sid, { title: patch.title, updated_at: typeof patch.updated_at === "number" ? patch.updated_at : Date.now() });
          return json(res, sharedDb.getSession(sid) || { ok: true });
        } catch {}
      }
      const sessions = loadJson("sessions.json");
      if (sessions.items) {
        const idx = sessions.items.findIndex((x) => x.id === sid);
        if (idx >= 0) Object.assign(sessions.items[idx], patch);
        saveJson("sessions.json", sessions);
      }
      return json(res, { ok: true });
    }

    // GET/POST /api/sessions/:id/messages
    const msgMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (msgMatch) {
      const sid = msgMatch[1];
      if (req.method === "GET") {
        if (sharedDb) { try { return json(res, sharedDb.getMessages(sid)); } catch {} }
        return json(res, loadJson(`messages_${sid}.json`).items || []);
      }
      if (req.method === "POST") {
        const m = await body(req);
        if (sharedDb) {
          try {
            sharedDb.addMessage(m.id || sharedDb.genId(), sid, m.role, m.content || "", m.thinking || "", typeof m.tool_calls === "string" ? m.tool_calls : JSON.stringify(m.tool_calls || []), m.tool_call_id || "", typeof m.swarm === "string" ? m.swarm : undefined);
            return json(res, sharedDb.getMessages(sid).slice(-1)[0]);
          } catch {}
        }
        const msgs = loadJson(`messages_${sid}.json`);
        if (!msgs.items) msgs.items = [];
        msgs.items.push({ id: m.id, session_id: sid, role: m.role, content: m.content, tool_calls: m.tool_calls || "[]", thinking: m.thinking || "", created_at: m.created_at || (new Date()).toISOString() });
        saveJson(`messages_${sid}.json`, msgs);
        return json(res, msgs.items[msgs.items.length - 1]);
      }
    }
    // DELETE /api/sessions/:sid/messages/after/:msgId
    const afterMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages\/after\/([^/]+)$/);
    if (afterMatch && req.method === "DELETE") {
      const [, sid, msgId] = afterMatch;
      if (sharedDb) {
        try {
          const anchor = sharedDb.db.prepare("SELECT created_at FROM messages WHERE id = ?").get(msgId);
          if (anchor) sharedDb.db.prepare("DELETE FROM messages WHERE session_id = ? AND created_at > ?").run(sid, anchor.created_at);
          return json(res, { ok: true });
        } catch {}
      }
      const msgs = loadJson(`messages_${sid}.json`);
      if (msgs.items) {
        const idx = msgs.items.findIndex((x) => x.id === msgId);
        if (idx >= 0) msgs.items = msgs.items.slice(0, idx + 1);
      }
      saveJson(`messages_${sid}.json`, msgs);
      return json(res, { ok: true });
    }
    // PUT /api/messages/:id
    const msgSingleMatch = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
    if (msgSingleMatch && req.method === "PUT") {
      const msgId = msgSingleMatch[1];
      const patch = await body(req);
      if (sharedDb) {
        try {
          sharedDb.updateMessage(msgId, { content: patch.content, thinking: patch.thinking, tool_calls: typeof patch.tool_calls === "string" ? patch.tool_calls : undefined, swarm: typeof patch.swarm === "string" ? patch.swarm : undefined, variants: typeof patch.variants === "string" ? patch.variants : undefined });
          return json(res, { ok: true });
        } catch {}
      }
      const allFiles = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("messages_"));
      for (const f of allFiles) {
        const msgs = loadJson(f);
        if (msgs.items) {
          const idx = msgs.items.findIndex((x) => x.id === msgId);
          if (idx >= 0) { Object.assign(msgs.items[idx], patch); saveJson(f, msgs); break; }
        }
      }
      return json(res, { ok: true });
    }

    // --- AI 角色聊天（Persona）---
    // 角色定义、会话、角色记忆三者分离；记忆复用 memories 表并按 persona:<id>: 前缀隔离。
    var PERSONA_SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
    var personaAll = () => {
      const saved = loadJson("personas.json");
      const items = Array.isArray(saved.items) ? saved.items : [];
      const byId = new Map(items.map((p: { id?: string }) => [p.id as string, p]));
      let touched = false;
      for (const pre of PRESET_PERSONAS) {
        const cur = byId.get(pre.id);
        if (!cur) { byId.set(pre.id, { ...pre, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); touched = true; }
        else if (!cur.persona) { byId.set(pre.id, { ...pre, ...cur }); touched = true; }
      }
      const list = [...byId.values()];
      if (touched) saveJson("personas.json", { items: list });
      return list;
    };
    var personaMemories = (pid) => {
      const pfx = `persona:${pid}:`;
      const out = [];
      if (sharedDb) {
        try {
          for (const r of sharedDb.getAllMemories()) {
            if (String(r.key).startsWith(pfx)) out.push({ key: String(r.key).slice(pfx.length), value: String(r.value || ""), updatedAt: "" });
          }
          if (out.length) return out;
        } catch {}
      }
      const mem = loadJson("memories.json");
      for (const k of Object.keys(mem)) if (k.startsWith(pfx)) out.push({ key: k.slice(pfx.length), value: String(mem[k] || ""), updatedAt: "" });
      return out;
    };
    if (url.pathname === "/api/personas" && req.method === "GET") {
      return json(res, { ok: true, items: personaAll(), presets: PRESET_PERSONAS.length });
    }
    if (url.pathname === "/api/personas" && req.method === "POST") {
      try {
        const b = await body(req);
        const name = String(b.name || "").trim().slice(0, 40);
        if (!name) return json(res, { success: false, error: "角色名不能为空" }, 400);
        const id = PERSONA_SAFE_ID.test(String(b.id || "")) ? String(b.id)
          : "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const now = new Date().toISOString();
        const existing = personaAll().find((p) => p.id === id);
        const item = {
          id, name,
          avatar: String(b.avatar || name.slice(0, 2)).slice(0, 4),
          tagline: String(b.tagline || "").slice(0, 80),
          persona: String(b.persona || "").slice(0, 4000),
          style: String(b.style || "").slice(0, 1000),
          boundaries: Array.isArray(b.boundaries) ? b.boundaries.slice(0, 10).map((s) => String(s).slice(0, 200)) : [],
          opening: String(b.opening || "").slice(0, 500),
          // 编辑预置角色时保留 isPreset，不被冲成 false
          isPreset: existing ? !!existing.isPreset : false, createdAt: now, updatedAt: now,
        };
        const list = personaAll();
        const i = list.findIndex((p) => p.id === id);
        if (i >= 0) { item.createdAt = list[i].createdAt || now; list[i] = item; }
        else list.push(item);
        saveJson("personas.json", { items: list });
        return json(res, { success: true, item });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname.startsWith("/api/personas/") && url.pathname.endsWith("/delete") && req.method === "POST") {
      const id = decodeURIComponent(url.pathname.split("/api/personas/")[1].replace(/\/delete$/, ""));
      const list = personaAll().filter((p) => p.id !== id);
      saveJson("personas.json", { items: list });
      return json(res, { success: true, count: list.length });
    }
    // 角色记忆：GET 列表 / POST 写入(单条) / DELETE 单条 / DELETE?purge=1 清空该角色全部
    if (url.pathname.startsWith("/api/persona-memories/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.split("/api/persona-memories/")[1]);
      return json(res, { ok: true, items: personaMemories(id) });
    }
    if (url.pathname.startsWith("/api/persona-memories/") && req.method === "POST") {
      try {
        const pid = decodeURIComponent(url.pathname.split("/api/persona-memories/")[1]);
        const b = await body(req);
        const slug = String(b.key || "").trim().slice(0, 64).replace(/[^\w一-龥-]/g, "_");
        if (!slug) return json(res, { error: "记忆名不能为空" }, 400);
        const value = String(b.value == null ? "" : b.value).slice(0, 4000);
        const key = `persona:${pid}:${slug}`;
        if (sharedDb) { try { sharedDb.setMemory(key, value); return json(res, { ok: true }); } catch {} }
        const mem = loadJson("memories.json"); mem[key] = value; saveJson("memories.json", mem);
        return json(res, { ok: true });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname.startsWith("/api/persona-memories/") && req.method === "DELETE") {
      const raw = url.pathname.split("/api/persona-memories/")[1];
      const purge = url.searchParams.get("purge") === "1";
      // pathname 仍是百分号编码状态，必须逐段解码后再切分，
      // 否则中文 key（如「作息」）解码错位导致删不掉
      const segs = raw.replace(/\/delete$/, "").split("/").filter(Boolean).map((s) => decodeURIComponent(s));
      const pid = segs[0] || "";
      const slug = segs[1] || "";
      const pfx = `persona:${pid}:`;
      if (sharedDb) {
        try {
          if (purge) { for (const m of personaMemories(pid)) sharedDb.deleteMemory(pfx + m.key); }
          else sharedDb.deleteMemory(pfx + slug);
          return json(res, { ok: true });
        } catch {}
      }
      const mem = loadJson("memories.json");
      if (purge) { for (const k of Object.keys(mem)) if (k.startsWith(pfx)) delete mem[k]; }
      else delete mem[pfx + slug];
      saveJson("memories.json", mem);
      return json(res, { ok: true });
    }
    // 角色会话：GET <pid> / POST 追加 / DELETE <pid> 清空
    if (url.pathname.startsWith("/api/persona-sessions/") && req.method === "GET") {
      const pid = decodeURIComponent(url.pathname.split("/api/persona-sessions/")[1]);
      const all = loadJson("persona-sessions.json");
      return json(res, { ok: true, items: (all.sessions && all.sessions[pid]) || [] });
    }
    if (url.pathname.startsWith("/api/persona-sessions/") && req.method === "POST") {
      try {
        const pid = decodeURIComponent(url.pathname.split("/api/persona-sessions/")[1]);
        const b = await body(req);
        const msg = { role: b.role === "user" ? "user" : "assistant", content: String(b.content || "").slice(0, 8000), ts: Date.now() };
        if (!msg.content.trim()) return json(res, { error: "空消息" }, 400);
        const all = loadJson("persona-sessions.json");
        all.sessions = all.sessions || {};
        all.sessions[pid] = all.sessions[pid] || [];
        all.sessions[pid].push(msg);
        // 单角色保留最近 500 条，避免 JSON 无限增长
        if (all.sessions[pid].length > 500) all.sessions[pid] = all.sessions[pid].slice(-500);
        saveJson("persona-sessions.json", all);
        return json(res, { ok: true });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname.startsWith("/api/persona-sessions/") && req.method === "DELETE") {
      const pid = decodeURIComponent(url.pathname.split("/api/persona-sessions/")[1]);
      const all = loadJson("persona-sessions.json");
      if (all.sessions) delete all.sessions[pid];
      saveJson("persona-sessions.json", all);
      return json(res, { ok: true });
    }
    // 合规：免责声明 + 隐私说明（前端首次进入时展示）
    if (url.pathname === "/api/persona-disclaimer" && req.method === "GET") {
      return json(res, { ok: true, ...PERSONA_DISCLAIMER });
    }

    // --- 长期记忆 API（统一 SQLite）---
    if (url.pathname === "/api/memories" && req.method === "GET") {
      if (sharedDb) {
        try {
          const rows = sharedDb.getAllMemories();
          return json(res, Object.fromEntries(rows.map((r) => [r.key, r.value])));
        } catch {}
      }
      return json(res, loadJson("memories.json"));
    }
    // 会话摘要独立存储（与记忆/知识库三分）
    if (url.pathname === "/api/ctx-summary" && (req.method === "GET" || req.method === "POST")) {
      try {
        if (req.method === "GET") return json(res, loadJson("ctx-summaries.json").items || {});
        const { sid, value } = await body(req);
        if (!sid) return json(res, { error: "缺少 sid" }, 400);
        const store = loadJson("ctx-summaries.json");
        store.items = store.items || {};
        if (value) store.items[sid] = String(value); else delete store.items[sid];
        saveJson("ctx-summaries.json", store);
        return json(res, { ok: true });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/memories" && req.method === "POST") {
      const { key, value } = await body(req);
      if (!key) return json(res, { error: "缺少 key" }, 400);
      if (sharedDb) { try { sharedDb.setMemory(key, value == null ? "" : String(value)); return json(res, { ok: true }); } catch {} }
      // 分家守卫：知识库条目(kb_/knowledge)与会话摘要(ctx_summary_)不得写入长期记忆
      if (argKey) {
        const k = String(argKey)
        if (/^(kb_|kb:|knowledge|ctx_summary_)/i.test(k)) return json(res, { error: "该键不属于长期记忆（知识库/会话摘要请走各自存储）" }, 400);
      }
      const mem = loadJson("memories.json");
      mem[key] = value;
      saveJson("memories.json", mem);
      return json(res, { ok: true });
    }
    if (url.pathname.startsWith("/api/memories/") && req.method === "DELETE") {
      const key = decodeURIComponent(url.pathname.split("/api/memories/")[1]);
      if (sharedDb) { try { sharedDb.deleteMemory(key); return json(res, { ok: true }); } catch {} }
      const mem = loadJson("memories.json");
      delete mem[key];
      saveJson("memories.json", mem);
      return json(res, { ok: true });
    }

    // ─── Git 版本控制：对话检查点 / 状态 / 日志 / 差异 / 撤销 ───
    // 每次对话前自动 checkpoint，用户可一键撤销该轮对话造成的文件改动。
    var GIT_EXCLUDES = ["node_modules/", "__pycache__/", "*.pyc", ".venv/", "venv/", ".DS_Store", "*.log", "dist/", "build/", ".cache/"];
    var gitRun = async (dir, args) => execAsync("git", ["-C", dir, ...args], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    var gitEnsureRepo = async (dir) => {
      try {
        await gitRun(dir, ["rev-parse", "--is-inside-work-tree"]);
      } catch {
        await gitRun(dir, ["init"]);
        await gitRun(dir, ["config", "user.name", "巨天agent"]);
        await gitRun(dir, ["config", "user.email", "agent@jutian.local"]);
        try {
          const excl = path.join(dir, ".git", "info", "exclude");
          let cur = "";
          try { cur = fs.readFileSync(excl, "utf-8"); } catch {}
          if (!cur.includes("node_modules/")) {
            fs.writeFileSync(excl, cur + (cur.endsWith("\n") || !cur ? "" : "\n") + GIT_EXCLUDES.join("\n") + "\n", "utf-8");
          }
        } catch {}
      }
    };
    var gitParseLog = (stdout) => stdout.trim().split("\n").filter(Boolean).map((line) => {
      const parts = line.split(" ");
      const hash = parts.shift() || "";
      const ts = Number(parts.shift() || 0);
      return { hash, ts, label: parts.join(" ") };
    });

    if (url.pathname === "/api/git/status" && req.method === "GET") {
      try {
        const dir = path.resolve(url.searchParams.get("dir") || "");
        if (!dir || !ok(dir)) return json(res, { success: false, error: "路径不允许" }, 403);
        let isRepo = true;
        try { await gitRun(dir, ["rev-parse", "--is-inside-work-tree"]); } catch { isRepo = false; }
        if (!isRepo) return json(res, { success: true, isRepo: false });
        const [{ stdout: branchOut }, { stdout: stOut }] = await Promise.all([
          gitRun(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({ stdout: "main" })),
          gitRun(dir, ["status", "--porcelain"]),
        ]);
        const changes = stOut.trim().split("\n").filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), file: l.slice(3) }));
        return json(res, { success: true, isRepo: true, branch: branchOut.trim(), changes });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }

    if (url.pathname === "/api/git/checkpoint" && req.method === "POST") {
      try {
        const { dir, label } = await body(req);
        const d = path.resolve(dir || "");
        if (!d || !ok(d)) return json(res, { success: false, error: "路径不允许" }, 403);
        const st = fs.statSync(d);
        if (!st.isDirectory()) return json(res, { success: false, error: "不是目录" }, 400);
        await gitEnsureRepo(d);
        const { stdout: stOut } = await gitRun(d, ["status", "--porcelain"]);
        if (!stOut.trim()) return json(res, { success: true, skipped: true, reason: "无改动，跳过检查点" });
        await gitRun(d, ["add", "-A"]);
        const msg = label || `检查点 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
        const { stdout: cOut } = await gitRun(d, ["commit", "-m", msg]);
        // 检查点治理：定期 gc 防仓库膨胀（每 10 个检查点触发一次）
        try {
          const { stdout: cnt } = await gitRun(d, ["rev-list", "--count", "HEAD"]);
          if (parseInt(cnt.trim() || "0", 10) % 10 === 0) await gitRun(d, ["gc", "--auto", "--quiet", "--prune=30.days"]).catch(() => {});
        } catch {}
        const hash = (await gitRun(d, ["rev-parse", "HEAD"])).stdout.trim().slice(0, 10);
        return json(res, { success: true, hash, label: msg });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }

    if (url.pathname === "/api/git/undo" && req.method === "POST") {
      try {
        const { dir, hash } = await body(req);
        const d = path.resolve(dir || "");
        if (!d || !ok(d)) return json(res, { success: false, error: "路径不允许" }, 403);
        if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) return json(res, { success: false, error: "无效的检查点" }, 400);
        // 先为当前未提交状态留一个保底检查点，撤销本身也可被再次撤销
        try {
          const { stdout: pre } = await gitRun(d, ["status", "--porcelain"]);
          if (pre.trim()) {
            await gitRun(d, ["add", "-A"]);
            await gitRun(d, ["commit", "-m", `撤销前保底 ${new Date().toLocaleString("zh-CN", { hour12: false })}`]);
          }
        } catch {}
        await gitRun(d, ["reset", "--hard", hash]);
        await gitRun(d, ["clean", "-fd"]);
        return json(res, { success: true, restoredTo: hash });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }

    if (url.pathname === "/api/git/log" && req.method === "GET") {
      try {
        const dir = path.resolve(url.searchParams.get("dir") || "");
        const limit = Math.min(Number(url.searchParams.get("limit") || 20) || 20, 100);
        if (!dir || !ok(dir)) return json(res, { success: false, error: "路径不允许" }, 403);
        let stdout = "";
        try {
          stdout = (await gitRun(dir, ["log", `--pretty=format:%h %ct %s`, "-n", String(limit)])).stdout;
        } catch { return json(res, { success: true, isRepo: false, items: [] }); }
        return json(res, { success: true, items: gitParseLog(stdout) });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }

    if (url.pathname === "/api/git/diff" && req.method === "GET") {
      try {
        const dir = path.resolve(url.searchParams.get("dir") || "");
        if (!dir || !ok(dir)) return json(res, { success: false, error: "路径不允许" }, 403);
        const { stdout } = await gitRun(dir, ["diff", "HEAD", "--stat"]).catch(() => ({ stdout: "" }));
        let text = "";
        try { text = (await gitRun(dir, ["diff", "HEAD"])).stdout; } catch {}
        return json(res, { success: true, stat: stdout, diff: String(text || "").slice(0, 200000) });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }

    // --- /api/code/* 端点 ---
    if (url.pathname === "/api/code/read-dir" && req.method === "GET") {
      try {
        const dirPath = path.resolve(url.searchParams.get("path") || process.env.HOME);
        if (!ok(dirPath)) return json(res, { success: false, error: "路径不允许" }, 403);
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries.filter((x) => !x.name.startsWith(".") || url.searchParams.get("showHidden") === "1")
          .map((x) => ({ name: x.name, path: path.join(dirPath, x.name), type: x.isDirectory() ? "directory" : "file", children: x.isDirectory() ? [] : undefined }));
        return json(res, items);
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/read-file" && req.method === "GET") {
      try {
        const fp = path.resolve(url.searchParams.get("path") || "");
        if (!ok(fp)) return json(res, { success: false, error: "路径不允许" }, 403);
        const content = fs.readFileSync(fp, "utf-8");
        return json(res, { success: true, content });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/write-file" && req.method === "POST") {
      try {
        const { path: fp, content } = await body(req);
        const resolved = path.resolve(fp);
        if (!ok(resolved)) return json(res, { success: false, error: "路径不允许" }, 403);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content || "", "utf-8");
        return json(res, { success: true, path: resolved });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/create-file" && req.method === "POST") {
      try {
        const { path: fp, content, overwrite } = await body(req);
        const resolved = path.resolve(fp);
        if (!ok(resolved)) return json(res, { success: false, error: "路径不允许" }, 403);
        if (fs.existsSync(resolved) && !overwrite) return json(res, { success: false, error: "文件已存在" }, 409);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content || "", "utf-8");
        return json(res, { success: true, path: resolved });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/create-folder" && req.method === "POST") {
      try {
        const { dirPath } = await body(req);
        const resolved = path.resolve(dirPath);
        if (!ok(resolved)) return json(res, { success: false, error: "路径不允许" }, 403);
        fs.mkdirSync(resolved, { recursive: true });
        return json(res, { success: true });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/rename" && req.method === "POST") {
      try {
        const { path: fp, newName } = await body(req);
        const resolved = path.resolve(fp);
        if (!ok(resolved)) return json(res, { success: false, error: "路径不允许" }, 403);
        const newPath = path.join(path.dirname(resolved), newName);
        fs.renameSync(resolved, newPath);
        return json(res, { success: true });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/file" && req.method === "DELETE") {
      try {
        const { path: fp } = await body(req);
        const resolved = path.resolve(fp);
        if (!ok(resolved)) return json(res, { success: false, error: "路径不允许" }, 403);
        fs.rmSync(resolved, { recursive: true, force: true });
        return json(res, { success: true });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/move" && req.method === "POST") {
      try {
        const { src, dest } = await body(req);
        const rSrc = path.resolve(src), rDest = path.resolve(dest);
        if (!ok(rSrc) || !ok(rDest)) return json(res, { success: false, error: "路径不允许" }, 403);
        fs.mkdirSync(path.dirname(rDest), { recursive: true });
        fs.renameSync(rSrc, rDest);
        return json(res, { success: true });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/search" && req.method === "POST") {
      try {
        const { query, dir } = await body(req);
        const target = path.resolve(dir || process.env.HOME);
        if (!ok(target)) return json(res, { success: false, error: "路径不允许" }, 403);
        const excludeDirs = ["node_modules", ".git", "dist", "build", "__pycache__", ".next", "target"].map((d) => `-path '*/${d}' -prune -o`).join(" ");
        const r = await execAsync("zsh", ["-c", `find ${JSON.stringify(target)} ${excludeDirs} -type f -print0 | xargs -0 grep -Il ${JSON.stringify(query)} | head -50`], { timeout: 15e3, maxBuffer: MAX_OUT });
        const files = r.stdout.trim().split("\n").filter(Boolean);
        return json(res, { success: true, files });
      } catch (e) { return json(res, { success: e.code === 1, error: e.stderr || e.message, files: [] }, e.code === 1 ? 200 : 500); }
    }
    if (url.pathname === "/api/code/select-directory" && req.method === "POST") {
      try {
        if (IS_WIN) {
          const r = await execAsync("powershell.exe", ["-NoProfile", "-Command", `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = '选择目录'
if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }`], { timeout: 120e3 });
          const p = r.stdout.trim();
          if (!p) return json(res, { success: false, error: "已取消" });
          return json(res, { success: true, path: p });
        }
        const r = await execAsync("osascript", ["-e", 'set dirPath to POSIX path of (choose folder with prompt "选择目录")'], { timeout: 60e3 });
        const p = r.stdout.trim();
        return json(res, { success: true, path: p });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/select-file" && req.method === "POST") {
      try {
        if (IS_WIN) {
          const r = await execAsync("powershell.exe", ["-NoProfile", "-Command", `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Title = '选择文件'
if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }`], { timeout: 120e3 });
          const p = r.stdout.trim();
          if (!p) return json(res, { success: false, error: "已取消" });
          return json(res, { success: true, path: p });
        }
        const r = await execAsync("osascript", ["-e", 'set filePath to POSIX path of (choose file with prompt "选择文件")'], { timeout: 60e3 });
        return json(res, { success: true, path: r.stdout.trim() });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/ensure-dir" && req.method === "POST") {
      try {
        const { path: fp } = await body(req);
        const resolved = path.resolve(fp);
        if (!ok(resolved)) return json(res, { success: false, error: "路径不允许" }, 403);
        fs.mkdirSync(resolved, { recursive: true });
        return json(res, { success: true, path: resolved, exists: true });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/terminal" && req.method === "POST") {
      try {
        const { command, cwd } = await body(req);
        let r;
        if (IS_WIN) {
          r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command || "Write-Output ready"], { timeout: 10e3, cwd: safeCwd(cwd), maxBuffer: 512 * 1024 });
        } else {
          r = await execAsync("zsh", ["-c", command || "echo ready"], { timeout: 10e3, cwd: safeCwd(cwd), maxBuffer: 512 * 1024 });
        }
        return json(res, { success: true, output: r.stdout.slice(0, MAX_OUT) + (r.stderr ? "\n[stderr]\n" + r.stderr.slice(0, MAX_OUT) : "") });
      } catch (e) { return json(res, { success: false, error: e.message, output: e.stdout || "" }); }
    }
    if (url.pathname === "/api/code/run" && req.method === "POST") {
      try {
        const { command, cwd } = await body(req);
        const child = cp.exec(command || "echo ready", { cwd: cwd || process.env.HOME, maxBuffer: 2 * 1024 * 1024 });
        const runId = "run_" + Date.now();
        let output = "";
        child.stdout?.on("data", (d) => { output += d.toString(); });
        child.stderr?.on("data", (d) => { output += d.toString(); });
        child.on("close", () => {
          const jobs = loadJson("run_jobs.json");
          jobs[runId] = { status: "done", output: output.slice(0, MAX_OUT * 2) };
          saveJson("run_jobs.json", jobs);
        });
        const jobs = loadJson("run_jobs.json");
        jobs[runId] = { status: "running", pid: child.pid };
        saveJson("run_jobs.json", jobs);
        return json(res, { success: true, runId });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/run/status" && req.method === "GET") {
      const runId = url.searchParams.get("runId");
      const jobs = loadJson("run_jobs.json");
      return json(res, jobs[runId] || { status: "unknown" });
    }
    if (url.pathname === "/api/code/run/stop" && req.method === "POST") {
      try {
        const { runId } = await body(req);
        const jobs = loadJson("run_jobs.json");
        if (jobs[runId]?.pid) { try { process.kill(jobs[runId].pid); } catch {} }
        jobs[runId] = { status: "stopped" };
        saveJson("run_jobs.json", jobs);
        return json(res, { ok: true });
      } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/code/git-status" && req.method === "GET") {
      try {
        const cwd = url.searchParams.get("cwd") || process.env.HOME;
        const r = await execAsync("git", ["status", "--porcelain"], { timeout: 5e3, cwd, maxBuffer: 65536 });
        const files = r.stdout.trim().split("\n").filter(Boolean).map((line) => {
          const statusCode = line.slice(0, 2).trim();
          return { file: line.slice(3), status: statusCode };
        });
        return json(res, { success: true, files });
      } catch (e) { return json(res, { success: false, error: e.message, files: [] }, 500); }
    }
    // Git 一键提交：add -A + commit -m
    if (url.pathname === "/api/code/git-commit" && req.method === "POST") {
      try {
        const { cwd, message } = await body(req);
        if (!message || !String(message).trim()) return json(res, { success: false, error: "提交信息不能为空" });
        const opts = { timeout: 15000, cwd: cwd || process.env.HOME, maxBuffer: 65536 };
        await execAsync("git", ["add", "-A"], opts);
        const r = await execAsync("git", ["commit", "-m", String(message).trim()], opts);
        return json(res, { success: true, output: (r.stdout || r.stderr || "").trim() });
      } catch (e) { return json(res, { success: false, error: String(e.stderr || e.message).slice(0, 500) }); }
    }
    // 项目代码统计：文件数 / 总行数 / 语言分布（Top 8）
    if (url.pathname === "/api/code/stats" && req.method === "GET") {
      try {
        const root = url.searchParams.get("root") || process.env.HOME;
        const skip = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".next", "venv", ".venv", "release", "coverage"]);
        const extLang = { js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JSX", ts: "TypeScript", tsx: "TSX", py: "Python", java: "Java", go: "Go", rs: "Rust", c: "C", h: "C", cpp: "C++", hpp: "C++", cs: "C#", rb: "Ruby", php: "PHP", swift: "Swift", kt: "Kotlin", sh: "Shell", html: "HTML", css: "CSS", scss: "SCSS", vue: "Vue", sql: "SQL", json: "JSON", md: "Markdown", yml: "YAML", yaml: "YAML", toml: "TOML" };
        let files = 0, lines = 0, bytes = 0;
        const byLang = new Map();
        const walk = (dir, depth) => {
          if (depth > 8) return;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return }
          for (const ent of entries) {
            if (ent.name.startsWith(".") && ent.name !== ".env") continue;
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) { if (!skip.has(ent.name)) walk(p, depth + 1); continue }
            const ext = ent.name.split(".").pop()?.toLowerCase() || "";
            const lang = extLang[ext];
            if (!lang) continue;
            try {
              const st = fs.statSync(p);
              if (st.size > 2 * 1024 * 1024) continue;
              const content = fs.readFileSync(p, "utf8");
              const n = content.split("\n").length;
              files++; lines += n; bytes += st.size;
              const cur = byLang.get(lang) || { files: 0, lines: 0 };
              cur.files++; cur.lines += n;
              byLang.set(lang, cur);
            } catch { /* unreadable */ }
          }
        };
        walk(root, 0);
        const languages = [...byLang.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.lines - a.lines).slice(0, 8);
        return json(res, { success: true, files, lines, sizeMb: +(bytes / 1024 / 1024).toFixed(2), languages });
      } catch (e) { return json(res, { success: false, error: e.message }); }
    }
    if (url.pathname === "/api/code/upload-bg" && req.method === "POST") {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const buf = Buffer.concat(chunks);
        const contentType = req.headers["content-type"] || "";
        const boundary = contentType.split("boundary=")[1];
        if (!boundary) {
          const ext = contentType.includes("video/mp4") ? ".mp4" : contentType.includes("image/") ? ".jpg" : ".bin";
          const filename = "bg_upload" + ext;
          const publicPath = path.join(__dirname, "public", filename);
          const distPath = path.join(DIST, filename);
          fs.writeFileSync(publicPath, buf);
          fs.writeFileSync(distPath, buf);
          return json(res, { success: true, url: "/" + filename });
        }
        const str = buf.toString();
        const parts = str.split("--" + boundary);
        for (const part of parts) {
          if (!part.includes("Content-Disposition")) continue;
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd < 0) continue;
          const header = part.slice(0, headerEnd);
          const nameMatch = header.match(/name="(\w+)"/);
          const fnMatch = header.match(/filename="(.+)"/);
          if (!nameMatch) continue;
          if (fnMatch) {
            const ext = fnMatch[1].includes(".mp4") ? ".mp4" : fnMatch[1].includes(".mov") ? ".mov" : fnMatch[1].includes(".webm") ? ".webm" : ".jpg";
            const filename = "bg_upload" + ext;
            const data = buf.slice(buf.indexOf("\r\n\r\n", buf.indexOf(header)) + 4, buf.lastIndexOf("--" + boundary) - 2);
            const publicPath = path.join(__dirname, "public", filename);
            const distPath = path.join(DIST, filename);
            fs.mkdirSync(path.dirname(publicPath), { recursive: true });
            fs.mkdirSync(path.dirname(distPath), { recursive: true });
            fs.writeFileSync(publicPath, data);
            fs.writeFileSync(distPath, data);
            return json(res, { success: true, url: "/" + filename });
          }
        }
        return json(res, { success: false, error: "未找到上传文件" }, 400);
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }

    // --- 其他辅助端点 ---
    if (url.pathname === "/api/open-file" && req.method === "GET") {
      try {
        const p = url.searchParams.get("path") || process.env.HOME;
        await execAsync("open", [p], { timeout: 5e3 });
        return json(res, { ok: true });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/trash-file" && req.method === "POST") {
      try {
        const { path: fp } = await body(req);
        const resolved = path.resolve(fp);
        if (!ok(resolved)) return json(res, { success: false, error: "路径不允许" }, 403);
        await execAsync("osascript", ["-e", `tell app "Finder" to delete POSIX file ${JSON.stringify(resolved)}`], { timeout: 5e3 });
        return json(res, { success: true });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/skills/list" && req.method === "GET") {
      return json(res, (await list_skills()).output ? JSON.parse((await list_skills()).output) : []);
    }
    if (url.pathname === "/api/lm-models" && req.method === "GET") {
      try {
        const settings2 = loadJson("settings.json");
        if (!settings2.apiBaseUrl || !settings2.apiKey) return json(res, { models: [] });
        const r = await fetch(`${settings2.apiBaseUrl}/models`, {
          headers: { "Authorization": `Bearer ${settings2.apiKey}` },
          signal: AbortSignal.timeout(1e4)
        });
        if (!r.ok) return json(res, { models: [] });
        const data2 = await r.json();
        const channelData = data2 && data2.data ? (Array.isArray(data2.data) ? data2.data.reduce((acc, m) => { acc[m.id] = true; return acc; }, {}) : data2.data) : {};
        const models = [...new Set(Object.values(channelData).flat().filter(Boolean))];
        return json(res, { models });
      } catch { return json(res, { models: [] }); }
    }
    // ─── 免费模型面板:Kilo Gateway 免 key 全量目录(10 分钟缓存)───
    // 注:GitHub Models 的 models.github.ai/inference 匿名/带 token 均返回
    // text/plain "OK" 桩响应(2026-10-06 实测),非 OpenAI 兼容,不可用。
    // 注册即免费额度提供商(端点均实测存活,OpenAI 兼容,用户自备免费 key)
    var FREE_TIER_PROVIDERS = [
      { id: "zhipu", name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", signup: "https://open.bigmodel.cn", free: "GLM-4-Flash 完全免费", models: [
        { id: "glm-4-flash", name: "GLM-4-Flash(免费)", context: 128000 },
        { id: "glm-4.5-flash", name: "GLM-4.5-Flash", context: 128000 } ] },
      { id: "siliconflow", name: "硅基流动", base: "https://api.siliconflow.cn/v1", signup: "https://siliconflow.cn", free: "注册送 14 元,部分模型免费", models: [
        { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen2.5-7B(免费)", context: 32768 },
        { id: "THUDM/glm-4-9b-chat", name: "GLM-4-9B(免费)", context: 32768 } ] },
      { id: "google", name: "Google AI Studio", base: "https://generativelanguage.googleapis.com/v1beta/openai", signup: "https://aistudio.google.com", free: "Gemini 免费档(每分钟限额)", models: [
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", context: 1048576 },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1048576 } ] },
      { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1", signup: "https://console.groq.com", free: "免费额度,推理速度极快", models: [
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", context: 128000 },
        { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", context: 128000 } ] },
      { id: "mistral", name: "Mistral", base: "https://api.mistral.ai/v1", signup: "https://console.mistral.ai", free: "免费档(需验证手机号)", models: [
        { id: "mistral-small-latest", name: "Mistral Small", context: 32000 } ] },
      { id: "hunyuan", name: "腾讯混元", base: "https://api.hunyuan.cloud.tencent.com/v1", signup: "https://console.cloud.tencent.com/hunyuan", free: "hunyuan-lite 免费", models: [
        { id: "hunyuan-lite", name: "混元 lite(免费)", context: 256000 } ] },
      { id: "modelscope", name: "ModelScope 魔搭", base: "https://api-inference.modelscope.cn/v1", signup: "https://modelscope.cn", free: "每日 2000 次免费调用", models: [
        { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen2.5-7B", context: 32768 },
        { id: "Qwen/Qwen3-32B", name: "Qwen3-32B", context: 40960 } ] },
      { id: "volcengine", name: "火山方舟(豆包)", base: "https://ark.cn-beijing.volces.com/api/v3", signup: "https://console.volcengine.com/ark", free: "每个模型 50 万免费 token", models: [
        { id: "ep-xxxxxxxx", name: "填入你的接入点 ID", context: 32000 } ] },
    ];
    var FREE_MODELS_CACHE = null;
    var FREE_MODELS_TS = 0;
    if (url.pathname === "/api/free-models" && req.method === "GET") {
      const now = Date.now();
      if (FREE_MODELS_CACHE && now - FREE_MODELS_TS < 600000) return json(res, FREE_MODELS_CACHE);
      try {
        const r = await fetch("https://api.kilo.ai/api/gateway/v1/models", {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) return json(res, { error: `Kilo 目录拉取失败 HTTP ${r.status}` }, 502);
        const data = await r.json().catch(() => null);
        const arr = Array.isArray(data?.data) ? data.data : [];
        const pick = (m) => ({
          id: String(m?.id || ""),
          name: String(m?.name || m?.id || ""),
          context: Number(m?.context_length) || 0,
          desc: String(m?.description || "").slice(0, 120),
          vision: /image|vision|multimodal|omni|识图/i.test(String(m?.description || "") + JSON.stringify(m?.architecture || "")),
        });
        // 免费档判定::free 后缀 / isFree / kilo- 前缀 / /free 结尾(openrouter/free)
        const isFreeId = (id: string) => id.indexOf(":free") >= 0 || id.endsWith("/free") || /^kilo-/.test(id);
        const free = arr.filter((m) => { const id = String(m?.id || ""); return isFreeId(id) || m?.isFree === true; }).map(pick).filter((m) => m.id);
        free.sort((a, b) => {
          // 默认:openrouter/free(OpenRouter 免费路由器,经 Kilo 网关免 key,
          // 实测 2026-10-06 无 Authorization 直连可用);kilo-auto/free 备选
          if (a.id === "openrouter/free") return -1;
          if (b.id === "openrouter/free") return 1;
          if (a.id === "kilo-auto/free") return -1;
          if (b.id === "kilo-auto/free") return 1;
          return a.name.localeCompare(b.name);
        });
        const paid = arr.filter((m) => { const id = String(m?.id || ""); return !(isFreeId(id) || m?.isFree === true); }).map(pick).filter((m) => m.id);
        const out = {
          ok: true,
          sources: [
            {
              id: "pollinations", name: "Pollinations", keyless: true,
              base: "https://text.pollinations.ai/openai",
              note: "免 key 匿名档:GPT-OSS 20B(推理·工具调用)",
              models: [{ id: "openai-fast", name: "GPT-OSS 20B(推理·工具)", context: 131072, vision: false, tools: true }],
            },
            {
              id: "kilo", name: "Kilo Gateway", keyless: true,
              base: "https://api.kilo.ai/api/gateway/v1",
              total: arr.length,
              models: free,
              paid,
            },
          ],
          providers: FREE_TIER_PROVIDERS,
          ts: new Date().toISOString(),
        };
        FREE_MODELS_CACHE = out; FREE_MODELS_TS = now;
        return json(res, out);
      } catch (e) { return json(res, { error: String(e?.message || e) }, 502); }
    }
    // 单个免费模型测速(5 token 最小请求)
    if (url.pathname === "/api/free-model-test" && req.method === "POST") {
      try {
        const { model, base } = await body(req);
        if (!model) return json(res, { error: "缺少 model" }, 400);
        const target = String(base || "") === "pollinations" ? "https://text.pollinations.ai/openai"
          : String(base || "") === "github" ? "https://models.github.ai/inference"
          : "https://api.kilo.ai/api/gateway/v1";
        const t0 = Date.now();
        const r = await fetch(`${target}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 5 }),
          signal: AbortSignal.timeout(30000),
        });
        const ms = Date.now() - t0;
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          return json(res, { ok: false, ms, error: `HTTP ${r.status} ${detail.slice(0, 120)}` });
        }
        return json(res, { ok: true, ms });
      } catch (e) { return json(res, { ok: false, error: String(e?.message || e) }); }
    }
    // 按请求头传入的 baseUrl/apiKey 拉取模型列表（供设置面板"拉取模型"，无需先保存）
    if (url.pathname === "/api/models-list" && req.method === "POST") {
      try {
        const targetBase = String(req.headers["x-target-base"] || "").trim();
        let apiKey = String(req.headers["x-api-key"] || "").trim();
        // 掩码回显不是真钥匙:为空/含 **** 时回退 SQLite 存储密钥
        if (!apiKey || apiKey.indexOf("****") >= 0) {
          try {
            const __rows = sharedDb ? sharedDb.getAllSettings() : [];
            for (const __r of __rows) { if (__r.key === "apiKey" && __r.value) apiKey = String(__r.value); }
          } catch {}
        }
        if (!targetBase) return json(res, { models: [], error: "缺少 API 地址" }, 200);
        const r = await fetch(`${targetBase.replace(/\/+$/, "")}/models`, {
          // 免 key 网关:free/keyless/空 都不带 Authorization
          headers: apiKey && apiKey !== "free" && apiKey !== "keyless" ? { "Authorization": `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(15e3)
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          return json(res, { models: [], error: `HTTP ${r.status}${detail ? " · " + detail.slice(0, 200) : ""}` }, 200);
        }
        const data2 = await r.json().catch(() => null);
        const arr = Array.isArray(data2?.data) ? data2.data : Array.isArray(data2) ? data2 : [];
        const models = [...new Set(arr.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean))];
        return json(res, { models });
      } catch (e) {
        return json(res, { models: [], error: e.message || "请求失败" }, 200);
      }
    }
    if (url.pathname === "/api/speech-to-text" && req.method === "POST") {
      try {
        const ctype = req.headers["content-type"] || "";
        const boundary = ctype.match(/boundary=(.+)/)?.[1];
        if (!boundary) return json(res, { success: false, error: "需要 multipart/form-data" }, 400);
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const buf = Buffer.concat(chunks);
        // 解析 multipart，取 name="audio" 或带 filename 的音频部分
        let audioData = null;
        const parts = buf.toString("latin1").split(`--${boundary}`);
        for (const part of parts) {
          if (!part.includes("Content-Disposition")) continue;
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd < 0) continue;
          const header = part.slice(0, headerEnd);
          if (!/filename="/.test(header) && !/name="audio"/.test(header)) continue;
          let dataEnd = part.length - 2;
          if (dataEnd < headerEnd + 4) dataEnd = part.length;
          audioData = Buffer.from(part.slice(headerEnd + 4, dataEnd), "latin1");
          break;
        }
        if (!audioData || audioData.length === 0) return json(res, { success: false, error: "缺少音频数据" }, 400);
        const tmpDir = path.join(os.homedir(), ".lyclaw", "stt-tmp");
        fs.mkdirSync(tmpDir, { recursive: true });
        const wavPath = path.join(tmpDir, `rec_${Date.now()}.wav`);
        fs.writeFileSync(wavPath, audioData);
        const pyBin = process.env.PYTHON_BIN || "python3";
        // stt.py 位于 asar 外（Resources/stt），Python 无法读取 asar 内文件
        const sttScript = process.env.STT_SCRIPT || path.join(__dirname, "src", "shared", "stt.py");
        try {
          // 优先走常驻 worker（免冷启动）；worker 不可用时回退一次性进程
          let text
          try { text = await sttTranscribe(wavPath) }
          catch (we) {
            const { stdout } = await execAsync(pyBin, [sttScript, wavPath], { timeout: 90000, maxBuffer: 1024 * 1024 })
            text = (stdout || "").trim()
          }
          return json(res, { success: true, text })
        } catch (e) {
          return json(res, { success: false, error: `语音识别失败: ${e.stderr || e.message}` }, 500)
        } finally {
          try { fs.unlinkSync(wavPath) } catch {}
        }
      } catch (e) {
        return json(res, { success: false, error: e.message }, 500);
      }
    }
    // ─── jtcode 命令行工具：状态 / 安装 / 卸载 ───
    var CLI_CANDIDATES = ["/usr/local/bin/jtcode", "/opt/homebrew/bin/jtcode", path.join(process.env.HOME || "", ".local", "bin", "jtcode")];
    if (url.pathname === "/api/cli/status" && req.method === "GET") {
      for (const p of CLI_CANDIDATES) {
        try { if (fs.existsSync(p)) return json(res, { installed: true, path: p, version: "1.0.0" }); } catch {}
      }
      return json(res, { installed: false });
    }
    if (url.pathname === "/api/cli/install" && req.method === "POST") {
      try {
        const src = path.join(__dirname, "src", "shared", "jtcode-cli.mjs");
        if (!fs.existsSync(src)) return json(res, { success: false, error: "CLI 脚本缺失" }, 500);
        const script = fs.readFileSync(src, "utf-8").replace("__APP_VERSION__", PKG.version);
        const targets = ["/usr/local/bin/jtcode", path.join(process.env.HOME || "", ".local", "bin", "jtcode")];
        let lastErr = "";
        for (const p of targets) {
          try {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, script, { mode: 0o755 });
            fs.chmodSync(p, 0o755);
            const needsPath = p.includes(".local/bin") && !(process.env.PATH || "").includes(path.dirname(p));
            return json(res, { success: true, path: p, needsPathNote: needsPath, binDir: path.dirname(p) });
          } catch (e) { lastErr = e.message; }
        }
        return json(res, { success: false, error: "写入失败: " + lastErr }, 500);
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }
    if (url.pathname === "/api/cli/uninstall" && req.method === "POST") {
      try {
        let removed = 0;
        for (const p of CLI_CANDIDATES) {
          try { if (fs.existsSync(p)) { fs.unlinkSync(p); removed++; } } catch {}
        }
        return json(res, { success: true, removed });
      } catch (e) { return json(res, { success: false, error: e.message }, 500); }
    }

    if (url.pathname === "/api/edge-tts" && req.method === "POST") {
      try {
        const { text, input, voice, speed } = await body(req);
        const spoken = text || input;
        if (!spoken) return json(res, { error: "缺少 text" }, 400);
        // 惰性启动：首次语音请求时才拉起 Edge TTS python 进程
        try { if (globalThis.ensureEdgeTTS) await Promise.race([globalThis.ensureEdgeTTS(), new Promise((rr) => setTimeout(rr, 12000))]); } catch {}
        // TTS 进程冷启动（python 导入依赖）需数秒：带重试
        let r = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            r = await fetch(`http://localhost:5050/v1/audio/speech`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ input: spoken, voice: voice || "zh-CN-XiaoxiaoNeural", speed: Number(speed) || 1.0 }),
              signal: AbortSignal.timeout(30e3),
            });
            if (r.ok) break;
          } catch (e) {
            if (attempt === 3) return json(res, { error: "TTS 服务不可达: " + e.message }, 502);
          }
          await new Promise((rr) => setTimeout(rr, 1800));
        }
        if (!r || !r.ok) return json(res, { error: "TTS 服务异常" }, 502);
        const audioBuf = Buffer.from(await r.arrayBuffer());
        res.writeHead(200, { ...(corsHeaders(req) || {}), "Content-Type": "audio/mpeg" });
        res.end(audioBuf);
        return;
      } catch (e) { return json(res, { error: e.message }, 502); }
    }

    // ─── 全会话内容搜索（企业级：跨会话找消息）───
    if (url.pathname === "/api/search" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json(res, { hits: [] });
      if (!sharedDb) return json(res, { hits: [] });
      try {
        const rows = sharedDb.db.prepare(
          `SELECT m.session_id, m.content, m.created_at, s.title
           FROM messages m JOIN sessions s ON s.id = m.session_id
           WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT 30`
        ).all(`%${q}%`);
        const seen = new Set();
        const hits = [];
        for (const r of rows) {
          if (seen.has(r.session_id)) continue;
          seen.add(r.session_id);
          const idx = r.content.indexOf(q);
          hits.push({
            sessionId: r.session_id,
            title: r.title || "未命名",
            snippet: r.content.slice(Math.max(0, idx - 30), idx + 80).replace(/\n/g, " "),
            at: r.created_at,
          });
          if (hits.length >= 12) break;
        }
        return json(res, { hits });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // ─── 一键备份导出 / 导入 ───
    if (url.pathname === "/api/backup/export" && req.method === "GET") {
      try {
        if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
        const sessions = sharedDb.listSessions();
        const messages = {};
        for (const ses of sessions) messages[ses.id] = sharedDb.getMessages(ses.id);
        const settingsRows = sharedDb.getAllSettings();
        const settingsObj = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
        const memories = sharedDb.getAllMemories();
        return jsonRaw(res, { version: 1, exported_at: new Date().toISOString(), sessions, messages, settings: settingsObj, memories });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/backup/import" && req.method === "POST") {
      try {
        const data = await body(req);
        if (!data.sessions) return json(res, { error: "备份文件格式不正确" }, 400);
        let ns = 0, nm = 0;
        for (const ses of data.sessions) {
          sharedDb.createSession(ses.id, ses.title || "导入会话");
          ns++;
        }
        for (const [sid, msgs] of Object.entries(data.messages || {})) {
          for (const m of (msgs || [])) {
            sharedDb.addMessage(m.id || sharedDb.genId(), sid, m.role, m.content || "", m.thinking || "", typeof m.tool_calls === "string" ? m.tool_calls : JSON.stringify(m.tool_calls || []), m.tool_call_id || "");
            nm++;
          }
        }
        for (const [k, v] of Object.entries(data.settings || {})) {
          // 旧版（掩码导出时期）的备份文件里密钥是 ****，跳过以免把掩码写回库
          if (isMasked(v)) continue;
          sharedDb.setSetting(k, String(v));
        }
        for (const mem of (data.memories || [])) sharedDb.setMemory(mem.key || sharedDb.genId(), mem.value || "");
        return json(res, { ok: true, sessions: ns, messages: nm });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // ─── 知识库 RAG ───
    // embeddings 代理：按设置自动选地址与密钥（未配置时明确报错）
    async function kbEmbedTexts(texts) {
      const rows = sharedDb ? sharedDb.getAllSettings() : [];
      const st = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const base = st.apiBaseUrl || "";
      const key = st.apiKey || "";
      const model = st.embeddingModel || "";
      if (!base || !key || !model) throw new Error("未配置模型服务（知识库检索需要 embedding 模型）");
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(60e3),
      });
      if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const d = await res.json();
      return (d.data || []).map((x) => x.embedding);
    }
    function kbSplitChunks(text) {
      const CHUNK = 800, OVERLAP = 100;
      const clean = text.replace(/\r/g, "");
      if (clean.length <= CHUNK) return clean ? [clean] : [];
      const out = [];
      let i = 0;
      while (i < clean.length) { out.push(clean.slice(i, i + CHUNK)); i += CHUNK - OVERLAP; }
      return out;
    }
    function kbCosine(a, b) {
      let dot = 0, na = 0, nb = 0;
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
    }
    const KB_TEXT_EXTS = [".md", ".txt", ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".html", ".css", ".cjs", ".mjs", ".sh", ".yaml", ".yml", ".csv", ".log", ".sql"];
    const KB_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "venv", "__pycache__", "release"]);

    if (url.pathname === "/api/kb/entries" && req.method === "GET") {
      if (!sharedDb) return json(res, { entries: [] });
      try {
        const rows = sharedDb.listKbEntries();
        const all = rows.map((e) => ({ ...e, tags: JSON.parse(e.tags || "[]"), links: JSON.parse(e.links || "[]"), backlinkCount: sharedDb.kbBacklinks(e.id).length }));
        return json(res, { entries: all });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/entry" && req.method === "POST") {
      try {
        const { title, content, tags, link_titles, id, source, notebook, pinned, icon } = await body(req);
        if (!title) return json(res, { error: "缺少 title" }, 400);
        const result = await save_knowledge({ title, content, tags, link_titles, id, source: source === "ai" ? "ai" : "user", notebook, pinned, icon });
        return json(res, result);
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/reindex" && req.method === "POST") {
      try {
        if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
        const es = sharedDb.listKbEntries();
        let chunks = 0, notes = 0;
        for (const e of es) { const c = await kbIndexEntry(e.id, e.title, e.content || ""); chunks += c; notes++ }
        return json(res, { ok: true, notes, chunks });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/notebooks" && req.method === "GET") {
      if (!sharedDb) return json(res, { notebooks: [] });
      try { return json(res, { notebooks: sharedDb.kbNotebooks() }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/search-notes" && req.method === "GET") {
      if (!sharedDb) return json(res, { results: [] });
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json(res, { results: [] });
      try { return json(res, { results: sharedDb.kbSearchNotes(q) }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname.startsWith("/api/kb/entry/") && req.method === "DELETE") {
      try { sharedDb.deleteKbEntry(url.pathname.split("/").pop()); return json(res, { ok: true }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/status" && req.method === "GET") {
      if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
      const rows = sharedDb.kbAll();
      const files = [...new Set(rows.map((r) => r.path))];
      return json(res, { chunks: rows.length, files: files.length, paths: files.slice(0, 200) });
    }
    if (url.pathname === "/api/kb/clear" && req.method === "POST") {
      if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
      sharedDb.kbClear();
      return json(res, { ok: true });
    }
    if (url.pathname === "/api/kb/ingest" && req.method === "POST") {
      try {
        const { folder } = await body(req);
        if (!folder) return json(res, { error: "缺少 folder" }, 400);
        if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
        const fsMod = await import("fs");
        const pathMod = await import("path");
        const files = [];
        (function walk(dir, depth) {
          if (depth > 6) return;
          let entries = [];
          try { entries = fsMod.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (e.name.startsWith(".")) continue;
            const full = pathMod.join(dir, e.name);
            if (e.isDirectory()) { if (!KB_SKIP_DIRS.has(e.name)) walk(full, depth + 1); continue; }
            if (!KB_TEXT_EXTS.includes(pathMod.extname(e.name).toLowerCase())) continue;
            try { if (fsMod.statSync(full).size > 1024 * 1024) continue; } catch { continue; }
            files.push(full);
            if (files.length >= 120) return;
          }
        })(folder, 0);
        let totalChunks = 0, embedded = 0;
        for (const fp of files) {
          sharedDb.kbDeleteByPath(fp);
          let text = "";
          try { text = fsMod.readFileSync(fp, "utf-8"); } catch { continue; }
          const chunks = kbSplitChunks(text).slice(0, 120);
          if (chunks.length === 0) continue;
          for (let i = 0; i < chunks.length; i += 16) {
            const batch = chunks.slice(i, i + 16);
            const vectors = await kbEmbedTexts(batch);
            batch.forEach((ck, j) => { sharedDb.kbInsert(fp, ck, vectors[j] || []); totalChunks++; });
            embedded += batch.length;
          }
        }
        return json(res, { ok: true, files: files.length, chunks: totalChunks });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/search" && req.method === "POST") {
      try {
        const { query, topK } = await body(req);
        if (!query) return json(res, { error: "缺少 query" }, 400);
        if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
        if (sharedDb.kbCount() === 0) return json(res, { hits: [] });
        const [qv] = await kbEmbedTexts([String(query).slice(0, 1000)]);
        const hits = sharedDb.kbAll()
          .map((r) => ({ path: r.path, chunk: r.chunk, score: kbCosine(qv, JSON.parse(r.vector)) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.min(topK || 4, 8));
        return json(res, { hits });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    await serveStatic(req, res);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}).listen(PORT, () => {

// ─── 定时任务执行器（每 30s 检查一次，到点真实执行）───
// ─── 服务端通知桥（v7.0）：notices.json 供渲染层合并进通知中心 ───
const NOTICE_FILE = () => path.join(DATA_DIR, "notices.json");
function pushServerNotice(n) {
  try {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(NOTICE_FILE(), "utf-8")); if (!Array.isArray(list)) list = []; } catch {}
    list.unshift({ id: "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), read: false, ...n });
    fs.writeFileSync(NOTICE_FILE(), JSON.stringify(list.slice(0, 50)));
  } catch {}
}

function runScheduler() {  try {
    const rows = sharedDb ? sharedDb.getAllSettings() : [];
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const base = s.apiBaseUrl || "";
    const key = s.apiKey || "";
    const model = s.model || "";
    if (!base || !key || !model) return;
    let tasks = [];
    try { tasks = loadTasks(); } catch {}
    if (!Array.isArray(tasks)) return;
    const now = Date.now();
    const auth = "Bearer " + key;
    for (const t of tasks) {
      if (!t.enabled) continue;
      const next = new Date(t.nextRun).getTime();
      if (!next || next > now) continue;
      t.lastRun = new Date().toISOString();
      t.status = "running";
      saveTasks(tasks);
      const taskId = t.id;
      const type = t.type || "once";
      fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": auth },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "你是一个自动定时任务执行器。执行用户指定的任务，输出结果（中文，简洁可读）。不要提及自己是 AI。只用文字完成任务；如需文件操作请在结果中给出建议而非执行。" },
            { role: "user", content: String(t.content || "") },
          ],
          max_tokens: 1200,
          stream: false,
        }),
        signal: AbortSignal.timeout(120000),
      })
        .then(async (r) => {
          let result = "";
          try {
            const d = await r.json();
            result = (d.choices?.[0]?.message?.content || d.error?.message || "(无输出)").trim();
          } catch {}
          const list = loadTasks();
          const item = list.find((x) => x.id === taskId);
          if (item) {
            item.lastResult = result;
            item.status = "done";
            if (type === "once") { item.enabled = false; }
            else {
              const n = new Date();
              n.setDate(n.getDate() + (type === "daily" ? 1 : 7));
              item.nextRun = n.toISOString();
            }
            saveTasks(list);
            // 定时任务完成 → 通知中心（v7.0 服务端通知桥）
            try {
              pushServerNotice({ type: "system", title: `定时任务完成：${(item.title || item.content || "任务").slice(0, 30)}`, body: result.slice(0, 120) });
            } catch {}
          }
        })
        .catch(() => {
          const list = loadTasks();
          const item = list.find((x) => x.id === taskId);
          if (item) { item.status = "error"; item.lastResult = "执行失败：网络错误"; saveTasks(list); }
        });
    }
  } catch { /* 调度器失败不影响主服务 */ }
}
setInterval(runScheduler, 30000);
console.log("[ly-next] 定时任务调度器已启动（30s 轮询）");
  console.log(`
  \u{1F43E} \u8001\u6538 Agent v2 \u2014 http://localhost:${PORT}
  ${Object.keys(TOOLS).length} tools | \u5355\u8FDB\u7A0B | \u4F4E\u5185\u5B58
  `);
});

// ─── 合盖保持运行：caffeinate 防止系统休眠（设置 keepAwake，默认开启）───
let caffeinateProc = null;
function syncKeepAwake() {
  let on = true; // 默认开启（未设置过该选项视为开启）
  try {
    if (sharedDb) {
      const v = sharedDb.getSetting("keepAwake");
      if (v !== undefined && v !== null && v !== "") on = v === "true";
    } else {
      const s = loadJson("settings.json");
      if (s && s.keepAwake !== undefined) on = String(s.keepAwake) === "true";
    }
  } catch {}
  if (on && !caffeinateProc) {
    try {
      caffeinateProc = cp.spawn("caffeinate", ["-dimsu"], { stdio: "ignore" });
      caffeinateProc.on("error", () => { caffeinateProc = null; });
      caffeinateProc.on("exit", () => { caffeinateProc = null; });
      console.log("→ 合盖保持运行已开启 (caffeinate)");
    } catch {}
  } else if (!on && caffeinateProc) {
    try { caffeinateProc.kill(); } catch {}
    caffeinateProc = null;
    console.log("→ 合盖保持运行已关闭");
  }
}
function killCaffeinate() {
  if (caffeinateProc) { try { caffeinateProc.kill(); } catch {} caffeinateProc = null; }
}
process.on("exit", killCaffeinate);
process.on("SIGTERM", killCaffeinate);
process.on("SIGINT", killCaffeinate);
syncKeepAwake();
setInterval(syncKeepAwake, 20000);
