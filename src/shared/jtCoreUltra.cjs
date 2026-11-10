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

// src/shared/jtCoreUltra.ts
var jtCoreUltra_exports = {};
__export(jtCoreUltra_exports, {
  ContentLoopDetector: () => ContentLoopDetector,
  StuckDetector: () => StuckDetector,
  TERMINAL_STATES: () => TERMINAL_STATES,
  ToolCallStateMachine: () => ToolCallStateMachine,
  ToolLoopDetector: () => ToolLoopDetector,
  ULTRA_MAX_TURNS: () => MAX_TURNS,
  UltraNeedsClientError: () => UltraNeedsClientError,
  allReady: () => allReady,
  canTransition: () => canTransition,
  fastNextSpeaker: () => fastNextSpeaker,
  findCompressSplitPoint: () => findCompressSplitPoint,
  needsCompression: () => needsCompression,
  parseNextSpeaker: () => parseNextSpeaker,
  resolveNextSpeaker: () => resolveNextSpeaker,
  runUltraLoop: () => runUltraLoop,
  shouldSemanticCheck: () => shouldSemanticCheck,
  toolFingerprint: () => toolFingerprint,
  ultraBackoff: () => delayWithJitter,
  ultraQuotaDelay: () => quotaDelay,
  ultraRetryable: () => isRetryableStatus
});
module.exports = __toCommonJS(jtCoreUltra_exports);

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
      try {
        JSON.parse(slot.arguments);
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
var RETRY_AFTER_CAP_MS = 1e4;
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

// src/shared/agentLoop.ts
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
function buildUpstreamError(status, errText) {
  const detail = (errText || "").slice(0, 300);
  if (status === 401 || status === 403) return `\u9274\u6743\u5931\u8D25\uFF08${status}\uFF09\uFF1AAPI Key \u6216\u6743\u9650\u4E0D\u6B63\u786E\u3002\u8BF7\u5230 \u8BBE\u7F6E \u2192 \u63A8\u7406 \u68C0\u67E5\u3002${detail ? " " + detail : ""}`;
  if (status === 402) return `\u4F59\u989D\u6216\u989D\u5EA6\u4E0D\u8DB3\uFF08402\uFF09\u3002\u8BF7\u6362\u7528\u514D\u8D39\u6A21\u578B\u6216\u5145\u503C\u3002${detail ? " " + detail : ""}`;
  if (status === 404) return `\u63A5\u53E3\u4E0D\u5B58\u5728\uFF08404\uFF09\uFF1A\u8BF7\u68C0\u67E5 API \u5730\u5740\u662F\u5426\u4EE5 /v1 \u7ED3\u5C3E\u3001\u6A21\u578B\u540D\u662F\u5426\u6B63\u786E\u3002${detail ? " " + detail : ""}`;
  if (status === 429) return `\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF08429\uFF09\uFF0C\u5DF2\u81EA\u52A8\u91CD\u8BD5\u4ECD\u672A\u6210\u529F\u3002\u7A0D\u540E\u518D\u8BD5\u6216\u6362\u6A21\u578B\u3002${detail ? " " + detail : ""}`;
  if (status >= 500) return `\u4E0A\u6E38\u670D\u52A1\u5F02\u5E38\uFF08${status}\uFF09\uFF0C\u5DF2\u81EA\u52A8\u91CD\u8BD5\u4ECD\u672A\u6210\u529F\u3002${detail ? " " + detail : ""}`;
  return `\u8BF7\u6C42\u5931\u8D25\uFF08${status}\uFF09${detail ? "\uFF1A" + detail : ""}`;
}

// src/shared/ultra/types.ts
var TERMINAL_STATES = /* @__PURE__ */ new Set(["success", "error", "cancelled"]);
var ALLOWED = {
  validating: ["awaiting_approval", "scheduled", "error", "cancelled"],
  awaiting_approval: ["scheduled", "cancelled", "error"],
  scheduled: ["executing", "cancelled", "error"],
  executing: ["success", "error", "cancelled"],
  success: [],
  error: [],
  cancelled: []
};
function canTransition(from, to) {
  return (ALLOWED[from] || []).includes(to);
}

// src/shared/ultra/toolScheduler.ts
var ToolCallStateMachine = class {
  state = "validating";
  data = {};
  log = [];
  transition(to, data) {
    if (!canTransition(this.state, to)) throw new Error(`\u975E\u6CD5\u5DE5\u5177\u72B6\u6001\u8DC3\u8FC1: ${this.state} \u2192 ${to}`);
    if (to === "executing" && data?.liveOutput === void 0) throw new Error("executing \u9700\u8981 liveOutput");
    if (to === "success" && data?.result === void 0) throw new Error("success \u9700\u8981 result");
    if (to === "error" && data?.error === void 0) throw new Error("error \u9700\u8981 error");
    this.log.push({ from: this.state, to, at: Date.now() });
    this.state = to;
    if (data) this.data = { ...this.data, ...data };
  }
  get terminal() {
    return TERMINAL_STATES.has(this.state);
  }
  get history() {
    return this.log;
  }
};
function decidePolicy(name, cfg = {}) {
  if (cfg.denyTools?.has(name)) return "deny";
  if (cfg.yolo) return "allow";
  if (cfg.confirmTools?.has(name)) return "ask";
  return "allow";
}
var ConfirmationBus = class {
  pending = /* @__PURE__ */ new Map();
  decided = /* @__PURE__ */ new Set();
  /** 返回 Promise；resolve(true)=批准，resolve(false)=拒绝 */
  request(callId, reason) {
    if (this.decided.has(callId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.pending.set(callId, { resolve, reason });
    });
  }
  approve(callId) {
    this.finish(callId, true);
  }
  deny(callId) {
    this.finish(callId, false);
  }
  finish(callId, approved) {
    this.decided.add(callId);
    const p = this.pending.get(callId);
    if (p) {
      p.resolve(approved);
      this.pending.delete(callId);
    }
  }
  get size() {
    return this.pending.size;
  }
  get waiting() {
    return [...this.pending.keys()];
  }
};
function allReady(calls) {
  return calls.every((c) => c.fsm.terminal || c.fsm.state === "scheduled" || c.fsm.state === "executing");
}
function hasBlocking(calls) {
  return calls.some((c) => c.fsm.state === "awaiting_approval" || c.fsm.state === "executing");
}
async function yieldIfBlocked(calls, tickMs = 10) {
  const blocking = hasBlocking(calls);
  if (blocking) {
    await new Promise((r) => setTimeout(r, tickMs));
    return { yielded: true, stuck: false };
  }
  const anyProgress = calls.some((c) => c.fsm.state === "validating" || c.fsm.state === "scheduled");
  return { yielded: false, stuck: !anyProgress };
}
function normalizeOutcome(tc, output, failed, error) {
  const state = failed ? "error" : "success";
  return { callId: tc.id, state, output, error };
}
var SerialRequestQueue = class {
  processing = false;
  queue = [];
  async submit(job) {
    this.queue.push(job);
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const j = this.queue.shift();
        await j();
      }
    } finally {
      this.processing = false;
    }
  }
  get busy() {
    return this.processing;
  }
  get pending() {
    return this.queue.length;
  }
};

// src/shared/ultra/loopDetection.ts
var TOOL_CALL_LOOP_THRESHOLD = 5;
var CONTENT_LOOP_THRESHOLD = 10;
var CONTENT_CHUNK_SIZE = 50;
var LLM_CHECK_AFTER_TURNS = 30;
var LLM_CHECK_INTERVAL = 10;
var LLM_CHECK_MIN = 5;
var LLM_CHECK_MAX = 15;
var LLM_HISTORY_TURNS = 20;
var LLM_CONFIDENCE_THRESHOLD = 0.9;
function toolFingerprint(name, args) {
  let h = 5381;
  const s = name + "|" + String(args || "");
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) >>> 0;
  return h.toString(36);
}
var ToolLoopDetector = class {
  history = [];
  threshold = TOOL_CALL_LOOP_THRESHOLD;
  ring = TOOL_CALL_LOOP_THRESHOLD * 5;
  add(fp) {
    this.history.push(fp);
    if (this.history.length > this.ring) this.history.shift();
    const tail = this.history.slice(-this.threshold);
    if (tail.length < this.threshold) return false;
    const counts = /* @__PURE__ */ new Map();
    for (const x of tail) counts.set(x, (counts.get(x) || 0) + 1);
    for (const n of counts.values()) if (n >= this.threshold) return true;
    for (let k = 2; k <= 5; k++) {
      let cyclic = true;
      for (let i = k; i < tail.length; i++) {
        if (tail[i] !== tail[i - k]) {
          cyclic = false;
          break;
        }
      }
      if (cyclic && tail.length >= 2 * k) return true;
    }
    return false;
  }
  reset() {
    this.history = [];
  }
  get samples() {
    return [...this.history];
  }
};
var ContentLoopDetector = class {
  chunks = [];
  threshold = CONTENT_LOOP_THRESHOLD;
  chunkSize = CONTENT_CHUNK_SIZE;
  maxDistance = CONTENT_CHUNK_SIZE * 5;
  add(text) {
    if (!text) return false;
    for (let i = 0; i + this.chunkSize <= text.length; i += this.chunkSize) {
      this.chunks.push({ key: text.slice(i, i + this.chunkSize), at: i });
    }
    const byKey = /* @__PURE__ */ new Map();
    for (const c of this.chunks) {
      const a = byKey.get(c.key) || [];
      a.push(c.at);
      byKey.set(c.key, a);
    }
    for (const [, positions] of byKey) {
      if (positions.length < this.threshold) continue;
      const last = positions.slice(-this.threshold);
      let sum = 0;
      for (let i = 1; i < last.length; i++) sum += last[i] - last[i - 1];
      const avg = sum / (last.length - 1);
      const periods = /* @__PURE__ */ new Set();
      for (let i = 1; i < last.length; i++) periods.add(last[i] - last[i - 1]);
      if (avg <= this.maxDistance && periods.size <= Math.floor(this.threshold / 2)) return true;
    }
    return false;
  }
  reset() {
    this.chunks = [];
  }
};
function semanticInterval(confidence = 0.5) {
  const base = LLM_CHECK_INTERVAL;
  const scaled = Math.round(base * (1 + (1 - confidence)));
  return Math.max(LLM_CHECK_MIN, Math.min(LLM_CHECK_MAX, scaled));
}
function shouldSemanticCheck(turn, lastCheck, confidence = 0.5) {
  if (turn < LLM_CHECK_AFTER_TURNS) return false;
  return turn - lastCheck >= semanticInterval(confidence);
}
var LoopRecovery = class {
  count = 0;
  /** 返回 'nudge' | 'stop' | null */
  signal(loopHit) {
    if (!loopHit) return null;
    this.count++;
    return this.count === 1 ? "nudge" : "stop";
  }
  get nudges() {
    return Math.min(this.count, 1);
  }
  reset() {
    this.count = 0;
  }
};
var STEP_BACK_MESSAGE = "\u3010\u5FAA\u73AF\u81EA\u6551\u3011\u68C0\u6D4B\u5230\u91CD\u590D\u884C\u4E3A\uFF0C\u8BF7\u505C\u4E0B\u91CD\u65B0\u5BA1\u89C6\uFF1A\u6362\u4E00\u79CD\u65B9\u6CD5\u3001\u6362\u53C2\u6570\uFF0C\u6216\u57FA\u4E8E\u5DF2\u6709\u4FE1\u606F\u76F4\u63A5\u7ED9\u51FA\u6700\u7EC8\u7ED3\u8BBA\uFF0C\u4E0D\u8981\u91CD\u590D\u539F\u52A8\u4F5C\u3002";

// src/shared/ultra/retry.ts
var DEFAULT_MAX_ATTEMPTS = 10;
var INITIAL_DELAY_MS = 5e3;
var MAX_DELAY_MS = 3e4;
var JITTER_FACTOR = 0.3;
var QUOTA_JITTER = 0.2;
var MAX_SILENT_CAPACITY_ATTEMPTS = 3;
var MAX_VALIDATION_ATTEMPTS = 3;
var RETRYABLE_STATUS = /* @__PURE__ */ new Set([429, 499, 500, 502, 503, 504, 529]);
function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(status);
}
function delayWithJitter(attempt, opts = {}) {
  const init = opts.initialDelayMs ?? INITIAL_DELAY_MS;
  const cap = opts.maxDelayMs ?? MAX_DELAY_MS;
  const rng = opts.rng ?? Math.random;
  const raw = init * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(raw, cap);
  return Math.max(0, Math.round(capped + capped * JITTER_FACTOR * (rng() * 2 - 1)));
}
function quotaDelay(serverDelayMs, opts = {}) {
  const init = opts.initialDelayMs ?? INITIAL_DELAY_MS;
  const rng = opts.rng ?? Math.random;
  const floor = Math.max(init, serverDelayMs || 0);
  return Math.round(floor * (1 + QUOTA_JITTER * rng()));
}
function decideRetry(status, attempt, opts = {}, extras = {}) {
  const max = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (attempt >= max) return { retry: false, delayMs: 0, reason: `\u5DF2\u8FBE\u6700\u5927\u5C1D\u8BD5\u6B21\u6570 ${max}` };
  if (!isRetryableStatus(status)) {
    if (status === 0 && opts.shouldRetryOnContent && extras.content !== void 0 && opts.shouldRetryOnContent(extras.content)) {
      return { retry: true, delayMs: delayWithJitter(attempt, opts), reason: "\u5185\u5BB9\u7EA7\u91CD\u89E6\u53D1" };
    }
    return { retry: false, delayMs: 0, reason: `${status} \u4E0D\u53EF\u91CD\u8BD5\uFF08\u914D\u7F6E\u6216\u53C2\u6570\u95EE\u9898\uFF0C\u6C38\u4E0D\u91CD\u8BD5 400 \u7C7B\uFF09` };
  }
  if ((extras.silentCapacity || 0) >= MAX_SILENT_CAPACITY_ATTEMPTS) return { retry: false, delayMs: 0, reason: "\u9759\u9ED8\u5BB9\u91CF\u9519\u8BEF\u6B21\u6570\u8D85\u9650" };
  if ((extras.validationFailures || 0) >= MAX_VALIDATION_ATTEMPTS) return { retry: false, delayMs: 0, reason: "\u54CD\u5E94\u6821\u9A8C\u5931\u8D25\u6B21\u6570\u8D85\u9650" };
  const delay = status === 429 ? quotaDelay(extras.serverDelayMs ?? null, opts) : delayWithJitter(attempt, opts);
  return { retry: true, delayMs: delay, reason: `\u4E0A\u6E38 ${status}\uFF0C\u7B2C ${attempt + 1} \u6B21\u91CD\u8BD5` };
}
var ModelFallback = class {
  constructor(models, maxResets = 2) {
    this.models = models;
    this.maxResets = maxResets;
  }
  idx = 0;
  resets = 0;
  get current() {
    return this.models[this.idx] || "";
  }
  /** 返回是否还能回落 */
  fallback() {
    if (this.idx + 1 >= this.models.length) return false;
    this.idx++;
    this.resets++;
    return this.resets <= this.maxResets;
  }
  reset() {
    this.idx = 0;
  }
  get exhausted() {
    return this.resets > this.maxResets;
  }
};

// src/shared/ultra/chatCompression.ts
var DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5;
var COMPRESSION_PRESERVE_THRESHOLD = 0.3;
var RECENT_TURNS_PROTECTED = 3;
var COLLAPSE_HISTORY_BYTE_THRESHOLD = 256 * 1024;
var COLLAPSED_FUNCTION_RESPONSE_MAX_BYTES = 2 * 1024;
function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 12288 && c <= 40959 || c >= 65280 && c <= 65519) cjk++;
  }
  return Math.ceil(cjk + (text.length - cjk) / 4);
}
function estimateMessagesTokens(messages) {
  return messages.reduce((s, m) => s + estimateTokens(typeof m.content === "string" ? m.content : ""), 0);
}
function needsCompression(messages, contextWindow, threshold = DEFAULT_COMPRESSION_TOKEN_THRESHOLD) {
  if (!contextWindow || contextWindow <= 0) return false;
  return estimateMessagesTokens(messages) / contextWindow >= threshold;
}
function findCompressSplitPoint(messages, preserve = COMPRESSION_PRESERVE_THRESHOLD, protectTurns = RECENT_TURNS_PROTECTED) {
  const floor = Math.floor(messages.length * preserve);
  let protectedFrom = messages.length;
  let userTurns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userTurns++;
      protectedFrom = i;
    }
    if (userTurns >= protectTurns) break;
  }
  return Math.max(0, Math.min(floor, protectedFrom));
}
function collapseFunctionResponse(text, maxBytes = COLLAPSED_FUNCTION_RESPONSE_MAX_BYTES) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const head = text.slice(0, Math.floor(maxBytes / 2));
  const tail = text.slice(-Math.floor(maxBytes / 2));
  return head + "\n\u2026[\u51FD\u6570\u54CD\u5E94\u5DF2\u6298\u53E0]\u2026\n" + tail;
}
function compress(messages, contextWindow) {
  if (!needsCompression(messages, contextWindow)) return { messages, status: "none" };
  const split = findCompressSplitPoint(messages);
  if (split <= 1) return { messages, status: "none" };
  const head = messages.slice(0, split);
  const summary = head.map((m) => `[${m.role}] ${String(m.content || "").slice(0, 160)}`).join("\n");
  const out = [
    { role: "system", content: `\u3010\u4E0A\u4E0B\u6587\u538B\u7F29\u3011\u524D ${split} \u6761\u5386\u53F2\u6458\u8981\uFF08\u8FD1\u671F\u5B8C\u6574\u6D88\u606F\u4FDD\u7559\u5728\u540E\uFF09\uFF1A
${collapseFunctionResponse(summary)}` },
    ...messages.slice(split).map((m) => ({ role: m.role, content: Buffer.byteLength(String(m.content || ""), "utf8") > COLLAPSE_HISTORY_BYTE_THRESHOLD ? collapseFunctionResponse(String(m.content || "")) : m.content || "" }))
  ];
  return { messages: out, status: "compressed" };
}
function willOverflow(messages, contextWindow, incomingTokens = 0) {
  return estimateMessagesTokens(messages) + incomingTokens >= contextWindow * 0.92;
}

// src/shared/ultra/nextSpeaker.ts
var CONTINUE_PROMPT = "Please continue.";
function fastNextSpeaker(ctx) {
  if (ctx.skip || ctx.quotaError || ctx.pendingTools > 0) return null;
  if (ctx.lastMessageRole === "tool") return "model";
  if (ctx.lastMessageRole === "assistant" && (!ctx.lastMessageContent || !String(ctx.lastMessageContent).trim())) return "model";
  return null;
}
function parseNextSpeaker(text) {
  const t = String(text || "").trim();
  try {
    const d = JSON.parse(t);
    const v = String(d?.next_speaker ?? d?.speaker ?? "").toLowerCase();
    if (v === "user" || v === "model") return v;
  } catch {
  }
  const m = t.match(/\b(user|model)\b/i);
  return m ? m[1].toLowerCase() : null;
}
function resolveNextSpeaker(ctx, llmText) {
  const fast = fastNextSpeaker(ctx);
  if (fast) return fast;
  if (llmText !== void 0) return parseNextSpeaker(llmText);
  return "user";
}

// src/shared/ultra/stuckDetector.ts
var MAX_EVENTS_TO_SCAN = 20;
var THRESHOLDS = {
  ACTION_OBSERVATION: 4,
  ACTION_ERROR: 3,
  MONOLOGUE: 3,
  ALTERNATING: 6,
  CONTEXT_ERROR: 10
};
function eventEquals(a, b) {
  return a.kind === b.kind && a.sig === b.sig && a.ok === b.ok;
}
var StuckDetector = class {
  events = [];
  lastNudgedErrorId = "";
  /** 返回注入提醒文案；null = 正常 */
  check() {
    const win = this.events.slice(-MAX_EVENTS_TO_SCAN);
    if (!win.length) return null;
    const ctx = win.filter((e) => /context|overflow|too long|token/i.test(e.sig)).length;
    if (ctx >= THRESHOLDS.CONTEXT_ERROR) return "\u4E0A\u4E0B\u6587\u53CD\u590D\u6EA2\u51FA\uFF0C\u5DF2\u505C\u6B62\u7EE7\u7EED\u6D88\u8017\u989D\u5EA6\u3002";
    const errs = win.filter((e) => e.kind === "error");
    if (errs.length >= THRESHOLDS.ACTION_ERROR && errs.every((e) => eventEquals(e, errs[0]))) {
      const id = errs[0].sig;
      if (this.lastNudgedErrorId === id) return null;
      this.lastNudgedErrorId = id;
      return "\u8FDE\u7EED\u591A\u6B21\u540C\u7C7B\u5DE5\u5177\u62A5\u9519\uFF0C\u8BF7\u5148\u9605\u8BFB\u9519\u8BEF\u4FE1\u606F\u5E76\u4FEE\u6B63\u53C2\u6570\uFF0C\u4E0D\u8981\u7528\u76F8\u540C\u53C2\u6570\u53CD\u590D\u91CD\u8BD5\u3002";
    }
    let alt = 0;
    for (let i = 1; i < win.length; i++) {
      const a = win[i - 1].kind, b = win[i].kind;
      alt = a === "action" && b === "observation" || a === "observation" && b === "action" ? alt + 1 : 0;
    }
    if (alt >= THRESHOLDS.ALTERNATING) return "\u5DE5\u5177\u8C03\u7528\u4E0E\u7ED3\u679C\u957F\u65F6\u95F4\u4EA4\u66FF\u4F46\u65E0\u8FDB\u5C55\uFF0C\u8BF7\u603B\u7ED3\u73B0\u72B6\u5E76\u7ED9\u51FA\u7ED3\u8BBA\u3002";
    const pairs = win.filter((e) => e.kind === "action" && e.ok);
    if (pairs.length >= THRESHOLDS.ACTION_OBSERVATION && pairs.every((e) => eventEquals(e, pairs[0]))) {
      return "\u68C0\u6D4B\u5230\u91CD\u590D\u6267\u884C\u540C\u4E00\u64CD\u4F5C\u4E14\u7ED3\u679C\u76F8\u540C\uFF0C\u8BF7\u6362\u601D\u8DEF\u6216\u5411\u7528\u6237\u786E\u8BA4\uFF0C\u4E0D\u8981\u539F\u6837\u91CD\u8BD5\u3002";
    }
    let mono = 0;
    for (const e of win) {
      if (e.kind === "message") mono++;
      else mono = 0;
    }
    if (mono >= THRESHOLDS.MONOLOGUE) return "\u5DF2\u8FDE\u7EED\u591A\u8F6E\u53EA\u8F93\u51FA\u6587\u5B57\u672A\u8C03\u7528\u5DE5\u5177\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u5E94\u52A8\u624B\u6267\u884C\u3002";
    return null;
  }
  push(e) {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS_TO_SCAN * 2) this.events.shift();
  }
  reset() {
    this.events = [];
    this.lastNudgedErrorId = "";
  }
  get window() {
    return this.events.slice(-MAX_EVENTS_TO_SCAN);
  }
  get lastNudge() {
    return this.lastNudgedErrorId;
  }
};

// src/shared/ultra/turn.ts
var MAX_TURNS = 100;
var DEFAULT_MAX_SESSION_TURNS = 100;
function boundedTurns(turns) {
  return Math.max(0, Math.min(turns, MAX_TURNS));
}
var TurnBudget = class {
  constructor(maxSessionTurns = DEFAULT_MAX_SESSION_TURNS) {
    this.maxSessionTurns = maxSessionTurns;
  }
  sessionCount = 0;
  /** 返回本轮允许的最大 turn；超出会话上限返回 0（触发 MaxSessionTurns） */
  next(requested = MAX_TURNS) {
    if (this.sessionCount >= this.maxSessionTurns) return 0;
    return boundedTurns(requested);
  }
  consume() {
    this.sessionCount++;
  }
  get used() {
    return this.sessionCount;
  }
  get exhausted() {
    return this.sessionCount >= this.maxSessionTurns;
  }
  reset() {
    this.sessionCount = 0;
  }
};

// src/shared/ultra/tokenBudget.ts
var MODEL_TOKEN_LIMITS = {
  "gemini-2.5-pro": 1048576,
  "gemini-2.5-flash": 1048576,
  "gpt-5": 4e5,
  "claude": 2e5,
  "deepseek": 128e3,
  "qwen": 131072,
  "kimi": 262144,
  "glm": 128e3,
  "spark": 128e3
};
var DEFAULT_CONTEXT_WINDOW = 128e3;
var INPUT_BUDGET_RATIO = 0.8;
var OUTPUT_RESERVE_RATIO = 0.06;
function resolveContextWindow(model, declared) {
  if (declared && declared > 0) return declared;
  const m = String(model || "").toLowerCase();
  for (const [k, v] of Object.entries(MODEL_TOKEN_LIMITS)) if (m.includes(k)) return v;
  return DEFAULT_CONTEXT_WINDOW;
}
function inputBudget(contextWindow) {
  return Math.floor(contextWindow * INPUT_BUDGET_RATIO);
}
function maxOutputTokens(contextWindow) {
  return Math.max(1024, Math.min(8192, Math.floor(contextWindow * OUTPUT_RESERVE_RATIO)));
}
function trimToBudget(messages, contextWindow, estimate) {
  const budget = inputBudget(contextWindow);
  const out = [...messages];
  let dropped = 0;
  while (out.length > 1 && estimate(out) > budget) {
    let i = 0;
    while (i < out.length && out[i].role === "system") i++;
    if (i >= out.length) break;
    out.splice(i, 1);
    dropped++;
  }
  return { messages: out, dropped };
}

// src/shared/ultra/policy.ts
var SandboxEscalation = class {
  escalated = false;
  firstAttempt() {
    return { level: "standard", reason: "\u6700\u5C0F\u6743\u9650\u9996\u6B21\u5C1D\u8BD5" };
  }
  /** 返回升级后的覆盖；只允许升级一次，防止无限提权 */
  onSandboxDenial() {
    if (this.escalated) return null;
    this.escalated = true;
    return { level: "full", reason: "\u6C99\u7BB1\u62D2\u7EDD\uFF0C\u5347\u7EA7\u4E00\u6B21\u540E\u91CD\u8BD5" };
  }
  get used() {
    return this.escalated;
  }
};
var ApprovedScopes = class {
  scopes = /* @__PURE__ */ new Set();
  scopeKeyOf(tool, args) {
    const norm = JSON.stringify(args, Object.keys(args).sort());
    return tool + "::" + norm;
  }
  approve(key) {
    this.scopes.add(key);
  }
  isApproved(key) {
    return this.scopes.has(key);
  }
  get all() {
    return [...this.scopes];
  }
  clear() {
    this.scopes.clear();
  }
};
function modeFromLevel(level) {
  if (level === "full") return "never";
  if (level === "ask" || level === "restricted") return "always";
  return "on-request";
}

// src/shared/ultra/context.ts
var IgnoreMatcher = class {
  patterns = [];
  constructor(patterns = []) {
    this.patterns = patterns;
  }
  add(p) {
    this.patterns.push(p);
  }
  isIgnored(relPath) {
    const p = relPath.replace(/\\/g, "/");
    return this.patterns.some((raw) => {
      const pat = raw.trim().replace(/^\//, "").replace(/\/$/, "");
      if (!pat || pat.startsWith("#")) return false;
      if (pat.includes("*")) {
        const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "($|/)");
        return re.test(p);
      }
      return p === pat || p.startsWith(pat + "/") || p.split("/").includes(pat);
    });
  }
};
function clampOutput(text, maxChars = 4e4, headRatio = 0.7) {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * headRatio);
  const tail = maxChars - head - 60;
  return text.slice(0, head) + `

\u2026[\u7701\u7565 ${text.length - head - tail} \u5B57\u7B26]\u2026

` + text.slice(-tail);
}

// src/shared/jtCoreUltra.ts
var UltraNeedsClientError = class extends Error {
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
var ULTRA_TOOL_TIMEOUT_MS = 18e4;
var ULTRA_MAX_OUTPUT = 4e4;
var READONLY = /* @__PURE__ */ new Set([
  "read_file",
  "list_dir",
  "search_files",
  "search_content",
  "get_file_info",
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
function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
function buildRequestBody(messages, tools, opts) {
  let msgs = messages;
  if (opts.ideBlock) {
    msgs = msgs[0]?.role === "system" ? [{ ...msgs[0], content: String(msgs[0].content || "") + "\n\n" + opts.ideBlock }, ...msgs.slice(1)] : [{ role: "system", content: opts.ideBlock }, ...msgs];
  }
  const body = {
    model: opts.model,
    messages: opts.wrapUp ? [...msgs, { role: "user", content: "\u5DF2\u63A5\u8FD1\u672C\u8F6E\u5DE5\u5177\u8C03\u7528\u4E0A\u9650\uFF0C\u8BF7\u57FA\u4E8E\u5DF2\u6709\u7ED3\u679C\u76F4\u63A5\u7ED9\u51FA\u6700\u7EC8\u7B54\u590D\uFF0C\u4E0D\u8981\u518D\u8C03\u7528\u5DE5\u5177\u3002" }] : msgs,
    stream: true
  };
  if (tools.length) {
    body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = opts.toolChoice ? "auto" : "none";
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  return JSON.stringify(body);
}
async function execOne(deps, tc, signal) {
  let args = {};
  try {
    args = JSON.parse(tc.arguments || "{}");
  } catch {
  }
  try {
    let outText;
    if (deps.isClientTool(tc.name)) outText = deps.runClientTool ? await deps.runClientTool(tc) : '{"ok":true}';
    else {
      const result = await Promise.race([
        deps.runTool(tc.name, args, signal),
        new Promise((_, rej) => setTimeout(() => rej(new Error("\u5DE5\u5177\u6267\u884C\u8D85\u65F6\uFF08180 \u79D2\uFF09")), ULTRA_TOOL_TIMEOUT_MS))
      ]);
      outText = result.success ? result.output ?? "" : "\u274C \u9519\u8BEF: " + (result.error || "\u5DE5\u5177\u6267\u884C\u5931\u8D25");
      if (result.changeId) tc.changeId = result.changeId;
    }
    if (outText.length > ULTRA_MAX_OUTPUT) {
      outText = clampOutput(outText, ULTRA_MAX_OUTPUT);
      if (deps.saveLargeOutput) {
        try {
          const fname = await deps.saveLargeOutput(tc.name, outText);
          if (fname) outText = clampToolResult(outText, tc.name) + "\n[\u5B8C\u6574\u8F93\u51FA\u5DF2\u4FDD\u5B58\u5230\u5DE5\u4F5C\u533A: " + fname + "]";
        } catch {
        }
      }
    }
    return outText;
  } catch (e) {
    return "\u274C \u9519\u8BEF: " + String(e?.message || e);
  }
}
async function runUltraLoop(inputMessages, deps) {
  const messages = [...inputMessages];
  let fullContent = deps.resume?.content || "";
  let fullThinking = deps.resume?.thinking || "";
  const allToolCalls = deps.resume?.toolCalls ? [...deps.resume.toolCalls] : [];
  const repeatMap = /* @__PURE__ */ new Map();
  const toolUseCounter = /* @__PURE__ */ new Map();
  const toolLoop = new ToolLoopDetector();
  const contentLoop = new ContentLoopDetector();
  const recovery = new LoopRecovery();
  const stuck = new StuckDetector();
  const turnBudget = new TurnBudget();
  const fallback = new ModelFallback([deps.model, ...deps.fallbackModels || []]);
  const confirmationBus = new ConfirmationBus();
  const requestQueue = new SerialRequestQueue();
  const approvedScopes = new ApprovedScopes();
  (deps.approvedScopes || []).forEach((k) => approvedScopes.approve(k));
  const sandbox = new SandboxEscalation();
  const policyMode = modeFromLevel(deps.permissionLevel || "edit");
  const ignoreMatcher = new IgnoreMatcher(["node_modules", "dist", "release", ".git", "*.log"]);
  const ideBlock = deps.ideContext?.toPromptBlock() || "";
  let lastSemanticCheck = 0;
  let wrappedUp = false;
  const signal = deps.signal;
  const tools = deps.tools.filter((t) => !(deps.disabledTools || []).includes(t.name));
  const contextWindow = resolveContextWindow(deps.model, deps.contextWindow);
  const maxTokens = deps.maxTokens || maxOutputTokens(contextWindow);
  if (deps.pendingTool) {
    const p = deps.pendingTool;
    messages.push({ role: "tool", tool_call_id: p.toolCall.id, content: p.decision || p.toolCall.result || "" });
    if (!allToolCalls.some((t) => t.id === p.toolCall.id)) allToolCalls.push({ ...p.toolCall, status: p.decision ? "error" : "done" });
  }
  const maxTurns = turnBudget.next();
  if (maxTurns === 0) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "max-session-turns", error: "\u4F1A\u8BDD turn \u4E0A\u9650" };
  for (let turn = 0; turn < maxTurns; turn++) {
    turnBudget.consume();
    if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
    if (willOverflow(messages, contextWindow, 0)) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "context-overflow", error: "\u4E0A\u4E0B\u6587\u7A97\u53E3\u5373\u5C06\u6EA2\u51FA" };
    const comp = compress(messages, contextWindow);
    if (comp.status === "compressed") messages.splice(0, messages.length, ...comp.messages);
    const trimmed = trimToBudget(messages, contextWindow, (ms) => ms.reduce((s, m) => s + Math.ceil(String(m.content || "").length / 4), 0));
    if (trimmed.dropped > 0) messages.splice(0, messages.length, ...trimmed.messages);
    let reqMessages = messages;
    if (shouldInjectHermes(deps.model, deps.apiBase, deps.hermesMode) && tools.length) {
      const block = buildToolsBlock(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), { compact: true });
      reqMessages = reqMessages[0]?.role === "system" ? [{ ...reqMessages[0], content: String(reqMessages[0].content || "") + "\n\n" + block }, ...reqMessages.slice(1)] : [{ role: "system", content: block }, ...reqMessages];
    }
    let res = null;
    let lastErr = "";
    for (let attempt = 1; attempt <= 10; attempt++) {
      if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
      deps.events.onNetStatus?.(attempt === 1 ? "connecting" : "retrying", { attempt });
      try {
        res = await deps.callLLM(buildRequestBody(reqMessages, tools, { model: fallback.current, maxTokens, toolChoice: !wrappedUp, wrapUp: wrappedUp, ideBlock }), signal);
        if (res.ok && res.body) break;
        const status = res.status;
        let bodyText = "";
        try {
          bodyText = (await res.text()).slice(0, 400);
        } catch {
        }
        const decision = decideRetry(status, attempt, { shouldRetryOnContent: (c) => !c || !c.trim() }, { content: bodyText, serverDelayMs: parseRetryAfter(res.headers.get("retry-after")) });
        if (!decision.retry) {
          if (status === 429 && !fallback.exhausted && fallback.fallback()) {
            attempt = 0;
            continue;
          }
          lastErr = status >= 400 ? buildUpstreamError(status, bodyText) : decision.reason;
          res = null;
          break;
        }
        await sleepAbortable(Math.min(decision.delayMs, 3e4), signal);
      } catch (e) {
        if (e?.name === "AbortError") return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
        lastErr = String(e?.message || e);
        if (attempt < 10) await sleepAbortable(Math.min(5e3 * Math.pow(2, attempt - 1), 3e4), signal);
      }
    }
    if (!res || !res.ok || !res.body) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "error", error: lastErr };
    const toolCallMap = /* @__PURE__ */ new Map();
    let roundContent = "", draftAnnounced = false;
    const perf = { firstTokenMs: 0, t0: Date.now() };
    try {
      for await (const data of ssePayloads(res.body)) {
        if (data === "[DONE]") continue;
        let ev;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        const d = ev.choices?.[0]?.delta;
        if (!d) continue;
        if (d.reasoning_content || d.reasoning) {
          const t = String(d.reasoning_content || d.reasoning);
          fullThinking += t;
          deps.events.onThinking?.(t);
        }
        if (d.content) {
          if (!perf.firstTokenMs) perf.firstTokenMs = Date.now() - perf.t0;
          const t = String(d.content);
          roundContent += t;
          fullContent += t;
          deps.events.onChunk?.(t);
        }
        const parsed = parseToolCallsFromDelta(d);
        if (parsed) {
          for (const tc of parsed) accumulateToolCallDelta(toolCallMap, tc);
          if (!draftAnnounced) {
            draftAnnounced = true;
            deps.events.onToolDraft?.(parsed[0]?.function?.name || "\u2026");
          }
        }
        if (ev.choices?.[0]?.finish_reason === "tool_calls") adoptNonStreamToolCalls(toolCallMap, ev.choices[0].message?.tool_calls);
      }
    } catch (e) {
      if (e?.name === "AbortError") return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "aborted" };
      return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "error", error: String(e?.message || e) };
    }
    let toolCalls = toolCallsToArray(toolCallMap);
    if (!toolCalls.length && roundContent.includes("<tool_call>")) {
      const hs = parseHermesToolCalls(roundContent);
      if (hs.length) {
        toolCalls = hs.map((h, i) => ({ id: "hermes_" + i + "_" + Date.now(), name: h.name, arguments: h.arguments }));
        roundContent = stripToolCallBlocks(roundContent);
      }
    }
    deps.events.onPerf?.({ ...perf, turns: turn + 1, engine: "ultra", toolCalls: toolCalls.length });
    const toolHit = toolCalls.some((tc) => toolLoop.add(toolFingerprint(tc.name, tc.arguments)));
    const signalRec = recovery.signal(toolHit || contentLoop.add(roundContent));
    if (signalRec === "stop") return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "loop-detected", error: "\u5FAA\u73AF\u68C0\u6D4B\u786C\u505C" };
    if (signalRec === "nudge") messages.push({ role: "user", content: STEP_BACK_MESSAGE });
    if (!toolCalls.length) {
      const last = messages[messages.length - 1];
      const ctx = { pendingTools: 0, quotaError: false, skip: false, lastMessageRole: last?.role, lastMessageContent: typeof last?.content === "string" ? last.content : "" };
      if (resolveNextSpeaker(ctx) === "model") {
        messages.push({ role: "user", content: CONTINUE_PROMPT });
        continue;
      }
      if (deps.semanticLoopCheck && shouldSemanticCheck(turn, lastSemanticCheck, LLM_CONFIDENCE_THRESHOLD)) {
        lastSemanticCheck = turn;
        if (await deps.semanticLoopCheck(messages.slice(-LLM_HISTORY_TURNS))) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "loop-detected", error: "LLM \u5224\u5B9A\u4E3A\u5FAA\u73AF" };
      }
      return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls };
    }
    messages.push({ role: "assistant", content: roundContent || void 0, tool_calls: toolCalls.map((tc, idx) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments }, index: idx })) });
    const plans = [];
    for (const tc of toolCalls) {
      const obj = { ...tc, status: "running", started_at: (/* @__PURE__ */ new Date()).toISOString() };
      const fsm = new ToolCallStateMachine();
      const repeat = checkRepeatCall(repeatMap, callSignature(tc.name, tc.arguments));
      if (repeat.blocked) {
        obj.status = "error";
        obj.result = "\u274C \u9519\u8BEF: " + (repeat.message || "\u91CD\u590D\u8C03\u7528\u88AB\u62E6\u622A");
        deps.events.onToolStart?.(obj);
        deps.events.onToolEnd?.(obj);
        stuck.push({ kind: "error", sig: String(repeat.message || "repeat"), ok: false });
        allToolCalls.push(obj);
        messages.push({ role: "tool", tool_call_id: tc.id, content: obj.result });
        continue;
      }
      const need = deps.needsClient?.(obj) ?? null;
      if (need) throw new UltraNeedsClientError(need, obj, messages, { content: fullContent, thinking: fullThinking, toolCalls: [...allToolCalls, ...plans.map((p) => p.tc)] }, deps.scopeKeyOf?.(obj));
      const denial = await deps.confirmTool?.(obj);
      if (denial) {
        obj.status = "error";
        obj.result = denial;
        deps.events.onToolStart?.(obj);
        deps.events.onToolEnd?.(obj);
        allToolCalls.push(obj);
        messages.push({ role: "tool", tool_call_id: tc.id, content: obj.result });
        continue;
      }
      const decision = decidePolicy(tc.name, { yolo: policyMode === "never", confirmTools: /* @__PURE__ */ new Set(["shell", "delete_file"]) });
      fsm.transition(decision === "ask" ? "awaiting_approval" : "scheduled");
      if (decision === "ask") {
        let a = {};
        try {
          a = JSON.parse(tc.arguments || "{}");
        } catch {
        }
        const key = approvedScopes.scopeKeyOf(tc.name, a);
        if (approvedScopes.isApproved(key)) fsm.transition("scheduled");
        else {
          await confirmationBus.request(tc.id, "\u9700\u8981\u786E\u8BA4");
          fsm.transition("scheduled");
        }
      }
      plans.push({ tc: obj, fsm, decision });
    }
    const stuckMsg = stuck.check();
    if (stuckMsg) messages.push({ role: "user", content: "\u3010\u5361\u6B7B\u63D0\u9192\u3011" + stuckMsg });
    const barrier = await yieldIfBlocked(plans);
    if (barrier.stuck && !plans.length) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "error", error: "\u8C03\u5EA6\u5668\u5361\u6B7B" };
    await requestQueue.submit(async () => {
      let i = 0;
      while (i < plans.length) {
        if (signal?.aborted) return;
        const group = [];
        if (READONLY.has(plans[i].tc.name)) {
          while (i < plans.length && READONLY.has(plans[i].tc.name)) group.push(plans[i++]);
        } else group.push(plans[i++]);
        await Promise.all(group.map(async (p) => {
          p.fsm.transition("executing", { liveOutput: "" });
          deps.events.onToolStart?.(p.tc);
          const outText = await execOne(deps, p.tc, signal);
          const failed = outText.startsWith("\u274C");
          p.tc.result = outText;
          p.tc.status = failed ? "error" : "done";
          p.tc.finished_at = (/* @__PURE__ */ new Date()).toISOString();
          p.fsm.transition(failed ? "error" : "success", failed ? { error: outText } : { result: outText });
          const outcome = normalizeOutcome(p.tc, outText, failed);
          bumpToolUse(toolUseCounter, p.tc.name);
          deps.events.onToolEnd?.(p.tc);
          allToolCalls.push(p.tc);
          stuck.push({ kind: failed ? "error" : "observation", sig: toolFingerprint(p.tc.name, outcome.output.slice(0, 80)), ok: !failed });
          if (failed) sandbox.onSandboxDenial();
          messages.push({ role: "tool", tool_call_id: p.tc.id, content: outText + (toolUseHint(toolUseCounter, p.tc.name) ? "\n" + toolUseHint(toolUseCounter, p.tc.name) : "") });
        }));
      }
    });
    if (turn >= maxTurns - 2 && !wrappedUp) wrappedUp = true;
    if (wrappedUp && turn >= maxTurns - 1) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "max-turns", error: "\u5DF2\u8FBE\u6700\u5927 turn \u6570" };
  }
  return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: "max-turns" };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ContentLoopDetector,
  StuckDetector,
  TERMINAL_STATES,
  ToolCallStateMachine,
  ToolLoopDetector,
  ULTRA_MAX_TURNS,
  UltraNeedsClientError,
  allReady,
  canTransition,
  fastNextSpeaker,
  findCompressSplitPoint,
  needsCompression,
  parseNextSpeaker,
  resolveNextSpeaker,
  runUltraLoop,
  shouldSemanticCheck,
  toolFingerprint,
  ultraBackoff,
  ultraQuotaDelay,
  ultraRetryable
});
