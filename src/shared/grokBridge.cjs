"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared/grokBridge.ts
var grokBridge_exports = {};
__export(grokBridge_exports, {
  grokHomeDir: () => grokHomeDir,
  grokStatus: () => grokStatus,
  locateGrok: () => locateGrok,
  runGrokTurn: () => runGrokTurn
});
module.exports = __toCommonJS(grokBridge_exports);
var import_node_child_process = require("node:child_process");
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var BIN_NAMES = process.platform === "win32" ? ["grok.exe", "grok.bat"] : ["grok"];
function locateGrok() {
  const fromEnv = process.env.GROK_BIN;
  if (fromEnv && import_node_fs.default.existsSync(fromEnv)) return fromEnv;
  try {
    const rp = process.resourcesPath;
    if (rp) {
      for (const n of BIN_NAMES) {
        const p = import_node_path.default.join(rp, "grok", n);
        if (import_node_fs.default.existsSync(p)) return p;
      }
    }
  } catch {
  }
  const home = import_node_path.default.join(import_node_os.default.homedir(), ".lyclaw", "grok", "bin");
  for (const n of BIN_NAMES) {
    const p = import_node_path.default.join(home, n);
    if (import_node_fs.default.existsSync(p)) return p;
  }
  const dirs = String(process.env.PATH || "").split(import_node_path.default.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    for (const n of BIN_NAMES) {
      const p = import_node_path.default.join(d, n);
      if (import_node_fs.default.existsSync(p)) return p;
    }
  }
  return null;
}
function permissionArgs(level) {
  if (level === "\u5B8C\u5168\u8BBF\u95EE" || level === "yolo") return ["--yolo"];
  if (level === "\u53D7\u9650" || level === "readonly") {
    return ["--tools", "read_file,grep,list_dir,web_search"];
  }
  return ["--always-approve"];
}
function grokHomeDir() {
  return process.env.GROK_HOME || import_node_path.default.join(import_node_os.default.homedir(), ".lyclaw", "grok-home");
}
function ensureGrokModelConfig(opts) {
  const home = grokHomeDir();
  try {
    if (!import_node_fs.default.existsSync(home)) import_node_fs.default.mkdirSync(home, { recursive: true });
    const lines = [];
    const hasJutianModel = !!(opts.modelBase && opts.model);
    if (hasJutianModel) {
      const base = String(opts.modelBase).replace(/[\\/]+$/, "");
      lines.push("[model.jutian-active]");
      lines.push(`model = ${JSON.stringify(opts.model)}`);
      lines.push(`base_url = ${JSON.stringify(base)}`);
      lines.push('name = "\u5DE8\u5929\u5F53\u524D\u6A21\u578B"');
      if (opts.contextWindow && opts.contextWindow > 1e3) lines.push(`context_window = ${Math.floor(opts.contextWindow)}`);
      lines.push("");
      lines.push("[models]");
      lines.push('default = "jutian-active"');
      lines.push("");
    }
    const target = import_node_path.default.join(home, "config.toml");
    const tmp = target + ".tmp";
    import_node_fs.default.writeFileSync(tmp, lines.join("\n"));
    import_node_fs.default.renameSync(tmp, target);
    const token = (hasJutianModel ? opts.modelKey || "" : opts.xaiApiKey || "") || "";
    import_node_fs.default.writeFileSync(import_node_path.default.join(home, "model-key"), token);
    import_node_fs.default.writeFileSync(import_node_path.default.join(home, "grok-auth.sh"), '#!/bin/sh\ncat "$(dirname "$0")/model-key" 2>/dev/null\n');
    import_node_fs.default.chmodSync(import_node_path.default.join(home, "grok-auth.sh"), 448);
    return home;
  } catch {
    return process.env.GROK_HOME || import_node_path.default.join(import_node_os.default.homedir(), ".grok");
  }
}
function runGrokTurn(opts, events = {}) {
  return new Promise((resolve) => {
    const bin = locateGrok();
    if (!bin) {
      resolve({ ok: false, text: "", error: "\u672A\u627E\u5230 grok \u4E8C\u8FDB\u5236\u3002\u53EF\u5728\u7EC8\u7AEF\u8FD0\u884C\u5B98\u65B9\u5B89\u88C5\u811A\u672C\uFF1Acurl -fsSL https://x.ai/cli/install.sh | bash" });
      return;
    }
    const args = [
      "-p",
      opts.prompt,
      "--output-format",
      "streaming-json",
      "--include-partial-messages",
      "--cwd",
      opts.workDir || process.cwd(),
      "--session-id",
      opts.sessionId,
      ...permissionArgs(opts.permissionLevel || "\u6807\u51C6")
    ];
    if (opts.model && /^grok-/i.test(opts.model)) args.push("-m", opts.model);
    const env = { ...process.env };
    if (opts.xaiApiKey) env.XAI_API_KEY = opts.xaiApiKey;
    env.GROK_HOME = ensureGrokModelConfig(opts);
    env.GROK_AUTH_PROVIDER_COMMAND = import_node_path.default.join(env.GROK_HOME, "grok-auth.sh");
    env.GROK_AUTH_PROVIDER_LABEL = "Jutian";
    events.onNetStatus?.("connecting");
    let child;
    try {
      child = (0, import_node_child_process.spawn)(bin, args, { cwd: opts.workDir || process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, text: "", error: String(e.message || e) });
      return;
    }
    let buf = "";
    let finalText = "";
    let errText = "";
    let usage;
    let settled = false;
    const toolOpen = /* @__PURE__ */ new Map();
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      resolve({ ok, text: finalText, stopped: aborted ? "aborted" : void 0, error, usage });
    };
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      try {
        child.kill("SIGINT");
      } catch {
      }
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const handleLine = (line) => {
      const t = line.trim();
      if (!t || !t.startsWith("{")) return;
      let ev;
      try {
        ev = JSON.parse(t);
      } catch {
        return;
      }
      const type = String(ev.type || "");
      if (type === "text") {
        const piece = String(ev.data ?? ev.text ?? ev.delta ?? ev.deltaText ?? "");
        if (piece) {
          finalText += piece;
          events.onDelta?.(piece);
        }
      } else if (type === "thought") {
        const piece = String(ev.data ?? ev.thought ?? ev.text ?? ev.delta ?? "");
        if (piece) events.onThinking?.(piece);
      } else if (type === "tool_call") {
        const name = String(ev.title || ev.toolName || ev.name || ev.kind || "");
        const id = String(ev.toolCallId || ev.id || ev.tool_call_id || "");
        const argsRaw = ev.rawInput ?? ev.arguments ?? ev.input ?? {};
        const argsStr = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
        if (id) toolOpen.set(id, { name, args: argsStr });
        events.onTool?.({ id, name, arguments: argsStr });
      } else if (type === "tool_call_update") {
        const id = String(ev.toolCallId || ev.id || ev.tool_call_id || "");
        if (!id) return;
        const open = toolOpen.get(id);
        const status = String(ev.status || ev.state || "");
        if (!/completed|failed|error|denied|cancelled/i.test(status)) {
          if (id && !open) toolOpen.set(id, { name: String(ev.title || ev.toolName || ""), args: "" });
          return;
        }
        const ok = /completed/i.test(status);
        const content = Array.isArray(ev.content) ? ev.content : [];
        const parts = [];
        for (const c of content) {
          if (!c) continue;
          if (c.type === "diff") {
            parts.push(`${c.path}${c.oldText ? `:
- ${String(c.oldText).slice(0, 200)}
+ ${String(c.newText).slice(0, 200)}` : ` \u2192 ${String(c.newText).slice(0, 200)}`}`);
          } else {
            const inner = c.content;
            const t2 = String(typeof inner === "string" ? inner : inner?.text ?? inner?.output ?? c.text ?? c.data ?? c.message ?? c.stdout ?? "");
            if (t2.trim()) parts.push(t2.slice(0, 1500));
          }
        }
        const rO = ev.rawOutput;
        const rawPieces = [];
        if (rO && typeof rO === "object") {
          if (rO.command) rawPieces.push("$ " + String(rO.command).slice(0, 120));
          if (rO.output_for_prompt) rawPieces.push(String(rO.output_for_prompt).slice(0, 1500));
          if (!rO.output_for_prompt && Array.isArray(rO.output) && rO.output.length) {
            try {
              rawPieces.push(Buffer.from(rO.output).toString("utf-8").slice(0, 1500));
            } catch {
            }
          }
        } else if (typeof rO === "string" && rO.trim()) {
          rawPieces.push(rO.slice(0, 1500));
        }
        const result = [parts.join("\n"), rawPieces.join("\n")].filter(Boolean).join("\n").slice(0, 4e3);
        events.onToolEnd?.({ id, name: open?.name || String(ev.title || ev.toolName || ""), ok, result });
        if (id) toolOpen.delete(id);
      } else if (type === "usage") {
        const u = ev.usage && typeof ev.usage === "object" ? ev.usage : ev;
        usage = {
          inputTokens: Number(u.input_tokens ?? u.inputTokens ?? 0) || void 0,
          outputTokens: Number(u.output_tokens ?? u.outputTokens ?? 0) || void 0
        };
        events.onUsage?.(usage);
      } else if (type === "error") {
        errText = String(ev.message || ev.error || "grok \u5185\u6838\u62A5\u9519");
      } else if (type === "end") {
      }
    };
    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    });
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (c) => {
      errText += c;
    });
    child.on("error", (e) => finish(false, String(e.message || e)));
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (buf.trim()) handleLine(buf);
      if (aborted) return finish(true);
      if (code === 0) return finish(true);
      finish(false, errText.trim() || `grok \u9000\u51FA\u7801 ${code}`);
    });
    const firstTimer = setTimeout(() => events.onNetStatus?.("first-token"), 300);
    firstTimer.unref?.();
  });
}
function grokStatus() {
  const p = locateGrok();
  return { available: !!p, path: p };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  grokHomeDir,
  grokStatus,
  locateGrok,
  runGrokTurn
});
