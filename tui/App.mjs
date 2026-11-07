var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// tui/api.mjs
var api_exports = {};
__export(api_exports, {
  BASE: () => BASE,
  PORT: () => PORT,
  REPO_ROOT: () => REPO_ROOT,
  chatRun: () => chatRun,
  createSession: () => createSession,
  getSettings: () => getSettings,
  health: () => health,
  listSessions: () => listSessions,
  loadMessages: () => loadMessages,
  saveMessage: () => saveMessage,
  startApp: () => startApp,
  startBackend: () => startBackend,
  waitHealth: () => waitHealth
});
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
async function jfetch(path, opts = {}, timeoutMs = 1e4) {
  const res = await fetch(BASE + path, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: text };
  }
}
async function health() {
  try {
    const r = await jfetch("/api/health", {}, 1500);
    return r.ok && r.data?.status === "ok" ? r.data : null;
  } catch {
    return null;
  }
}
async function startBackend() {
  const serveCjs = resolve(REPO_ROOT, "serve.cjs");
  if (existsSync(serveCjs)) {
    const out = openSync("/tmp/jutian-serve-tui.log", "a");
    const child = spawn(process.execPath, [serveCjs], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, PORT: String(PORT), JUTIAN_HEADLESS: "1" },
      cwd: REPO_ROOT
    });
    child.unref();
    return { via: "serve.cjs", pid: child.pid };
  }
  return startApp();
}
function startApp() {
  const plat = process.platform;
  const candidates = plat === "darwin" ? ["/Applications/\u5DE8\u5929agent.app", `${process.env.HOME}/Applications/\u5DE8\u5929agent.app`] : plat === "win32" ? [`${process.env.LOCALAPPDATA}\\Programs\\\u5DE8\u5929agent\\\u5DE8\u5929agent.exe`, `C:\\Program Files\\\u5DE8\u5929agent\\\u5DE8\u5929agent.exe`] : [`${process.env.HOME}/.local/share/applications/\u5DE8\u5929agent`, `/opt/\u5DE8\u5929agent/\u5DE8\u5929agent`];
  const found = candidates.find((p) => existsSync(p));
  if (!found) return null;
  if (plat === "darwin") spawn("open", ["-a", found], { detached: true, stdio: "ignore" }).unref();
  else spawn(found, [], { detached: true, stdio: "ignore" }).unref();
  return { via: found };
}
async function waitHealth(timeoutMs = 6e4, onTick) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await health();
    if (h) return h;
    onTick?.(Math.round((Date.now() - t0) / 1e3));
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}
async function getSettings() {
  const r = await jfetch("/api/settings");
  return r.data || {};
}
async function listSessions(limit = 10) {
  const r = await jfetch("/api/sessions");
  const items = Array.isArray(r.data) ? r.data : [];
  return items.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, limit);
}
async function createSession(title) {
  const r = await jfetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
  return r.data;
}
async function loadMessages(sid) {
  const r = await jfetch(`/api/sessions/${encodeURIComponent(sid)}/messages`);
  return Array.isArray(r.data) ? r.data : [];
}
async function saveMessage(sid, m) {
  await jfetch(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...m, created_at: m.created_at || (/* @__PURE__ */ new Date()).toISOString() })
  }, 15e3).catch(() => {
  });
}
async function* sseLines(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (line.startsWith("data: ")) yield line.slice(6);
      }
    }
  }
}
async function chatRun(payload, hooks, signal) {
  let msgs = payload.messages;
  let resume;
  let pendingTool;
  const confirmations = {};
  const approvedScopes = [...payload.approvedScopes || []];
  for (let hop = 0; hop < 30; hop++) {
    if (signal?.aborted) return;
    let res;
    try {
      res = await fetch(BASE + "/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: msgs,
          tools: payload.tools,
          model: payload.model,
          apiBase: payload.apiBase,
          apiKey: "",
          // 留空 → 服务端回落到本机存储的真实密钥（密钥不出电脑）
          contextWindow: payload.contextWindow,
          hermesMode: payload.hermesMode,
          disabledTools: payload.disabledTools || [],
          workDir: payload.workDir || void 0,
          permissionLevel: payload.permissionLevel || "standard",
          resume,
          pendingTool,
          confirmations,
          approvedScopes
        }),
        signal
      });
    } catch (e) {
      if (e?.name === "AbortError") return;
      hooks.onEvent({ type: "error", message: `\u65E0\u6CD5\u8FDE\u63A5\u672C\u5730\u670D\u52A1\uFF1A${e?.message || e}` });
      return;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      hooks.onEvent({ type: "error", message: `agent \u542F\u52A8\u5931\u8D25\uFF08HTTP ${res.status}\uFF09${text ? "\uFF1A" + text.slice(0, 200) : ""}` });
      return;
    }
    let needs = null;
    try {
      for await (const data of sseLines(res.body)) {
        let ev;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.type === "needs_client") {
          needs = ev;
          break;
        }
        hooks.onEvent(ev);
        if (ev.type === "done" || ev.type === "error" || ev.type === "aborted") return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
      hooks.onEvent({ type: "error", message: `\u8FDE\u63A5\u4E2D\u65AD\uFF1A${e?.message || e}` });
      return;
    }
    if (!needs) {
      hooks.onEvent({ type: "error", message: "\u8FDE\u63A5\u4E2D\u65AD\uFF1A\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE\u7ED3\u679C" });
      return;
    }
    msgs = needs.messages || msgs;
    resume = needs.partial;
    if (needs.kind === "client_tool" && needs.tool) {
      let out = '{"ok":true}';
      try {
        out = await hooks.onClientTool?.(needs.tool) || out;
      } catch (e) {
        out = '{"ok":false,"error":"' + String(e?.message || e).replace(/"/g, "'") + '"}';
      }
      msgs = [...msgs, { role: "tool", tool_call_id: needs.tool.id, content: out }];
      pendingTool = void 0;
      continue;
    }
    if (needs.kind === "confirm" && needs.tool) {
      const verdict = await hooks.onConfirm?.(needs.tool, needs.scopeKey) || "deny";
      if (verdict === "deny") pendingTool = { toolCall: needs.tool, decision: "\u7528\u6237\u62D2\u7EDD\u4E86\u6B64\u64CD\u4F5C\u3002\u4E0D\u8981\u5C1D\u8BD5\u7528\u5176\u4ED6\u65B9\u5F0F\u7ED5\u8FC7\uFF0C\u76F4\u63A5\u5411\u7528\u6237\u8BF4\u660E\u5E76\u7EE7\u7EED\u3002" };
      else {
        confirmations[needs.tool.id] = true;
        pendingTool = { toolCall: needs.tool, decision: null };
        if (verdict === "always" && needs.scopeKey) approvedScopes.push(needs.scopeKey);
      }
      continue;
    }
    hooks.onEvent({ type: "error", message: "agent \u9700\u8981\u672A\u77E5\u7684\u5BA2\u6237\u7AEF\u64CD\u4F5C\uFF0C\u5DF2\u505C\u6B62" });
    return;
  }
  hooks.onEvent({ type: "error", message: "agent \u7EED\u8DD1\u6B21\u6570\u8FC7\u591A\uFF0C\u5DF2\u505C\u6B62\uFF08\u53EF\u80FD\u5B58\u5728\u5FAA\u73AF\u786E\u8BA4\uFF09" });
}
var __dir, REPO_ROOT, PORT, BASE;
var init_api = __esm({
  "tui/api.mjs"() {
    "use strict";
    __dir = dirname(fileURLToPath(import.meta.url));
    REPO_ROOT = resolve(__dir, "..");
    PORT = Number(process.env.JUTIAN_PORT || 3211);
    BASE = `http://127.0.0.1:${PORT}`;
  }
});

// tui/App.jsx
init_api();
import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Static, Box, Text, useInput, useApp } from "ink";
import Spinner from "ink-spinner";

// tui/prompt.mjs
function buildTuiSystemPrompt(settings, info) {
  const osName = info?.platform === "darwin" ? "macOS" : info?.platform === "win32" ? "Windows" : "Linux";
  const shell = info?.platform === "win32" ? "PowerShell" : "zsh";
  const workDir = settings.workDir || "";
  return `\u4F60\u53EB\u5DE8\u5929\uFF0C\u662F\u300C\u5DE8\u5929agent\u300D\u7684\u7EC8\u7AEF\u7248\uFF08TUI\uFF09\uFF0C\u8FD0\u884C\u5728${osName}\u7CFB\u7EDF\uFF08${shell}\uFF09\u3002\u7528\u6237\u5728\u7EC8\u7AEF\u91CC\u4E0E\u4F60\u5BF9\u8BDD\uFF0C\u4F60\u53EF\u4EE5\u8C03\u7528\u5DE5\u5177\u771F\u5B9E\u6267\u884C\u64CD\u4F5C\u3002

\u3010\u54CD\u5E94\u98CE\u683C\u3011
- \u76F4\u63A5\u9AD8\u6548\uFF1A\u5148\u7ED9\u7ED3\u8BBA/\u65B9\u6848\uFF0C\u518D\u8865\u5FC5\u8981\u7EC6\u8282\uFF1B\u4E0D\u5199\u5BA2\u5957\u8BDD\u548C\u7A7A\u6D1E\u5F00\u573A\u767D
- \u7EC8\u7AEF\u5BBD\u5EA6\u6709\u9650\uFF1A\u56DE\u7B54\u7D27\u51D1\uFF0C\u5217\u8868\u6700\u591A 5 \u70B9\uFF0C\u4EE3\u7801\u5757\u6807\u6CE8\u8BED\u8A00

\u3010\u8FD0\u884C\u73AF\u5883\u3011
- \u9ED8\u8BA4\u5DE5\u4F5C\u76EE\u5F55\uFF1A${workDir || "\u7528\u6237\u4E3B\u76EE\u5F55"}\uFF08shell/\u8BFB\u5199\u6587\u4EF6\u9ED8\u8BA4\u5728\u6B64\u76EE\u5F55\u5185\u8FDB\u884C\uFF09
- write_file \u7684 path \u53C2\u6570\u53EA\u653E\u6587\u4EF6\u8DEF\u5F84\u672C\u8EAB

\u3010\u6267\u884C\u7EAA\u5F8B\u3011
\u25C6 \u4E00\u6B21\u8BF4\u6E05\uFF1A\u9700\u8981\u591A\u4E2A\u4FE1\u606F\u65F6\u4E00\u8F6E\u5E76\u884C\u8C03\u7528\u591A\u4E2A\u5DE5\u5177\uFF0C\u4E0D\u8981\u4E00\u8F6E\u4E00\u4E2A
\u25C6 \u5148\u770B\u540E\u5199\uFF1A\u6539\u6587\u4EF6\u524D\u5148 read_file \u786E\u8BA4\u771F\u5B9E\u5185\u5BB9\uFF0C\u7981\u6B62\u51ED\u8BB0\u5FC6\u6539
\u25C6 \u5C0F\u6B65\u9A8C\u8BC1\uFF1A\u6BCF\u6539\u5B8C\u4E00\u5904\u5C31\u9A8C\u8BC1\uFF08\u8BFB\u56DE/\u8DD1\u6D4B\u8BD5\uFF09
\u25C6 \u9047\u9519\u5373\u505C\uFF1A\u5DE5\u5177\u62A5\u9519\u5148\u770B\u9519\u8BEF\u4FE1\u606F\uFF0C\u522B\u7528\u540C\u6837\u53C2\u6570\u91CD\u8BD5\uFF1B\u8FDE\u7EED\u5931\u8D25\u4E24\u6B21\u6362\u65B9\u6CD5
\u25C6 \u8BF4\u4EBA\u8BDD\uFF1A\u56DE\u590D\u91CC\u4E0D\u8D34\u5DE5\u5177\u539F\u59CB\u8F93\u51FA\uFF0C\u63D0\u70BC\u6210\u7ED3\u8BBA

\u3010\u5DE5\u4F5C\u94C1\u5F8B\u3011
\u25C6 \u6539\u524D\u5FC5\u8BFB\u3001\u6700\u5C0F\u6539\u52A8\u3001\u6539\u540E\u5FC5\u9A8C\u3001\u4E0D\u7F16\u9020\u3001\u5220\u9664\u786E\u8BA4\u3001\u5BC6\u94A5\u4E0D\u5165\u7801
\u25C6 \u5173\u673A/\u91CD\u542F/\u767B\u51FA\u53EA\u80FD\u7531\u7528\u6237\u624B\u52A8\u64CD\u4F5C\uFF0CAI \u4E0D\u5F97\u7528\u4EFB\u4F55\u547D\u4EE4\u6216\u811A\u672C\u53D8\u4F53\u6267\u884C
\u25C6 \u547D\u4EE4\u91CC\u53EF\u7528 {{KEY}}/{{BASE}} \u5360\u4F4D\u7B26\u5F15\u7528\u5DF2\u914D\u7F6E\u7684\u5BC6\u94A5/\u5730\u5740\uFF0C\u4E0D\u8981\u7D22\u8981\u660E\u6587\u5BC6\u94A5

\u3010\u7EC8\u7AEF\u4FA7\u6CE8\u610F\u3011
- \u591A\u6B65\u4EFB\u52A1\uFF08\u22653 \u6B65\uFF09\u5148\u8C03\u7528 update_plan \u5217\u51FA\u6B65\u9AA4\u6E05\u5355\uFF0C\u6BCF\u5B8C\u6210\u4E00\u6B65\u66F4\u65B0\u72B6\u6001
- \u4EFB\u52A1\u786E\u5B9E\u9700\u8981\u5E76\u884C\u62C6\u5206\u65F6\u624D\u8C03\u7528 dispatch_subagents\uFF08TUI \u4E0B\u5B50\u4EE3\u7406\u53D7\u9650\uFF0C\u4F18\u5148\u81EA\u5DF1\u987A\u5E8F\u5B8C\u6210\uFF09
- \u590D\u6742\u4EFB\u52A1\u5F00\u5DE5\u524D\u53EF\u7528 consult_guidance \u67E5\u7EA6\u675F\uFF08topic=plan/code/files\uFF09`;
}

// tui/md.mjs
import { marked } from "marked";
import * as mtNS from "marked-terminal";
var mt = mtNS.default ?? mtNS.markedTerminal ?? mtNS;
var ready = false;
try {
  marked.use(mt({
    width: 96,
    reflowText: true,
    heading: (text) => `\x1B[1;36m${text}\x1B[0m`,
    firstHeading: (text) => `\x1B[1;36m${text}\x1B[0m`,
    codespan: (text) => `\x1B[33m${text}\x1B[0m`,
    code: (code) => `\x1B[2m${"\u2500".repeat(4)}\x1B[0m
\x1B[36m${code}\x1B[0m
\x1B[2m${"\u2500".repeat(4)}\x1B[0m`
  }));
  ready = true;
} catch {
}
function renderMd(text) {
  const s = String(text || "");
  if (!ready) return s;
  try {
    return String(marked.parse(s)).replace(/\n+$/, "");
  } catch {
    return s;
  }
}

// tui/App.jsx
import { jsx, jsxs } from "react/jsx-runtime";
var DIM = "rgb(130,135,145)";
var ACCENT = "rgb(64,196,140)";
var ERR = "rgb(240,90,90)";
var USER_C = "rgb(120,180,255)";
function argsLine(name, argsStr) {
  let a = {};
  try {
    a = JSON.parse(argsStr || "{}");
  } catch {
  }
  const pick = [a.command, a.path, a.file_path, a.query, a.pattern, a.url, a.name, a.skill, a.topic, a.content].find((v) => typeof v === "string" && v);
  const s = String(pick || JSON.stringify(a)).replace(/\s+/g, " ").slice(0, 90);
  return `${name}(${s})`;
}
function outPreview(result, isError) {
  const s = String(result || "").trim();
  if (!s) return null;
  const max = isError ? 5 : 4;
  const lines = s.split("\n").slice(0, max).map((l) => l.slice(0, 110));
  return lines.join("\n") + (s.split("\n").length > max ? "\n\u2026" : "");
}
function Block({ b }) {
  if (b.kind === "user") {
    return /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: USER_C, bold: true, children: "\u25B8 \u4F60" }),
      /* @__PURE__ */ jsxs(Text, { color: "white", children: [
        " ",
        b.text
      ] })
    ] });
  }
  if (b.kind === "assistant") {
    const md = renderMd(b.text);
    if (!md.trim()) return null;
    return /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsx(Text, { color: ACCENT, bold: true, children: "\u25C6 \u5DE8\u5929" }),
      /* @__PURE__ */ jsx(Text, { children: md })
    ] });
  }
  if (b.kind === "tool") {
    return /* @__PURE__ */ jsxs(Box, { paddingLeft: 2, flexDirection: "column", children: [
      /* @__PURE__ */ jsxs(Text, { children: [
        /* @__PURE__ */ jsx(Text, { color: b.status === "error" ? ERR : ACCENT, children: b.status === "error" ? "\u2717" : "\u23FA" }),
        /* @__PURE__ */ jsxs(Text, { color: DIM, children: [
          " ",
          b.label,
          b.ms ? `  (${(b.ms / 1e3).toFixed(1)}s)` : ""
        ] })
      ] }),
      b.preview && /* @__PURE__ */ jsx(Text, { color: b.status === "error" ? ERR : DIM, children: b.preview })
    ] });
  }
  if (b.kind === "plan") {
    return /* @__PURE__ */ jsx(Box, { marginTop: 1, paddingLeft: 2, borderStyle: "round", borderColor: DIM, flexDirection: "column", children: b.steps.map((s, i) => /* @__PURE__ */ jsxs(Text, { color: s.status === "done" ? ACCENT : s.status === "in_progress" ? "yellow" : DIM, children: [
      s.status === "done" ? "\u2611" : s.status === "in_progress" ? "\u25D0" : "\u2610",
      " ",
      s.content
    ] }, i)) });
  }
  if (b.kind === "error") return /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsxs(Text, { color: ERR, children: [
    "\u2717 ",
    b.text
  ] }) });
  if (b.kind === "info") return /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsx(Text, { color: DIM, children: b.text }) });
  return null;
}
function ConfirmBox({ tool, onDecide }) {
  return /* @__PURE__ */ jsxs(Box, { marginTop: 1, borderStyle: "round", borderColor: "yellow", paddingX: 1, flexDirection: "column", children: [
    /* @__PURE__ */ jsxs(Text, { color: "yellow", bold: true, children: [
      "\u26A0 \u9700\u8981\u4F60\u7684\u786E\u8BA4\uFF1A",
      tool.name
    ] }),
    /* @__PURE__ */ jsxs(Text, { color: DIM, children: [
      " ",
      argsLine(tool.name, tool.arguments)
    ] }),
    /* @__PURE__ */ jsx(Text, { children: " [y] \u5141\u8BB8 \xB7 [n] \u62D2\u7EDD \xB7 [a] \u672C\u4F1A\u8BDD\u59CB\u7EC8\u5141\u8BB8" })
  ] });
}
function App({ info, tools, sysPrompt, initialMessages, initialSession, settings, port }) {
  const { exit } = useApp();
  const [blocks, setBlocks] = useState(initialMessages.length ? [{ kind: "info", text: `\u5DF2\u6062\u590D\u4F1A\u8BDD\u300C${initialSession?.title || ""}\u300D\uFF08${initialMessages.length} \u6761\u6D88\u606F\uFF09` }] : []);
  const [live, setLive] = useState(null);
  const [runningTools, setRunningTools] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [histIdx, setHistIdx] = useState(-1);
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(initialSession || null);
  const abortRef = useRef(null);
  const convoRef = useRef([]);
  const inputHistRef = useRef([]);
  const liveTextRef = useRef("");
  const toolT0Ref = useRef(/* @__PURE__ */ new Map());
  const busyRef = useRef(false);
  const inputRef = useRef("");
  const workDir = settings.workDir || info?.workDir || "~";
  const model = settings.model || "?";
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    liveTextRef.current = live?.text || "";
  }, [live]);
  const push = useCallback((b) => setBlocks((prev) => [...prev, b]), []);
  const send = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    inputHistRef.current.unshift(trimmed);
    setHistIdx(-1);
    push({ kind: "user", text: trimmed });
    setBusy(true);
    liveTextRef.current = "";
    setLive({ text: "", thinking: "" });
    let sid = session?.id;
    if (!sid) {
      try {
        const s = await createSession(trimmed.slice(0, 18) || "\u7EC8\u7AEF\u5BF9\u8BDD");
        if (s?.id) {
          sid = s.id;
          setSession(s);
        }
      } catch {
      }
    }
    if (sid) saveMessage(sid, { id: `tui-u-${Date.now()}`, role: "user", content: trimmed });
    const controller = new AbortController();
    abortRef.current = controller;
    const toolFirst = /* @__PURE__ */ new Set();
    try {
      await chatRun({
        messages: [{ role: "system", content: sysPrompt }, ...convoRef.current, { role: "user", content: trimmed }],
        tools,
        model: settings.model,
        apiBase: settings.apiBaseUrl,
        contextWindow: settings.contextWindow,
        hermesMode: settings.hermesProtocol,
        workDir: settings.workDir,
        permissionLevel: settings.permissionLevel || "standard"
      }, {
        onEvent: (ev) => {
          if (ev.type === "chunk") setLive((p) => ({ ...p, text: (p?.text || "") + (ev.text || "") }));
          else if (ev.type === "thinking") setLive((p) => ({ ...p, thinking: (p?.thinking || "") + (ev.text || "") }));
          else if (ev.type === "tool_start" && ev.tool) {
            toolT0Ref.current.set(ev.tool.id, Date.now());
            setRunningTools((prev) => [...prev, { id: ev.tool.id, label: argsLine(ev.tool.name, ev.tool.arguments) }]);
          } else if (ev.type === "tool_end" && ev.tool) {
            const ms = Date.now() - (toolT0Ref.current.get(ev.tool.id) || Date.now());
            const st = ev.tool.status === "error" ? "error" : "done";
            setRunningTools((prev) => prev.filter((t) => t.id !== ev.tool.id));
            push({
              kind: "tool",
              id: ev.tool.id,
              status: st,
              label: argsLine(ev.tool.name, ev.tool.arguments),
              ms,
              preview: outPreview(ev.tool.result, st === "error"),
              noGap: !toolFirst.has(ev.tool.name) && (toolFirst.add(ev.tool.name), true)
            });
          }
        },
        onConfirm: (tool, _scopeKey) => new Promise((resolve2) => {
          setConfirm({ tool, resolve: (v) => {
            setConfirm(null);
            resolve2(v);
          } });
        }),
        onClientTool: async (tool) => {
          if (tool.name === "update_plan") {
            let steps = [];
            try {
              steps = JSON.parse(tool.arguments || "{}").steps || [];
            } catch {
            }
            setPlan(steps);
            push({ kind: "plan", steps });
            return '{"ok":true}';
          }
          return '{"ok":false,"error":"TUI \u6682\u4E0D\u652F\u6301\u6B64\u5BA2\u6237\u7AEF\u5DE5\u5177\uFF08\u8BF7\u5728\u684C\u9762\u7AEF\u4F7F\u7528\uFF09"}';
        }
      }, controller.signal);
      const finalText = liveTextRef.current;
      if (finalText.trim()) push({ kind: "assistant", text: finalText });
      convoRef.current = [...convoRef.current, { role: "user", content: trimmed }, { role: "assistant", content: finalText }];
      if (sid) saveMessage(sid, { id: `tui-a-${Date.now()}`, role: "assistant", content: finalText });
    } catch (e) {
      push({ kind: "error", text: String(e?.message || e) });
    } finally {
      setBusy(false);
      setRunningTools([]);
      setLive(null);
      abortRef.current = null;
    }
  }, [push, session, sysPrompt, tools, settings]);
  const handleCommand = useCallback(async (raw) => {
    const [cmd, ...rest] = raw.split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "/help":
        push({ kind: "info", text: "\u547D\u4EE4\uFF1A/new \u65B0\u5BF9\u8BDD \xB7 /resume [\u5E8F\u53F7] \u6062\u590D\u4F1A\u8BDD \xB7 /status \u72B6\u6001 \xB7 /plan \u8BA1\u5212 \xB7 /security \u5B89\u5168\u5F00\u5173 \xB7 /pack \u66F4\u65B0\u9632\u62A4\u5E93 \xB7 /quit \u9000\u51FA\n\u5FEB\u6377\u952E\uFF1AEsc \u4E2D\u65AD\u8F93\u51FA \xB7 \u2191\u2193 \u8F93\u5165\u5386\u53F2 \xB7 Ctrl+C \u4E2D\u65AD/\u9000\u51FA" });
        return;
      case "/new":
        convoRef.current = [];
        setSession(null);
        setPlan(null);
        push({ kind: "info", text: "\u5DF2\u5F00\u65B0\u5BF9\u8BDD\uFF08TUI \u7684\u4F1A\u8BDD\u5728\u684C\u9762\u7AEF\u540C\u6837\u53EF\u89C1\uFF09" });
        return;
      case "/resume": {
        try {
          const { listSessions: listSessions2 } = await Promise.resolve().then(() => (init_api(), api_exports));
          const list = await listSessions2(10);
          if (!list.length) {
            push({ kind: "info", text: "\u8FD8\u6CA1\u6709\u5386\u53F2\u4F1A\u8BDD" });
            return;
          }
          if (!arg) {
            push({ kind: "info", text: "\u6700\u8FD1\u4F1A\u8BDD\uFF08/resume <\u5E8F\u53F7> \u6062\u590D\uFF09\uFF1A\n" + list.map((s2, i) => `${i + 1}. ${s2.title} \xB7 ${String(s2.updated_at || "").slice(5, 16)}`).join("\n") });
            return;
          }
          const n = parseInt(arg, 10);
          if (!(n >= 1 && n <= list.length)) {
            push({ kind: "error", text: `\u5E8F\u53F7 1-${list.length}` });
            return;
          }
          const s = list[n - 1];
          const msgs = await loadMessages(s.id);
          convoRef.current = msgs.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }));
          setSession(s);
          setBlocks(msgs.slice(-40).map((m) => m.role === "user" ? { kind: "user", text: String(m.content || "") } : { kind: "assistant", text: String(m.content || "") }));
          push({ kind: "info", text: `\u5DF2\u6062\u590D\u300C${s.title}\u300D` });
        } catch (e) {
          push({ kind: "error", text: String(e?.message || e) });
        }
        return;
      }
      case "/status":
        push({ kind: "info", text: `\u6A21\u578B ${model} \xB7 \u5DE5\u4F5C\u533A ${workDir} \xB7 \u540E\u7AEF v${info?.version || "?"} \xB7 \u5DE5\u5177 ${info?.tools || "?"} \u4E2A \xB7 \u4F1A\u8BDD ${session ? `\u300C${session.title}\u300D` : "\u672A\u4FDD\u5B58"}` });
        return;
      case "/plan":
        push(plan ? { kind: "plan", steps: plan } : { kind: "info", text: "\u5F53\u524D\u6CA1\u6709\u8BA1\u5212" });
        return;
      case "/security": {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/settings`).then((x) => x.json());
          push({ kind: "info", text: `\u5DE8\u5929\u5B89\u5168\uFF1A\u5371\u9669\u547D\u4EE4\u62E6\u622A ${r.security_cmd_guard !== "0" ? "\u5F00" : "\u5173"} \xB7 \u6CE8\u5165\u626B\u63CF ${r.security_injection_scan !== "0" ? "\u5F00" : "\u5173"} \xB7 \u5BC6\u94A5\u5C4F\u853D ${r.security_key_shield !== "0" ? "\u5F00" : "\u5173"}\uFF08\u684C\u9762\u8BBE\u7F6E\u9875\u53EF\u6539\uFF09` });
        } catch {
          push({ kind: "error", text: "\u8BFB\u53D6\u5931\u8D25" });
        }
        return;
      }
      case "/pack": {
        push({ kind: "info", text: "\u6B63\u5728\u66F4\u65B0\u6076\u610F\u547D\u4EE4\u5E93\u2026" });
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/security/pack/update`, { method: "POST" }).then((x) => x.json());
          push({ kind: "info", text: r?.ok ? `\u9632\u62A4\u5E93\u5DF2\u66F4\u65B0\u81F3 v${r.version}\uFF08${r.count} \u6761\uFF0C\u751F\u6548 ${r.active} \u6761\uFF09` : `\u66F4\u65B0\u5931\u8D25\uFF1A${r?.error}` });
        } catch (e) {
          push({ kind: "error", text: String(e?.message || e) });
        }
        return;
      }
      case "/quit":
      case "/exit":
      case "/q":
        exit();
        return;
      default:
        push({ kind: "error", text: `\u672A\u77E5\u547D\u4EE4 ${cmd}\uFF08/help \u67E5\u770B\u5168\u90E8\uFF09` });
    }
  }, [push, info, model, workDir, session, plan, port]);
  useInput((ch, key) => {
    if (confirm) {
      if (ch === "y") confirm.resolve("allow");
      else if (ch === "a") confirm.resolve("always");
      else if (ch === "n" || key.escape) confirm.resolve("deny");
      return;
    }
    if (key.ctrl && ch === "c") {
      if (busyRef.current) {
        abortRef.current?.abort();
        return;
      }
      exit();
      return;
    }
    if (key.escape && busyRef.current) {
      abortRef.current?.abort();
      return;
    }
    if (busyRef.current) return;
    if (key.return) {
      const v = inputRef.current.trim();
      inputRef.current = "";
      setInput("");
      if (!v) return;
      if (v.startsWith("/")) {
        handleCommand(v);
        return;
      }
      send(v);
      return;
    }
    if (key.upArrow) {
      const next = Math.min(histIdx + 1, inputHistRef.current.length - 1);
      if (next >= 0) {
        setHistIdx(next);
        inputRef.current = inputHistRef.current[next];
        setInput(inputRef.current);
      }
      return;
    }
    if (key.downArrow) {
      const next = histIdx - 1;
      setHistIdx(next);
      inputRef.current = next >= 0 ? inputHistRef.current[next] : "";
      setInput(inputRef.current);
      return;
    }
    if (key.backspace || key.delete) {
      inputRef.current = inputRef.current.slice(0, -1);
      setInput(inputRef.current);
      return;
    }
    if (!ch || key.ctrl || key.meta) return;
    if (ch.includes("\r") || ch.includes("\n")) {
      const parts = ch.split(/[\r\n]+/);
      inputRef.current += parts[0];
      const submit = () => {
        const v = inputRef.current.trim();
        inputRef.current = "";
        setInput("");
        if (!v) return;
        if (v.startsWith("/")) {
          handleCommand(v);
          return;
        }
        send(v);
      };
      if (parts[0] !== "" || parts.length > 1) {
        setInput(inputRef.current);
        submit();
      }
      if (parts[1]) {
        inputRef.current = parts[1];
        setInput(inputRef.current);
      }
      return;
    }
    inputRef.current += ch;
    setInput(inputRef.current);
  });
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(Static, { items: blocks, children: (b, i) => /* @__PURE__ */ jsx(Block, { b }, `${b.kind}-${i}`) }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop: 1, paddingLeft: 2, children: [
      live?.thinking && /* @__PURE__ */ jsx(Text, { color: DIM, italic: true, children: live.thinking.split("\n").filter(Boolean).slice(-1).join("").slice(-110) }),
      live?.text && /* @__PURE__ */ jsx(Text, { color: DIM, children: live.text.slice(-600) }),
      runningTools.map((t) => /* @__PURE__ */ jsxs(Text, { color: ACCENT, children: [
        /* @__PURE__ */ jsx(Spinner, { type: "dots" }),
        " ",
        /* @__PURE__ */ jsx(Text, { color: DIM, children: t.label })
      ] }, t.id)),
      confirm && /* @__PURE__ */ jsx(ConfirmBox, { tool: confirm.tool })
    ] }),
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: ACCENT, bold: true, children: busy ? "  \u2026 " : "\u276F " }),
      /* @__PURE__ */ jsx(Text, { color: "white", children: input }),
      !busy && /* @__PURE__ */ jsx(Text, { color: DIM, children: "\u258C" })
    ] }),
    /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsxs(Text, { color: DIM, children: [
      " ",
      model,
      " \xB7 ",
      workDir,
      " \xB7 /help \u547D\u4EE4 \xB7 Ctrl+C \u9000\u51FA"
    ] }) })
  ] });
}
async function startTui({ info, tools, settings, port }) {
  const resumeId = process.argv.find((a) => a.startsWith("--resume="))?.split("=")[1];
  let initialMessages = [];
  let initialSession = null;
  if (resumeId) {
    try {
      initialMessages = await loadMessages(resumeId);
      initialSession = { id: resumeId, title: "\u5DF2\u6062\u590D" };
    } catch {
    }
  }
  const cwdSettings = { ...settings, workDir: process.cwd() };
  const sysPrompt = buildTuiSystemPrompt(cwdSettings, info);
  const instance = render(
    /* @__PURE__ */ jsx(
      App,
      {
        info,
        tools,
        settings: cwdSettings,
        sysPrompt,
        port,
        initialMessages,
        initialSession
      }
    ),
    { exitOnCtrlC: false }
  );
  await instance.waitUntilExit();
}
export {
  startTui
};
