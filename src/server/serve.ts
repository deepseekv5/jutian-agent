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
import * as dns from 'dns'

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

/**
 * 系统语音兜底（v13.3）：Edge TTS 需要联网，微软服务偶发 403/限流。
 * 三个桌面平台各有离线合成器，逐平台调用，产出可直接播放的音频。
 * 手机端没有系统合成器 → 前端自动回退浏览器 speechSynthesis。
 */
async function cloudAsr(audioBuf, mime) {
  let base = "", key = "", model = "";
  try {
    for (const r of (sharedDb ? db.getAllSettings() : [])) {
      if (r.key === "apiBaseUrl") base = String(r.value || "");
      if (r.key === "apiKey") key = String(r.value || "");
      if (r.key === "asrModel") model = String(r.value || "");
    }
  } catch { /* 设置读不到就走失败分支 */ }
  if (!base || !key || key.indexOf("****") >= 0 || key === "free" || key === "keyless") {
    throw new Error("未配置可用的模型服务（云端识别需要 API Key）");
  }
  let b = base.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(b)) b = b.replace(/\/chat\/completions$/i, "");
  const ext = /webm/i.test(mime) ? "webm" : /mp4|m4a|aac/i.test(mime) ? "m4a" : /ogg/i.test(mime) ? "ogg" : /mp3|mpeg/i.test(mime) ? "mp3" : "wav";
  const form = new FormData();
  form.append("file", new Blob([audioBuf], { type: mime || "audio/wav" }), "audio." + ext);
  form.append("model", model || "whisper-1");
  const r = await fetch(`${b}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120e3),
  });
  if (!r.ok) {
    const errText = (await r.text().catch(() => "")).slice(0, 300);
    throw new Error(`云端识别 HTTP ${r.status}${errText ? "：" + errText : ""}`);
  }
  const data = await r.json().catch(() => null);
  const text = String(data?.text || "").trim();
  if (!text) throw new Error("云端识别未返回文本");
  return text;
}
// SQLite 设置存储（与开发版共用 ~/.lyclaw/data.db，避免 settings.json 双源不一致）
var PKG = (() => { try { return require("./package.json"); } catch (e) { return { version: "unknown" }; } })();
var sharedDb = null;
/* ─── MCP（Model Context Protocol）客户端管理器 — v5.0 学自 Zode ─── */
var mcp = (() => { try { const m = require("./src/shared/mcp.cjs"); m.init(DATA_DIR); return m; } catch (e) { console.error("mcp.cjs load failed:", e.message); return null; } })();
try { sharedDb = require("./src/shared/db.cjs"); } catch (e) { console.error("db.cjs load failed:", e.message); }

// ─── 文件空间（v13.8）：默认工作区自动就位，用户无需手动创建文件夹 ───
// 位置：数据目录下的 workspace（桌面 ~/.lyclaw/workspace，手机 filesDir/.lyclaw/workspace）
// 手机本地版/桌面端统一从这里起步；用户之后可在设置里改成任何目录。
var DEFAULT_WORKSPACE = path.join(LYCLAW_HOME, "workspace");
try { fs.mkdirSync(DEFAULT_WORKSPACE, { recursive: true }); } catch (e) { console.error("workspace mkdir:", e.message); }
// 首次放一个引导文件，打开文件空间不至于空空如也
try {
  const welcomeFile = path.join(DEFAULT_WORKSPACE, "开始这里.txt");
  if (!fs.existsSync(welcomeFile)) {
    fs.writeFileSync(welcomeFile, [
      "这是你的文件空间。",
      "",
      "· Agent 生成的文件、你让 AI 写的代码、调研产出的报告都在这里",
      "· 桌面端：代码模式的文件树直接浏览；侧栏「打开工作目录」一键定位",
      "· 手机端：底部「文件」页就是这里",
      "· 想换位置：设置 → 工作区，改成任意目录即可",
      "",
      "—— 巨天 Agent",
    ].join("\n"));
  }
} catch { /* 只读环境跳过 */ }
// 一次性迁移：设置里没有 workDir 时写入默认值（前端会自动带上它发请求）
try {
  if (sharedDb) {
    const cur = sharedDb.getSetting("workDir");
    if (!cur || !String(cur).trim()) sharedDb.setSetting("workDir", DEFAULT_WORKSPACE);
  }
} catch (e) { console.error("workDir 迁移:", e.message); }
/**
 * 数据库不可用时的安全代理。
 *
 * db.cjs 加载失败（原生模块 ABI 不匹配、文件损坏、权限问题）时 sharedDb 为 null，
 * 而全文件有 70+ 处直接调用它的方法——每一处都会抛 TypeError，用户看到的是
 * 「Cannot read properties of null」这类内部错误，无从判断该怎么办。
 *
 * 代理的行为：查询类方法返回空数组/空对象/null，写入类方法静默 no-op，
 * 并只记录一次警告（避免刷屏）。这样界面能正常打开、功能降级，而不是整片报错。
 */
function makeDbFallback() {
  // v12.9：换 jsondb（真实落盘的完整降级）——better-sqlite3 是原生模块，
  // Android(Termux/bionic) 等环境加载不了。之前这里是"空读+写丢弃"的
  // 占位代理：界面能开，但 API Key 存不上、对话全丢，等于不可用。
  // jsondb 实现了对话核心 API（会话/消息/设置/记忆/代码项目），
  // 知识库向量检索诚实降级为空集。
  try {
    var J = require("./src/shared/jsondb.cjs");
    console.warn("[db] better-sqlite3 不可用，已切换 JSON 文件存储（对话数据照常保存；知识库检索不可用）");
    return J.createJsonDb(path.join(DATA_DIR, "data.json"));
  } catch (e) {
    console.error("[db] jsondb 初始化失败，功能将严重降级:", e.message);
    var warned2 = false;
    return new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        if (!warned2) { warned2 = true; }
        if (/^(get|list|search|all|find|has)/i.test(prop)) {
          return (..._a) => (prop.startsWith("getAll") || prop.startsWith("list") || prop.startsWith("search") ? [] : null);
        }
        return () => undefined;
      },
    });
  }
}
var db = sharedDb || makeDbFallback();
// 数据层可用性：sqlite（桌面）或 jsondb（手机/降级）都视为"有库"。
// 只有两者皆无（极端故障）才走"数据库不可用"分支。
var hasDb = !!sharedDb || db.__jsondb === true;
// 空会话清理模块（判据与选集都有测试）—— 与前端共用 src/shared/sessionCleanup.ts
var CLEANUP_MOD = (() => { try { return require("./src/shared/sessionCleanup.cjs"); } catch (e) { console.error("sessionCleanup.cjs load failed:", e.message); return null; } })();
// 工具参数校验（严格化）：规格表 + 覆盖提醒，见 shared/toolArgs（有测试）
var ARGS_MOD = (() => { try { return require("./src/shared/toolArgs.cjs"); } catch (e) { console.error("toolArgs.cjs load failed:", e.message); return null; } })();
// 公告解析（GitHub 仓库 docs/notice.md → 进应用自动读取显示）
var ANNOUNCE_MOD = (() => { try { return require("./src/shared/announcement.cjs"); } catch (e) { console.error("announcement.cjs load failed:", e.message); return null; } })();
// 联网搜索域（Bing/DDG/SearXNG/Electron 多引擎聚合 + 缓存）
var SEARCH_MOD = (() => { try { return require("./src/shared/websearch.cjs"); } catch (e) { console.error("websearch.cjs load failed:", e.message); return null; } })();
// TTS 域（系统语音兜底 + 多格式缓存）
var TTS_MOD = (() => { try { return require("./src/shared/tts.cjs"); } catch (e) { console.error("tts.cjs load failed:", e.message); return null; } })();
var ttsExecFile = util.promisify(cp.execFile);
// 真实技能市场（anthropics/skills 官方 + superpowers 社区）的纯逻辑：frontmatter 解析、白名单、限额
var SKILL_MARKET_MOD = (() => { try { return require("./src/shared/skillMarket.cjs"); } catch (e) { console.error("skillMarket.cjs load failed:", e.message); return null; } })();
var TOOL_SPECS = ARGS_MOD ? ARGS_MOD.TOOL_SPECS : {};
var validateArgs = ARGS_MOD ? ARGS_MOD.validateArgs : () => ({ ok: true });
var overwriteWarning = ARGS_MOD ? ARGS_MOD.overwriteWarning : () => null;
// 空会话清理：应用每次冷启动建一个默认对话，用户没打字就留下"新对话"。
// 反复启动会让侧栏被几十条空会话淹没，且界面上与真实会话无从分辨。
//
// 时机很关键：原先只在启动时跑一次。实测发现用户可能几天不重启应用
// （app.asar 是 10/16 的，到 10/18 仍在跑同一个进程），于是空会话一直
// 堆着、清理从没执行过。现在改为「启动时 + 每小时」都跑。
//
// 保护集：调用方传入"当前打开的会话"，避免清掉用户正在看的那条。
function runEmptyCleanup(protectIds) {
  try {
    if (!CLEANUP_MOD || !sharedDb || typeof sharedDb.listSessions !== "function") return 0;
    if (typeof sharedDb.messageCounts !== "function") return 0;
    var all = db.listSessions() || [];
    // messageCounts() 只返回"有消息"的会话，零消息的会话不在结果里。
    // 必须按会话列表补齐缺失项为 0，否则它们会被 isEmptySession 的
    // "缺计数不误删"规则判成非空，清理永远删不到东西。
    var raw = sharedDb.messageCounts();
    var counts = new Map();
    for (var s of all) {
      var id0 = String(s.id);
      counts.set(id0, Number(raw[id0] || 0));
    }
    var empties = all.filter(function (s) { return counts.get(String(s.id)) === 0; });
    if (!CLEANUP_MOD.shouldCleanup(empties.length)) return 0;
    var ids = CLEANUP_MOD.pickEmptySessions(all, counts, protectIds || new Set(), empties.length);
    for (var id of ids) { try { db.deleteSession(id); } catch (e) {} }
    if (ids.length) console.log("已清理空会话:", ids.length);
    return ids.length;
  } catch (e) { console.error("空会话清理失败:", e.message); return 0; }
}
// 启动时跑一次（此刻还没有用户打开的 tab，保护集为空）
var _EMPTY_CLEANUP = runEmptyCleanup(new Set());
// AI 角色模块（预置角色 / 免责声明 / 系统提示构造）—— 与前端共用 src/shared/personas.ts
// OpenCode Zen 免费车道：请求构造与判定（与前端共用 src/shared/opencodeZen.ts）
var ZEN_MOD = (() => { try { return require("./src/shared/opencodeZen.cjs"); } catch (e) { console.error("opencodeZen.cjs load failed:", e.message); return null; } })();
var isZenBase = ZEN_MOD ? ZEN_MOD.isZenBase : () => false;
var zenEndpoint = ZEN_MOD ? ZEN_MOD.zenEndpoint : () => "/chat/completions";
var zenHeaders = ZEN_MOD ? ZEN_MOD.zenHeaders : () => ({});
var zenBody = ZEN_MOD ? ZEN_MOD.zenBody : (_m, b) => b;
var chatToResponsesShape = ZEN_MOD ? ZEN_MOD.chatToResponsesShape : (b) => b;
var mintSessionId = ZEN_MOD ? ZEN_MOD.mintSessionId : () => "";
var mintRequestId = ZEN_MOD ? ZEN_MOD.mintRequestId : () => "";
var withFingerprintTools = ZEN_MOD ? ZEN_MOD.withFingerprintTools : (t) => t;
var PERSONA_MOD = (() => { try { return require("./src/shared/personas.cjs"); } catch (e) { console.error("personas.cjs load failed:", e.message); return null; } })();
var PRESET_PERSONAS = PERSONA_MOD ? PERSONA_MOD.PRESET_PERSONAS : [];
var PERSONA_DISCLAIMER = PERSONA_MOD ? PERSONA_MOD.DISCLAIMER : { disclaimer: [], privacy: [] };
// QQ 官方机器人 AccessToken 缓存（2 小时有效）：必须活在模块级，
// 放在请求 handler 里等于每次请求都重新换取，缓存永不命中
var qqTokenCache = { key: "", token: "", expiresAt: 0 };
var PORT = parseInt(process.env.PORT || "3211");
// ─── 仅限 App 内访问（v12.2）──────────────────────────────────────────────
// 这个应用本质是"本地网页"，但桌面窗口打开的是 http://localhost:3211，
// 于是同一台机器上任何浏览器/任何网页都能直接访问它——包括读走 API Key、
// 调 /api/tools/execute 执行任意命令。
//
// 对策：主进程每次启动生成一个随机令牌，注入 APP_UI_TOKEN 环境变量，
// 并把窗口导航到 http://localhost:3211/?app=<token>。
// 前端首次带上这个 token 后换成 HttpOnly Cookie 并跳回干净 URL；
// 没有 token 的浏览器访问（含地址栏手输、其他程序、恶意页面）一律回拦截页。
//
// 为什么不用"只绑 127.0.0.1"：那只能挡局域网，挡不住本机浏览器，
// 而用户要的正是"不要在 App 外面打开"。
// 为什么还保留 LAN 远程：远程分享走单独配对码门卫，与这条路径互不影响。
var APP_UI_TOKEN = String(process.env.APP_UI_TOKEN || "");
// 未注入时（独立跑 node serve.cjs / 测试）不做 App 限制，否则无法调试
var APP_UI_ONLY = APP_UI_TOKEN.length >= 16;
var UI_COOKIE = "jt_ui";
var MAX_OUT = 512 * 1024;
var DIST = path.join(__dirname, "dist");
var MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
var IS_WIN = process.platform === "win32";

// 安卓判定（v13.8.1）：linux 内核 + /system/bin 是 Android 特征。
// 安卓没有 zsh/bash（本地版 APK 里也没有 Termux），只有系统 toybox sh。
var IS_ANDROID = process.platform === "linux" && (function () { try { return fs.existsSync("/system/bin/sh"); } catch { return false; } })();
// 各平台执行命令的 shell：安卓 sh（toybox）、mac/linux zsh、win powershell
var SHELL_BIN = IS_ANDROID ? "sh" : (IS_WIN ? "powershell.exe" : "zsh");
function shellArgs(command) {
  if (IS_WIN) return ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + command];
  return ["-c", command];
}
var USER_HOME = process.env.HOME || process.env.USERPROFILE || (IS_WIN ? "C:\\Users" : os.homedir());
// macOS 的 os.tmpdir() 是 /var/folders/…，不在原来的白名单里——工具读临时
// 文件会被"路径不允许"挡住（写测试时才暴露：原先用硬编码 /tmp 碰巧能过）。
// Windows 的 temp 在 %USERPROFILE%\AppData\Local\Temp，但 CI runner 上
// TEMP/TMP 可能指向别处（或 USERPROFILE 未注入子进程），靠前缀推断不可靠。
// 直接把 os.tmpdir() 加进白名单——这是权威来源，比任何猜测都稳。
var ALLOWED = [USER_HOME, "/tmp", "/Users", "/opt", "/usr/local", os.tmpdir()];
if (!IS_WIN && fs.existsSync("/var/folders")) ALLOWED.push("/var/folders");
// 目录包含判断必须带路径分隔符，否则 /Users/evilx 会被 /Users 前缀放行
var ok = (p) => {
  const rp = path.resolve(p);
  return ALLOWED.some((b) => {
    const rb = path.resolve(b);
    if (rp === rb || rp.startsWith(rb + path.sep)) return true;
    // Windows 文件系统不区分大小写：USERPROFILE 是 C:\Users\me，模型常写
    // c:\users\me，逐字比较会把合法路径挡成「路径不允许」。
    // 只在 Win 上放宽——POSIX 大小写敏感，/Users/a 不能因此摸到 /users。
    if (IS_WIN) {
      const lr = rp.toLowerCase(), lb = rb.toLowerCase();
      return lr === lb || lr.startsWith(lb + "\\");
    }
    return false;
  });
};
// 技能/记忆等以名称作为目录名的场景，统一白名单清洗，杜绝 ../ 穿越
var sanitizeName = (n) => String(n || "").replace(/[^a-z0-9_-]/gi, "_").replace(/^_+|_+$/g, "").slice(0, 64);
// 解析后强制校验目标仍在基准目录内（防御 symlink/编码组合）。
// 名称被清洗即说明含非法字符（../、/、中文等），直接拒绝而非静默改写——
// 静默改写会让「删除 ../../x」返回成功却什么都没删，调用方无法感知
function resolveWithin(baseDir, name) {
  const raw = String(name || "");
  const clean = sanitizeName(raw);
  if (!clean || clean !== raw) return null;
  const base = path.resolve(baseDir);
  const full = path.resolve(base, clean);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}
// ─── SSRF 防护（web_fetch / http_request 共用）───
// 这两个工具的 URL 来自模型输出，而模型输出可能被网页内容里的指令污染。
// 不设防时可以被诱导去打：
//   · 169.254.169.254 云元数据接口（偷临时凭证）
//   · 127.0.0.1:3211 本应用自己的管理接口（本地请求不带 Origin 门卫限制，
//     能读到 /api/settings 里的 API Key）
//   · 内网其他主机（扫端口、打内部服务）
var isIpLiteral = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(":");
var isPrivateIp = (ip) => {
  var s = String(ip || "").toLowerCase().replace(/^::ffff:/, "").replace(/^\[|\]$/g, "");
  if (s.includes(":")) {
    if (s === "::1" || s === "::") return true;
    var head = s.split(":")[0] || "0";
    var h = parseInt(head, 16);
    if (isNaN(h)) return true; // 解析不了按私有处理，宁枉勿纵
    if ((h & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
    if ((h & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
    if ((h & 0xff00) === 0xff00) return true; // 组播
    return false;
  }
  var p = s.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  var a = p[0], b = p[1];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // 链路本地 / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // 组播与保留段
  // 有意不拦 198.18.0.0/15 等基准/文档段：Clash、Surge 等代理工具的
  // fake-IP 模式正是用 198.18.x.x 承载被劫持的域名，拦了会让这类用户的
  // web_fetch 全部失效；而这些段里也没有 SSRF 真正想要的目标
  return false;
};
// 返回规范化后的 URL；不合法则抛错（调用方统一转成 {success:false, error}）
async function assertFetchableUrl(rawUrl) {
  var u;
  try { u = new URL(String(rawUrl || "")); } catch { throw new Error("URL 不合法"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("仅支持 http/https 链接");
  var host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new Error("缺少主机名");
  var port = u.port ? parseInt(u.port, 10) : (u.protocol === "https:" ? 443 : 80);
  // 本应用自己的管理接口：域名解析到哪儿都拦（端口即身份）
  var isLocalName = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  if (isLocalName && port === PORT) throw new Error("不允许访问本应用自身的管理接口");
  if (isIpLiteral(host)) {
    if (isPrivateIp(host)) throw new Error("不允许访问内网或本机地址");
    return u;
  }
  var addrs = await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("域名无法解析");
  for (var one of addrs) if (isPrivateIp(one.address)) throw new Error("目标主机解析到内网或本机地址，已阻止（防 SSRF）");
  // 已知边界：解析后到真正发起请求之间存在 DNS 重绑定窗口（TOCTOU）。
  // 彻底封死需要把连接钉到已校验的 IP 上，本地工具场景先以这道屏障为主
  return u;
}
// 带 SSRF 校验的有界重定向跟随：仍然自动跟随跳转（否则大量站点直接不可用），
// 但每一跳都重新过一遍 assertFetchableUrl——否则一个公网 URL 302 到
// 169.254.169.254 就把前面的防护全部绕过了
async function fetchGuarded(startUrl, opts) {
  var cur = new URL(startUrl);
  for (var hop = 0; hop < 6; hop++) {
    await assertFetchableUrl(cur.toString());
    var r = await fetch(cur, { ...opts, redirect: "manual" });
    var loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      cur = new URL(loc, cur);
      continue;
    }
    return r;
  }
  throw new Error("重定向次数过多");
}
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
  //
  // v12.2 收紧：原来 `localhost(?:\d+)?` 放行**任意端口**——用户本机任何
  // 开发服务器（localhost:3000/8080/…）上跑的页面都能 fetch 到本应用并读走
  // API Key。现在只认本应用自己的端口（PORT），以及远程配对时与 Host 一致
  // 的情形（下面两条 host 判断仍保留）。
  var localRe = new RegExp("^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):" + PORT + "$", "i");
  if (localRe.test(o)) return true;
  // 无端口写法（http://localhost）只可能指向 80 端口，与 PORT 不同，不再放行
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
// 请求体读取带 32MB 上限：防止畸形/恶意请求把主进程内存打满(主进程 OOM 会连带整个应用崩溃)
var BODY_LIMIT = 32 * 1024 * 1024;
var body = async (req) => {
  const b = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > BODY_LIMIT) {
      req.destroy(); // 立即断连，停止继续读入内存
      const err = new Error("请求体过大");
      err.statusCode = 413;
      throw err;
    }
    b.push(c);
  }
  return JSON.parse(Buffer.concat(b).toString() || "{}");
};
// Windows 黑名单补 PowerShell 形态(cmd 形态对 PS 无效,之前的列表漏了整个 PS 面)
var BLOCKED = IS_WIN ? ["format c:", "del /f /s /q c:\\", "rd /s /q c:\\", "diskpart", "shutdown /s", "shutdown /r",
  "remove-item -path c:\\ -recurse", "remove-item c:\\windows", "rmdir /s", "cipher /w",
  "stop-process -id 0", "remove-item $env:systemroot"] : ["rm -rf /", "mkfs", "dd if=", ":(){:|:&};:", "chmod -R 777 /", "> /dev/sda", "format", "shutdown"];
/** execFile 的超时选项：SIGTERM 后若进程不理会，5 秒后升级 SIGKILL */
function shellExecOpts(timeoutSec) {
  return {
    timeout: timeoutSec * 1e3,
    maxBuffer: MAX_OUT,
    killSignal: "SIGTERM",
    // Windows 上必须补全 PATH。GUI 启动的 Electron 继承的是系统精简 PATH
    // （只有 System32 等），没有用户 PATH——于是 npm / node / git 全部
    // 找不到，命令以 "command not found" 失败。这是 Windows 上「指令无法执行」
    // 的头号根因：模型看到的是命令失败，于是声称无法调用工具。
    env: shellEnv(),
  }
}

/**
 * 取一份完整 PATH 的环境变量（只在 Windows 上需要，其他平台原样透传）。
 *
 * 做法：从注册表读用户的 PATH（HKCU\\Environment）与系统 PATH
 * （HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment），
 * 拼到进程 PATH 前面。读不到就退回进程 PATH——至少不更糟。
 *
 * 用 powershell 读注册表而不是 winapi 包：零新依赖，且 powershell 在
 * Windows 上必然存在（shell 已经在用它）。
 */
var _shellEnvCache = null;
function shellEnv() {
  if (!IS_WIN) return process.env;
  if (_shellEnvCache) return _shellEnvCache;
  var base = process.env.PATH || "";
  try {
    var cp = require("child_process");
    var r = cp.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')"
    ], { encoding: "utf8", timeout: 8000 });
    var extra = String(r || "").trim();
    if (extra) {
      var seen = {};
      var parts = (extra + ";" + base).split(";").map(function (s) { return s.trim().replace(/[\\/]+$/, ""); })
        .filter(function (s) { if (!s || seen[s.toLowerCase()]) return false; seen[s.toLowerCase()] = 1; return true; });
      base = parts.join(";");
    }
  } catch (e) { /* 读不到注册表就用进程 PATH，至少不比原来差 */ }
  _shellEnvCache = Object.assign({}, process.env, { PATH: base });
  return _shellEnvCache;
}

/* ─── 后台 shell（长驻进程：dev server / watch / 构建）───
 * 前台 shell 有超时上限，长驻进程不该阻塞对话。这里维护一组受管子进程：
 * 输出累积在环形缓冲（防内存无限增长），由 shell_output 增量读取、
 * shell_kill 终止。进程退出后保留一段时间供最后读取，再自动清理。
 */
var BG_SHELLS = new Map();
var BG_MAX = 12                 // 同时最多 12 个后台任务，超了拒绝（防泄漏）
var BG_OUTPUT_CAP = 200000      // 每个任务保留最近 200KB 输出
var BG_EXIT_TTL = 10 * 60 * 1000 // 退出后保留 10 分钟

function startBackgroundShell(command, cwd, label) {
  if (BG_SHELLS.size >= BG_MAX) {
    const oldest = [...BG_SHELLS.entries()].filter(([, s]) => s.exited).sort((a, b) => a[1].exitedAt - b[1].exitedAt)[0]
    if (oldest) BG_SHELLS.delete(oldest[0])
    else return { success: false, error: `后台任务已达上限（${BG_MAX} 个），请先用 shell_kill 结束不需要的任务` }
  }
  const id = `sh_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const [bin, args] = IS_WIN
    ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`]]
    : [SHELL_BIN, shellArgs(command)]
  let child
  try {
    // PATH 必须用补全后的 env：后台进程同样是 GUI 启动的 Electron 子进程，
    // 不补 PATH 的话 dev server / watch 起不来（前台已修，这里同步）。
    // TERM=dumb 只对 POSIX shell 有意义，Windows 上忽略即可。
    child = cp.spawn(bin, args, { cwd, env: IS_WIN ? shellEnv() : { ...shellEnv(), TERM: "dumb" } })
  } catch (e) {
    return { success: false, error: `启动失败: ${e.message}` }
  }
  const state: {
    id: string; command: string; label: string; cwd: string; startedAt: number;
    exited: boolean; exitCode: number | null; exitSignal: string | null; exitedAt: number;
    chunks: Buffer[]; totalBytes: number; readAt: number; child: ReturnType<typeof cp.spawn>;
  } = {
    id, command, label: String(label || "").slice(0, 80), cwd,
    startedAt: Date.now(), exited: false, exitCode: null, exitSignal: null, exitedAt: 0,
    chunks: [], totalBytes: 0, readAt: 0, child,
  }
  const push = (buf) => {
    state.chunks.push(buf)
    state.totalBytes += buf.length
    // 环形裁剪：保留最近 BG_OUTPUT_CAP，丢弃最旧
    let over = state.totalBytes - BG_OUTPUT_CAP
    while (over > 0 && state.chunks.length > 1) {
      const dropped = state.chunks.shift()
      state.totalBytes -= dropped.length
      over -= dropped.length
    }
  }
  child.stdout?.on("data", push)
  child.stderr?.on("data", push)
  child.on("error", (e) => push(Buffer.from(`\n[spawn error] ${e.message}\n`)))
  child.on("close", (code, signal) => {
    state.exited = true
    // 被信号杀死时 code 为 null，只报 null 会让人以为异常退出；记下信号名
    state.exitCode = code
    state.exitSignal = signal || null
    state.exitedAt = Date.now()
    setTimeout(() => { BG_SHELLS.delete(id) }, BG_EXIT_TTL)
  })
  BG_SHELLS.set(id, state)
  return {
    success: true,
    output: `已在后台启动（id: ${id}）。用 shell_output 查看输出、shell_kill 终止。命令：${command.slice(0, 120)}`,
  }
}

function shell_output(a) {
  const s = BG_SHELLS.get(String(a.id || ""))
  if (!s) return { success: false, error: `后台任务不存在（${a.id}）：可能已结束并被清理` }
  const text = Buffer.concat(s.chunks).toString("utf-8")
  // 增量读取：只返回上次读取之后的新内容，避免模型反复拉全量
  const from = Math.max(0, Number(a.from) || s.readAt || 0)
  const tail = text.slice(from)
  s.readAt = text.length
  const status = s.exited
    ? (s.exitSignal ? `已被信号终止（${s.exitSignal}）` : `已退出（code ${s.exitCode}）`)
    : "运行中"
  return {
    success: true,
    output: JSON.stringify({
      status, id: s.id, command: s.command.slice(0, 120),
      running_ms: (s.exited ? s.exitedAt : Date.now()) - s.startedAt,
      total_chars: text.length, next_from: text.length,
      output: tail.slice(0, MAX_OUT),
      truncated: tail.length > MAX_OUT,
    }, null, 2),
  }
}

function shell_kill(a) {
  const s = BG_SHELLS.get(String(a.id || ""))
  if (!s) return { success: false, error: `后台任务不存在（${a.id}）` }
  if (s.exited) { BG_SHELLS.delete(s.id); return { success: true, output: s.exitSignal ? `任务已被信号终止（${s.exitSignal}），记录已清理` : `任务已退出（code ${s.exitCode}），记录已清理` } }
  try {
    s.child.kill("SIGTERM")
    // 不理会 SIGTERM 的（npm/docker 会自己收尾），3 秒后强杀
    setTimeout(() => { try { if (!s.exited) s.child.kill("SIGKILL") } catch {} }, 3000)
  } catch (e) { return { success: false, error: e.message } }
  return { success: true, output: `已发送终止信号给 ${s.id}` }
}

function shell_list() {
  const rows = [...BG_SHELLS.values()].map((s) => ({
    id: s.id, command: s.command.slice(0, 80),
    status: s.exited ? (s.exitSignal ? `killed(${s.exitSignal})` : `exited(${s.exitCode})`) : "running",
    running_ms: (s.exited ? s.exitedAt : Date.now()) - s.startedAt,
  }))
  return { success: true, output: JSON.stringify({ count: rows.length, shells: rows }, null, 2) }
}

async function shell(a) {
  if (!a.command) return { success: false, error: "无命令" };
  const n = a.command.toLowerCase();
  if (BLOCKED.some((b) => n.includes(b))) return { success: false, error: "已阻止" };
  const cwd = safeCwd(a.workdir);
  // 超时上限：模型偶尔会传超大 timeout（如 99999 秒）把对话挂住；
  // 上限 10 分钟，同时下限 1 秒防止 0 被当成"无超时"
  const timeoutSec = Math.min(Math.max(Number(a.timeout) || 30, 1), 600);

  // 后台模式：长驻进程（dev server、watch、构建）不该阻塞对话。
  // 返回 shellId，由 shell_output / shell_kill 后续查看与终止。
  if (a.background) {
    return startBackgroundShell(a.command, cwd, a.name)
  }

  try {
    let r;
    if (IS_WIN) {
      // Windows:PowerShell。两件事必须做:
      // 1) 前置 [Console]::OutputEncoding=UTF8 — PS5.1 默认按系统 ANSI 码页(GBK)输出,
      //    Node 按 UTF-8 解码会乱码;常量前缀不引入注入面。
      // 2) -NoProfile 避免用户 profile 拖慢/污染输出。
      const wrapped = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${a.command}`;
      // 注意：不能在这里写 env: process.env——那会覆盖 shellExecOpts 里
      // 补全过的 PATH，让 npm/node/git 又变回"找不到命令"。
      // encoding 走 opts 保证 stdout 是字符串而不是 Buffer。
      r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", wrapped],
        { ...shellExecOpts(timeoutSec), cwd });
    } else {
      // zsh 分支保留 TERM=dumb（去掉颜色控制符），但用补全后的 env
      r = await execAsync(SHELL_BIN, shellArgs(a.command), { ...shellExecOpts(timeoutSec), env: { ...shellEnv(), TERM: "dumb" }, cwd });
    }
    const outStr = String(r.stdout ?? "");
    const errStr = String(r.stderr ?? "");
    return { success: true, output: outStr.trim() + (errStr.trim() ? `\n[stderr]\n${errStr.trim()}` : "") };
  } catch (e) {
    // execFile 的 e.stdout / e.stderr 可能是 Buffer（execAsync 的 encoding
    // 选项在部分平台不生效），直接塞进 JSON 会变成乱码或 {type:'Buffer'}。
    // 统一转成字符串。
    const out = String(e.stdout ?? "");
    const err = String(e.stderr ?? "");
    // 超时的错误信息必须可辨识：默认的 "Command failed: xxx" 让人分不清
    // 是命令本身失败还是被超时中断，模型会据此做出错误判断（比如以为
    // 命令语法有误而反复改参数重试）
    const killed = e.killed === true || e.signal === "SIGTERM" || /timed?\s*out/i.test(String(e.message || ""));
    if (killed) {
      return {
        success: false,
        output: out,
        error: `命令超时（${timeoutSec} 秒）已被中断。若任务确实需要更久，请拆分执行；`
          + `若是长驻进程（如 dev server），请改用后台方式启动。`,
      };
    }
    // 关键：非超时失败必须把 stderr 原样回给模型。
    // 只回 e.message（形如 "Command failed: npm ERR!"）时，模型看不到
    // 真实报错，就会声称「我无法调用工具」然后换一种方式再试——
    // 这是 Windows 上观感极差的直接原因之一。
    const detail = err.trim() || String(e.message || e);
    return { success: false, output: out, error: `命令执行失败：\n${detail.slice(0, 4000)}` };
  }
}
async function read_file(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  // 路径是目录时不能直接 readFile（会抛 EISDIR）。实测复现：模型传
  // about_me.html，但该路径当时是目录（如网页另存为时生成的同名文件夹），
  // 直接读崩成 EISDIR，模型无从判断该读哪个文件。
  // 改为：列出目录内容 + 若目录里就有同名文件则直接读出来（省一轮往返）。
  let st;
  try { st = await fsp.stat(p); } catch (e) { return { success: false, error: e.message }; }
  if (st.isDirectory()) {
    try {
      const entries = await fsp.readdir(p, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name + "/");
      // 目录里正好有同名文件（about_me.html/about_me.html）→ 直接读它
      const base = path.basename(p);
      const sameName = files.find((f) => f.toLowerCase() === base.toLowerCase());
      if (sameName) {
        const samePath = path.join(p, sameName);
        // 同一条大文件保护（与正常读取路径一致），否则这条路会绕开限制
        const sameSize = (await fsp.stat(samePath)).size;
        if (sameSize > 2 * 1024 * 1024) {
          return {
            success: false,
            error: `目录内同名文件 ${sameName} 过大（${(sameSize / 1048576).toFixed(1)} MB），请改用 offset/limit 分段读取。`,
          };
        }
        let c = await fsp.readFile(samePath, "utf-8");
        if (a.offset || a.limit) {
          const ls = c.split("\n");
          c = ls.slice((a.offset || 1) - 1, a.limit ? (a.offset || 1) - 1 + a.limit : ls.length).join("\n");
        }
        return { success: true, output: c.slice(0, MAX_OUT), note: `（自动读取目录内同名文件 ${sameName}）` };
      }
      const listing = [...dirs.sort(), ...files.sort()];
      return {
        success: false,
        isDirectory: true,
        error: `"${a.path}" 是目录，不是文件。请从下面挑一个具体文件再读：\n${listing.slice(0, 60).join("\n") || "（空目录）"}`,
      };
    } catch (e) {
      return { success: false, error: `读取目录失败: ${e.message}` };
    }
  }
  try {
    // 大文件保护：整文件读进内存再截断，读一个几百 MB 的日志会把进程内存
    // 打满（实测风险）。先看 stat 大小，超限就不读，并告诉模型怎么分段取。
    const size = st.size;
    const MAX_READ = 2 * 1024 * 1024;   // 2MB：足够覆盖源码与文档
    if (size > MAX_READ) {
      const lines = await (async () => {
        try { const fh = await fsp.open(p, "r"); const buf = Buffer.alloc(64 * 1024); await fh.read(buf, 0, buf.length, 0); await fh.close(); return buf.toString("utf-8").split("\n").length; } catch { return 0 }
      })();
      return {
        success: false,
        error: `文件过大（${(size / 1048576).toFixed(1)} MB），直接读取会占用大量内存与上下文。`
          + `请改用 offset/limit 分段读取（如 offset: 1, limit: 200），或先用 search_content 定位再读指定区域。`
          + (lines ? `\n（文件首 64KB 约 ${lines} 行）` : ""),
      };
    }
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

/**
 * 原子写入：先写同目录临时文件，再 rename 覆盖目标。
 *
 * 直接 writeFile 在写入中途断电/崩溃会留下半截文件——原内容已丢、新内容
 * 不完整，对用户代码是数据损坏。rename 在同一文件系统内是原子操作，
 * 要么看到旧内容、要么看到完整新内容。
 *
 * 同目录放临时文件是必须的：跨文件系统的 rename 会退化成拷贝+删除，
 * 又变回非原子。
 */
async function writeFileAtomic(target, content) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await fsp.writeFile(tmp, content, "utf-8");
    await fsp.rename(tmp, target);
  } catch (e) {
    // 失败时清掉临时文件，不在用户目录里留垃圾
    try { await fsp.unlink(tmp); } catch {}
    throw e;
  }
}

async function write_file(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    let __old = "";
    let existed = false;
    try { __old = await fsp.readFile(p, "utf-8"); existed = true; } catch {}
    await writeFileAtomic(p, a.content);
    const __chg = recordChange(p, __old, String(a.content || ""));
    // 覆盖提醒：不清空、不阻断（模型常常就是要改文件），只把风险说清楚，
    // 让它有机会在回复里说明改了什么
    const warn = existed ? overwriteWarning(true, __old.length, String(a.content || "").length) : null;
    return { success: true, output: `\u2705 \u5DF2\u5199\u5165: ${p}${warn ? `\n${warn}` : ""}`, changeId: __chg };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function edit_file(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    let c = await fsp.readFile(p, "utf-8");
    if (!c.includes(a.oldText)) {
      // 精确匹配失败通常有三种原因：文件被外部改动、oldText 抄写有出入
      // （缩进/换行/全角空格）、或需要替换的区域已被前一次编辑改掉。
      // 只回「未找到」模型会反复重试同一参数，这里给出可操作的下一步。
      const firstLine = String(a.oldText || "").split("\n")[0].slice(0, 60);
      return {
        success: false,
        error: `未找到要替换的文本。可能原因：文件已被外部修改、oldText 与原文有细微差异（缩进/换行/空格），或该处已被之前的编辑改掉。`
          + `建议先 read_file 重新确认当前内容。匹配串首行：「${firstLine}」`,
      };
    }
    const __oldFull = c;
    // replaceAll：模型常期望替换所有匹配（重命名变量、统一改一处写法）。
    // 默认仍只替换第一处，避免意外改动；需要全局时显式传 replaceAll
    c = a.replaceAll
      ? c.split(a.oldText).join(a.newText)
      : c.replace(a.oldText, a.newText);
    await writeFileAtomic(p, c);
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
async function screenshot(_a) {
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
      // 参数一律走环境变量，不拼进命令文本：pattern 来自模型输出，
      // 直接插进 "..." 里的话 `"$(calc)"`、反引号、引号都会被执行/截断
      // （引号截断后还能接上任意命令）。env 展开不会被当代码重新求值。
      const cmd = "Get-ChildItem -Path $env:JT_DIR -Filter $env:JT_PATTERN -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 100 -ExpandProperty FullName";
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd],
        { timeout: 15e3, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_DIR: d, JT_PATTERN: String(a.pattern || "*") } });
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
      // 同 search_files：pattern 走 env，不拼进命令文本（见那里的说明）
      const cmd = "Get-ChildItem -Path $env:JT_DIR -Recurse -File -ErrorAction SilentlyContinue | Select-String -Pattern $env:JT_PATTERN -List | Select-Object -First 20 -ExpandProperty Path";
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd],
        { timeout: 15e3, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_DIR: d, JT_PATTERN: String(a.pattern || "") } });
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
    const p = resolveWork(a.path);
    if (!ok(p)) return { success: false, error: "路径不允许" };
    const s = await fsp.stat(p);
    return { success: true, output: JSON.stringify({ size: s.size, type: s.isFile() ? "file" : "directory", modified: s.mtime.toISOString() }, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function move_file(a) {
  const s = resolveWork(a.src), d = resolveWork(a.dest);
  if (!ok(s) || !ok(d)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    // 源必须存在且不是目录：否则 rename 会抛含糊的 ENOENT/EISDIR
    let sst;
    try { sst = await fsp.stat(s); }
    catch { return { success: false, error: `源路径不存在：${s}` }; }
    if (sst.isDirectory()) {
      return { success: false, error: `源路径是目录（${s}），move_file 只移动文件。目录请用 shell 的 mv 并说明意图。` };
    }
    // 目标已存在时不再静默覆盖（rename 会直接盖掉同名文件，原文件就没了）。
    // 这是实测风险点：模型以为在"移动"，实际把目标文件毁掉了。
    let destExists = false;
    try { await fsp.stat(d); destExists = true; } catch {}
    if (destExists) {
      return {
        success: false,
        error: `目标已存在：${d}。移动会覆盖它，已中止。`
          + `若确实要覆盖，请先用 delete_file 删除目标，或改用新文件名。`,
      };
    }
    await fsp.mkdir(path.dirname(d), { recursive: true });
    await fsp.rename(s, d);
    return { success: true, output: `\u2705 ${s} \u2192 ${d}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function delete_file(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "\u8DEF\u5F84\u4E0D\u5141\u8BB8" };
  try {
    // 目录要走 unlink 会报 EISDIR，模型看不懂；明确告诉它该怎么删目录
    let st;
    try { st = await fsp.stat(p); }
    catch { return { success: false, error: `路径不存在：${p}` }; }
    if (st.isDirectory()) {
      return {
        success: false,
        error: `"${p}" 是目录，delete_file 只删文件。`
          + `删除目录（含其中内容）请用 shell: rm -rf "${p}"，并先确认里面没有要保留的东西。`,
      };
    }
    await fsp.unlink(p);
    return { success: true, output: `\u2705 \u5DF2\u5220\u9664: ${p}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function web_fetch(a) {
  try {
    await assertFetchableUrl(a.url);
    const r = await fetchGuarded(a.url, { headers: { "User-Agent": "LaoyouAgent/1.0" }, signal: AbortSignal.timeout(2e4) });
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
    await assertFetchableUrl(a.url);
    const r = await fetchGuarded(a.url, { method: a.method || "GET", headers: { "Content-Type": "application/json" }, body: a.body, signal: AbortSignal.timeout(2e4) });
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
  const p = resolveWork(a.path);
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
      // env: shellEnv() 是必须的——GUI 启动的 Electron 继承的是精简 PATH，
      // 不补全的话 Get-Command 会把 node/npm/git 全报成 no，模型据此
      // 以为环境里没工具，于是声称"我无法调用工具"（实测根因之一）。
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; foreach ($t in 'node','npm','python','pip','git','docker','go','java') { if (Get-Command $t -ErrorAction SilentlyContinue) { Write-Output \"$t=yes\" } else { Write-Output \"$t=no\" } }"],
        { timeout: 8000, maxBuffer: 65536, env: shellEnv() });
      for (const l of r.stdout.trim().split("\n")) {
        const [k, v] = l.split("=");
        if (k && v) tools[k.trim()] = v.trim() === "yes";
      }
    } else {
      const r = await execAsync(SHELL_BIN, shellArgs('for t in node npm python3 pip3 git brew docker rustc go java ruby; do which $t 2>/dev/null && echo "$t=yes" || echo "$t=no"; done'), { timeout: 5e3, maxBuffer: 65536 });
      for (const l of r.stdout.trim().split("\n")) {
        const [k, v] = l.split("=");
        if (k && v) tools[k.trim()] = v.trim() === "yes";
      }
    }
    return { success: true, output: JSON.stringify({ os: (IS_ANDROID ? "Android " : "") + `${os.platform()} ${os.release()}`, isAndroid: IS_ANDROID, arch: os.arch, cpu: `${os.cpus().length} 核`, memory: `${mu}GB / ${mt}GB`, node: process.version, home: os.homedir(), tools }, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function process_list(a) {
  try {
    let r;
    if (IS_WIN) {
      // Windows:Get-Process;filter 为空时按 CPU 时间取前 40
      // filter 走 env 而不是拼进 '...' 里：单引号转义挡不住 PowerShell 的
      // 字符串展开规则（且这层转义一旦漏改就是命令注入）。
      const ps = a.filter
        ? "$p = $env:JT_FILTER; Get-Process | Where-Object { $_.ProcessName -like \"*$p*\" } | Select-Object -First 30 Id,ProcessName,CPU,WS | Format-Table -AutoSize"
        : "Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Id,ProcessName,CPU,WS | Format-Table -AutoSize";
      r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${ps}`],
        { timeout: 1e4, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_FILTER: String(a.filter || "") } });
    } else if (IS_ANDROID) {
      // 安卓 toybox 的 ps 不支持 aux，用 ps -A + grep（参数同样走 env 防注入）
      const cmd = a.filter ? 'ps -A | grep -i -- "$JT_FILTER" | head -30' : "ps -A | head -40";
      r = await execAsync(SHELL_BIN, shellArgs(cmd), { timeout: 1e4, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_FILTER: String(a.filter || "") } });
    } else {
      // POSIX 侧同样不拼字符串：filter 里带 " 或 $() 会被 shell 展开
      const cmd = a.filter ? 'ps aux | grep -i -- "$JT_FILTER" | head -30' : "ps aux | head -40";
      r = await execAsync(SHELL_BIN, shellArgs(cmd), { timeout: 1e4, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_FILTER: String(a.filter || "") } });
    }
    return { success: true, output: r.stdout.trim() || "(无匹配)" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function port_check(a) {
  try {
    if (IS_WIN) {
      // Windows:netstat -ano 过滤端口(lsof 不存在)。
      // 端口号来自模型输出，先强制成整数——直接拼进 cmd.exe 命令行时
      // 一个 `& calc` 就能接上任意命令。
      const port = Number(a.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { success: false, error: `端口号非法：${a.port}` };
      }
      const r = await execAsync("cmd.exe", ["/c", `netstat -ano | findstr :${port}`], { timeout: 5000, maxBuffer: 65536, encoding: "utf8" });
      const out = r.stdout.trim();
      return { success: true, output: out ? `端口 ${a.port}: 被占用\n${out}` : `端口 ${a.port} 空闲 ✅` };
    }
    if (IS_ANDROID) {
      // 安卓无 lsof：toybox netstat -tlnp 列监听端口（部分设备无 -p 权限，降级仅列端口）
      const port = Number(a.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { success: false, error: `端口号非法：${a.port}` };
      }
      let out = "";
      try {
        const r = await execAsync("netstat", ["-tln"], { timeout: 5e3, maxBuffer: 65536 });
        out = (r.stdout || "").split("\n").filter(l => l.includes(":" + port + " ")).join("\n");
      } catch { out = ""; }
      return { success: true, output: out ? `端口 ${a.port}: 疑似被占用\n${out}` : `端口 ${a.port} 空闲 ✅` };
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
    let d;
    if (a.data.startsWith("file:")) {
      const fp = path.resolve(a.data.slice(5));
      if (!ok(fp)) return { success: false, error: "路径不允许" };
      d = JSON.parse(await fsp.readFile(fp, "utf-8"));
    } else {
      d = JSON.parse(a.data);
    }
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
var REMOTE_MARKET_FILE = path.join(DATA_DIR, "skill_market_remote.json");
var REMOTE_MARKET_TTL = 6 * 3600 * 1000;

// --- 真实市场：GitHub 取数助手（枚举走 Contents API，文件正文走 raw 不占 API 配额） ---
async function ghApiList(repo, dirPath) {
  const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "JutianAgent/1.0" };
  if (process.env.GITHUB_TOKEN) headers["Authorization"] = "Bearer " + process.env.GITHUB_TOKEN;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURI(dirPath)}`, { headers, signal: AbortSignal.timeout(12e3) });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  return r.json();
}
async function ghRawText(repo, filePath) {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${filePath.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { "User-Agent": "JutianAgent/1.0" }, signal: AbortSignal.timeout(12e3),
  });
  if (!r.ok) throw new Error(`raw ${r.status}`);
  return r.text();
}
// 枚举全部市场源 → 归一化条目。单个源失败不影响其他源。
async function fetchRemoteMarketItems() {
  const M = SKILL_MARKET_MOD;
  if (!M) throw new Error("市场模块不可用");
  const items = [];
  for (const src of M.SKILL_SOURCES) {
    try {
      const dirs = await ghApiList(src.repo, src.dir);
      if (!Array.isArray(dirs)) continue;
      const found = await Promise.all(dirs.filter((d) => d.type === "dir").slice(0, 60).map(async (d) => {
        try { return M.normalizeRemoteSkill({ name: d.name, path: d.path }, src, await ghRawText(src.repo, `${d.path}/SKILL.md`)); }
        catch { return null; }
      }));
      for (const it of found) if (it) items.push(it);
    } catch (e) {
      console.error("[skill-market]", src.repo, "拉取失败:", e.message);
    }
  }
  return items;
}

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
    // 名称必须清洗：此前直接 path.join(SKILL_DIR, a.name)，传 "../../.." 可读
    // 任意目录下的 skill.json / SKILL.md（信息泄露，与 uninstall 同类问题）
    const dir = resolveWithin(SKILL_DIR, a.name);
    if (!dir) return { success: false, error: "非法技能名称" };
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
    const rawName = a.name || a.skill_name || "";
    const dir = resolveWithin(SKILL_DIR, rawName);
    if (!dir) return { success: false, error: "非法技能名称" };
    const name = sanitizeName(rawName);
    await fsp.mkdir(dir, { recursive: true });
    // v10.0：优先按市场条目的完整数据安装(元数据/指令/工具全落地)，
    // 市场里没有时才走通用兜底——不再写什么都不干的空壳
    const market = loadMarket();
    const hit = market.find((s) => s.id === name || s.name === a.name);
    if (hit) {
      await fsp.writeFile(path.join(dir, "skill.json"), JSON.stringify({
        name, display_name: hit.name, version: hit.version,
        author: hit.author, description: hit.description, tags: hit.tags,
        tools: hit.tools, installed_at: (/* @__PURE__ */ new Date()).toISOString(),
      }, null, 2));
      writeSkillMd(dir, {
        name, display_name: hit.name, version: hit.version,
        author: hit.author, description: hit.description,
        instructions: hit.instructions, hasTools: !!(hit.tools && hit.tools.length),
      });
      if (hit.tools && hit.tools.length) {
        await fsp.writeFile(path.join(dir, "tools.json"), JSON.stringify(hit.tools, null, 2), "utf-8");
      }
      return { success: true, output: `已安装「${hit.name}」(含完整指令与工具定义)` };
    }
    await fsp.writeFile(path.join(dir, "skill.json"), JSON.stringify({ name, display_name: name, version: "0.1.0", installed_at: (/* @__PURE__ */ new Date()).toISOString() }, null, 2));
    writeSkillMd(dir, { name, description: a.description || "", hasTools: false });
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
  if (hasDb) {
    try {
      if (args.key) return { success: true, output: db.getMemory(args.key) || "(无此记忆)" };
      return { success: true, output: memIndex(db.getAllMemories().filter((r) => !r.key.startsWith("persona:"))) };
    } catch {}
  }
  const mem = loadMem();
  if (args.key) return { success: true, output: mem[args.key] || "(无此记忆)" };
  return { success: true, output: memIndex(Object.entries(mem).map(([key, value]) => ({ key, value }))) };
}
async function write_memory(args) {
  if (!args.key) return { success: false, error: "缺少 key 参数" };
  if (hasDb) { try { db.setMemory(args.key, args.value || ""); return { success: true, output: `已记住: ${args.key} = ${args.value}` }; } catch {} }
  const mem = loadMem();
  mem[args.key] = args.value || "";
  saveMem(mem);
  return { success: true, output: `已记住: ${args.key} = ${args.value}` };
}
async function delete_memory(args) {
  if (!args.key) return { success: false, error: "缺少 key 参数" };
  if (hasDb) { try { db.deleteMemory(args.key); return { success: true, output: `已删除记忆: ${args.key}` }; } catch {} }
  const mem = loadMem();
  delete mem[args.key];
  saveMem(mem);
  return { success: true, output: `已删除记忆: ${args.key}` };
}

// ─── ly-next：旧 JSON 会话/消息一次性导入 SQLite（仅当 SQLite 为空时）───
(() => {
  if (!hasDb) return;
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
    const knownSessions = new Set(db.listSessions().map((s) => s.id));
    const seen = new Set();
    let created = 0, msgCount = 0;
    const pending = [];   // { m, sid }：补登的消息及其所属会话
    for (const s of sessions.items) {
      if (!s || !s.id) continue;
      if (!knownSessions.has(s.id)) { db.createSession(s.id, typeof s.title === "string" ? s.title : "新对话"); created++; }
      const inDb = new Set(db.getMessages(s.id).map((m) => m.id));
      for (const m of (readJson(`messages_${s.id}.json`).items || [])) {
        if (!m || !m.id || inDb.has(m.id) || seen.has(m.id)) continue;
        seen.add(m.id);
        pending.push({ m, sid: s.id });
      }
    }
    if (pending.length > 0) {
      try { db.db.exec("BEGIN"); } catch {}
      for (const { m, sid } of pending) {
        try {
          db.addMessage(m.id, sid, m.role || "user", m.content || "", m.thinking || "", typeof m.tool_calls === "string" ? m.tool_calls : JSON.stringify(m.tool_calls || []), m.tool_call_id || "");
          msgCount++;
        } catch { /* 单条失败不阻断整体迁移 */ }
      }
      try { db.db.exec("COMMIT"); } catch {}
    }
    if (created || msgCount) console.log(`[ly-next] 合并迁移：新增 ${created} 个会话 / ${msgCount} 条消息`);
  } catch (e) { console.error("[ly-next] JSON 合并迁移失败:", e.message); }
})();

// --- 新增工具函数 ---
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ─── 安全策略：从设置实时读取，工具入口强制生效（主对话 + 集群统一）───
function securityConfig() {
  const rows = sharedDb ? db.getAllSettings() : [];
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
// ─── KB 向量缓存（v12.6 性能）──────────────────────────────
// 之前每次搜索 kbAll() 全表加载 + JSON.parse 全部向量（1000 chunk ≈ 数 MB
// 字符串解析，每次搜索都做一遍）。索引只在写入/删除时变化，
// 这里按代数失效：写入/删除时 bump 代数，下次搜索重建缓存。
var _kbCache = { gen: 0, rows: [] };
var _kbGen = 0;
function kbBump() { _kbGen++ }
function kbRowsCached() {
  if (_kbCache.gen !== _kbGen) {
    _kbCache = {
      gen: _kbGen,
      rows: db.kbAll().map((r) => {
        let vec = [];
        try { vec = JSON.parse(r.vector) } catch {}
        return { path: r.path, chunk: r.chunk, vec };
      }),
    };
  }
  return _kbCache.rows;
}

async function kbEmbedFor(texts) {
  const rows = sharedDb ? db.getAllSettings() : [];
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
  db.kbDeleteByPath("entry:" + id); kbBump();
  const body = (title ? title + "\n" : "") + (content || "");
  const chunks = kbChunkText(body);
  let n = 0;
  for (let i = 0; i < chunks.length; i += 16) {
    const batch = chunks.slice(i, i + 16);
    let vecs = [];
    try { vecs = await kbEmbedFor(batch) } catch { break }
    batch.forEach((c, j) => { if (vecs[j]) { db.kbInsert("entry:" + id, c, vecs[j]); n++ } }); kbBump();
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
  const id = args.id || db.genId();
  const links = [];
  for (const lt of linkTitles) {
    const hit = db.getKbEntryByTitle(lt);
    if (hit && hit.id !== id) links.push(hit.id);
  }
  db.upsertKbEntry({
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
      const other = db.getKbEntry(lid);
      if (other && !JSON.parse(other.links || "[]").includes(id)) {
        db.upsertKbEntry({ ...other, links: JSON.stringify([...JSON.parse(other.links || "[]"), id]) });
      }
    } catch { /* ignore */ }
  }
  try { await kbIndexEntry(id, title, content) } catch { /* embedding 失败不阻断写入 */ }
  const backlinks = db.kbBacklinks(id).map((b) => ({ id: b.id, title: b.title }));
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

// 搜索模块不可用时的兜底实现（定义在 TOOLS 块外，避免键扫描误判）
async function searchUnavailableFallback() {
  return { success: false, error: "搜索模块不可用" };
}

var TOOLS = {
  read_file, write_file, edit_file, list_dir, search_files, search_content,
  get_file_info, move_file, delete_file,
  shell, shell_output, shell_kill, shell_list, system_info, process_list, port_check,
  code_analysis, npm_run, git_operation,
  web_fetch, http_request,
  web_search: SEARCH_MOD ? SEARCH_MOD.web_search : searchUnavailableFallback,
  json_process, text_tools, screenshot,
  url_tools, base64_tools, hash_tools,
  uuid_generate, timestamp_tools, random_tools, color_tools, image_generate,
  text_diff, todo_write, find_in_files, file_stats,
  clipboard_read, clipboard_write, open_path, archive,
  list_skills, load_skill, install_skill, create_skill,
  remember, recall, forget,
  save_knowledge: toolSaveKnowledge,
  consult_guidance: consultGuidance
};

/* ─── v12 新工具实现 ─────────────────────────────────────────────
 * 保持与既有工具相同的返回形状 { success, output?, error? }。
 * 路径一律走 resolveWork + ok()（Windows 大小写、白名单边界都在里面）。
 */

async function text_diff(a) {
  const readSide = async (v, isPath) => {
    if (!isPath) return String(v ?? "");
    const p = resolveWork(String(v));
    if (!ok(p)) throw new Error("路径不允许");
    return await fsp.readFile(p, "utf-8");
  };
  try {
    const [oldText, newText] = await Promise.all([
      readSide(a.a, a.aIsPath), readSide(a.b, a.bIsPath),
    ]);
    const ctx = Math.max(0, Math.min(20, Number(a.context) || 3));
    // 简易 LCS diff：按行做最长公共子序列，输出统一格式。
    // 不引第三方 diff 库（体积与依赖风险都不值），这段只处理行级差异。
    const A = oldText.split("\n"), B = newText.split("\n");
    const n = A.length, m = B.length;
    // 内存保护：两边都上千行时退化成逐行对比，避免 O(n*m) 表爆掉
    if (n * m > 4_000_000) {
      const out = [];
      const max = Math.max(n, m);
      for (let i = 0; i < max; i++) {
        if (A[i] === B[i]) { if (A[i] !== undefined) out.push("  " + A[i]); }
        else {
          if (A[i] !== undefined) out.push("- " + A[i]);
          if (B[i] !== undefined) out.push("+ " + B[i]);
        }
      }
      return { success: true, output: out.join("\n").slice(0, MAX_OUT) };
    }
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const lines = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { lines.push([" ", A[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push(["-", A[i]]); i++; }
      else { lines.push(["+" , B[j]]); j++; }
    }
    while (i < n) { lines.push(["-", A[i]]); i++; }
    while (j < m) { lines.push(["+" , B[j]]); j++; }
    // 折叠未变更的长段落
    const out = [];
    let sameRun = 0;
    for (let k = 0; k < lines.length; k++) {
      const [sign, text] = lines[k];
      if (sign === " ") {
        sameRun++;
        // 只保留变更点前后 ctx 行
        const nearChange = (() => {
          for (let d = 1; d <= ctx; d++) {
            if (lines[k - d] && lines[k - d][0] !== " ") return true;
            if (lines[k + d] && lines[k + d][0] !== " ") return true;
          }
          return false;
        })();
        if (nearChange) out.push("  " + text);
        else if (sameRun === ctx + 1) out.push("  …");
      } else {
        sameRun = 0;
        out.push(sign + " " + text);
      }
    }
    const changed = lines.filter((l) => l[0] !== " ").length;
    return { success: true, output: `差异 ${changed} 行\n\n` + (out.join("\n") || "（无差异）").slice(0, MAX_OUT) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function todo_write(a) {
  const list = Array.isArray(a.todos) ? a.todos : [];
  const clean = list.slice(0, 100).map((t) => ({
    content: String(t?.content || "").slice(0, 200),
    status: ["pending", "in_progress", "completed"].includes(t?.status) ? t.status : "pending",
  })).filter((t) => t.content);
  const path = path.join(DATA_DIR, "todos.json");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path, JSON.stringify(clean, null, 1));
  } catch (e) {
    return { success: false, error: `保存待办失败：${e.message}` };
  }
  const done = clean.filter((t) => t.status === "completed").length;
  return { success: true, output: `已保存 ${clean.length} 条待办（完成 ${done} 条 / 进行中 ${clean.filter((t) => t.status === "in_progress").length} 条）` };
}

async function find_in_files(a) {
  const dir = resolveWork(a.path);
  if (!ok(dir)) return { success: false, error: "路径不允许" };
  const limit = Math.max(1, Math.min(500, Number(a.maxResults) || 50));
  if (IS_WIN) {
    const cmd = "$ErrorActionPreference='SilentlyContinue'; "
      + "Get-ChildItem -Path $env:JT_DIR -Recurse -File"
      + (a.include ? " -Filter $env:JT_INCLUDE" : "")
      + " | Select-String -Pattern $env:JT_RE | Select-Object -First $env:JT_LIMIT | ForEach-Object { \"$($_.Path):$($_.LineNumber): $($_.Line.Trim())\" }";
    try {
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
        timeout: 20e3, maxBuffer: MAX_OUT,
        env: { ...shellEnv(), JT_DIR: dir, JT_RE: String(a.pattern || ""), JT_INCLUDE: String(a.include || ""), JT_LIMIT: String(limit) },
      });
      return { success: true, output: r.stdout.trim() || "(无匹配)" };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  const args = ["-rn", "--max-count=1", a.pattern, dir];
  if (a.include) args.push(`--include=${a.include}`);
  try {
    const r = await execAsync("grep", args, { timeout: 20e3, maxBuffer: MAX_OUT, env: shellEnv() });
    const lines = String(r.stdout || "").split("\n").filter(Boolean).slice(0, limit);
    return { success: true, output: lines.join("\n") || "(无匹配)" };
  } catch (e) {
    if (e.code === 1) return { success: true, output: "(无匹配)" };
    return { success: false, error: e.stderr || e.message };
  }
}

async function file_stats(a) {
  const target = resolveWork(a.path);
  if (!ok(target)) return { success: false, error: "路径不允许" };
  const byExt = {};
  let files = 0, dirs = 0, bytes = 0;
  const walk = async (p, depth) => {
    if (depth > 12 || files > 200000) return;
    let entries;
    try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      // 跳过依赖与版本库：统计项目体量时它们只会误导
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      const full = path.join(p, e.name);
      if (e.isDirectory()) { dirs++; await walk(full, depth + 1); }
      else if (e.isFile()) {
        try {
          const st = await fsp.stat(full);
          files++; bytes += st.size;
          const ext = path.extname(e.name).toLowerCase() || "(无扩展名)";
          byExt[ext] = (byExt[ext] || 0) + 1;
        } catch { /* 跳过读不了的文件 */ }
      }
    }
  };
  try {
    const st = await fsp.stat(target);
    if (st.isFile()) {
      return { success: true, output: JSON.stringify({ type: "file", bytes: st.size, human: (st.size / 1024).toFixed(1) + " KB" }, null, 2) };
    }
    await walk(target, 0);
    const top = Object.entries(byExt).sort((x, y) => y[1] - x[1]).slice(0, 15);
    return { success: true, output: JSON.stringify({
      root: target, files, dirs, totalBytes: bytes,
      human: (bytes / 1024 / 1024).toFixed(2) + " MB",
      byExtension: Object.fromEntries(top),
    }, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function clipboard_read() {
  try {
    if (IS_ANDROID) {
      // 安卓没有命令行剪贴板接口（剪贴板由前台应用持有，且需要 Java 层访问）
      return { success: false, error: "安卓端不支持剪贴板读取（系统限制，剪贴板由前台应用持有）。可以直接把内容粘贴到输入框。" };
    }
    if (IS_WIN) {
      const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"], { timeout: 5000, maxBuffer: 1024 * 512, encoding: "utf8", env: shellEnv() });
      return { success: true, output: String(r.stdout || "").slice(0, MAX_OUT) || "(剪贴板为空)" };
    }
    const r = await execAsync("pbpaste", [], { timeout: 5000, maxBuffer: 1024 * 512 });
    return { success: true, output: String(r.stdout || "").slice(0, MAX_OUT) || "(剪贴板为空)" };
  } catch (e) {
    return { success: false, error: `读取剪贴板失败：${e.message}` };
  }
}

async function clipboard_write(a) {
  const text = String(a.text ?? "");
  try {
    if (IS_WIN) {
      // 走 stdin 传文本，避免把任意内容拼进 PowerShell 命令（引号/反引号会被执行）
      await new Promise((resolve, reject) => {
        const cp2 = require("child_process").spawn("powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "$input | Set-Clipboard"],
          { env: shellEnv(), stdio: ["pipe", "ignore", "pipe"] });
        cp2.on("error", reject);
        cp2.on("close", (code) => (code === 0 ? resolve(null) : reject(new Error("Set-Clipboard 失败"))));
        cp2.stdin.write(text);
        cp2.stdin.end();
      });
      return { success: true, output: `已写入剪贴板（${text.length} 字符）` };
    }
    await new Promise((resolve, reject) => {
      const cp2 = require("child_process").spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      cp2.on("error", reject);
      cp2.on("close", (code) => (code === 0 ? resolve(null) : reject(new Error("pbcopy 失败"))));
      cp2.stdin.write(text);
      cp2.stdin.end();
    });
    return { success: true, output: `已写入剪贴板（${text.length} 字符）` };
  } catch (e) {
    return { success: false, error: `写入剪贴板失败：${e.message}` };
  }
}

async function open_path(a) {
  const p = resolveWork(a.path);
  if (!ok(p)) return { success: false, error: "路径不允许" };
  try {
    await fsp.access(p);
  } catch {
    return { success: false, error: `路径不存在：${p}` };
  }
  try {
    if (IS_WIN) {
      const cp2 = require("child_process");
      // start 是 cmd 内建命令，必须经 cmd /c；空标题位避免路径被当成窗口标题
      cp2.spawn("cmd.exe", ["/c", "start", "", p], { detached: true, stdio: "ignore", env: shellEnv() }).unref();
    } else {
      const cp2 = require("child_process");
      cp2.spawn("open", [p], { detached: true, stdio: "ignore" }).unref();
    }
    return { success: true, output: `已用系统默认程序打开：${p}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function archive(a) {
  const src = resolveWork(a.source);
  const dest = resolveWork(a.dest);
  if (!ok(src) || !ok(dest)) return { success: false, error: "路径不允许" };
  if (a.action === "zip") {
    try {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      if (IS_WIN) {
        await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          "Compress-Archive -Path $env:JT_SRC -DestinationPath $env:JT_DEST -Force"],
          { timeout: 120e3, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_SRC: src, JT_DEST: dest } });
      } else {
        // ditto 在 macOS 上保留资源分支与权限；zip 命令在部分文件名上会丢中文
        await execAsync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", src, dest], { timeout: 120e3, maxBuffer: MAX_OUT });
      }
      const st = await fsp.stat(dest);
      return { success: true, output: `已打包：${dest}（${(st.size / 1024 / 1024).toFixed(2)} MB）` };
    } catch (e) {
      return { success: false, error: `打包失败：${e.message}` };
    }
  }
  if (a.action === "unzip") {
    try {
      await fsp.mkdir(dest, { recursive: true });
      if (IS_WIN) {
        await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          "Expand-Archive -Path $env:JT_SRC -DestinationPath $env:JT_DEST -Force"],
          { timeout: 120e3, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_SRC: src, JT_DEST: dest } });
      } else {
        await execAsync("ditto", ["-x", "-k", src, dest], { timeout: 120e3, maxBuffer: MAX_OUT });
      }
      return { success: true, output: `已解压到：${dest}` };
    } catch (e) {
      return { success: false, error: `解压失败：${e.message}` };
    }
  }
  return { success: false, error: "action 只能是 zip 或 unzip" };
}

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
    // 安全响应头（v12.2）：此前完全没有，应用可被任意网页 iframe 嵌入，
    // 也能被当成同源页面加载第三方脚本。
    // frame-ancestors 'none' 是这里最关键的一条——它让"嵌到别人页面里
    // 点按钮"这类点击劫持在浏览器层直接失效。
    // 注：应用自身不加载任何外部脚本（前端产物全在 dist/ 内），
    // 所以 CSP 可以收得比较紧；若将来引入 CDN 需同步放开对应源。
    const secHeaders = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; "
        + "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "   // CodeMirror/Vite 产物需要 eval
        + "style-src 'self' 'unsafe-inline'; "
        + "img-src 'self' data: blob:; "
        + "font-src 'self' data:; "
        + "connect-src 'self'; "
        + "media-src 'self' blob:; "
        + "frame-ancestors 'none'; "
        + "base-uri 'none'; "
        + "form-action 'self'",
    };
    const head = {
      ...secHeaders,
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
          ...secHeaders,
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
// ─── 前端错误收集（供诊断页展示）───
// 渲染层崩溃原先只写 console，用户看不到、报障时也拿不到线索。
// 这里保留最近 50 条（内存，重启即清），诊断页一并返回。
var CLIENT_ERRORS = [];

// ─── 开放本地 API：把本机当成一个 OpenAI 兼容服务，供其它工具调用 ───
// 安全取向见 shared/localApi（有测试）：默认关闭；只认显式生成的 Key；
// 本机 Key 与局域网 Key 互不通用；局域网范围未开时外部请求一律拒绝。
var LOCAL_API_MOD = (() => { try { return require("./src/shared/localApi.cjs"); } catch (e) { console.error("localApi.cjs load failed:", e.message); return null; } })();
var localApiServer = null;
var localApiConfig = { enabled: false, port: 18080, scope: "local", key: "", lanKey: "" };

function localApiFromLoopback(req) {
  const ra = String(req.socket?.remoteAddress || "");
  return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
}

// 读取配置：存在 SQLite 的 settings 表，与其它设置同源
function loadLocalApiConfig() {
  try {
    if (!hasDb) return;
    const rows = db.getAllSettings();
    const get = (k) => { const r = rows.find((x) => x.key === k); return r ? String(r.value) : ""; };
    // v12.4：本地 API 默认开启。
    // 之前默认关闭 + 必须手动生成 Key 才真正监听，结果是"看起来有这功能，
    // 实际从未启动过"（用户反馈：api 访问压根没有启动）。改成：
    //   · 首次启动（设置里从未写过 local_api_enabled）→ 默认开启
    //   · Key 不存在 → 自动生成本机 Key 并落库（局域网 Key 仍需手动，默认不对外）
    const rawEnabled = get("local_api_enabled");
    // 一次性迁移：v12.4 之前本地 API 因 want=enabled&&key 的门闩从未真正
    // 监听过，那个年代落库的 "0" 不是用户的明确选择（功能坏了关它没有意义）。
    // 用 local_api_migrated 标记保证只迁一次——之后用户手动关就尊重。
    let enabled = rawEnabled === "1";
    if (!get("local_api_migrated")) {
      enabled = true;
      try {
        db.setSetting("local_api_enabled", "1");
        db.setSetting("local_api_migrated", "1");
      } catch {}
    }
    let key = get("local_api_key");
    if (!key) {
      key = "ly-" + crypto.randomBytes(32).toString("hex");
      try { db.setSetting("local_api_key", key); } catch {}
    }
    localApiConfig = {
      enabled,
      port: Number(get("local_api_port")) || 18080,
      scope: get("local_api_scope") === "lan" ? "lan" : "local",
      key,
      lanKey: get("local_api_lankey"),
    };
  } catch (e) { console.error("读取本地 API 配置失败:", e.message); }
}

/** 把请求转发到本机的 llm-proxy，实现 OpenAI 兼容端点 */
async function localApiHandler(req, res) {
  const cfg = localApiConfig;
  const fromLoop = localApiFromLoopback(req);
  const auth = LOCAL_API_MOD
    ? LOCAL_API_MOD.authorizeLocalApi(req.headers["authorization"], fromLoop, cfg)
    : { ok: false, status: 403, error: "模块未加载" };
  const jsonOut = (obj, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (!auth.ok) {
    // 按 OpenAI 的错误形状返回，便于客户端识别
    return jsonOut({ error: { message: auth.error, type: "invalid_request_error", code: auth.status === 401 ? "invalid_api_key" : "forbidden" } }, auth.status || 401);
  }

  const url = new URL(req.url || "/", "http://localhost");
  // 只暴露三个标准端点：模型清单 / 对话 / 补全（后者走同一处理器）
  if (req.method === "GET" && /^\/v1\/models\/?$/.test(url.pathname)) {
    const base = (db.getSetting ? db.getSetting("apiBaseUrl") : "") || "";
    const model = (db.getSetting ? db.getSetting("model") : "") || "";
    // 模型清单取自当前配置的上游，拉不到就至少回当前模型，别回空
    let ids = model ? [String(model)] : [];
    try {
      if (base) {
        const r = await fetch(`${String(base).replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = await r.json();
          const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
          const got = arr.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
          if (got.length) ids = got;
        }
      }
    } catch { /* 拉不到就用兜底 */ }
    return jsonOut({ object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "jutian-agent" })) });
  }

  if (req.method === "POST" && (/^\/v1\/chat\/completions\/?$/.test(url.pathname) || /^\/v1\/completions\/?$/.test(url.pathname))) {
    // 读原始 body，原样转给内部 llm-proxy
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* 交给下游报错 */ }
    if (!parsed || typeof parsed !== "object") {
      return jsonOut({ error: { message: "请求体不是合法 JSON", type: "invalid_request_error" } }, 400);
    }
    // 客户端没指定模型时用应用当前模型
    if (!parsed.model) {
      try { parsed.model = (db.getSetting ? db.getSetting("model") : "") || ""; } catch {}
    }
    try {
      const upstream = await fetch(`http://127.0.0.1:${PORT}/api/llm-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Target-Base": String((db.getSetting ? db.getSetting("apiBaseUrl") : "") || ""),
          // v12.4.1：内部转发必须显式带令牌。Electron 主进程的 fetch 走
          // Chromium 网络栈，会带浏览器指纹头（Sec-Fetch-*），按"浏览器"被
          // 自己的门卫拦成 403——设置里的本地 API /v1/chat/completions
          // 因此整条挂掉（用户实测）。同进程就有 APP_UI_TOKEN，直接带上，
          // 门卫的 hasHeader 通道确定性放行，不再依赖任何指纹推断。
          ...(APP_UI_TOKEN ? { "X-App-Token": APP_UI_TOKEN } : {}),
          // 故意不传 X-Api-Key：GET /api/settings 回显的是掩码(sk-H****)，
          // 拿它当钥匙会被上游 401。llm-proxy 在头缺失或为掩码时会自己
          // 从库里取真钥匙——密钥不出本机，这里交给它处理。
        },
        body: JSON.stringify(parsed),
      });
      // 原样透传（含 SSE 流），客户端拿到的语义与直连上游一致
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-cache",
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      res.end();
    } catch (e) {
      return jsonOut({ error: { message: String(e?.message || e), type: "upstream_error" } }, 502);
    }
    return;
  }

  return jsonOut({ error: { message: `未知端点 ${url.pathname}（支持 GET /v1/models、POST /v1/chat/completions）`, type: "invalid_request_error" } }, 404);
}

/** 按配置启停本地 API 监听。配置变化时由设置保存接口调用。 */
function syncLocalApi() {
  loadLocalApiConfig();
  const want = localApiConfig.enabled && !!localApiConfig.key;
  if (want && !localApiServer) {
    const bind = LOCAL_API_MOD ? LOCAL_API_MOD.bindAddress(localApiConfig.scope) : "127.0.0.1";
    // 端口可能被别的程序占用（实测 8326 常被 DeepSeek Harness 占着）。
    // 按备选列表依次试，全都失败才放弃——比让用户自己去猜端口友好得多。
    const fallbacks = LOCAL_API_MOD ? LOCAL_API_MOD.LOCAL_API_PORT_FALLBACKS : [localApiConfig.port];
    const candidates = [localApiConfig.port, ...fallbacks.filter((p) => p !== localApiConfig.port)];
    const tryListen = (idx) => {
      if (idx >= candidates.length) {
        console.error("本地 API 启动失败：候选端口全部被占用");
        localApiServer = null;
        return;
      }
      const port = candidates[idx];
      const srv = http.createServer((req, res) => { localApiHandler(req, res).catch(() => { try { res.end(); } catch {} }); });
      srv.once("error", (e) => {
        if (e && e.code === "EADDRINUSE") {
          console.log(`本地 API 端口 ${port} 被占用，换下一个`);
          try { srv.close(); } catch {}
          tryListen(idx + 1);
        } else {
          console.error("本地 API 监听失败:", e.message);
          localApiServer = null;
        }
      });
      srv.listen(port, bind, () => {
        localApiServer = srv;
        // 实际生效的端口回写配置，界面显示与实际一致
        if (port !== localApiConfig.port) {
          localApiConfig.port = port;
          try { db.setSetting("local_api_port", String(port)); } catch {}
        }
        console.log(`→ 本地 API 已开放: http://${bind}:${port}/v1`);
      });
    };
    tryListen(0);
  } else if (!want && localApiServer) {
    try { localApiServer.close(); } catch {}
    localApiServer = null;
    console.log("→ 本地 API 已关闭");
  } else if (want && localApiServer) {
    // 端口或范围变了：重启监听
    const addr = localApiServer.address();
    const curPort = addr && typeof addr === "object" ? addr.port : 0;
    const bind = LOCAL_API_MOD ? LOCAL_API_MOD.bindAddress(localApiConfig.scope) : "127.0.0.1";
    const curBind = addr && typeof addr === "object" ? addr.address : "";
    if (curPort !== localApiConfig.port || curBind !== bind) {
      try { localApiServer.close(); } catch {}
      localApiServer = null;
      syncLocalApi();
    }
  }
}
try { loadLocalApiConfig(); syncLocalApi(); } catch (e) { console.error("本地 API 初始化失败:", e.message); }

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
  // ─── 仅限 App 内访问（v12.2）───
  // 桌面窗口带 token 进来换 Cookie；之后同浏览器内都靠 Cookie。
  // 没有 Cookie 也没有 token 的请求 = 用户在浏览器里手输地址、或本机其他程序
  // 在访问 → 返回拦截页，不提供任何 API 与界面。
  //
  // 例外（必须放行，否则 App 自己起不来）：
  //   · /api/health          启动探活
  //   · LAN 远程路径         由下面的配对码门卫单独负责（__isLocal 为 false 时跳过本段）
  //   · 带 token 的首次导航   下面合法化后重定向
  if (APP_UI_ONLY) {
    const __raUI = String(req.socket.remoteAddress || "");
    const __fromLoopbackUI = __raUI === "127.0.0.1" || __raUI === "::1" || __raUI === "::ffff:127.0.0.1";
    if (__fromLoopbackUI && url.pathname !== "/api/health") {
      // 保底通道（v12.4）：Electron 自身的 UA 必须放行。
      // webRequest 注入头在个别机器/时序下可能未生效，一旦失效窗口就会被
      // 自己的门卫拦住 = 「应用无法启动」（用户在其他电脑上实测踩过）。
      // 浏览器里的恶意页面无法伪造 User-Agent（fetch 禁改头部），
      // 所以这条路只放行真正的桌面窗口，不放开外部浏览器。
      const ua = String(req.headers["user-agent"] || "");
      const isElectronUA = /Electron\/\d+/.test(ua);
      if (isElectronUA) {
        // 放行，继续后续处理（不写 Cookie，不重定向）
      } else {
      const cookies = String(req.headers.cookie || "");
      const hasCookie = cookies.split(/;\s*/).some((c) => c === `${UI_COOKIE}=${APP_UI_TOKEN}`);
      // 主通道：Electron 主进程经 webRequest 给每个请求注入 X-App-Token。
      // 这条路径不依赖任何前端配合，子资源/XHR/重定向全覆盖，最可靠。
      const headerTok = String(req.headers["x-app-token"] || "");
      const hasHeader = headerTok.length > 0 && headerTok === APP_UI_TOKEN;
      const supplied = url.searchParams.get("app") || "";
      if (hasHeader) {
        // 头部已证明来自应用窗口，直接放行（不写 Cookie：
        // 避免本机浏览器里残留一个可被复用的凭据）
      } else if (supplied && supplied === APP_UI_TOKEN) {
        // 首次进入：换成 HttpOnly Cookie，并 302 到干净 URL，
        // 避免 token 留在地址栏/历史记录/截图里
        const clean = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        clean.searchParams.delete("app");
        res.writeHead(302, {
          "Set-Cookie": `${UI_COOKIE}=${APP_UI_TOKEN}; Path=/; HttpOnly; SameSite=Strict`,
          Location: clean.pathname + (clean.search || ""),
        });
        res.end();
        return;
      }
      // v12.4.1 修正：门卫只拦**浏览器**，不能把本机程序一起拦了。
      // jtcode CLI / 用户脚本 / curl 用普通 HTTP 客户端访问 /api/*，
      // 上一版全被 403（用户实测："开放的 api 也无法访问"）。
      //
      // 浏览器判据要避开 Node fetch 的坑：undici 默认发
      // `sec-fetch-mode: cors`（实测），按"有无 sec-fetch-mode"判断会把
      // 一切 Node 程序误判成浏览器。改用两个真浏览器独有的信号：
      //   · sec-fetch-site 有值（cross-site / same-site / same-origin）
      //     ——只有 Chromium 系浏览器网络栈会加；undici 不发它（实测）
      //   · sec-fetch-mode: navigate ——浏览器地址栏/链接跳转
      // 对照表（实测）：
      //   恶意网页跨站 fetch      → site: cross-site        → 拦 ✓
      //   浏览器地址栏直开        → mode: navigate          → 拦 ✓
      //   Node fetch / jtcode CLI → mode: cors，无 site     → 放行 ✓
      //   curl                    → 无 Sec-Fetch-*          → 放行 ✓
      const __sfSite = String(req.headers["sec-fetch-site"] || "");
      const __sfMode = String(req.headers["sec-fetch-mode"] || "");
      const __isBrowserLike = !!__sfSite || __sfMode === "navigate";
      if (!hasHeader && !hasCookie && __isBrowserLike) {
        // 拦截页：明确告诉用户"这是桌面应用，请从 App 打开"，
        // 不回任何业务数据，也不提供登录入口（本地应用没有账号体系）
        res.writeHead(403, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>请在应用内打开</title>
<style>
:root{color-scheme:light}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f6f4;
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#2c2c33}
.card{max-width:420px;padding:36px 32px;background:rgba(255,255,255,.72);border:1px solid rgba(0,0,0,.06);
  border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.06);backdrop-filter:blur(20px);text-align:center}
h1{margin:0 0 10px;font-size:17px;font-weight:600}
p{margin:0;color:#8f8f8f;font-size:13px}
code{background:rgba(0,0,0,.05);padding:1px 6px;border-radius:5px;font-size:12px}
</style></head><body>
<div class="card">
  <h1>请从桌面应用打开</h1>
  <p>巨天agent 是本地桌面应用，界面不对外提供。</p>
  <p style="margin-top:14px">打开 <code>巨天agent</code> 应用即可使用。</p>
</div>
</body></html>`);
        return;
      }
      } // ← 非 Electron UA 的校验结束（保底通道见上方注释）
    }
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
    if (url.pathname === "/api/health") return json(res, {
      status: "ok", agent: "巨天agent", version: PKG.version, tools: Object.keys(TOOLS).length,
      platform: process.platform, workDir: globalWorkDir || null, defaultWorkDir: DEFAULT_WORKSPACE,
      // 诊断级快照：排查环境问题时一个请求看全（v13.2）
      uptime_s: Math.round(process.uptime()),
      memory: { rss_mb: Math.round(process.memoryUsage().rss / 1048576), heap_mb: Math.round(process.memoryUsage().heapUsed / 1048576) },
      db: sharedDb ? (sharedDb.__engine || "sqlite") : (db && db.__jsondb ? "jsondb" : "none"),
      node: process.version,
    });
    // 数据库维护：VACUUM 回收已删除数据占用的空间
    if (url.pathname === "/api/db/vacuum" && req.method === "POST") {
      if (!sharedDb?.vacuumDb) return json(res, { success: false, error: "数据库不可用" });
      try {
        const r = db.vacuumDb();
        const mb = (n) => (n / 1024 / 1024).toFixed(1);
        return json(res, { success: true, output: `完成：${mb(r.before)} MB → ${mb(r.after)} MB（回收 ${mb(Math.max(0, r.before - r.after))} MB）` });
      } catch (e) { return json(res, { success: false, error: e.message }); }
    }
    // 手动清理空会话（设置 → 数据）。自动清理是「启动 + 每小时」，
    // 但用户可能想立刻清一次；这个端点也便于诊断自动清理是否生效。
    if (url.pathname === "/api/db/cleanup-empty" && req.method === "POST") {
      try {
        if (!hasDb) return json(res, { success: false, error: "数据库不可用（db 未加载）" });
        const before = (db.listSessions() || []).length;
        const removed = runEmptyCleanup(new Set());
        const after = (db.listSessions() || []).length;
        return json(res, { success: true, removed, before, after, output: `已清理 ${removed} 个空会话（${before} → ${after}）` });
      } catch (e) { return json(res, { success: false, error: e.message }); }
    }
    // 环境诊断：一键体检各子系统可用性（设置 → 关于 → 环境诊断）
    // 前端错误上报（渲染层崩溃时由 ErrorBoundary / 全局监听调用）
    if (url.pathname === "/api/client-error" && req.method === "POST") {
      try {
        const d = await body(req);
        CLIENT_ERRORS.unshift({
          ts: new Date().toISOString(),
          message: String(d.message || "").slice(0, 500),
          stack: String(d.stack || "").slice(0, 2000),
          componentStack: String(d.componentStack || "").slice(0, 1000),
          url: String(d.url || "").slice(0, 300),
        });
        if (CLIENT_ERRORS.length > 50) CLIENT_ERRORS.length = 50;
        return json(res, { ok: true });
      } catch { return json(res, { ok: false }, 400); }
    }

    if (url.pathname === "/api/diagnostics") {      const check = [];
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
        const rawSettings = sharedDb && db.getAllSettings ? db.getAllSettings() : [];
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
      return json(res, { success: true, checks: check, allOk: check.every((c) => c.ok), clientErrors: CLIENT_ERRORS.slice(0, 20) });
    }
    if (url.pathname === "/api/tools") return json(res, { tools: Object.keys(TOOLS).map((k) => ({ name: k })) });
    if (url.pathname === "/api/tools/execute" && req.method === "POST") {
      const { name, args = {} } = await body(req);
      // 工作目录是**全局**状态（影响后续所有请求），不能让任意请求随手改。
      // 只接受来自本应用窗口的请求（loopback + App 令牌）；LAN 远程即使配对
      // 成功也不该改桌面端的工作目录。
      const workDirHeader = req.headers["x-work-dir"] || "";
      if (workDirHeader) {
        const ra = String(req.socket.remoteAddress || "");
        const fromLoopback = ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
        const trustedToken = !APP_UI_ONLY || String(req.headers["x-app-token"] || "") === APP_UI_TOKEN;
        if (!fromLoopback || !trustedToken) {
          return json(res, { success: false, error: "不允许从远程修改工作目录" }, 403);
        }
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
      // ─── 参数校验（严格化）：模型传参是不可信输入，先按规格验一遍 ───
      // 实测踩过的坑：write_file 缺 content → 文件被写成字符串 "undefined"；
      // move_file 目标已存在 → rename 静默覆盖；类型错 → 一路走到 fs 层
      // 才炸成 ENOENT/EISDIR，模型看不懂报错就反复重试同一参数。
      // 规格表见 shared/toolArgs（有测试）。校验不通过直接回错，不进工具。
      let callArgs = args;
      const spec = TOOL_SPECS[name];
      if (spec) {
        const v = validateArgs(callArgs, spec);
        if (!v.ok) {
          return json(res, { success: false, error: `【参数错误】${v.error}请修正后重试。` });
        }
        callArgs = v.value;
      }
      let r;
      try { r = await h(callArgs); }
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
            const __rows = sharedDb ? db.getAllSettings() : [];
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
        // 免 key 网关(如 Kilo Gateway):密钥填 free/keyless 时完全不带
        // Authorization 头——此类网关对任何无效 token 反而报 INVALID_TOKEN
        const keyless = apiKey === "free" || apiKey === "keyless" || apiKey === "";
        const proxyHeaders: Record<string, string> = { "Content-Type": "application/json" };
        // ─── OpenCode Zen 免费车道：需要特殊头 + 强制流式 ───
        // 这条车道不能按普通 OpenAI 兼容源处理：
        //  · 必须带 x-opencode-* 客户端指纹，且 session/request id 要是特定形状
        //  · 必须 stream:true —— 非流式一律 403，且报的是误导性的 FreeTierError
        //  · 免费额度要求 body.tools 声明 bash/glob/grep/read 四个小写工具
        // 判定与构造都在 shared/opencodeZen（有测试）
        const zen = isZenBase(targetBase);
        if (zen) {
          const sess = mintSessionId();
          const reqId = mintRequestId();
          Object.assign(proxyHeaders, zenHeaders(sess, reqId, true));
          bodyData = zenBody(String(bodyData.model || ""), bodyData);
          // muse-spark 系列走 /responses 端点，但渲染层发的是 Chat 形状。
          // 不转换的话这些模型即使不在地区限制名单里也会 400（input/max_output_tokens 形状不匹配）。
          if (zenEndpoint(String(bodyData.model || "")) === "/responses") {
            bodyData = chatToResponsesShape(bodyData);
          }
          // 指纹工具：保留调用方真实工具，只补缺的槽位
          const bd = bodyData as Record<string, unknown>;
          const tools = Array.isArray(bd.tools) ? (bd.tools as unknown[]) : [];
          bd.tools = withFingerprintTools(tools as { function?: { name?: string } }[], (name) => ({
            type: "function",
            function: {
              name,
              description: "Not available. Never call this tool.",
              parameters: { type: "object", properties: {}, additionalProperties: false },
            },
          }));
        } else if (!keyless) {
          proxyHeaders["Authorization"] = `Bearer ${apiKey}`;
        }
        // Pollinations 的端点本身就是 /openai(chat completions),不拼后缀；
        // Zen 按模型分流 /chat/completions 与 /responses
        const upstreamUrl = zen
          ? `${targetBase.replace(/\/+$/, "")}${zenEndpoint(String(bodyData.model || ""))}`
          : /\/openai$/.test(targetBase) ? targetBase : `${targetBase}/chat/completions`;
        console.log(`\u2192 llm-proxy \u2192 ${targetBase}${zen ? " (zen)" : ""}`);
        // v11:主上游连接失败不再抛出 —— 置 null 落入下方接力链（免费链兜底）
        let proxyRes = null;
        try {
          proxyRes = await fetch(upstreamUrl, {
            method: "POST",
            headers: proxyHeaders,
            body: JSON.stringify(bodyData),
            signal: AbortSignal.timeout(120000),
          });
        } catch (e) {
          console.error(`llm-proxy 主上游连接失败: ${e.message}（将尝试免费接力链）`);
        }
        if (proxyRes && !proxyRes.ok) {
          // v11:主上游 HTTP 错误不再直接透传终止 —— 记录后落入下方接力链
          // (免费链兜底,永远有回应);若免费链也全部失败,最终错误体会带 upstreamStatus。
          const detail = await proxyRes.text().catch(() => "");
          console.error(`llm-proxy 主上游 ${proxyRes.status} ← ${upstreamUrl}(将尝试免费接力链): ${String(detail).slice(0, 200)}`);
        }
        // ─── v11 模型自动接力:主上游失败/空响应耗尽后,自动换免费链（Kilo → Pollinations）,
        //     永远有回应。用户配置的主上游永远是第一顺位,成功即停,不静默改写成功请求。───
        const isStreamReq = bodyData.stream === true;
        const basePayload = (() => { const p = { ...bodyData }; delete p.targetBase; delete p.apiKey; return p; })();
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
        // 免费接力链:主上游不是它们时才追加（去重）
        const RELAY_CHAIN = [
          { base: "https://api.kilo.ai/api/gateway/v1", key: "free", model: "openrouter/free", name: "kilo" },
          { base: "https://text.pollinations.ai/openai", key: "free", model: "openai-fast", name: "pollinations" },
        ].filter((u) => u.base !== targetBase);
        const callOne = (u, payload) => {
          const url = /\/openai$/.test(u.base) ? u.base : `${u.base}/chat/completions`;
          const headers = { "Content-Type": "application/json" };
          if (u.key !== "free" && u.key !== "keyless" && u.key) headers["Authorization"] = `Bearer ${u.key}`;
          return fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
        };

        if (!isStreamReq) {
          // 非流式:逐上游尝试,每个上游内保留空响应重试(最多 3 次),耗尽换下一家
          let payload = basePayload;
          for (let ci = 0; ci <= RELAY_CHAIN.length; ci++) {
            const u = ci === 0 ? { base: targetBase, key: apiKey, name: "primary" } : RELAY_CHAIN[ci - 1];
            if (ci > 0) { payload = { ...payload, model: u.model }; console.log(`llm-proxy 接力 → ${u.name}`); }
            // 首响复用:ci=0 且主上游首响正常时直接用 proxyRes（连接失败/!ok 均走接力）
            const first = ci === 0 ? (proxyRes && proxyRes.ok ? proxyRes : null) : await callOne(u, payload).catch(() => null);
            if (!first || !first.ok) {
              const st = first ? first.status : 0;
              // 429 按 Retry-After 退避后同上游再试一次（限速是暂态，换上游太浪费）；
              // 其余状态（401/404/5xx）才是上游问题，直接换下一家
              if (st === 429) {
                const ra = Number(first?.headers?.get?.("retry-after")) || 0;
                await sleep(Math.min(Math.max(ra * 1000, 800), 4000));
                const r2 = await callOne(u, payload).catch(() => null);
                if (r2 && r2.ok) {
                  let j2 = null;
                  try { j2 = JSON.parse(await r2.text()); } catch {}
                  if (!bodyEmpty(j2)) {
                    res.writeHead(200, { ...sseHeaders, "X-Relay-Used": `${u.name}(429-retry)` });
                    res.end(JSON.stringify(j2));
                    return;
                  }
                }
              }
              console.error(`llm-proxy ${u.name} HTTP ${first ? first.status : "?"}`);
              continue;
            }
            let j = null;
            try { j = JSON.parse(await first.text()); } catch {}
            for (let att = 1; att <= 3 && bodyEmpty(j); att++) {
              console.log(`llm-proxy 空响应(${u.name} attempt ${att}${j?.choices?.[0]?.finish_reason ? ", finish=" + j.choices[0].finish_reason : ""})${att < 3 ? ",重试" : ",换上游"}`);
              if (att < 3) {
                await sleep(400 * att);
                payload = escalate(payload, j?.choices?.[0]?.finish_reason || "");
                let r2 = null;
                try { r2 = await callOne(u, payload); } catch { break; }
                if (r2.ok) { try { j = JSON.parse(await r2.text()); } catch { j = null; } }
                else break;
              }
            }
            if (!bodyEmpty(j)) {
              res.writeHead(200, { ...sseHeaders, "X-Relay-Used": u.name });
              res.end(JSON.stringify(j));
              return;
            }
          }
          res.writeHead(502, { ...(corsHeaders(req) || {}), "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "所有模型上游均不可用（含免费接力链）", relayTried: ["primary", ...RELAY_CHAIN.map(u => u.name)] }));
          return;
        }
        // 流式:实时透传;押后 [DONE],空流自动重试,单上游耗尽后接力下一家
        res.writeHead(200, sseHeaders);
        // 心跳（v13.6）：上游排队/429 退避期间代理不发任何字节，中间层可能
        // 按 idle 超时掐断连接。每 15s 发一行 SSE 注释（客户端解析器天然忽略），
        // 连接关闭时自动清除——覆盖所有退出路径。
        const heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* 已断开 */ } }, 15000);
        res.on("close", () => clearInterval(heartbeat));
        let payload = basePayload;
        for (let ci = 0; ci <= RELAY_CHAIN.length; ci++) {
          const u = ci === 0 ? { base: targetBase, key: apiKey, name: "primary" } : RELAY_CHAIN[ci - 1];
          if (ci > 0) { payload = { ...payload, model: u.model }; console.log(`llm-proxy 流式接力 → ${u.name}`); res.write(`: relay ${u.name}\n\n`); }
          for (let att = 1; att <= (ci === 0 ? 3 : 2); att++) {
            let r = null;
            try { r = att === 1 && ci === 0 ? proxyRes : await callOne(u, payload); } catch (e) { break; }
            if (!r || !r.ok) {
              // 429 与 5xx 分开处理：429 是按 IP 限速，等 Retry-After 后
              // 同上游重试往往就能过；5xx 才是上游真挂，立即换下一家。
              // 都不做退避的话，超限时的 3 次重试会瞬间打完，白白烧掉额度窗口。
              const status = r ? r.status : 0;
              if (status === 429 && att < (ci === 0 ? 3 : 2)) {
                const ra = Number(r.headers?.get?.("retry-after")) || 0;
                await sleep(Math.min(Math.max(ra * 1000, 800), 4000));
                console.log(`llm-proxy 流式 429(${u.name} attempt ${att})，退避后同上游重试`);
                payload = escalate(payload, "");
                continue;
              }
              if (status >= 500 && att < (ci === 0 ? 3 : 2)) { await sleep(500 * att); continue; }
              break;
            }
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
            if (sawContent) { res.write("data: [DONE]\n\n"); res.end(); return; }
            console.log(`llm-proxy 流式空响应(${u.name} attempt ${att}${finishFr ? ", finish=" + finishFr : ""})${att < 3 ? ",重试" : ",换上游"}`);
            if (att < (ci === 0 ? 3 : 2)) { await sleep(400 * att); payload = escalate(payload, finishFr); }
          }
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (e) {
        console.error("llm-proxy error:", e.message);
        if (!res.headersSent) json(res, { error: e.message }, 502);
      }
      return;
    }

    // --- QQ 官方机器人 AccessToken 换取 (AppID+AppSecret → QQBot token，2小时有效，模块级缓存) ---
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
        // 安全：仅允许发送用户目录 / tmp 内的文件。
        // 必须先 resolve 再判断，否则 /Users/x/../etc/passwd 这类带 .. 的路径能绕过前缀检查
        const realPath = path.resolve(filePath);
        const home = process.env.HOME || "/Users/zeroneil";
        if (!ok(realPath) || !(realPath === home || realPath.startsWith(home + path.sep))) {
          return json(res, { error: "仅允许发送用户目录内的文件" }, 403);
        }
        const sendPath = realPath;
        const apiBase = sandbox ? "https://sandbox.api.sgroup.qq.com" : "https://api.sgroup.qq.com";
        const tokenHeader = { Authorization: `QQBot ${token}` };
        // 1. 上传文件 → file_info
        const buf = await fsp.readFile(sendPath);
        const fd = new FormData();
        fd.append("file", new Blob([buf], { type: "application/octet-stream" }), path.basename(sendPath));
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
    // --- 真实市场：官方/社区仓库技能枚举（磁盘缓存 6h，拉取失败回退陈旧数据） ---
    if (url.pathname === "/api/skills/remote" && req.method === "GET") {
      if (!SKILL_MARKET_MOD) return json(res, { success: false, error: "市场模块不可用" });
      let cache = null;
      try { if (fs.existsSync(REMOTE_MARKET_FILE)) cache = JSON.parse(fs.readFileSync(REMOTE_MARKET_FILE, "utf-8")); } catch { cache = null; }
      const fresh = cache && Date.now() - cache.cached_at < REMOTE_MARKET_TTL && Array.isArray(cache.items) && cache.items.length > 0;
      if (!url.searchParams.get("refresh") && fresh) {
        return json(res, { success: true, items: cache.items, cached_at: cache.cached_at });
      }
      try {
        const items = await fetchRemoteMarketItems();
        if (items.length) {
          const rec = { cached_at: Date.now(), items };
          try { fs.writeFileSync(REMOTE_MARKET_FILE, JSON.stringify(rec)); } catch { /* 缓存写失败不拦返回 */ }
          return json(res, { success: true, items, cached_at: rec.cached_at });
        }
        // 枚举为空（多半是网络被墙/配额耗尽）：有陈旧就用陈旧
        if (fresh) return json(res, { success: true, items: cache.items, cached_at: cache.cached_at, stale: true });
        return json(res, { success: false, error: "市场枚举为空，请稍后重试" });
      } catch (e) {
        if (cache && Array.isArray(cache.items) && cache.items.length > 0) {
          return json(res, { success: true, items: cache.items, cached_at: cache.cached_at, stale: true });
        }
        return json(res, { success: false, error: "市场拉取失败：" + e.message });
      }
    }
    // 市场技能文件预览（详情展开时取 SKILL.md 正文）
    if (url.pathname === "/api/skills/remote-file" && req.method === "GET") {
      const repo = url.searchParams.get("repo") || "";
      const fp = url.searchParams.get("path") || "";
      const M = SKILL_MARKET_MOD;
      if (!M) return json(res, { success: false, error: "市场模块不可用" });
      const src = (M.SKILL_SOURCES || []).find((s) => s.repo === repo);
      // 路径必须落在白名单仓库的市场目录下：防任意仓库读取
      if (!src || !fp.startsWith(src.dir + "/") || fp.includes("..")) return json(res, { success: false, error: "非法路径" });
      if (!M.isAllowedSkillFile(fp.split("/").pop() || "")) return json(res, { success: false, error: "不支持的文件类型" });
      try {
        const text = await ghRawText(repo, fp);
        return json(res, { success: true, text: String(text).slice(0, 4e4) });
      } catch (e) {
        return json(res, { success: false, error: e.message });
      }
    }
    // 市场直装：从白名单仓库按目录递归拉真实文件（不依赖 git，Termux 上同样可用）
    if (url.pathname === "/api/skills/install-remote" && req.method === "POST") {
      const { repo, path: skillPath } = await body(req);
      const M = SKILL_MARKET_MOD;
      if (!M) return json(res, { success: false, error: "市场模块不可用" });
      const src = (M.SKILL_SOURCES || []).find((s) => s.repo === repo);
      if (!src) return json(res, { success: false, error: "仓库不在市场白名单内" });
      if (typeof skillPath !== "string" || !skillPath.startsWith(src.dir + "/") || skillPath.includes("..")) {
        return json(res, { success: false, error: "非法技能路径" });
      }
      const id = M.sanitizeSkillId(skillPath.split("/").pop());
      if (!id) return json(res, { success: false, error: "非法技能名称" });
      const destDir = resolveWithin(SKILL_DIR, id);
      if (!destDir) return json(res, { success: false, error: "非法技能名称" });
      try {
        const L = M.SKILL_INSTALL_LIMITS;
        let count = 0, total = 0;
        const saved = [];
        await fsp.rm(destDir, { recursive: true, force: true }); // 重装/更新：先清旧目录
        await fsp.mkdir(destDir, { recursive: true });
        const walk = async (dirPath, depth) => {
          if (depth > L.maxDepth || count >= L.maxFiles || total > L.maxTotalBytes) return;
          const entries = await ghApiList(repo, dirPath);
          for (const e of Array.isArray(entries) ? entries : []) {
            if (count >= L.maxFiles || total > L.maxTotalBytes) break;
            if (e.type === "dir") { await walk(e.path, depth + 1); continue; }
            if ((e.size || 0) > L.maxFileBytes) continue;
            if (!M.isAllowedSkillFile(e.name)) continue;
            const text = await ghRawText(repo, e.path);
            const rel = e.path.slice(skillPath.length + 1);
            const dest = path.resolve(destDir, rel);
            if (!dest.startsWith(destDir + path.sep)) continue; // 防 rel 里藏 ../
            await fsp.mkdir(path.dirname(dest), { recursive: true });
            await fsp.writeFile(dest, text, "utf-8");
            count++; total += Buffer.byteLength(text);
            saved.push(rel);
          }
        };
        await walk(skillPath, 1);
        if (!saved.includes("SKILL.md")) {
          await fsp.rm(destDir, { recursive: true, force: true });
          return json(res, { success: false, error: "该目录不是有效技能（缺 SKILL.md）" });
        }
        const mdMeta = parseSkillMd(destDir) || {};
        const sourceUrl = `https://github.com/${repo}/tree/HEAD/${skillPath}`;
        await fsp.writeFile(path.join(destDir, "skill.json"), JSON.stringify({
          name: id, display_name: mdMeta.name || id, version: mdMeta.version || "1.0.0",
          author: repo.split("/")[0], description: mdMeta.description || "",
          source: "market", source_url: sourceUrl, installed_at: (/* @__PURE__ */ new Date()).toISOString(),
        }, null, 2));
        // 登记进本地市场列表，市场页签也能看到它
        const market = loadMarket();
        if (!market.find((s) => s.id === id)) {
          market.push({
            id, name: mdMeta.name || id, version: mdMeta.version || "1.0.0", author: repo.split("/")[0],
            description: mdMeta.description || "", tags: [src.sourceLabel, "已安装"],
            tools: [], source_url: sourceUrl,
          });
          saveMarket(market);
        }
        return json(res, { success: true, id, files: saved.length });
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
        // 市场条目理论上受控，但 skill_market.json 可被手工编辑或被污染的
        // 导入覆盖 —— 仍走同一道白名单校验，不给"读到的 id 一定安全"留假设
        const dir = resolveWithin(SKILL_DIR, skillId);
        if (!dir) return json(res, { success: false, error: "非法技能名称" });
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
      // 仓库名必须校验：此前直接取 URL 最后一段拼路径，传
      // "https://github.com/x/../../.." 会得到 repoName=".."，
      // destDir 变成 ~/.lyclaw 本身 —— 下一行的 rm -rf 会删掉用户全部数据。
      // 这里用 URL 解析取 pathname 段，并强制白名单字符集。
      let repoName = "";
      try {
        const segs = new URL(githubUrl).pathname.split("/").filter(Boolean);
        repoName = (segs[segs.length - 1] || "").replace(/\.git$/, "");
      } catch { return json(res, { success: false, error: "无效的 GitHub 链接" }); }
      if (!/^[\w.-]+$/.test(repoName) || repoName === "." || repoName === ".." || repoName.startsWith(".")) {
        return json(res, { success: false, error: "无法从该链接确定合法的仓库名" });
      }
      const destDir = resolveWithin(SKILL_DIR, repoName);
      if (!destDir) return json(res, { success: false, error: "非法仓库名" });
      try {
        // 重装/更新：先清空旧目录，否则 git clone 报 "already exists and is not an empty directory"
        await fsp.rm(destDir, { recursive: true, force: true });
        await execAsync("git", ["clone", "--depth", "1", githubUrl, destDir], { timeout: 6e4, maxBuffer: 524288 });
        // 清掉 .git，技能目录保持干净
        await fsp.rm(path.join(destDir, ".git"), { recursive: true, force: true });
        // 统计真实安装的文件
        const files = [];
        // 参数名必须是 p：此前写成 _p 而函数体引用 p，触发的 ReferenceError
        // 被下面的 catch 吞掉，安装后的文件数永远统计成 0
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
        const skillPath = resolveWithin(SKILL_DIR, skillName);
        if (!skillPath) return json(res, { success: false, error: "非法技能名称" });
        if (fs.existsSync(skillPath)) {
          await fsp.rm(skillPath, { recursive: true, force: true });
        }
        // 从市场中移除
        const market = loadMarket();
        const updated = market.filter((s) => s.id !== skillName && s.id !== sanitizeName(skillName));
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
      if (hasDb) {
        try {
          const rows = db.getAllSettings();
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
      // 本地 API 的开关/端口/范围/Key 改动后要立刻生效（启停或重启监听）
      const isLocalApiKey = /^local_api_/.test(String(key));
      if (hasDb) {
        try {
          db.setSetting(key, value == null ? "" : String(value));
          if (key === "keepAwake") syncKeepAwake();
          if (isLocalApiKey) { try { syncLocalApi(); } catch (e) { console.error("同步本地 API 失败:", e.message); } }
          return json(res, { ok: true });
        } catch {}
      }
      const settings = loadJson("settings.json");
      settings[key] = value;
      saveJson("settings.json", settings);
      if (key === "keepAwake") syncKeepAwake();
      if (isLocalApiKey) { try { syncLocalApi(); } catch (e) { console.error("同步本地 API 失败:", e.message); } }
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
    // ─── 待办清单（v12.5）：模型经 todo_write 写入，界面经此读取 ───
    // 之前只写不读——模型维护的清单用户根本看不见（半成品）。
    if (url.pathname === "/api/todos" && req.method === "GET") {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, "todos.json"), "utf-8");
        return json(res, JSON.parse(raw));
      } catch { return json(res, []); }
    }
    // 界面手动改状态用（与 todo_write 工具同一份文件、同一套校验）。
    // 注意语义：模型的 todo_write 是全量覆盖，手改会在模型下次写时被覆盖——
    // 面板里已向用户说明这一点，这里不做合并。
    if (url.pathname === "/api/todos/write" && req.method === "POST") {
      try {
        const b = await body(req);
        const clean = (Array.isArray(b.todos) ? b.todos : []).slice(0, 100).map((t) => ({
          content: String(t?.content || "").slice(0, 200),
          status: ["pending", "in_progress", "completed"].includes(t?.status) ? t.status : "pending",
        })).filter((t) => t.content);
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, "todos.json"), JSON.stringify(clean, null, 1));
        return json(res, { ok: true, count: clean.length });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // ─── 应用公告（v11.7）：GitHub 仓库 docs/notice.md，进应用自动读取 ───
    if (url.pathname === "/api/announcement" && req.method === "GET") {
      const fresh = url.searchParams.get("fresh") === "1";
      return json(res, await getAnnouncement(fresh));
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
      if (hasDb) { try { return json(res, db.listSessions()); } catch {} }
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
          ? (() => { try { return db.listSessions(); } catch { return [] } })()
          : (loadJson("sessions.json").items || []);
        const titleHits = sessions
          .filter(s => String(s.title || "").toLowerCase().includes(needle))
          .slice(0, 8)
          .map(s => ({ id: s.id, title: s.title, updated_at: s.updated_at }));

        // 2) 正文命中：SQLite 走 LIKE；JSON 回落则逐文件扫描
        let msgHits = [];
        if (hasDb) {
          try {
            const like = "%" + q.replace(/[%_]/g, (m) => "\\" + m) + "%";
            const rows = db.db.prepare(
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
    // 会话分叉（v12.1）：把某个会话从指定消息处复制成新会话，
    // 原会话保持不变。用于"保留原方案的同时试另一条路"。
    if (url.pathname === "/api/sessions/branch" && req.method === "POST") {
      try {
        if (!hasDb) return json(res, { error: "本地数据库不可用" }, 503);
        const b = await body(req);
        const sourceId = String(b.sourceId || "");
        const atMessageId = String(b.atMessageId || "");
        if (!sourceId) return json(res, { error: "缺少 sourceId" }, 400);
        const msgs = db.getMessages(sourceId) || [];
        if (!msgs.length) return json(res, { error: "原会话没有消息" }, 400);
        // 找到分叉点：找不到就取全部（比直接报错更宽容）
        let cut = msgs.length;
        if (atMessageId) {
          const i = msgs.findIndex((m) => m.id === atMessageId);
          if (i >= 0) cut = i + 1;
        }
        const picked = msgs.slice(0, cut);
        const newId = db.genId();
        db.createSession(newId, String(b.title || "分支会话"));
        for (const m of picked) {
          db.addMessage(db.genId(), newId, m.role, m.content || "",
            m.thinking || "",
            typeof m.tool_calls === "string" ? m.tool_calls : JSON.stringify(m.tool_calls || []),
            m.tool_call_id || "");
        }
        return json(res, { ok: true, sessionId: newId, copied: picked.length });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const s = await body(req);
      if (hasDb) {
        try { return json(res, db.createSession(s.id || db.genId(), s.title || "新对话", s.project || "")); } catch {}
      }
      const sessions = loadJson("sessions.json");
      if (!sessions.items) sessions.items = [];
      sessions.items.unshift({ id: s.id, title: s.title || "新对话", project: s.project || "", created_at: s.created_at || (new Date()).toISOString(), updated_at: s.updated_at || (new Date()).toISOString() });
      saveJson("sessions.json", sessions);
      return json(res, sessions.items[0]);
    }
    // DELETE /api/sessions/:id
    if (url.pathname.startsWith("/api/sessions/") && req.method === "DELETE" && !url.pathname.includes("/messages")) {
      const sid = url.pathname.split("/")[3];
      if (hasDb) { try { db.deleteSession(sid); return json(res, { ok: true }); } catch {} }
      const sessions = loadJson("sessions.json");
      if (sessions.items) sessions.items = sessions.items.filter((x) => x.id !== sid);
      saveJson("sessions.json", sessions);
      return json(res, { ok: true });
    }
    // PUT /api/sessions/:id
    if (url.pathname.startsWith("/api/sessions/") && req.method === "PUT" && !url.pathname.includes("/messages")) {
      const sid = url.pathname.split("/")[3];
      const patch = await body(req);
      if (hasDb) {
        try {
          db.updateSession(sid, { title: patch.title, project: patch.project, updated_at: typeof patch.updated_at === "number" ? patch.updated_at : Date.now() });
          return json(res, db.getSession(sid) || { ok: true });
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
        if (hasDb) { try { return json(res, db.getMessages(sid)); } catch {} }
        return json(res, loadJson(`messages_${sid}.json`).items || []);
      }
      if (req.method === "POST") {
        const m = await body(req);
        if (hasDb) {
          try {
            db.addMessage(m.id || db.genId(), sid, m.role, m.content || "", m.thinking || "", typeof m.tool_calls === "string" ? m.tool_calls : JSON.stringify(m.tool_calls || []), m.tool_call_id || "", typeof m.swarm === "string" ? m.swarm : undefined);
            return json(res, db.getMessages(sid).slice(-1)[0]);
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
      if (hasDb) {
        try {
          const anchor = db.db.prepare("SELECT created_at FROM messages WHERE id = ?").get(msgId);
          if (anchor) db.db.prepare("DELETE FROM messages WHERE session_id = ? AND created_at > ?").run(sid, anchor.created_at);
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
      if (hasDb) {
        try {
          db.updateMessage(msgId, { content: patch.content, thinking: patch.thinking, tool_calls: typeof patch.tool_calls === "string" ? patch.tool_calls : undefined, swarm: typeof patch.swarm === "string" ? patch.swarm : undefined, variants: typeof patch.variants === "string" ? patch.variants : undefined });
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
      if (hasDb) {
        try {
          for (const r of db.getAllMemories()) {
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
        if (hasDb) { try { db.setMemory(key, value); return json(res, { ok: true }); } catch {} }
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
      if (hasDb) {
        try {
          if (purge) { for (const m of personaMemories(pid)) db.deleteMemory(pfx + m.key); }
          else db.deleteMemory(pfx + slug);
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
        const msg: Record<string, unknown> = { role: b.role === "user" ? "user" : "assistant", content: String(b.content || "").slice(0, 8000), ts: Date.now() };
        // 思考过程随会话保存（历史可回看）；crisis 标记同理
        if (b.thinking) msg.thinking = String(b.thinking).slice(0, 40000);
        if (b.crisis) msg.crisis = true;
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

    // ─── v11 记忆中枢:主对话记忆 + 全部角色记忆聚合（PIPL 查阅/删除权的统一入口）───
    if (url.pathname === "/api/memory-hub" && req.method === "GET") {
      const main = {};
      if (hasDb) {
        try { for (const r of db.getAllMemories()) if (!String(r.key).startsWith("persona:")) main[r.key] = String(r.value || ""); } catch {}
      } else {
        const mem = loadJson("memories.json");
        for (const k of Object.keys(mem)) if (!k.startsWith("persona:")) main[k] = String(mem[k] || "");
      }
      const personas = [];
      try {
        for (const p of personaAll()) {
          const items = [];
          const pfx = `persona:${p.id}:`;
          if (hasDb) {
            try { for (const r of db.getAllMemories()) if (String(r.key).startsWith(pfx)) items.push({ key: String(r.key).slice(pfx.length), value: String(r.value || "") }); } catch {}
          } else {
            const mem = loadJson("memories.json");
            for (const k of Object.keys(mem)) if (k.startsWith(pfx)) items.push({ key: k.slice(pfx.length), value: String(mem[k] || "") });
          }
          if (items.length > 0) personas.push({ id: p.id, name: p.name, avatar: p.avatar, items });
        }
      } catch {}
      const mainCount = Object.keys(main).length;
      const personaCount = personas.reduce((s, p) => s + p.items.length, 0);
      return json(res, { ok: true, main, personas, stats: { main: mainCount, persona: personaCount, total: mainCount + personaCount } });
    }
    // 记忆中枢：删除主对话记忆单条（复用 /api/memories/:key DELETE 已有），此处补角色记忆删除与全清
    if (url.pathname.startsWith("/api/memory-hub/persona/") && req.method === "DELETE") {
      const rest = decodeURIComponent(url.pathname.split("/api/memory-hub/persona/")[1] || "");
      const slash = rest.indexOf("/");
      const pid = slash > 0 ? rest.slice(0, slash) : rest;
      const slug = slash > 0 ? rest.slice(slash + 1) : "";
      const pfx = `persona:${pid}:`;
      if (hasDb) {
        try {
          if (slug) db.deleteMemory(pfx + slug);
          else for (const m of personaMemories(pid)) db.deleteMemory(pfx + m.key);
          return json(res, { ok: true });
        } catch {}
      }
      const mem = loadJson("memories.json");
      if (slug) delete mem[pfx + slug];
      else for (const k of Object.keys(mem)) if (k.startsWith(pfx)) delete mem[k];
      saveJson("memories.json", mem);
      return json(res, { ok: true });
    }

    // --- 长期记忆 API（统一 SQLite）---
    if (url.pathname === "/api/memories" && req.method === "GET") {
      // 角色记忆（persona: 前缀）是独立域，走 /api/memory-hub 分角色展示；
      // 混进主对话记忆列表会让两边看起来互相污染（用户实测反馈）
      const isMain = (k: string) => !k.startsWith("persona:");
      if (hasDb) {
        try {
          const rows = db.getAllMemories().filter((r) => isMain(r.key));
          return json(res, Object.fromEntries(rows.map((r) => [r.key, r.value])));
        } catch {}
      }
      const local = loadJson("memories.json");
      return json(res, Object.fromEntries(Object.entries(local).filter(([k]) => isMain(k))));
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
      if (hasDb) { try { db.setMemory(key, value == null ? "" : String(value)); return json(res, { ok: true }); } catch {} }
      // 分家守卫：知识库条目(kb_/knowledge)与会话摘要(ctx_summary_)不得写入长期记忆
      if (key) {
        const k = String(key)
        if (/^(kb_|kb:|knowledge|ctx_summary_)/i.test(k)) return json(res, { error: "该键不属于长期记忆（知识库/会话摘要请走各自存储）" }, 400);
      }
      const mem = loadJson("memories.json");
      mem[key] = value;
      saveJson("memories.json", mem);
      return json(res, { ok: true });
    }
    if (url.pathname.startsWith("/api/memories/") && req.method === "DELETE") {
      const key = decodeURIComponent(url.pathname.split("/api/memories/")[1]);
      if (hasDb) { try { db.deleteMemory(key); return json(res, { ok: true }); } catch {} }
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
        await gitRun(d, ["commit", "-m", msg]);
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
    // 按文件名模糊搜索（@ 提及补全用）。与 /api/code/search 不同——那个是内容 grep，
    // 这里只要"名字里含这个片段"，所以直接遍历目录树，不落 shell。
    if (url.pathname === "/api/code/find-files" && req.method === "GET") {
      try {
        const root = path.resolve(url.searchParams.get("path") || globalWorkDir || process.env.HOME);
        if (!ok(root)) return json(res, { success: false, error: "路径不允许", files: [] }, 403);
        const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
        if (!q) return json(res, { success: true, files: [] });
        const cap = Math.min(Number(url.searchParams.get("limit")) || 20, 50);
        const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".next", "target", ".venv", "venv", ".cache"]);
        const MAX_DEPTH = 8;
        const MAX_SCAN = 20000;
        const files = [];
        let scanned = 0;
        let overflow = false;
        var walk = (dir, depth) => {
          if (files.length >= cap || overflow) return;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (files.length >= cap) return;
            if (e.name.startsWith(".")) continue;
            if (++scanned > MAX_SCAN) { overflow = true; return; }
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              if (SKIP.has(e.name) || depth >= MAX_DEPTH) continue;
              walk(full, depth + 1);
            } else if (e.isFile() && e.name.toLowerCase().includes(q)) {
              files.push({ name: e.name, path: full });
            }
          }
        };
        walk(root, 0);
        return json(res, { success: true, files, truncated: overflow || scanned > MAX_SCAN });
      } catch (e) { return json(res, { success: false, error: e.message, files: [] }, 500); }
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
        // query / target 走环境变量，不拼进命令文本：
        // 之前用 JSON.stringify 包成双引号，`$(...)` 与反引号仍会被 shell
        // 展开执行（实测 `"$(whoami)"` 能跑）；env 展开不会再求值。
        if (IS_WIN) {
          // 这里原来固定用 zsh——Windows 上根本没有 zsh，全局搜索必然
          // 报 spawn ENOENT，整个功能等于不可用。改用 PowerShell Select-String。
          const cmd = "$ErrorActionPreference='SilentlyContinue'; "
            + "Get-ChildItem -Path $env:JT_DIR -Recurse -File | "
            + "Where-Object { $_.FullName -notmatch '\\\\(node_modules|\\.git|dist|build|__pycache__|\\.next|target)\\\\' } | "
            + "Select-String -Pattern $env:JT_QUERY -List | Select-Object -First 50 -ExpandProperty Path";
          const r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd],
            { timeout: 15e3, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_DIR: target, JT_QUERY: String(query || "") } });
          const files = r.stdout.trim().split(/\r?\n/).filter(Boolean);
          return json(res, { success: true, files });
        }
        const excludeDirs = ["node_modules", ".git", "dist", "build", "__pycache__", ".next", "target"].map((d) => `-path '*/${d}' -prune -o`).join(" ");
        const r = await execAsync(SHELL_BIN, shellArgs(`find "$JT_DIR" ${excludeDirs} -type f -print0 | xargs -0 grep -Il "$JT_QUERY" | head -50`),
          { timeout: 15e3, maxBuffer: MAX_OUT, env: { ...shellEnv(), JT_DIR: target, JT_QUERY: String(query || "") } });
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
if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }`], { timeout: 120e3, env: shellEnv() });
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
if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }`], { timeout: 120e3, env: shellEnv() });
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
          r = await execAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command || "Write-Output ready"], { timeout: 10e3, cwd: safeCwd(cwd), maxBuffer: 512 * 1024, env: shellEnv() });
        } else {
          r = await execAsync(SHELL_BIN, shellArgs(command || "echo ready"), { timeout: 10e3, cwd: safeCwd(cwd), maxBuffer: 512 * 1024 });
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
        // 付费档不再下发：本面板定位是"免 key 就能用"，混着 375 个付费档
        // 既让清单臃肿，也容易让人误以为选中的是免费额度。需要付费模型
        // 走设置里的常规供应商配置。
        const paid: typeof arr = [];
        // Zen 清单：每次请求实时拉上游 /models。拉不到就退回离线兜底，
        // 而不是让面板空着——用户至少能看到上次已知的可用项。
        const zenRes = ZEN_MOD ? await ZEN_MOD.fetchZenModels() : { ok: false, models: [], error: "模块未加载" };
        const zenFetchOk = !!zenRes.ok;
        const zenFetchErr = zenRes.error || "";
        const zenModels = (zenFetchOk && zenRes.models.length
          ? zenRes.models
          : (ZEN_MOD ? ZEN_MOD.ZEN_FREE_MODELS : []).map((m) => ({ id: m.id, name: m.name, free: true }))
        ).map((m) => ({
          id: m.id, name: m.name, context: 131072, vision: false, tools: true,
          // 已知用不了的标注出来，界面据此显示状态而不是假装可用
          ...(m.dead ? { unavailable: true, reason: m.dead } : {}),
        }));
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
              // OpenCode Zen 免费车道：清单每次实时拉取上游 /models，
              // 显示全部 -free 条目（含当前网络下不可用的，带状态标注）——
              // 用户有权看到上游声明了什么、哪些在这个出口用不了。
              // 拉取失败时退回离线兜底清单，不显示空面板。
              id: "opencode-zen", name: "OpenCode Zen Free", keyless: true,
              base: "https://opencode.ai/zen/v1",
              note: "免 key 公共档：每次实时拉取上游清单（需流式，已自动处理）",
              models: zenModels,
              ...(zenFetchOk ? {} : { note2: zenFetchErr || "上游拉取失败，显示离线清单" }),
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
            const __rows = sharedDb ? db.getAllSettings() : [];
            for (const __r of __rows) { if (__r.key === "apiKey" && __r.value) apiKey = String(__r.value); }
          } catch {}
        }
        if (!targetBase) return json(res, { models: [], error: "缺少 API 地址" }, 200);
        // OpenCode Zen 的 /models 也要客户端指纹，否则拿不到清单
        const zenList = isZenBase(targetBase);
        const listHeaders: Record<string, string> = zenList
          ? zenHeaders(mintSessionId(), mintRequestId(), false)
          : (apiKey && apiKey !== "free" && apiKey !== "keyless" ? { "Authorization": `Bearer ${apiKey}` } : {});
        const r = await fetch(`${targetBase.replace(/\/+$/, "")}/models`, {
          headers: listHeaders,
          signal: AbortSignal.timeout(15e3)
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          return json(res, { models: [], error: `HTTP ${r.status}${detail ? " · " + detail.slice(0, 200) : ""}` }, 200);
        }
        const data2 = await r.json().catch(() => null);
        const arr = Array.isArray(data2?.data) ? data2.data : Array.isArray(data2) ? data2 : [];
        // Zen 是混合清单（85 个里只有 9 个免费），本车道只列免费档——
        // 否则用户选中付费 id 会直接报错
        const ids = arr.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
        const models = [...new Set(zenList ? ids.filter((id) => /-free$/.test(id) || id === "big-pickle") : ids)];
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
          return json(res, { success: true, text, engine: "local" })
        } catch (e) {
          // 本地引擎不可用（Windows/Linux/手机常见：没 python 或没模型）
          // → 云端识别（用户已配置的 OpenAI 兼容端点），让语音输入在所有端可用
          try {
            const text = await cloudAsr(audioData, String(ctype));
            return json(res, { success: true, text, engine: "cloud" });
          } catch (ce) {
            return json(res, { success: false, error: `语音识别失败: ${e.stderr || e.message} / 云端: ${ce.message}` }, 500);
          }
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
        // v11.0.1:TTS 磁盘缓存 —— 相同文本+音色+语速第二次朗读零等待
        const ttsCacheDir = path.join(DATA_DIR, "tts-cache");
        const ttsKey = TTS_MOD.cacheKey(spoken, voice, speed);
        try {
          const hit = TTS_MOD.cacheLookup(ttsCacheDir, ttsKey);
          if (hit) {
            res.writeHead(200, { ...(corsHeaders(req) || {}), "Content-Type": hit.mime, "X-TTS-Cache": "hit" });
            res.end(hit.buf);
            return;
          }
        } catch {}
        // v10.8：Node 原生 Edge TTS 优先（零 python 依赖，mac-x64/Win 全平台可用，
        // 引擎随 app.asar 分发）；失败回落打包的 python edge-tts 服务（5050）。
        try {
          const nodeTTS = require("./electron/edge-tts.cjs");
          const mp3 = await nodeTTS.synthesize(spoken, voice || "zh-CN-XiaoxiaoNeural", Number(speed) || 1.0);
          try { fs.mkdirSync(path.join(DATA_DIR, "tts-cache"), { recursive: true }); fs.writeFileSync(ttsCacheFile, mp3); } catch {}
          res.writeHead(200, { ...(corsHeaders(req) || {}), "Content-Type": "audio/mpeg" });
          res.end(mp3);
          return;
        } catch (nodeErr) {
          console.error("[TTS] node-native 失败,回落系统语音:", nodeErr.message);
        }
        // 系统语音兜底（离线可用）：Edge TTS 403/断网时保证"至少能读出来"
        try {
          if (!TTS_MOD) throw new Error("TTS 模块不可用");
          const os = await TTS_MOD.osTtsSynthesize(spoken, voice, speed, ttsExecFile, path.join(DATA_DIR, "tts-tmp"));
          if (os && os.buf && os.buf.length > 0) {
            TTS_MOD.cacheStore(ttsCacheDir, ttsKey, os.ext, os.buf);
            res.writeHead(200, { ...(corsHeaders(req) || {}), "Content-Type": os.mime, "X-TTS-Engine": "os" });
            res.end(os.buf);
            return;
          }
        } catch (osErr) {
          console.error("[TTS] 系统语音不可用:", osErr.message);
        }
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

    // ─── v11 深度调研:服务端编排（拆检索词 → 多轮搜索 → 抓取正文 → 交叉引用报告）───
    // 服务端 LLM 调用:配置的模型优先,失败自动落免费链（与 llm-proxy 接力同一批上游）
    async function serverLLM(messages, maxTokens, temperature) {
      let cfgBase = "", cfgKey = "", cfgModel = "";
      try {
        const rows = sharedDb ? db.getAllSettings() : [];
        for (const r of rows) {
          if (r.key === "apiBaseUrl") cfgBase = String(r.value || "");
          if (r.key === "apiKey") cfgKey = String(r.value || "");
          if (r.key === "model") cfgModel = String(r.value || "");
        }
      } catch {}
      const chain = [];
      if (cfgBase && cfgModel && cfgKey && cfgKey.indexOf("****") < 0 && cfgKey !== "free" && cfgKey !== "keyless") {
        chain.push({ base: cfgBase, key: cfgKey, model: cfgModel });
      }
      chain.push(
        { base: "https://api.kilo.ai/api/gateway/v1", key: "free", model: "openrouter/free" },
        { base: "https://text.pollinations.ai/openai", key: "free", model: "openai-fast" },
      );
      for (const u of chain) {
        try {
          const url = /\/openai$/.test(u.base) ? u.base : `${u.base}/chat/completions`;
          const headers = { "Content-Type": "application/json" };
          if (u.key !== "free" && u.key !== "keyless" && u.key) headers["Authorization"] = `Bearer ${u.key}`;
          const r = await fetch(url, {
            method: "POST", headers,
            body: JSON.stringify({ model: u.model, messages, max_tokens: maxTokens, stream: false, temperature: temperature ?? 0.4 }),
            signal: AbortSignal.timeout(120000),
          });
          if (!r.ok) continue;
          const d = await r.json();
          const content = String(d?.choices?.[0]?.message?.content || "").trim();
          if (content) return content;
        } catch { /* 试下一家 */ }
      }
      return "";
    }
    if (url.pathname === "/api/deep-research" && req.method === "POST") {
      try {
        const { query } = await body(req);
        const q = String(query || "").trim();
        if (!q) return json(res, { error: "缺少 query" }, 400);
        res.writeHead(200, {
          ...(corsHeaders(req) || {}),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        const sse = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

        // 阶段一：拆检索词
        sse({ phase: "plan", detail: "正在拆解检索策略" });
        const planRaw = await serverLLM([
          { role: "system", content: '你是调研检索策划。针对用户问题给出 3-5 个搜索词：第一个必须与用户原问题几乎一致（保证相关性底线），其余从不同角度变换（可含英文视角）。只输出 JSON：{"queries":["...","..."]}，不要输出其他内容。' },
          { role: "user", content: q },
        ], 300, 0.3);
        let queries = [];
        try { queries = (JSON.parse((planRaw.match(/\{[\s\S]*\}/) || [])[0] || "{}").queries || []).map((s) => String(s).slice(0, 80)).filter(Boolean); } catch {}
        if (queries.length === 0) queries = [q];
        queries = queries.slice(0, 5);

        // 阶段二：多轮搜索
        sse({ phase: "search", total: queries.length, queries });
        const urlSet = new Map(); // url -> title
        for (let i = 0; i < queries.length; i++) {
          const qr = await web_search({ query: queries[i] });
          let found = 0;
          if (qr?.success) {
            const urls = String(qr.output || "").match(/https?:\/\/[^\s)\]"'<>]+/g) || [];
            for (const u of urls) {
              const clean = u.replace(/[.,;]+$/, "");
              if (!urlSet.has(clean) && !/bing\.com|duckduckgo\.com|google\./.test(clean)) { urlSet.set(clean, ""); found++; }
            }
          }
          sse({ phase: "search", index: i + 1, total: queries.length, query: queries[i], found });
        }

        // 阶段三：抓取正文（最多 5 篇，并行）+ 相关性过滤（查询 2 字滑窗 gram 命中判定，滤 SERP 垃圾站）
        const sources = [...urlSet.keys()].slice(0, 5);
        sse({ phase: "fetch", total: sources.length, sources });
        const qClean = q.replace(/[^\u4e00-\u9fff\w]/g, "");
        const qGrams = new Set();
        for (let i = 0; i < qClean.length - 1; i++) qGrams.add(qClean.slice(i, i + 2));
        const excerpts = [];
        await Promise.all(sources.map(async (u, i) => {
          const fr = await web_fetch({ url: u }).catch(() => null);
          let text = fr?.success ? String(fr.output || "").replace(/\n{2,}/g, "\n").slice(0, 6000) : "";
          let relevant = false;
          if (text) {
            let hits = 0;
            for (const g of qGrams) if (text.includes(g)) hits++;
            // 至少命中 2 个不同 gram 且覆盖率不过低,才算与问题相关
            relevant = hits >= Math.max(2, Math.ceil(qGrams.size * 0.08));
          }
          if (relevant) excerpts.push({ url: u, ok: true, text });
          sse({ phase: "fetch", index: i + 1, total: sources.length, url: u, ok: !!fr?.success, relevant });
        }));

        // 阶段四：交叉引用报告
        sse({ phase: "write", detail: "正在撰写带引用的报告" });
        const excerptBlock = excerpts
          .filter((e) => e.ok && e.text.length > 200)
          .map((e, i) => `【来源 ${i + 1}】${e.url}\n${e.text}`)
          .join("\n\n---\n\n");
        let report = "";
        if (excerptBlock) {
          report = await serverLLM([
            { role: "system", content: "你是深度调研员。基于给定的网络来源撰写一份结构化中文调研报告（markdown）：\n# 结论先行\n# 关键发现（分点，每个事实标注来源编号如 [1]）\n# 分歧与不确定性\n# 参考来源（列 URL）\n要求：只依据给定来源，不编造；来源之间有出入时明确指出；语言精炼。" },
            { role: "user", content: `调研问题：${q}\n\n来源与正文：\n\n${excerptBlock.slice(0, 40000)}` },
          ], 3000, 0.4);
        }
        if (!report) {
          // 兜底：模型不可用时给出来源清单
          report = `# 调研原始结果：${q}\n\n（报告生成服务暂不可用，以下为检索到的来源列表）\n\n${sources.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
        }
        // 落盘
        let file = "";
        try {
          const dir = path.join(DATA_DIR, "research");
          fs.mkdirSync(dir, { recursive: true });
          file = path.join(dir, `${Date.now()}.md`);
          fs.writeFileSync(file, `# 深度调研：${q}\n\n${report}\n`, "utf-8");
        } catch {}
        sse({ done: true, report, sources, file: path.basename(file || "") });
        res.end();
      } catch (e) {
        try { res.write(`data: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`); } catch {}
        res.end();
      }
      return;
    }

    // ─── 深度调研历史：列表 / 读取 / 删除 ───
    // 报告由 /api/deep-research 落盘到 DATA_DIR/research/<时间戳>.md，
    // 这里只做受控的列举与读取：文件名一律走 resolveWithin 风格的白名单校验，
    // 不允许带路径分隔符，杜绝 ../../ 越权读文件
    var RESEARCH_DIR = path.join(DATA_DIR, "research");
    if (url.pathname === "/api/research/history" && req.method === "GET") {
      try {
        var items = [];
        if (fs.existsSync(RESEARCH_DIR)) {
          var entries = fs.readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".md"));
          for (var f of entries) {
            var st = fs.statSync(path.join(RESEARCH_DIR, f));
            var title = "";
            try {
              // 只取首行：报告正文第一行可能就是模型的思考过程残文，
              // 多读几行会把正文吞进标题
              var first = fs.readFileSync(path.join(RESEARCH_DIR, f), "utf-8").split("\n")[0] || "";
              var m = first.match(/深度调研[：:]\s*(.{1,120})/);
              if (m) title = m[1].trim();
            } catch {}
            items.push({
              file: f,
              at: st.mtime.toISOString(),
              ts: parseInt(f.replace(/\.md$/, ""), 10) || st.mtimeMs,
              title: title || "未命名调研",
              size: st.size,
            });
          }
          items.sort((a, b) => b.ts - a.ts);
        }
        return json(res, { items: items.slice(0, 100) });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname.startsWith("/api/research/history/") && req.method === "GET") {
      var want = decodeURIComponent(url.pathname.slice("/api/research/history/".length));
      // 只接受纯文件名：拒绝任何带分隔符或 .. 的输入
      if (!/^[\w.-]+\.md$/.test(want) || want.includes("..")) {
        return json(res, { error: "非法文件名" }, 400);
      }
      var full = path.resolve(RESEARCH_DIR, want);
      if (!full.startsWith(path.resolve(RESEARCH_DIR) + path.sep)) return json(res, { error: "非法文件名" }, 400);
      if (!fs.existsSync(full)) return json(res, { error: "报告不存在" }, 404);
      try {
        var text = fs.readFileSync(full, "utf-8");
        return json(res, { file: want, content: text });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname.startsWith("/api/research/history/") && req.method === "DELETE") {
      var del = decodeURIComponent(url.pathname.slice("/api/research/history/".length));
      if (!/^[\w.-]+\.md$/.test(del) || del.includes("..")) {
        return json(res, { error: "非法文件名" }, 400);
      }
      var dpath = path.resolve(RESEARCH_DIR, del);
      if (!dpath.startsWith(path.resolve(RESEARCH_DIR) + path.sep)) return json(res, { error: "非法文件名" }, 400);
      try {
        if (fs.existsSync(dpath)) await fsp.unlink(dpath);
        return json(res, { success: true });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // ─── 一键备份导出 / 导入 ───
    // 备份范围与体积预览（v12.1）：让用户在导出前知道"会导出什么、多大"
    if (url.pathname === "/api/backup/stats" && req.method === "GET") {
      try {
        if (!hasDb) return json(res, { error: "db unavailable" }, 503);
        const sessions = db.listSessions() || [];
        let messages = 0;
        for (const ses of sessions) messages += (db.getMessages(ses.id) || []).length;
        const settings = (db.getAllSettings() || []).length;
        const memories = (db.getAllMemories() || []).length;
        // 知识库与技能按目录条目估算
        const countDir = (dir) => { try { return fs.readdirSync(dir).length } catch { return 0 } };
        const knowledge = countDir(path.join(DATA_DIR, "knowledge"));
        const skills = countDir(path.join(LYCLAW_HOME, "skills"));
        return json(res, {
          // 注意：这里必须是"数量"而不是数组本身。
          // sessions 变量是会话数组，直接塞进去会让前端拿到一整个列表当计数用
          settings, sessions: sessions.length, messages, memory: memories, knowledge, skills,
          // 体积按实际 JSON 序列化长度估，别让用户对"预计大小"产生怀疑
          bytes: {
            settings: JSON.stringify(db.getAllSettings() || []).length,
            sessions: JSON.stringify(sessions).length + JSON.stringify(sessions.map(x => db.getMessages(x.id) || [])).length,
            memory: JSON.stringify(db.getAllMemories() || []).length,
            knowledge: 0,
            skills: 0,
          },
        });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/backup/export" && req.method === "GET") {
      try {
        if (!hasDb) return json(res, { error: "db unavailable" }, 500);
        const sessions = db.listSessions();
        const messages = {};
        for (const ses of sessions) messages[ses.id] = db.getMessages(ses.id);
        const settingsRows = db.getAllSettings();
        const settingsObj = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
        const memories = db.getAllMemories();
        return jsonRaw(res, { version: 1, exported_at: new Date().toISOString(), sessions, messages, settings: settingsObj, memories });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/backup/import" && req.method === "POST") {
      try {
        // 数据库不可用时明确报错：此前会抛 TypeError（reading 'listSessions'），
        // 用户看到的是内部错误而不是「数据库没起来，请重启应用」
        if (!hasDb) return json(res, { error: "本地数据库不可用，无法导入。请重启应用后重试。" }, 503);
        const data = await body(req);
        if (!data.sessions) return json(res, { error: "备份文件格式不正确" }, 400);
        let ns = 0, nm = 0, skipped = 0;
        // 导入的会话 id 可能与现有数据冲突。底层 createSession 是
        // INSERT OR REPLACE —— 直接导入会静默覆盖当前会话，用户以为在
        // "恢复备份"，实际把现有数据冲掉了。冲突时改开新 id 并注明来源。
        const existing = new Set((db.listSessions() || []).map((s) => s.id));
        const idMap = new Map();
        for (const ses of (data.sessions || [])) {
          let id = ses.id;
          if (!id) { id = db.genId(); }
          else if (existing.has(id)) {
            id = db.genId();
            skipped++;
          }
          idMap.set(ses.id, id);
          db.createSession(id, ses.title || "导入会话");
          ns++;
        }
        for (const [sid, msgs] of Object.entries(data.messages || {})) {
          // 消息归属的会话必须存在：备份文件可能被手工编辑过，
          // 写入孤儿消息后界面上永远看不到，却占着库
          const targetSid = idMap.get(sid) || (existing.has(sid) ? sid : null);
          if (!targetSid) continue;
          for (const m of (msgs || [])) {
            db.addMessage(m.id || db.genId(), targetSid, m.role, m.content || "", m.thinking || "", typeof m.tool_calls === "string" ? m.tool_calls : JSON.stringify(m.tool_calls || []), m.tool_call_id || "");
            nm++;
          }
        }
        for (const [k, v] of Object.entries(data.settings || {})) {
          // 旧版（掩码导出时期）的备份文件里密钥是 ****，跳过以免把掩码写回库
          if (isMasked(v)) continue;
          db.setSetting(k, String(v));
        }
        for (const mem of (data.memories || [])) db.setMemory(mem.key || db.genId(), mem.value || "");
        return json(res, { ok: true, sessions: ns, messages: nm, renamed: skipped });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // ─── 知识库 RAG ───
    // embeddings 代理：按设置自动选地址与密钥（未配置时明确报错）
    async function kbEmbedTexts(texts) {
      const rows = sharedDb ? db.getAllSettings() : [];
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
        const rows = db.listKbEntries();
        const all = rows.map((e) => ({ ...e, tags: JSON.parse(e.tags || "[]"), links: JSON.parse(e.links || "[]"), backlinkCount: db.kbBacklinks(e.id).length }));
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
        const es = db.listKbEntries();
        let chunks = 0, notes = 0;
        for (const e of es) { const c = await kbIndexEntry(e.id, e.title, e.content || ""); chunks += c; notes++ }
        return json(res, { ok: true, notes, chunks });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/notebooks" && req.method === "GET") {
      if (!sharedDb) return json(res, { notebooks: [] });
      try { return json(res, { notebooks: db.kbNotebooks() }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/search-notes" && req.method === "GET") {
      if (!sharedDb) return json(res, { results: [] });
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json(res, { results: [] });
      try { return json(res, { results: db.kbSearchNotes(q) }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname.startsWith("/api/kb/entry/") && req.method === "DELETE") {
      try { db.deleteKbEntry(url.pathname.split("/").pop()); kbBump(); return json(res, { ok: true }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (url.pathname === "/api/kb/status" && req.method === "GET") {
      if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
      const rows = db.kbAll();
      const files = [...new Set(rows.map((r) => r.path))];
      return json(res, { chunks: rows.length, files: files.length, paths: files.slice(0, 200) });
    }
    if (url.pathname === "/api/kb/clear" && req.method === "POST") {
      if (!sharedDb) return json(res, { error: "db unavailable" }, 500);
      db.kbClear(); kbBump();
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
        let totalChunks = 0;
        for (const fp of files) {
          db.kbDeleteByPath(fp); kbBump();
          let text = "";
          try { text = fsMod.readFileSync(fp, "utf-8"); } catch { continue; }
          const chunks = kbSplitChunks(text).slice(0, 120);
          if (chunks.length === 0) continue;
          for (let i = 0; i < chunks.length; i += 16) {
            const batch = chunks.slice(i, i + 16);
            const vectors = await kbEmbedTexts(batch);
            batch.forEach((ck, j) => { db.kbInsert(fp, ck, vectors[j] || []); totalChunks++; });
          if (batch.length) kbBump();
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
        if (db.kbCount() === 0) return json(res, { hits: [] });
        const [qv] = await kbEmbedTexts([String(query).slice(0, 1000)]);
        const rows = kbRowsCached();
        const hits = rows
          .map((r) => ({ path: r.path, chunk: r.chunk, score: kbCosine(qv, r.vec) }))
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
  console.log(`
  \u{1F43E} \u8001\u6538 Agent v2 \u2014 http://localhost:${PORT}
  ${Object.keys(TOOLS).length} tools | \u5355\u8FDB\u7A0B | \u4F4E\u5185\u5B58
  `);
});

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

// ─── 应用公告拉取（v11.7）：GitHub docs/notice.md ────────────────────────────
//
// 设计：
//   - 公告文件放 GitHub 仓库 docs/notice.md，Pages 与 raw 两个域名互为镜像
//     （国内网络 raw.githubusercontent 常被墙，Pages 走 github.io 相对稳；
//     两个都失败再用 gh 加速镜像兜底）
//   - 结果缓存到 ~/.lyclaw/data/announcement.json，TTL 6 小时——
//     进应用每次都会请求，但不该每次都出网；离线时回缓存
//   - 解析器（shared/announcement.ts）负责格式与 id，服务端只管取+缓存
const ANNOUNCE_FILE = path.join(DATA_DIR, "announcement.json");
const ANNOUNCE_SOURCES = [
  "https://deepseekv5.github.io/jutian-agent/notice.md",
  "https://raw.githubusercontent.com/deepseekv5/jutian-agent/main/docs/notice.md",
  "https://gh-proxy.com/https://raw.githubusercontent.com/deepseekv5/jutian-agent/main/docs/notice.md",
];
var _announceTtlMs = 15 * 60 * 1000; // 公告要能及时触达：6h 太长，压到 15 分钟
function readAnnounceCache() {
  try { return JSON.parse(fs.readFileSync(ANNOUNCE_FILE, "utf-8")); } catch { return null; }
}
function writeAnnounceCache(obj) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ANNOUNCE_FILE, JSON.stringify(obj)); } catch {}
}
async function fetchAnnouncementText() {
  for (const src of ANNOUNCE_SOURCES) {
    try {
      const r = await fetch(src, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.trim()) return t;
    } catch { /* 换下一个源 */ }
  }
  return "";
}
async function getAnnouncement(forceFresh) {
  // 缓存形状是扁平的 { announcement, fetchedAt }（见 writeAnnounceCache(data)）。
  // 读取必须展开 cache 本身。之前两条都写成 ...cache.data——cache 没有 .data 层，
  // 展开 undefined 等于什么都没带，于是命中 6h 缓存的请求全部回 announcement 缺失，
  // 横幅只在缓存刚写入那一次显示、之后每次进应用都消失（实测复现）。
  const cache = readAnnounceCache();
  const fresh = cache && Date.now() - (cache.fetchedAt || 0) < _announceTtlMs;
  if (fresh && !forceFresh) return { ok: true, announcement: cache.announcement || null, cached: true };
  const text = await fetchAnnouncementText();
  if (!text) {
    // 出网失败：有旧缓存就用旧的（哪怕过期），没有就返回"无公告"。
    // 关键是不能因为取不到公告就弹错误——公告是锦上添花。
    if (cache) return { ok: true, announcement: cache.announcement || null, cached: true };
    return { ok: true, announcement: null };
  }
  const parsed = ANNOUNCE_MOD ? ANNOUNCE_MOD.parseNoticeMd(text) : null;
  const data = { announcement: parsed, fetchedAt: Date.now() };
  writeAnnounceCache(data);
  return { ok: true, ...data, cached: false };
}

function runScheduler() {  try {
    const rows = sharedDb ? db.getAllSettings() : [];
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

// ─── 合盖保持运行：caffeinate 防止系统休眠（设置 keepAwake，默认开启）───
let caffeinateProc = null;
function syncKeepAwake() {
  let on = true; // 默认开启（未设置过该选项视为开启）
  try {
    if (hasDb) {
      const v = db.getSetting("keepAwake");
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
// 空会话定期清理：每小时一次。启动时已经跑过一次，但用户可能几天不重启
// 应用（实测遇到过），只在启动时清理等于永远不清。保护集传空——
// 正在被打开的会话都有消息或正被使用，空会话删掉不丢内容。
setInterval(function () { try { runEmptyCleanup(new Set()); } catch {} }, 3600e3);
