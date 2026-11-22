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

// src/shared/autoCore.ts
var autoCore_exports = {};
__export(autoCore_exports, {
  AUTO_SYSTEM_PROMPT: () => AUTO_SYSTEM_PROMPT,
  evaluateGoalAuto: () => evaluateGoalAuto,
  extractGoal: () => extractGoal,
  runAutoLoop: () => runAutoLoop,
  trajectorySignature: () => trajectorySignature,
  withAutoPrompt: () => withAutoPrompt
});
module.exports = __toCommonJS(autoCore_exports);

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
  let dataLines = [];
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const line = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).trim();
        if (!line) {
          if (dataLines.length > 0) {
            const payload = dataLines.join("\n");
            dataLines = [];
            yield payload;
          }
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length > 0) yield dataLines.join("\n");
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
var THINK_OPEN = "<think>";
var THINK_CLOSE = "</think>";
function stripThinkTags(text) {
  if (!text || !text.includes("<")) return text;
  return text.split(THINK_OPEN).join("").split(THINK_CLOSE).join("");
}
function extractReasoning(obj) {
  if (!obj || typeof obj !== "object") return "";
  const o = obj;
  for (const key of ["reasoning_content", "reasoning", "thinking"]) {
    const v = o[key];
    if (typeof v === "string" && v) {
      const stripped = stripThinkTags(v);
      if (stripped) return stripped;
    }
  }
  const details = o.reasoning_details;
  if (Array.isArray(details)) {
    let out = "";
    for (const d of details) {
      if (d && typeof d === "object" && typeof d.text === "string") {
        out += d.text;
      }
    }
    const stripped = stripThinkTags(out);
    if (stripped) return stripped;
  }
  return "";
}

// src/shared/toolCallStream.ts
function normIndex(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
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
  if (!tc || typeof tc !== "object") return;
  const idx = normIndex(tc.index);
  if (!map.has(idx)) map.set(idx, { id: "", name: "", arguments: "" });
  const slot = map.get(idx);
  if (typeof tc.id === "string" && tc.id && !slot.id) slot.id = tc.id;
  const name = tc.function?.name;
  if (typeof name === "string" && name && !slot.name) slot.name = name;
  const args = tc.function?.arguments;
  if (typeof args !== "string") {
    if (args && typeof args === "object") {
      try {
        slot.arguments = JSON.stringify(args);
        slot.argsComplete = true;
      } catch {
      }
    }
    return;
  }
  if (!args) return;
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
function adoptNonStreamToolCalls(map, messageToolCalls) {
  if (map.size > 0) return;
  if (!Array.isArray(messageToolCalls)) return;
  for (let i = 0; i < messageToolCalls.length; i++) {
    const raw = messageToolCalls[i];
    if (!raw || typeof raw !== "object") continue;
    const fnName = typeof raw.function?.name === "string" ? raw.function.name : "";
    if (!fnName) continue;
    const rawArgs = raw.function?.arguments;
    let args = "";
    if (typeof rawArgs === "string") {
      args = rawArgs;
    } else if (rawArgs && typeof rawArgs === "object") {
      try {
        args = JSON.stringify(rawArgs);
      } catch {
        continue;
      }
    }
    if (args !== "") {
      try {
        JSON.parse(args);
      } catch {
        continue;
      }
    }
    const idx = typeof raw.index === "number" && Number.isFinite(raw.index) ? raw.index : i;
    map.set(idx, {
      id: typeof raw.id === "string" ? raw.id : "",
      name: fnName,
      arguments: args,
      // 全量快照已验证合法：标记 argsComplete，后续若仍收到 '{' 开头的分片按快照替换
      argsComplete: args !== "" ? true : void 0
    });
  }
}
function toolCallsToArray(map) {
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

// src/shared/toolLoopGuard.ts
var MAX_TOOL_ROUNDS = 12;
var REPEAT_SOFT_LIMIT = 3;
var REPEAT_HARD_LIMIT = 5;
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const src = v;
    const sorted = {};
    for (const k of Object.keys(src).sort()) sorted[k] = sortKeysDeep(src[k]);
    return sorted;
  }
  return v;
}
function callSignature(name, args) {
  let norm = String(args || "").trim();
  try {
    const parsed = JSON.parse(norm);
    if (parsed && typeof parsed === "object") {
      norm = JSON.stringify(sortKeysDeep(parsed));
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
  const parts = [
    `

[\u7CFB\u7EDF\u63D0\u793A] \u5DF2\u8FDE\u7EED ${n} \u4E2A\u5DE5\u5177\u8C03\u7528\u5931\u8D25\uFF08\u6700\u8FD1\uFF1A${lastName}\uFF09\u3002\u8BF7\u5148\u505C\u4E0B\u68C0\u67E5\uFF1A\u9519\u8BEF\u539F\u56E0\u662F\u5426\u76F8\u540C\uFF1F`,
    `\u4E0B\u4E00\u6B65\u4E8C\u9009\u4E00\uFF1A\u82E5\u662F\u6743\u9650\u4E0D\u8DB3\u3001\u8DEF\u5F84\u4E0D\u5B58\u5728\u8FD9\u7C7B\u73AF\u5883\u95EE\u9898\uFF0C\u6539\u7528\u5BF9\u5E94\u5DE5\u5177\u5148\u6838\u5B9E\uFF08\u5982\u5217\u76EE\u5F55\u3001\u6743\u9650\u68C0\u67E5\uFF09\uFF0C\u786E\u8BA4\u76EE\u6807\u662F\u5426\u5B58\u5728\u3001\u662F\u5426\u53EF\u8BBF\u95EE\u518D\u884C\u52A8\uFF1B\u82E5\u662F\u53C2\u6570\u6216\u524D\u63D0\u5F04\u9519\uFF0C\u5148\u8BFB\u76F8\u5173\u6587\u4EF6\u3001\u91CD\u65B0\u786E\u8BA4\u73AF\u5883\u72B6\u6001\u3002\u4E0D\u8981\u4EE5\u540C\u6837\u65B9\u5F0F\u91CD\u8BD5\u3002`
  ];
  if (n >= REPEAT_HARD_LIMIT) {
    parts.push(
      `\u5DF2\u8FDE\u7EED\u5931\u8D25 ${n} \u6B21\uFF08\u8FBE\u5230\u786C\u9608\u503C ${REPEAT_HARD_LIMIT}\uFF09\uFF0C\u8BE5\u95EE\u9898\u5927\u6982\u7387\u65E0\u6CD5\u9760\u91CD\u8BD5\u89E3\u51B3\uFF1A\u5EFA\u8BAE\u7ACB\u5373\u6536\u5C3E\u2014\u2014\u57FA\u4E8E\u5DF2\u6709\u6210\u679C\u5411\u7528\u6237\u7ED9\u51FA\u603B\u7ED3\u6027\u7B54\u590D\uFF0C\u8BF4\u660E\u5269\u4F59\u6B65\u9AA4\u4E0E\u963B\u585E\u539F\u56E0\uFF0C\u7B49\u5F85\u7528\u6237\u6307\u793A\uFF0C\u4E0D\u8981\u518D\u7EE7\u7EED\u5C1D\u8BD5\u5DE5\u5177\u8C03\u7528\u3002`
    );
  }
  return parts.join("\n");
}
function checkRepeatCall(counter, signature) {
  const seen = (counter.get(signature) || 0) + 1;
  counter.set(signature, seen);
  const toolName = signature.split("::")[0];
  if (seen < REPEAT_HARD_LIMIT) {
    const soft = seen >= REPEAT_SOFT_LIMIT;
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
  let cut = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = messageTokens(rest[i]);
    if (used + t > budgetTokens && rest.length - i >= 4) {
      cut = i + 1;
      break;
    }
    used += t;
  }
  while (cut < rest.length) {
    const m = rest[cut];
    if (m.role !== "tool" && !(m.role === "assistant" && m.tool_calls)) break;
    let start = cut;
    if (m.role === "tool") {
      let s = cut;
      while (s > 0 && rest[s - 1].role === "tool") s--;
      const owner = s > 0 ? rest[s - 1] : null;
      const ownerIds = owner && owner.role === "assistant" && owner.tool_calls ? new Set(
        (owner.tool_calls ?? []).map((tc) => String(tc?.id ?? "")).filter(Boolean)
      ) : null;
      if (!ownerIds || !ownerIds.has(String(m.tool_call_id ?? ""))) {
        let e = cut;
        while (e < rest.length && rest[e].role === "tool") e++;
        used -= rest.slice(cut, e).reduce((a, x) => a + messageTokens(x), 0);
        cut = e;
        continue;
      }
      start = s - 1;
    }
    const ids = new Set(
      (rest[start].tool_calls ?? []).map((tc) => String(tc?.id ?? "")).filter(Boolean)
    );
    let end = start + 1;
    while (end < rest.length && rest[end].role === "tool" && ids.has(String(rest[end].tool_call_id ?? ""))) end++;
    const prefixTokens = rest.slice(start, cut).reduce((a, x) => a + messageTokens(x), 0);
    if (end > start + 1 && used + prefixTokens <= budgetTokens) {
      cut = start;
      used += prefixTokens;
      break;
    }
    used -= rest.slice(cut, end).reduce((a, x) => a + messageTokens(x), 0);
    cut = end;
  }
  const kept = [...system, ...rest.slice(cut)];
  return { messages: kept, dropped: cut, tokens: totalTokens(kept) };
}
var CONTEXT_OVERFLOW_PATTERN = /context length|prompt (is )?too long|too many tokens|maximum context|context_length_exceeded|request too large|exceed[s]?( the)?( maximum )? context|context window|input (is )?too long|输入过长|输入太长|上下文过长|上下文超长|上下文太长|超出上下文|上下文超出/i;
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
  "url_tools",
  "get_file_info",
  "read_many_files",
  "glob",
  "grep_search",
  "code_analysis",
  "find_in_files",
  "file_stats",
  "text_diff",
  "shell_list",
  "list_skills",
  "load_skill",
  "consult_guidance"
]);
var TOOL_TIMEOUT_MS = 18e4;
var TAIL_KEEP_TOOLS = /* @__PURE__ */ new Set(["shell", "npm_run", "git_operation", "run_tests", "web_fetch"]);
function clampToolResult(text, toolName) {
  const MAX = 4e4;
  if (!text || text.length <= MAX) return text;
  const head = Math.floor(MAX * 0.3);
  const tail = MAX - head;
  if (toolName && TAIL_KEEP_TOOLS.has(toolName)) {
    return text.slice(0, head) + "\n\n\u2026[\u4E2D\u95F4 " + (text.length - MAX) + " \u5B57\u7B26\u5DF2\u7701\u7565\uFF1B\u4E0B\u65B9\u4FDD\u7559\u672B\u5C3E " + tail + " \u5B57\u7B26\uFF08\u9519\u8BEF\u5806\u6808\u901A\u5E38\u5728\u7ED3\u5C3E\uFF09\u3002\u5982\u9700\u67E5\u770B\u88AB\u7701\u7565\u7684\u90E8\u5206\uFF0C\u53EF\u7F29\u5C0F\u8303\u56F4\u91CD\u8DD1\u547D\u4EE4\uFF08\u5982\u52A0 head/tail/grep \u9650\u5B9A\uFF09\uFF0C\u6216\u628A\u5B8C\u6574\u8F93\u51FA\u91CD\u5B9A\u5411\u5230\u6587\u4EF6\u540E\u7528 read_file \u7684 offset/limit \u53C2\u6570\u5206\u6BB5\u8BFB\u53D6\u3002]\u2026\n\n" + text.slice(-tail);
  }
  return text.slice(0, MAX) + "\n\n[\u8F93\u51FA\u8FC7\u957F\u5DF2\u622A\u65AD\uFF1A\u539F\u59CB " + text.length + " \u5B57\u7B26\uFF0C\u4EC5\u4FDD\u7559\u524D " + MAX + "\u3002\u7EED\u8BFB\u6307\u5F15\uFF1A\u82E5\u5185\u5BB9\u6765\u81EA\u6587\u4EF6\uFF0C\u8BF7\u7528 read_file \u7684 offset/limit \u53C2\u6570\u5206\u6BB5\u8BFB\u53D6\u672A\u5C55\u793A\u7684\u90E8\u5206\uFF1B\u82E5\u6765\u81EA\u547D\u4EE4\u8F93\u51FA\uFF0C\u8BF7\u7F29\u5C0F\u8303\u56F4\u91CD\u8DD1\uFF08\u5982\u52A0 head/tail/grep \u9650\u5B9A\uFF09\u5206\u6BB5\u83B7\u53D6\u3002]";
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
function buildLoopContext(deps) {
  return {
    toolRound: 0,
    wrapUp: false,
    clearableIds: /* @__PURE__ */ new Set(),
    overflowRetried: false,
    callSignatures: /* @__PURE__ */ new Map(),
    toolUseCounts: /* @__PURE__ */ new Map(),
    failCounter: { n: 0 },
    fullThinking: deps.resume?.thinking || "",
    fullContent: deps.resume?.content || "",
    allToolCalls: [...deps.resume?.toolCalls || []]
  };
}
async function resumePendingTool(ctx, deps, messages, perf) {
  const { events, signal } = deps;
  if (!deps.pendingTool) return;
  const { toolCall, decision } = deps.pendingTool;
  const obj = { ...toolCall, status: "running", started_at: (/* @__PURE__ */ new Date()).toISOString() };
  events.onToolStart?.(obj);
  if (decision) {
    obj.status = "error";
    obj.result = String(decision);
    obj.finished_at = (/* @__PURE__ */ new Date()).toISOString();
    events.onToolEnd?.(obj);
    ctx.allToolCalls.push(obj);
    messages.push({ role: "tool", tool_call_id: obj.id, content: String(decision) });
    return;
  }
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
  ctx.allToolCalls.push(obj);
  perf.addTool(1, toolCall.name, Date.now() - t0, obj.status !== "error");
}
function buildWrapUpNotice(ctx) {
  const counts = /* @__PURE__ */ new Map();
  for (const tc of ctx.allToolCalls) {
    const e = counts.get(tc.name) || { ok: 0, fail: 0 };
    if (tc.status === "error") e.fail++;
    else e.ok++;
    counts.set(tc.name, e);
  }
  const lines = ["\u3010\u7CFB\u7EDF\u3011\u5DE5\u5177\u8C03\u7528\u8F6E\u6B21\u5DF2\u7528\u5C3D\uFF0C\u672C\u6B21\u8BF7\u6C42\u5DF2\u7981\u7528\u5168\u90E8\u5DE5\u5177\u3002\u8BF7\u7ACB\u523B\u57FA\u4E8E\u5DF2\u6709\u4FE1\u606F\u7ED9\u51FA\u603B\u7ED3\u6027\u7B54\u590D\uFF0C\u4E0D\u8981\u518D\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\u3002"];
  const total = ctx.allToolCalls.length;
  if (total > 0) {
    const names = [...counts.entries()].map(([name, e]) => e.fail > 0 ? `${name}\xD7${e.ok + e.fail}\uFF08\u5931\u8D25 ${e.fail}\uFF09` : `${name}\xD7${e.ok}`).join("\u3001");
    lines.push(`\u5DF2\u5B8C\u6210\u7684\u5DE5\u5177\u8C03\u7528\u5171 ${total} \u6B21\uFF1A${names}\u3002\u5404\u6B21\u8C03\u7528\u7684\u7ED3\u679C\u90FD\u5728\u4E0A\u65B9\u5BF9\u8BDD\u5386\u53F2\u4E2D\uFF0C\u53EF\u76F4\u63A5\u5F15\u7528\uFF0C\u65E0\u9700\u91CD\u8DD1\u3002`);
  }
  lines.push("\u7B54\u590D\u8981\u6C42\uFF1A\u6C47\u603B\u5DF2\u5B8C\u6210\u7684\u5DE5\u4F5C\u4E0E\u5173\u952E\u7ED3\u679C\uFF1B\u5982\u6709\u672A\u5B8C\u6210\u4E8B\u9879\uFF0C\u7528\u6587\u5B57\u5217\u51FA\u5269\u4F59\u6B65\u9AA4\u4E0E\u6240\u9700\u4FE1\u606F\uFF0C\u7B49\u5F85\u7528\u6237\u6307\u793A\uFF0C\u4E0D\u8981\u8BD5\u56FE\u7EE7\u7EED\u6267\u884C\u3002");
  return lines.join("\n");
}
function prepareRoundMessages(ctx, messages, deps) {
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
      const mc = microcompact(sendMessages, { clearableIds: ctx.clearableIds });
      if (mc.cleared > 0) sendMessages = mc.messages;
    }
    if (totalTokens(sendMessages) > budget) {
      sendMessages = truncateForBudget(sendMessages, budget).messages;
    }
  }
  if (ctx.wrapUp) {
    sendMessages = [...sendMessages, { role: "user", content: buildWrapUpNotice(ctx) }];
  }
  return sendMessages;
}
async function requestRound(deps, ctx, sendMessages, maxTokens, signal, perf) {
  const { events } = deps;
  const makeBody = () => JSON.stringify({
    model: deps.model,
    messages: sendMessages,
    tools: ctx.wrapUp ? [] : deps.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters }
    })),
    tool_choice: ctx.wrapUp ? "none" : "auto",
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
      if (signal?.aborted) throw e;
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
    if (isContextOverflowError(errText) && !ctx.overflowRetried) {
      ctx.overflowRetried = true;
      const cur = deps.contextBudget || totalTokens(sendMessages);
      const tighter = Math.max(2e3, Math.floor(cur * 0.5));
      sendMessages.splice(0, sendMessages.length, ...truncateForBudget(sendMessages, tighter).messages);
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
  return res;
}
async function streamRound(res, ctx, deps, perf) {
  const { events, signal } = deps;
  const onChunk = events.onChunk;
  const onThinking = events.onThinking;
  const onToolDraft = events.onToolDraft;
  let roundContent = "";
  const toolCallMap = /* @__PURE__ */ new Map();
  let draftAnnounced = false;
  let firstTokenSeen = false;
  for await (const data of ssePayloads(res.body)) {
    if (data === "[DONE]") break;
    if (signal?.aborted) return { toolCalls: [], roundContent };
    try {
      const parsed = JSON.parse(data);
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      const think = extractReasoning(delta);
      if (think) {
        if (!firstTokenSeen) {
          perf.firstToken();
          firstTokenSeen = true;
        }
        ctx.fullThinking += think;
        onThinking?.(think);
      }
      if (delta?.content) {
        if (!firstTokenSeen) {
          perf.firstToken();
          firstTokenSeen = true;
        }
        roundContent += delta.content;
        ctx.fullContent += delta.content;
        onChunk?.(delta.content);
      }
      const parsedTcs = parseToolCallsFromDelta(delta);
      if (parsedTcs) {
        for (const tc of parsedTcs) accumulateToolCallDelta(toolCallMap, tc);
        if (!draftAnnounced) {
          draftAnnounced = true;
          onToolDraft?.(parsedTcs[0]?.function?.name || "\u2026");
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
      toolCalls = hermes.map((h, i) => ({ id: "hermes_" + i + "_" + Date.now(), name: h.name, arguments: h.arguments }));
      roundContent = stripToolCallBlocks(roundContent);
      ctx.fullContent = stripToolCallBlocks(ctx.fullContent);
    }
  }
  perf.llmStreamEnd();
  return { toolCalls, roundContent };
}
async function gateToolCalls(ctx, deps, messages, toolCalls) {
  const { events, signal } = deps;
  const plans = [];
  for (const tc of toolCalls) {
    if (signal?.aborted) return [];
    const sig = callSignature(tc.name, tc.arguments);
    const repeat = checkRepeatCall(ctx.callSignatures, sig);
    if (repeat.blocked) {
      const seen = ctx.callSignatures.get(sig) || 0;
      const hint = seen > 0 ? "\n\n[\u7CFB\u7EDF\u63D0\u793A] \u672C\u6B21\u5DF2\u662F\u7B2C " + seen + " \u6B21\u76F8\u540C\u53C2\u6570\u8C03\u7528\u3002" : "";
      messages.push({ role: "tool", tool_call_id: tc.id, content: repeat.message + hint });
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
      throw new NeedsClientError(need, obj, messages, { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls }, deps.scopeKeyOf?.(obj));
    }
    const denial = await deps.confirmTool?.(obj);
    if (denial) {
      obj.status = "error";
      obj.result = denial;
      obj.finished_at = (/* @__PURE__ */ new Date()).toISOString();
      events.onToolEnd?.(obj);
      ctx.allToolCalls.push(obj);
      messages.push({ role: "tool", tool_call_id: tc.id, content: denial });
      continue;
    }
    plans.push({ tc, obj });
  }
  return plans;
}
async function executePlans(ctx, deps, messages, plans, perf) {
  const { events, signal } = deps;
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
        if (deps.failureRecovery) {
          if (result.success) deps.failureRecovery.reset();
          else {
            try {
              const rec = deps.failureRecovery.plan({
                toolName: pl.tc.name,
                args: parsedArgs,
                errorText: String(result.error || ""),
                round: ctx.toolRound,
                at: Date.now()
              });
              deps.failureRecovery.record({
                toolName: pl.tc.name,
                args: parsedArgs,
                errorText: String(result.error || ""),
                round: ctx.toolRound,
                at: Date.now()
              });
              if (rec.instruction) toolResult += "\n\n[\u6062\u590D\u5EFA\u8BAE] " + rec.instruction;
            } catch {
            }
          }
        }
      } catch (te) {
        toolResult = "\u274C \u9519\u8BEF: " + (te instanceof Error ? te.message : String(te));
        pl.obj.status = "error";
        if (deps.failureRecovery) {
          try {
            deps.failureRecovery.record({
              toolName: pl.tc.name,
              args: parsedArgs,
              errorText: String(te instanceof Error ? te.message : te),
              round: ctx.toolRound,
              at: Date.now()
            });
          } catch {
          }
        }
      }
    }
    const ms = Date.now() - t0;
    pl.obj.result = toolResult;
    pl.obj.finished_at = (/* @__PURE__ */ new Date()).toISOString();
    events.onToolEnd?.(pl.obj);
    ctx.allToolCalls.push(pl.obj);
    perf.addTool(ctx.toolRound, pl.tc.name, ms, pl.obj.status !== "error");
    const base = pl.obj.result && String(pl.obj.result).trim() ? String(pl.obj.result) : pl.obj.status === "error" ? "\u5DE5\u5177 " + pl.tc.name + " \u6267\u884C\u5931\u8D25\uFF08\u672A\u8FD4\u56DE\u5177\u4F53\u9519\u8BEF\u4FE1\u606F\uFF09\u3002" : "\u5DE5\u5177 " + pl.tc.name + " \u5DF2\u6267\u884C\uFF0C\u4F46\u8FD4\u56DE\u7A7A\u7ED3\u679C\u3002";
    if (CLEARABLE_TOOLS.has(pl.tc.name)) ctx.clearableIds.add(pl.tc.id);
    const useN = bumpToolUse(ctx.toolUseCounts, pl.tc.name);
    const failN = bumpToolFail(ctx.failCounter, pl.obj.status === "error");
    return base + toolUseHint(ctx.toolUseCounts, pl.tc.name) + toolFailHint(failN, pl.tc.name);
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
async function runAgentLoop(messages, deps) {
  const { events, signal } = deps;
  const perf = createAgentPerf();
  perf.setModel(deps.model);
  const ctx = buildLoopContext(deps);
  const maxTokens = deps.maxTokens ?? (Number(deps.contextWindow) >= 8e3 ? 16384 : 8192);
  await resumePendingTool(ctx, deps, messages, perf);
  while (true) {
    if (signal?.aborted) {
      return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: "aborted" };
    }
    ctx.toolRound++;
    perf.roundStart(ctx.toolRound);
    const roundCheck = checkRoundLimit(ctx.toolRound);
    if (roundCheck.exceeded) {
      if (!ctx.wrapUp) {
        ctx.wrapUp = true;
      } else {
        events.onPerf?.(perf.finish());
        return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: "round-limit", error: roundCheck.message };
      }
    }
    const sendMessages = prepareRoundMessages(ctx, messages, deps);
    const res = await requestRound(deps, ctx, sendMessages, maxTokens, signal, perf);
    const streamed = await streamRound(res, ctx, deps, perf);
    const toolCalls = streamed.toolCalls;
    if (signal?.aborted) {
      return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: "aborted" };
    }
    if (toolCalls.length === 0) {
      const content = stripToolCallBlocks(ctx.fullContent);
      events.onPerf?.(perf.finish());
      return { content, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls };
    }
    messages.push({
      role: "assistant",
      content: streamed.roundContent || void 0,
      tool_calls: toolCalls.map((tc, idx) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
        index: idx
      }))
    });
    const plans = await gateToolCalls(ctx, deps, messages, toolCalls);
    if (signal?.aborted) {
      return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: "aborted" };
    }
    await executePlans(ctx, deps, messages, plans, perf);
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

// src/shared/autoCore.ts
var EVALUATOR_SYSTEM = '\u4F60\u662F\u4EFB\u52A1\u5B8C\u6210\u5EA6\u8BC4\u4F30\u5668\u3002\u7ED9\u5B9A\u300C\u7528\u6237\u76EE\u6807\u300D\u548C\u300C\u672C\u8F6E\u6700\u7EC8\u56DE\u590D\u300D\uFF0C\u5224\u65AD\u76EE\u6807\u662F\u5426\u5DF2\u88AB\u5B9E\u8D28\u6027\u5B8C\u6210\u3002\u53EA\u8F93\u51FA JSON\uFF1A{"done":true|false,"note":"\u4E00\u53E5\u8BDD\u8BF4\u660E\u8FD8\u7F3A\u4EC0\u4E48\u6216\u5DF2\u5B8C\u6210\u4EC0\u4E48"}\u3002\u5224\u5B9A\u89C4\u5219\uFF1A\u53EA\u770B\u6709\u6CA1\u6709\u771F\u6B63\u628A\u4E8B\u60C5\u505A\u51FA\u6765\uFF08\u6587\u4EF6\u5DF2\u843D\u76D8\u3001\u547D\u4EE4\u5DF2\u6267\u884C\u3001\u95EE\u9898\u5DF2\u89E3\u51B3\uFF09\uFF0C\u4E0D\u56E0\u5BA2\u5957\u8BDD\u3001\u8BA1\u5212\u63CF\u8FF0\u3001"\u6211\u5C06\u8981"\u3001"\u5DF2\u5B8C\u6210"\u5B57\u6837\u800C\u5224\u5B9A\u5B8C\u6210\uFF1B\u5B81\u53EF\u4FDD\u5B88\u5224\u672A\u5B8C\u6210\u3002';
function truncateByCodePoints(str, max) {
  if (str.length <= max) return str;
  return Array.from(str).slice(0, max).join("");
}
function extractGoal(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((p) => p && p.type === "text").map((p) => p.text || "").join("\n") : "";
    const raw = String(text || "");
    if (/^<system-reminder>[\s\S]*?<\/system-reminder>$/.test(raw.trim())) continue;
    const clean = raw.trim();
    if (clean) return clean;
  }
  return "";
}
function trajectorySignature(calls) {
  return calls.map((c) => `${c.name}:${String(c.arguments || "").replace(/\s+/g, "")}`).sort().join("|");
}
async function evaluateGoalAuto(deps, goalText, lastReply, signal) {
  if (!goalText) return { done: false, note: "\u672A\u8BC6\u522B\u5230\u76EE\u6807", ok: false };
  try {
    const body = JSON.stringify({
      model: deps.model,
      messages: [
        { role: "system", content: EVALUATOR_SYSTEM },
        { role: "user", content: `\u7528\u6237\u76EE\u6807\uFF1A${goalText}

\u672C\u8F6E\u6700\u7EC8\u56DE\u590D\uFF1A
${String(lastReply || "").slice(0, 3e3)}` }
      ],
      max_tokens: 200,
      stream: false,
      temperature: 0
    });
    const res = await deps.callLLM(body, signal || deps.signal);
    if (!res.ok) return { done: false, note: "\u8BC4\u4F30\u670D\u52A1\u6682\u4E0D\u53EF\u7528", ok: false };
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { done: false, note: "", ok: false };
    const parsed = JSON.parse(m[0]);
    return { done: !!parsed.done, note: truncateByCodePoints(String(parsed.note || ""), 160), ok: true };
  } catch {
    return { done: false, note: "\u8BC4\u4F30\u5931\u8D25", ok: false };
  }
}
var AUTO_SYSTEM_PROMPT = `\u3010Auto \u81EA\u4E3B\u5185\u6838\u3011\u4F60\u6B63\u5904\u4E8E\u81EA\u4E3B\u6267\u884C\u6A21\u5F0F\uFF1A\u4E00\u6B21\u56DE\u590D\u7ED3\u675F\u540E\uFF0C\u7CFB\u7EDF\u4F1A\u7528\u72EC\u7ACB\u8BC4\u4F30\u5668\u68C0\u67E5\u7528\u6237\u76EE\u6807\u662F\u5426\u771F\u6B63\u5B8C\u6210\uFF0C\u672A\u5B8C\u6210\u4F1A\u81EA\u52A8\u7EED\u8DD1\u3002\u56E0\u6B64\uFF1A
- \u76F4\u63A5\u884C\u52A8\u3001\u52A8\u624B\u628A\u4E8B\u60C5\u505A\u51FA\u6765\uFF0C\u4E0D\u8981\u53EA\u63CF\u8FF0\u8BA1\u5212\u6216\u8BF4"\u6211\u5C06\u8981"\u3002
- \u5199\u5927\u6587\u4EF6\u7528 append_file \u5206\u6BB5\u5199\uFF1A\u5148 mode=start \u5199\u7B2C\u4E00\u6BB5\uFF0C\u518D mode=append \u9010\u6BB5\u8FFD\u52A0\uFF08\u5199\u4E00\u884C\u843D\u4E00\u884C\uFF09\uFF0C\u4E0D\u8981\u628A\u6574\u4EFD\u957F\u5185\u5BB9\u585E\u8FDB\u4E00\u6B21 write_file\u2014\u2014\u90A3\u6837\u5BB9\u6613\u88AB\u622A\u65AD\u5BFC\u81F4\u70C2\u5C3E\u3002
- \u6BCF\u8F6E\u7ED3\u675F\u7ED9\u51FA\u660E\u786E\u7684\u300C\u5DF2\u5B8C\u6210\u4EC0\u4E48 / \u8FD8\u5DEE\u4EC0\u4E48\u300D\uFF0C\u8BC4\u4F30\u5668\u636E\u6B64\u5224\u65AD\u3002
- \u82E5\u786E\u5B9E\u53D7\u963B\uFF08\u7F3A\u6743\u9650/\u7F3A\u4FE1\u606F/\u9700\u7528\u6237\u51B3\u7B56\uFF09\uFF0C\u660E\u786E\u8BF4\u660E\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u505C\u6B62\u7EED\u8DD1\u3002`;
function withAutoPrompt(messages) {
  const first = messages[0];
  return first && first.role === "system" ? [{ ...first, content: String(first.content || "") + "\n\n" + AUTO_SYSTEM_PROMPT }, ...messages.slice(1)] : [{ role: "system", content: AUTO_SYSTEM_PROMPT }, ...messages];
}
async function runAutoLoop(messages, deps) {
  const { signal } = deps;
  const working = withAutoPrompt(messages);
  const goal = extractGoal(messages);
  const maxRounds = Math.max(1, Math.min(12, deps.maxAutonomousRounds ?? 5));
  let totalContent = "";
  let totalThinking = "";
  const allToolCalls = [];
  const signatures = [];
  for (let round = 1; round <= maxRounds; round++) {
    if (signal?.aborted) {
      return { content: totalContent, thinking: totalThinking, toolCalls: allToolCalls, stopped: "aborted" };
    }
    const result = await runAgentLoop(working, deps);
    totalContent += (round > 1 ? "\n\n" : "") + result.content;
    totalThinking += result.thinking;
    allToolCalls.push(...result.toolCalls);
    if (result.stopped) {
      return { content: totalContent, thinking: totalThinking, toolCalls: allToolCalls, stopped: result.stopped, error: result.error };
    }
    if (round >= maxRounds) break;
    const sig = trajectorySignature(result.toolCalls);
    if (sig && signatures.length && signatures[signatures.length - 1] === sig) {
      return {
        content: totalContent,
        thinking: totalThinking,
        toolCalls: allToolCalls,
        stopped: "round-limit",
        error: "\u81EA\u4E3B\u5185\u6838\u68C0\u6D4B\u5230\u8FDE\u7EED\u4E24\u8F6E\u6267\u884C\u76F8\u540C\u64CD\u4F5C\u3001\u65E0\u5B9E\u8D28\u8FDB\u5C55\uFF0C\u5DF2\u505C\u6B62\u4EE5\u907F\u514D\u7A7A\u8F6C\u3002"
      };
    }
    if (sig) signatures.push(sig);
    const ev = await evaluateGoalAuto(deps, goal, result.content, signal);
    if (!ev.ok) break;
    if (ev.done) break;
    working.push({
      role: "user",
      content: `<system-reminder>\u76EE\u6807\u5C1A\u672A\u5B8C\u6210\uFF1A${ev.note || "\u8BF7\u7EE7\u7EED\u63A8\u8FDB"}\u3002\u8BF7\u76F4\u63A5\u52A8\u624B\u8865\u9F50\u7F3A\u53E3\uFF0C\u4E0D\u8981\u91CD\u590D\u5DF2\u5B8C\u6210\u7684\u6B65\u9AA4\uFF0C\u4E5F\u4E0D\u8981\u5411\u7528\u6237\u63D0\u53CA\u8FD9\u6761\u63D0\u9192\u3002</system-reminder>`
    });
  }
  return { content: totalContent, thinking: totalThinking, toolCalls: allToolCalls };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUTO_SYSTEM_PROMPT,
  evaluateGoalAuto,
  extractGoal,
  runAutoLoop,
  trajectorySignature,
  withAutoPrompt
});
