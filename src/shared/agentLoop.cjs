"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared/agentLoop.ts
var agentLoop_exports = {};
__export(agentLoop_exports, {
  NeedsClientError: () => NeedsClientError,
  READONLY_TOOLS: () => READONLY_TOOLS,
  TOOL_TIMEOUT_MS: () => TOOL_TIMEOUT_MS,
  buildUpstreamError: () => buildUpstreamError,
  clampToolResult: () => clampToolResult,
  runAgentLoop: () => runAgentLoop,
  toolContentWithImage: () => toolContentWithImage
});
module.exports = __toCommonJS(agentLoop_exports);

// src/shared/agentPerf.ts
function createAgentPerf() {
  const t0 = Date.now();
  const rounds = [];
  let cur = null;
  let llmT = 0;
  let firstTokenAt = 0;
  let model;
  const ensure = (round) => {
    if (!cur || cur.round !== round) {
      cur = rounds.find((r) => r.round === round) ?? { round, tools: [], toolMs: 0 };
      if (!rounds.includes(cur)) rounds.push(cur);
    }
    return cur;
  };
  return {
    roundStart(round) {
      ensure(round);
    },
    llmRequestStart() {
      llmT = Date.now();
      firstTokenAt = 0;
    },
    firstToken() {
      if (!firstTokenAt) firstTokenAt = Date.now();
      if (cur) cur.firstTokenMs = firstTokenAt - llmT;
    },
    llmStreamEnd() {
      if (cur && llmT) cur.llmMs = Date.now() - llmT;
    },
    addTool(round, name, ms, ok) {
      const r = ensure(round);
      r.tools.push({ name, ms, ok });
      r.toolMs = Math.max(r.toolMs, ms);
    },
    setModel(m) {
      model = m;
    },
    finish() {
      const llmMs = rounds.reduce((a, r) => a + (r.llmMs || 0), 0);
      const toolMs = rounds.reduce((a, r) => a + r.toolMs, 0);
      const toolEntries = rounds.flatMap((r) => r.tools);
      return {
        rounds: rounds.length,
        totalMs: Date.now() - t0,
        llmMs,
        toolMs,
        firstTokenMs: rounds[0]?.firstTokenMs,
        toolCalls: toolEntries.length,
        toolErrors: toolEntries.filter((t) => !t.ok).length,
        model,
        ts: Date.now(),
        roundsDetail: rounds
      };
    }
  };
}

// src/shared/sse.ts
async function* ssePayloads(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        yield line.slice(5).trim();
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
    }
    try {
      reader.releaseLock();
    } catch {
    }
  }
}

// src/shared/reasoning.ts
function extractReasoning(obj) {
  if (!obj || typeof obj !== "object") return "";
  const o = obj;
  for (const key of ["reasoning_content", "reasoning", "thinking"]) {
    const v = o[key];
    if (typeof v === "string" && v) return v;
  }
  const details = o.reasoning_details;
  if (Array.isArray(details)) {
    let out = "";
    for (const d of details) {
      if (d && typeof d === "object" && typeof d.text === "string") {
        out += d.text;
      }
    }
    if (out) return out;
  }
  return "";
}

// src/shared/toolCallStream.ts
function parseToolCallsFromDelta(delta) {
  const d = delta;
  if (d?.tool_calls && Array.isArray(d.tool_calls)) {
    return d.tool_calls;
  }
  if (d?.function_call) {
    return [{ index: 0, id: d.function_call.id, function: d.function_call }];
  }
  return null;
}
function accumulateToolCallDelta(map, tc) {
  const idx = tc.index ?? 0;
  if (!map.has(idx)) map.set(idx, { id: "", name: "", arguments: "" });
  const slot = map.get(idx);
  if (tc.id && !slot.id) slot.id = tc.id;
  const name = tc.function?.name;
  if (name && !slot.name) slot.name = name;
  const args = tc.function?.arguments;
  if (args) {
    if (args.trimStart().startsWith("{")) {
      if (slot.argsComplete) {
        slot.arguments = args;
        return;
      }
      try {
        JSON.parse(slot.arguments);
        slot.argsComplete = true;
        slot.arguments = args;
        return;
      } catch {
      }
    }
    slot.arguments += args;
  }
}
function adoptNonStreamToolCalls(map, messageToolCalls) {
  if (map.size > 0) return;
  if (!Array.isArray(messageToolCalls)) return;
  for (const raw of messageToolCalls) {
    const idx = raw.index ?? 0;
    map.set(idx, {
      id: raw.id || "",
      name: raw.function?.name || "",
      arguments: raw.function?.arguments || ""
    });
  }
}
function toolCallsToArray(map) {
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

// src/shared/toolLoopGuard.ts
var MAX_TOOL_ROUNDS = 12;
var SOFT_REPEAT_THRESHOLD = 3;
var HARD_REPEAT_THRESHOLD = 5;
function callSignature(name, args) {
  let norm = String(args || "").trim();
  try {
    const parsed = JSON.parse(norm);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const sorted = {};
      for (const k of Object.keys(parsed).sort()) sorted[k] = parsed[k];
      norm = JSON.stringify(sorted);
    }
  } catch {
  }
  norm = norm.replace(/\s+/g, " ");
  return name + "::" + norm;
}
function checkRoundLimit(round) {
  if (round <= MAX_TOOL_ROUNDS) return { exceeded: false, message: "" };
  return {
    exceeded: true,
    message: `\u5DF2\u8FBE\u5355\u6B21\u8BF7\u6C42\u7684\u5DE5\u5177\u8C03\u7528\u4E0A\u9650\uFF08${MAX_TOOL_ROUNDS} \u8F6E\uFF09\u3002\u4EFB\u52A1\u53EF\u80FD\u8FC7\u4E8E\u590D\u6742\u6216\u6A21\u578B\u9677\u5165\u5FAA\u73AF\u2014\u2014\u8BF7\u628A\u4EFB\u52A1\u62C6\u6210\u66F4\u5C0F\u7684\u6B65\u9AA4\u91CD\u8BD5\uFF0C\u6216\u76F4\u63A5\u544A\u8BC9\u6211\u5F53\u524D\u8FDB\u5C55\u3002`
  };
}
var SAME_TOOL_HINT_EVERY = 6;
function bumpToolUse(counter, name) {
  const n = (counter.get(name) || 0) + 1;
  counter.set(name, n);
  return n;
}
function toolUseHint(counter, name) {
  const n = counter.get(name) || 0;
  if (n === 0 || n % SAME_TOOL_HINT_EVERY !== 0) return "";
  return `

[\u7CFB\u7EDF\u63D0\u793A] ${name} \u5DF2\u88AB\u7D2F\u8BA1\u8C03\u7528 ${n} \u6B21\u3002\u5982\u679C\u8FDB\u5C55\u4E0D\u5927\uFF0C\u8BF7\u6362\u4E00\u79CD\u65B9\u6CD5\uFF0C\u6216\u76F4\u63A5\u57FA\u4E8E\u5DF2\u6709\u4FE1\u606F\u7ED9\u7528\u6237\u7ED3\u8BBA\u3002`;
}
var CONSECUTIVE_FAIL_THRESHOLD = 3;
function bumpToolFail(counter, failed) {
  counter.n = failed ? counter.n + 1 : 0;
  return counter.n;
}
function toolFailHint(n, lastName) {
  if (n < CONSECUTIVE_FAIL_THRESHOLD) return "";
  return `

[\u7CFB\u7EDF\u63D0\u793A] \u5DF2\u8FDE\u7EED ${n} \u4E2A\u5DE5\u5177\u8C03\u7528\u5931\u8D25\uFF08\u6700\u8FD1\uFF1A${lastName}\uFF09\u3002\u8BF7\u5148\u505C\u4E0B\u68C0\u67E5\uFF1A\u9519\u8BEF\u539F\u56E0\u662F\u5426\u76F8\u540C\uFF1F\u5148\u8BFB\u76F8\u5173\u6587\u4EF6/\u91CD\u65B0\u786E\u8BA4\u73AF\u5883\u72B6\u6001\u518D\u884C\u52A8\uFF0C\u6216\u6362\u4E00\u79CD\u65B9\u6CD5\u2014\u2014\u4E0D\u8981\u4EE5\u540C\u6837\u65B9\u5F0F\u91CD\u8BD5\u3002`;
}
function checkRepeatCall(counter, signature) {
  const seen = (counter.get(signature) || 0) + 1;
  counter.set(signature, seen);
  const toolName = signature.split("::")[0];
  if (seen < HARD_REPEAT_THRESHOLD) {
    const soft = seen >= SOFT_REPEAT_THRESHOLD;
    return {
      blocked: false,
      message: soft ? JSON.stringify({
        ok: false,
        soft: true,
        error: `\u3010\u91CD\u590D\u63D0\u9192 \xB7 \u7B2C ${seen} \u6B21\u3011\u300C${toolName}\u300D\u4EE5\u76F8\u540C\u53C2\u6570\u91CD\u590D\u8C03\u7528\u4E14\u7ED3\u679C\u4E0D\u4F1A\u53D8\u5316\u3002\u8BF7\u7ACB\u5373\u6539\u53D8\u65B9\u6CD5\uFF1A\u6362\u53C2\u6570/\u6362\u5DE5\u5177/\u6362\u601D\u8DEF\uFF0C\u6216\u76F4\u63A5\u57FA\u4E8E\u5DF2\u6709\u4FE1\u606F\u56DE\u7B54\u7528\u6237\u3002`
      }) : ""
    };
  }
  return {
    blocked: true,
    message: JSON.stringify({
      ok: false,
      error: `\u3010\u91CD\u590D\u8C03\u7528\u5DF2\u62E6\u622A\u3011\u300C${toolName}\u300D\u4EE5\u5B8C\u5168\u76F8\u540C\u7684\u53C2\u6570\u5DF2\u88AB\u8C03\u7528 ${seen - 1} \u6B21\uFF0C\u7ED3\u679C\u4E0D\u4F1A\u53D8\u5316\u3002\u8BF7\u6539\u7528\u4E0D\u540C\u53C2\u6570\u3001\u6362\u4E00\u4E2A\u5DE5\u5177\uFF0C\u6216\u76F4\u63A5\u57FA\u4E8E\u5DF2\u6709\u7ED3\u679C\u56DE\u7B54\u7528\u6237\u3002\u82E5\u4EFB\u52A1\u672C\u8EAB\u9700\u8981\u91CD\u590D\u64CD\u4F5C\uFF0C\u8BF7\u8BF4\u660E\u539F\u56E0\u5E76\u8BF7\u7528\u6237\u786E\u8BA4\u3002`
    })
  };
}

// src/shared/retry.ts
var MAX_ATTEMPTS = 3;
var BACKOFF_BASE_MS = 800;
var BACKOFF_CAP_MS = 8e3;
var RETRY_AFTER_CAP_MS = 1e4;
var RETRYABLE_STATUS = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504, 529]);
function backoffMs(attempt, baseMs = BACKOFF_BASE_MS, capMs = BACKOFF_CAP_MS) {
  const n = Math.max(1, Math.floor(attempt));
  const raw = baseMs * Math.pow(2, n - 1);
  return Math.min(raw, capMs);
}
function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const sec = Number(v);
    return sec > 0 ? Math.min(sec * 1e3, RETRY_AFTER_CAP_MS) : null;
  }
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  const delta = at - now;
  return delta > 0 ? Math.min(delta, RETRY_AFTER_CAP_MS) : null;
}
function shouldRetryHttp(status, attempt, retryAfterHeader, now = Date.now()) {
  if (!RETRYABLE_STATUS.has(status)) {
    return { retry: false, delayMs: 0, reason: `${status} \u4E0D\u53EF\u91CD\u8BD5\uFF08\u914D\u7F6E\u6216\u53C2\u6570\u95EE\u9898\uFF09` };
  }
  if (attempt >= MAX_ATTEMPTS) {
    return { retry: false, delayMs: 0, reason: `${status} \u5DF2\u8FBE\u6700\u5927\u5C1D\u8BD5\u6B21\u6570\uFF08${MAX_ATTEMPTS}\uFF09` };
  }
  const hinted = parseRetryAfter(retryAfterHeader, now);
  const delayMs = hinted ?? backoffMs(attempt);
  return {
    retry: true,
    delayMs,
    reason: hinted != null ? `${status}\uFF0C\u6309 Retry-After \u7B49\u5F85 ${delayMs}ms` : `${status}\uFF0C\u9000\u907F ${delayMs}ms \u540E\u91CD\u8BD5`
  };
}

// src/shared/hermesTools.ts
function buildToolsBlock(tools, opts) {
  if (!tools.length) return "";
  const paramsCompact = (parameters) => {
    const out = {};
    const props = (parameters && typeof parameters === "object" ? parameters.properties : null) || {};
    for (const k of Object.keys(props)) {
      const ty = props[k]?.type;
      out[k] = Array.isArray(ty) ? ty.join("|") : String(ty || "any");
    }
    return out;
  };
  const defs = tools.map((t) => JSON.stringify({
    type: "function",
    function: opts?.compact ? { name: t.name, description: t.description, parameters: { type: "object", properties: paramsCompact(t.parameters) } } : { name: t.name, description: t.description, parameters: t.parameters }
  })).join("\n");
  return [
    "",
    "# Tools",
    "",
    "\u4F60\u53EF\u80FD\u9700\u8981\u8C03\u7528\u5DE5\u5177\u6765\u5B8C\u6210\u4EFB\u52A1\u3002\u53EF\u7528\u5DE5\u5177\u7684 JSON Schema \u5982\u4E0B\uFF08\u7F6E\u4E8E <tools> \u6807\u7B7E\u5185\uFF09\uFF1A",
    "",
    "<tools>",
    defs,
    "</tools>",
    "",
    "\u5F53\u9700\u8981\u8C03\u7528\u5DE5\u5177\u65F6\uFF0C\u4E25\u683C\u6309\u4EE5\u4E0B\u683C\u5F0F\u8F93\u51FA\uFF08\u6BCF\u4E2A\u8C03\u7528\u4E00\u884C\uFF0C\u53EF\u4E00\u6B21\u8F93\u51FA\u591A\u4E2A\uFF09\uFF1A",
    '<tool_call>{"name": "\u5DE5\u5177\u540D", "arguments": {"\u53C2\u6570": "\u503C"}}</tool_call>',
    "\u5728\u6536\u5230\u5DE5\u5177\u7ED3\u679C\u4E4B\u524D\u4E0D\u8981\u7F16\u9020\u7ED3\u679C\uFF1B\u4E0D\u9700\u8981\u8C03\u7528\u5DE5\u5177\u65F6\u76F4\u63A5\u6B63\u5E38\u56DE\u7B54\u3002",
    ""
  ].join("\n");
}
function parseHermesToolCalls(text) {
  if (!text || !text.includes("<tool_call>")) return [];
  const out = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const name = typeof parsed.name === "string" ? parsed.name : "";
      if (!name) continue;
      const args = typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments ?? {});
      out.push({ name, arguments: args });
    } catch {
      try {
        const fixed = raw.replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3');
        const parsed = JSON.parse(fixed);
        const name = typeof parsed.name === "string" ? parsed.name : "";
        if (!name) continue;
        const args = typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments ?? {});
        out.push({ name, arguments: args });
      } catch {
      }
    }
  }
  return out;
}
function stripToolCallBlocks(text) {
  if (!text || !text.includes("<tool_call>")) return text;
  return text.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function shouldInjectHermes(model, apiBase, mode) {
  const m = String(mode || "auto");
  if (m === "off") return false;
  if (m === "on") return true;
  const id = String(model || "");
  const base = String(apiBase || "");
  return /(:free|[-_.]free($|[-_/])|gpt-oss|hermes|pollinations|kilo\.)/i.test(id + " " + base);
}

// src/shared/contextBudget.ts
function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 12288 && code <= 40959 || code >= 65280 && code <= 65519) cjk++;
  }
  const other = text.length - cjk;
  return Math.ceil(cjk + other / 4);
}
function messageTokens(m) {
  const c = typeof m.content === "string" ? m.content : m.content == null ? "" : JSON.stringify(m.content);
  let n = estimateTokens(c);
  if (m.tool_calls) n += estimateTokens(JSON.stringify(m.tool_calls));
  return n;
}
function totalTokens(messages) {
  let n = 0;
  for (const m of messages) n += messageTokens(m);
  return n;
}
var MICROCOMPACT_KEEP_RECENT = 6;
var CLEARABLE_TOOLS = /* @__PURE__ */ new Set([
  "read_file",
  "list_dir",
  "search_files",
  "search_content",
  "web_search",
  "web_fetch",
  "system_info",
  "process_list",
  "port_check",
  "shell_output"
]);
var CLEARED_PLACEHOLDER = "[\u65E7\u5DE5\u5177\u7ED3\u679C\u5DF2\u6E05\u7A7A\u4EE5\u91CA\u653E\u4E0A\u4E0B\u6587\u3002\u5173\u952E\u4FE1\u606F\u5E94\u5DF2\u4F53\u73B0\u5728\u540E\u7EED\u56DE\u590D\u91CC\uFF1B\u9700\u8981\u65F6\u91CD\u65B0\u8C03\u7528\u8BE5\u5DE5\u5177\u5373\u53EF\u3002]";
function microcompact(messages, opts = {}) {
  const keep = Math.max(1, opts.keepRecent ?? MICROCOMPACT_KEEP_RECENT);
  const minChars = opts.minChars ?? 800;
  const toolIdx = [];
  for (let i = 0; i < messages.length; i++) if (messages[i].role === "tool") toolIdx.push(i);
  if (toolIdx.length <= keep) return { messages, cleared: 0 };
  const protectedFrom = toolIdx[toolIdx.length - keep];
  let cleared = 0;
  const out = messages.map((m, i) => {
    if (i >= protectedFrom || m.role !== "tool") return m;
    const text = typeof m.content === "string" ? m.content : "";
    if (text.length < minChars) return m;
    if (text === CLEARED_PLACEHOLDER) return m;
    if (opts.clearableIds && !opts.clearableIds.has(String(m.tool_call_id || ""))) return m;
    cleared++;
    return { ...m, content: CLEARED_PLACEHOLDER };
  });
  return cleared > 0 ? { messages: out, cleared } : { messages, cleared: 0 };
}
function truncateForBudget(messages, budgetTokens) {
  if (!budgetTokens || budgetTokens <= 0) return { messages, dropped: 0, tokens: totalTokens(messages) };
  if (totalTokens(messages) <= budgetTokens) {
    return { messages, dropped: 0, tokens: totalTokens(messages) };
  }
  const systemCount = messages.findIndex((m) => m.role !== "system");
  const sysEnd = systemCount === -1 ? messages.length : systemCount;
  const system = messages.slice(0, sysEnd);
  const rest = messages.slice(sysEnd);
  let used = system.reduce((a, m) => a + messageTokens(m), 0);
  let cut = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = messageTokens(rest[i]);
    if (used + t > budgetTokens && rest.length - i >= 4) {
      cut = i + 1;
      break;
    }
    used += t;
  }
  while (cut < rest.length && rest[cut].role === "tool") {
    const prev = cut > 0 ? rest[cut - 1] : null;
    if (prev && prev.role === "assistant" && prev.tool_calls) {
      cut--;
      continue;
    }
    cut++;
  }
  while (cut < rest.length) {
    const m = rest[cut];
    if (m.role === "assistant" && m.tool_calls) {
      const ids = m.tool_calls.map((tc) => tc.id).filter(Boolean);
      const next = rest[cut + 1];
      if (next && next.role === "tool" && ids.includes(String(next.tool_call_id || ""))) break;
      cut++;
      continue;
    }
    break;
  }
  const kept = [...system, ...rest.slice(cut)];
  return { messages: kept, dropped: cut, tokens: totalTokens(kept) };
}
var CONTEXT_OVERFLOW_PATTERN = /context length|prompt is too long|too many tokens|maximum context|context_length_exceeded|request too large|exceed[s]? the (maximum )?context|context window|输入过长|上下文超长/i;
function isContextOverflowError(message) {
  return CONTEXT_OVERFLOW_PATTERN.test(String(message || ""));
}

// src/shared/agentLoop.ts
var NeedsClientError = class extends Error {
  kind;
  toolCall;
  scopeKey;
  messages;
  partial;
  constructor(kind, toolCall, messages, partial, scopeKey) {
    super(kind === "confirm" ? "\u9700\u8981\u7528\u6237\u786E\u8BA4" : "\u9700\u8981\u5BA2\u6237\u7AEF\u6267\u884C\u5DE5\u5177");
    this.name = "NeedsClientError";
    this.kind = kind;
    this.toolCall = toolCall;
    this.messages = messages;
    this.partial = partial;
    this.scopeKey = scopeKey;
  }
};
var READONLY_TOOLS = /* @__PURE__ */ new Set([
  "read_file",
  "list_dir",
  "search_files",
  "search_content",
  "web_search",
  "web_fetch",
  "system_info",
  "process_list",
  "port_check",
  "recall",
  "text_tools",
  "json_process",
  "timestamp_tools",
  "uuid_generate",
  "random_tools",
  "color_tools",
  "hash_tools",
  "base64_tools",
  "url_tools"
]);
var TOOL_TIMEOUT_MS = 18e4;
var TAIL_KEEP_TOOLS = /* @__PURE__ */ new Set(["shell", "npm_run", "git_operation", "run_tests", "web_fetch"]);
function clampToolResult(text, toolName) {
  const MAX = 4e4;
  if (!text || text.length <= MAX) return text;
  const head = Math.floor(MAX * 0.3);
  const tail = MAX - head;
  if (toolName && TAIL_KEEP_TOOLS.has(toolName)) {
    return text.slice(0, head) + "\n\n\u2026[\u4E2D\u95F4 " + (text.length - MAX) + " \u5B57\u7B26\u5DF2\u7701\u7565\uFF1B\u4E0B\u65B9\u4FDD\u7559\u672B\u5C3E " + tail + " \u5B57\u7B26\uFF08\u9519\u8BEF\u5806\u6808\u901A\u5E38\u5728\u7ED3\u5C3E\uFF09]\u2026\n\n" + text.slice(-tail);
  }
  return text.slice(0, MAX) + "\n\n[\u8F93\u51FA\u8FC7\u957F\u5DF2\u622A\u65AD\uFF1A\u539F\u59CB " + text.length + " \u5B57\u7B26\uFF0C\u4EC5\u4FDD\u7559\u524D " + MAX + "\u3002\u5982\u9700\u5B8C\u6574\u5185\u5BB9\uFF0C\u8BF7\u7528\u8303\u56F4\u53C2\u6570\u5206\u6BB5\u8BFB\u53D6\u3002]";
}
function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}
function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
async function runAgentLoop(messages, deps) {
  const { events, signal } = deps;
  const perf = createAgentPerf();
  perf.setModel(deps.model);
  let toolRound = 0;
  let wrapUp = false;
  const clearableIds = /* @__PURE__ */ new Set();
  let overflowRetried = false;
  const callSignatures = /* @__PURE__ */ new Map();
  const toolUseCounts = /* @__PURE__ */ new Map();
  const failCounter = { n: 0 };
  let fullThinking = deps.resume?.thinking || "";
  let fullContent = deps.resume?.content || "";
  const allToolCalls = [...deps.resume?.toolCalls || []];
  const maxTokens = deps.maxTokens ?? (Number(deps.contextWindow) >= 8e3 ? 16384 : 8192);
  if (deps.pendingTool) {
    const { toolCall, decision } = deps.pendingTool;
    const obj = { ...toolCall, status: "running", started_at: (/* @__PURE__ */ new Date()).toISOString() };
    events.onToolStart?.(obj);
    if (decision) {
      obj.status = "error";
      obj.result = String(decision);
      obj.finished_at = (/* @__PURE__ */ new Date()).toISOString();
      events.onToolEnd?.(obj);
      allToolCalls.push(obj);
      messages.push({ role: "tool", tool_call_id: obj.id, content: String(decision) });
    } else {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(toolCall.arguments || "{}");
      } catch {
        parsedArgs = {};
      }
      const t0 = Date.now();
      try {
        const result = await withTimeout(
          deps.runTool(toolCall.name, parsedArgs, signal),
          TOOL_TIMEOUT_MS,
          "\u5DE5\u5177 " + toolCall.name + " \u6267\u884C\u8D85\u65F6\uFF08180 \u79D2\uFF09\uFF0C\u5DF2\u4E2D\u6B62\u7B49\u5F85\u3002"
        );
        let outText = result.success ? result.output || "" : "";
        if (outText.length > 5e4 && result.success && deps.saveLargeOutput) {
          try {
            const fname = await deps.saveLargeOutput(toolCall.name, outText);
            if (fname) outText = clampToolResult(outText, toolCall.name) + "\n[\u5B8C\u6574\u8F93\u51FA\u5DF2\u4FDD\u5B58\u5230\u5DE5\u4F5C\u533A: " + fname + "]";
          } catch {
          }
        }
        obj.status = result.success ? "done" : "error";
        obj.result = result.success ? clampToolResult(outText, toolCall.name) : "\u274C \u9519\u8BEF: " + result.error;
        if (result.changeId) obj.changeId = result.changeId;
        messages.push({ role: "tool", tool_call_id: obj.id, content: obj.result });
      } catch (te) {
        obj.status = "error";
        obj.result = "\u274C \u9519\u8BEF: " + (te instanceof Error ? te.message : String(te));
        messages.push({ role: "tool", tool_call_id: obj.id, content: obj.result });
      }
      obj.finished_at = (/* @__PURE__ */ new Date()).toISOString();
      events.onToolEnd?.(obj);
      allToolCalls.push(obj);
      perf.addTool(1, toolCall.name, Date.now() - t0, obj.status !== "error");
    }
  }
  while (true) {
    if (signal?.aborted) {
      return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
    }
    toolRound++;
    perf.roundStart(toolRound);
    const roundCheck = checkRoundLimit(toolRound);
    if (roundCheck.exceeded) {
      if (!wrapUp) {
        wrapUp = true;
      } else {
        events.onPerf?.(perf.finish());
        return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "round-limit", error: roundCheck.message };
      }
    }
    const disabled = new Set(deps.disabledTools || []);
    const tools = deps.tools.filter((t) => !disabled.has(t.name));
    const hermesEnabled = tools.length > 0 && shouldInjectHermes(deps.model, deps.apiBase, deps.hermesMode);
    const wireMessages = (() => {
      if (!hermesEnabled) return messages;
      const block = buildToolsBlock(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), { compact: true });
      if (!block) return messages;
      const copy = [...messages];
      if (copy[0] && copy[0].role === "system") {
        copy[0] = { ...copy[0], content: String(copy[0].content ?? "") + block };
      } else {
        copy.unshift({ role: "system", content: block });
      }
      return copy;
    })();
    const budget = deps.contextBudget || Math.floor((Number(deps.contextWindow) || 0) * 0.8) || 0;
    let sendMessages = wireMessages;
    if (budget > 0) {
      const used = totalTokens(sendMessages);
      if (used > budget * 0.8 && deps.microcompact !== false) {
        const mc = microcompact(sendMessages, { clearableIds });
        if (mc.cleared > 0) sendMessages = mc.messages;
      }
      if (totalTokens(sendMessages) > budget) {
        sendMessages = truncateForBudget(sendMessages, budget).messages;
      }
    }
    if (wrapUp) {
      sendMessages = [...sendMessages, {
        role: "user",
        content: "\u3010\u7CFB\u7EDF\u3011\u5DE5\u5177\u8C03\u7528\u8F6E\u6B21\u5DF2\u7528\u5C3D\u3002\u8BF7\u7ACB\u523B\u57FA\u4E8E\u5DF2\u6709\u4FE1\u606F\u7528\u6587\u5B57\u7ED9\u51FA\u6700\u7EC8\u7B54\u590D\uFF0C\u4E0D\u8981\u518D\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\u3002"
      }];
    }
    const makeBody = () => JSON.stringify({
      model: deps.model,
      messages: sendMessages,
      tools: wrapUp ? [] : tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
      })),
      tool_choice: wrapUp ? "none" : "auto",
      stream: true,
      max_tokens: maxTokens
    });
    let res = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      events.onNetStatus?.(attempt === 1 ? "connecting" : "retrying", attempt > 1 ? { attempt } : void 0);
      perf.llmRequestStart();
      let netErr = null;
      try {
        res = await deps.callLLM(makeBody(), signal);
      } catch (e) {
        if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
        netErr = e instanceof Error ? e : new Error(String(e));
      }
      if (netErr) {
        lastErr = netErr;
        if (attempt >= MAX_ATTEMPTS) throw netErr;
        await sleepAbortable(backoffMs(attempt), signal);
        continue;
      }
      if (res && res.ok) break;
      const errText = await res.text().catch(() => "");
      if (isContextOverflowError(errText) && !overflowRetried) {
        overflowRetried = true;
        const cur = budget || totalTokens(sendMessages);
        const tighter = Math.max(2e3, Math.floor(cur * 0.5));
        sendMessages = truncateForBudget(sendMessages, tighter).messages;
        attempt--;
        continue;
      }
      const msg = buildUpstreamError(res.status, errText);
      const decision = shouldRetryHttp(res.status, attempt, res.headers.get("retry-after"));
      if (!decision.retry) throw new Error(msg);
      lastErr = new Error(msg);
      res = null;
      await sleepAbortable(decision.delayMs, signal);
    }
    if (!res) {
      throw lastErr ? new Error(`${lastErr.message}\uFF08\u5DF2\u81EA\u52A8\u91CD\u8BD5 ${MAX_ATTEMPTS} \u6B21\u4ECD\u5931\u8D25\u2014\u2014\u514D\u8D39\u7EBF\u8DEF\u9AD8\u5CF0\u671F\u5BB9\u6613\u6301\u7EED\u6392\u961F\uFF0C\u7A0D\u540E\u518D\u8BD5\u6216\u5230\u8BBE\u7F6E\u6362\u4E00\u6761\u7EBF\u8DEF\uFF09`) : new Error("\u8BF7\u6C42\u5931\u8D25\uFF1A\u672A\u77E5\u539F\u56E0");
    }
    if (!res.body) throw new Error("No response body");
    let roundContent = "";
    const toolCallMap = /* @__PURE__ */ new Map();
    let draftAnnounced = false;
    for await (const data of ssePayloads(res.body)) {
      if (data === "[DONE]") break;
      if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        const think = extractReasoning(delta);
        if (think) {
          perf.firstToken();
          fullThinking += think;
          events.onThinking?.(think);
        }
        if (delta?.content) {
          perf.firstToken();
          roundContent += delta.content;
          fullContent += delta.content;
          events.onChunk?.(delta.content);
        }
        const parsedTcs = parseToolCallsFromDelta(delta);
        if (parsedTcs) {
          for (const tc of parsedTcs) accumulateToolCallDelta(toolCallMap, tc);
          if (!draftAnnounced) {
            draftAnnounced = true;
            events.onToolDraft?.(parsedTcs[0]?.function?.name || "\u2026");
          }
        }
        if (choice.finish_reason === "tool_calls") {
          adoptNonStreamToolCalls(toolCallMap, choice.message?.tool_calls);
        }
      } catch {
      }
    }
    let toolCalls = toolCallsToArray(toolCallMap);
    if (toolCalls.length === 0 && roundContent.includes("<tool_call>")) {
      const hermes = parseHermesToolCalls(roundContent);
      if (hermes.length > 0) {
        toolCalls = hermes.map((h, i2) => ({ id: "hermes_" + i2 + "_" + Date.now(), name: h.name, arguments: h.arguments }));
        roundContent = stripToolCallBlocks(roundContent);
        fullContent = stripToolCallBlocks(fullContent);
      }
    }
    perf.llmStreamEnd();
    if (toolCalls.length === 0) {
      const content = stripToolCallBlocks(fullContent);
      events.onPerf?.(perf.finish());
      return { content, thinking: fullThinking, toolCalls: allToolCalls };
    }
    messages.push({
      role: "assistant",
      content: roundContent || void 0,
      tool_calls: toolCalls.map((tc, idx) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
        index: idx
      }))
    });
    const plans = [];
    for (const tc of toolCalls) {
      if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
      const repeat = checkRepeatCall(callSignatures, callSignature(tc.name, tc.arguments));
      if (repeat.blocked) {
        messages.push({ role: "tool", tool_call_id: tc.id, content: repeat.message });
        continue;
      }
      const obj = {
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: "running",
        started_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      events.onToolStart?.(obj);
      const need = deps.needsClient?.(obj);
      if (need) {
        throw new NeedsClientError(need, obj, messages, { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls }, deps.scopeKeyOf?.(obj));
      }
      const denial = await deps.confirmTool?.(obj);
      if (denial) {
        obj.status = "error";
        obj.result = denial;
        obj.finished_at = (/* @__PURE__ */ new Date()).toISOString();
        events.onToolEnd?.(obj);
        allToolCalls.push(obj);
        messages.push({ role: "tool", tool_call_id: tc.id, content: denial });
        continue;
      }
      plans.push({ tc, obj });
    }
    const execOne = async (pl) => {
      const t0 = Date.now();
      let toolResult;
      if (deps.isClientTool(pl.tc.name)) {
        toolResult = await deps.runClientTool?.(pl.obj) || '{"ok":true}';
        pl.obj.status = "done";
      } else {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(pl.tc.arguments || "{}");
        } catch {
          parsedArgs = {};
        }
        try {
          const result = await withTimeout(
            deps.runTool(pl.tc.name, parsedArgs, signal),
            TOOL_TIMEOUT_MS,
            "\u5DE5\u5177 " + pl.tc.name + " \u6267\u884C\u8D85\u65F6\uFF08180 \u79D2\uFF09\uFF0C\u5DF2\u4E2D\u6B62\u7B49\u5F85\u3002\u5982\u786E\u9700\u7EE7\u7EED\u8BF7\u62C6\u5C0F\u4EFB\u52A1\u3002"
          );
          let outText = result.success ? result.output || "" : "";
          if (outText.length > 5e4 && result.success && deps.saveLargeOutput) {
            try {
              const fname = await deps.saveLargeOutput(pl.tc.name, outText);
              if (fname) outText = clampToolResult(outText, pl.tc.name) + "\n[\u5B8C\u6574\u8F93\u51FA\u5DF2\u4FDD\u5B58\u5230\u5DE5\u4F5C\u533A: " + fname + "]";
            } catch {
            }
          }
          toolResult = result.success ? clampToolResult(outText, pl.tc.name) : "\u274C \u9519\u8BEF: " + result.error;
          pl.obj.status = result.success ? "done" : "error";
          if (result.changeId) pl.obj.changeId = result.changeId;
        } catch (te) {
          toolResult = "\u274C \u9519\u8BEF: " + (te instanceof Error ? te.message : String(te));
          pl.obj.status = "error";
        }
      }
      const ms = Date.now() - t0;
      pl.obj.result = toolResult;
      pl.obj.finished_at = (/* @__PURE__ */ new Date()).toISOString();
      events.onToolEnd?.(pl.obj);
      allToolCalls.push(pl.obj);
      perf.addTool(toolRound, pl.tc.name, ms, pl.obj.status !== "error");
      const base = pl.obj.result && String(pl.obj.result).trim() ? String(pl.obj.result) : pl.obj.status === "error" ? "\u5DE5\u5177 " + pl.tc.name + " \u6267\u884C\u5931\u8D25\uFF08\u672A\u8FD4\u56DE\u5177\u4F53\u9519\u8BEF\u4FE1\u606F\uFF09\u3002" : "\u5DE5\u5177 " + pl.tc.name + " \u5DF2\u6267\u884C\uFF0C\u4F46\u8FD4\u56DE\u7A7A\u7ED3\u679C\u3002";
      const useN = bumpToolUse(toolUseCounts, pl.tc.name);
      if (CLEARABLE_TOOLS.has(pl.tc.name)) clearableIds.add(pl.tc.id);
      const failN = bumpToolFail(failCounter, pl.obj.status === "error");
      return base + toolUseHint(toolUseCounts, pl.tc.name) + toolFailHint(failN, pl.tc.name);
    };
    let i = 0;
    while (i < plans.length) {
      const group = [];
      while (i < plans.length && READONLY_TOOLS.has(plans[i].tc.name)) {
        group.push(plans[i]);
        i++;
      }
      if (group.length === 0) {
        group.push(plans[i]);
        i++;
      }
      const results = group.length === 1 ? [await execOne(group[0])] : await Promise.all(group.map(execOne));
      for (let k = 0; k < group.length; k++) {
        messages.push({ role: "tool", tool_call_id: group[k].tc.id, content: results[k] });
      }
    }
  }
}
function buildUpstreamError(status, errText) {
  const detail = (errText || "").slice(0, 300);
  if (status === 401 || status === 403) return `\u9274\u6743\u5931\u8D25\uFF08${status}\uFF09\uFF1AAPI Key \u6216\u6743\u9650\u4E0D\u6B63\u786E\u3002\u8BF7\u5230 \u8BBE\u7F6E \u2192 \u63A8\u7406 \u68C0\u67E5\u3002${detail ? " " + detail : ""}`;
  if (status === 402) return `\u4F59\u989D\u6216\u989D\u5EA6\u4E0D\u8DB3\uFF08402\uFF09\u3002\u8BF7\u6362\u7528\u514D\u8D39\u6A21\u578B\u6216\u5145\u503C\u3002${detail ? " " + detail : ""}`;
  if (status === 404) return `\u63A5\u53E3\u4E0D\u5B58\u5728\uFF08404\uFF09\uFF1A\u8BF7\u68C0\u67E5 API \u5730\u5740\u662F\u5426\u4EE5 /v1 \u7ED3\u5C3E\u3001\u6A21\u578B\u540D\u662F\u5426\u6B63\u786E\u3002${detail ? " " + detail : ""}`;
  if (status === 429) return `\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF08429\uFF09\uFF0C\u5DF2\u81EA\u52A8\u91CD\u8BD5\u4ECD\u672A\u6210\u529F\u3002\u7A0D\u540E\u518D\u8BD5\u6216\u6362\u6A21\u578B\u3002${detail ? " " + detail : ""}`;
  if (status >= 500) return `\u4E0A\u6E38\u670D\u52A1\u5F02\u5E38\uFF08${status}\uFF09\uFF0C\u5DF2\u81EA\u52A8\u91CD\u8BD5\u4ECD\u672A\u6210\u529F\u3002${detail ? " " + detail : ""}`;
  return `\u8BF7\u6C42\u5931\u8D25\uFF08${status}\uFF09${detail ? "\uFF1A" + detail : ""}`;
}
function toolContentWithImage(text, image) {
  const cleaned = String(text || "").replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
  return [
    { type: "text", text: cleaned || "\uFF08\u5DE5\u5177\u4EA7\u51FA\uFF09" },
    { type: "image_url", image_url: { url: image } }
  ];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NeedsClientError,
  READONLY_TOOLS,
  TOOL_TIMEOUT_MS,
  buildUpstreamError,
  clampToolResult,
  runAgentLoop,
  toolContentWithImage
});
