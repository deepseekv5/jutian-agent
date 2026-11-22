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
var failureRecovery_exports = {};
__export(failureRecovery_exports, {
  FailureRecovery: () => FailureRecovery,
  HARD_CONSECUTIVE_LIMIT: () => HARD_CONSECUTIVE_LIMIT,
  REPEAT_STOP_LIMIT: () => REPEAT_STOP_LIMIT,
  RING_BUFFER_LIMIT: () => RING_BUFFER_LIMIT,
  STOP_ACTIONABLE: () => STOP_ACTIONABLE,
  STOP_SAME_KIND: () => STOP_SAME_KIND,
  STOP_WINDOW: () => STOP_WINDOW,
  TOOL_ERROR_SWITCH_LIMIT: () => TOOL_ERROR_SWITCH_LIMIT,
  UNKNOWN_SUMMARY_LIMIT: () => UNKNOWN_SUMMARY_LIMIT,
  argsSignature: () => argsSignature,
  classifyFailureKind: () => classifyFailureKind,
  defaultForField: () => defaultForField,
  extractSuggestedPath: () => extractSuggestedPath,
  isWriteTool: () => isWriteTool,
  parentPath: () => parentPath,
  parseInvalidArgs: () => parseInvalidArgs,
  switchToolAdvice: () => switchToolAdvice
});
module.exports = __toCommonJS(failureRecovery_exports);
const RING_BUFFER_LIMIT = 100;
const STOP_WINDOW = 5;
const STOP_SAME_KIND = 4;
const STOP_ACTIONABLE = 2;
const REPEAT_STOP_LIMIT = 3;
const TOOL_ERROR_SWITCH_LIMIT = 2;
const UNKNOWN_SUMMARY_LIMIT = 3;
const HARD_CONSECUTIVE_LIMIT = 5;
const CONTEXT_OVERFLOW_RE = /(context\s+length|context\s+window|上下文过长|上下文超限|超出上下文|上下文已满|maximum\s+context|token\s+limit|too\s+many\s+tokens|prompt\s+too\s+long|提示词过长|messages?\s+too\s+long)/i;
const NOT_FOUND_RE = /(不存在|找不到|未找到|路径不存在|文件不存在|not\s*found|ENOENT|no\s+such\s+(file|directory)|does\s+not\s+exist|cannot\s+find|missing\s+file)/i;
const PERMISSION_RE = /(permission|EACCES|EPERM|denied|forbidden|access\s+not\s+permitted|read[\s-]?only|只读|无权限|没有权限|无权|路径不允许|不允许访问|禁止访问|operation\s+not\s+permitted)/i;
const INVALID_ARGS_RE = /(参数|字段|校验|\bjson\b|required|missing\s+(?:required\s+)?(?:field|param(?:eter)?|argument|property)|invalid\s+(?:argument|param(?:eter)?|input|json|value)|invalid\s+json|json\s*(?:parse|格式|语法)|validation|格式错误|格式不对|unexpected\s+token|cannot\s+parse)/i;
const TOOL_ERROR_RE = /(timeout|timed?\s*out|超时|上游|upstream|gateway|HTTP\s*5\d\d|\b50[0-9]\b|bad\s+gateway|service\s+unavailable|ECONNRESET|ECONNREFUSED|ETIMEDOUT|网络错误|连接失败|服务不可用|请求失败)/i;
const READ_ONLY_RE = /(read[\s-]?only|只读|immutable|protected\s+path|read-only\s+file\s+system|不可写)/i;
const WRITE_TOOL_RE = /(write|edit|create|delete|remove|mkdir|rmdir|save|patch|touch|move|\bmv\b|copy|\bcp\b|shell|bash|exec|execute|apply|modify|update)/i;
function classifyFailureKind(errorText) {
  const t = String(errorText || "");
  if (CONTEXT_OVERFLOW_RE.test(t)) return "context_overflow";
  if (NOT_FOUND_RE.test(t)) return "not_found";
  if (PERMISSION_RE.test(t)) return "permission";
  if (INVALID_ARGS_RE.test(t)) return "invalid_args";
  if (TOOL_ERROR_RE.test(t)) return "tool_error";
  return "unknown";
}
function argsSignature(name, args) {
  const norm = sortKeysDeep(args && typeof args === "object" ? args : {});
  let text;
  try {
    text = JSON.stringify(norm);
  } catch {
    text = String(args || "");
  }
  return name + "::" + text.replace(/\s+/g, " ");
}
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const src = v;
    const out = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeysDeep(src[k]);
    return out;
  }
  return v;
}
function keyOf(ev) {
  return ev.toolName + "\0" + argsSignature(ev.toolName, ev.args) + "\0" + ev.round + "\0" + ev.at;
}
function sameEvent(a, b) {
  return keyOf(a) === keyOf(b);
}
function parentPath(pathValue) {
  const s = String(pathValue || "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return s.slice(0, i);
}
function extractSuggestedPath(errorText) {
  const m = /(?:did\s+you\s+mean|perhaps\s+you\s+meant|suggest(?:ed)?(?:\s+path)?|similar\s+(?:file|path)|你是否想(?:找|访问)|或许你想(?:找|访问)|最接近(?:的)?(?:文件|路径)?(?:是|为)|建议路径)[：:\s]*["'`]?([^\s"'`，。；;、]+)/i.exec(errorText);
  return m && m[1] ? m[1] : "";
}
const FIELD_PATTERNS = [
  /missing\s+(?:required\s+)?(?:field|parameter|param|argument|property)\s*["'`]?([\w.-]+)["'`]?/gi,
  /(?:required|missing)\s+["'`]?([\w.-]+)["'`]?\s+(?:field|parameter|param|argument|property|is\s+required)/gi,
  /(?:field|parameter|param|argument|property)\s*["'`]?([\w.-]+)["'`]?\s+(?:is\s+)?(?:required|missing)/gi,
  /(?:缺少|缺失)(?:必填)?(?:参数|字段)?\s*["'`]?([\w.-]+)["'`]?/g,
  /(?:参数|字段)\s*["'`]?([\w.-]+)["'`]?\s*(?:不能为空|未提供|缺失|不存在|必填)/g,
  /["'`]([\w.-]+)["'`]\s+(?:is\s+)?required/gi
];
const EMPTY_FIELD_RE = /(?:参数|字段)\s*["'`]?([\w.-]+)["'`]?\s*(?:不能为空|为空|empty|must\s+not\s+be\s+empty)/gi;
function parseInvalidArgs(errorText) {
  const t = String(errorText || "");
  const fields = [];
  for (const re of FIELD_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m[1] && !fields.includes(m[1])) fields.push(m[1]);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  const emptyFields = [];
  EMPTY_FIELD_RE.lastIndex = 0;
  let em;
  while ((em = EMPTY_FIELD_RE.exec(t)) !== null) {
    if (em[1] && !emptyFields.includes(em[1])) emptyFields.push(em[1]);
  }
  const jsonBroken = /(json|unexpected\s+token|cannot\s+parse|parse\s+error|语法错误|格式错误|破损)/i.test(t);
  return { fields, emptyFields, jsonBroken };
}
function defaultForField(field, args) {
  const cur = args[field];
  if (cur !== void 0 && cur !== null && cur !== "") return void 0;
  const f = field.toLowerCase();
  if (/(path|dir|folder|file|filename|uri|url|target|dest|destination|source)/.test(f)) return void 0;
  if (/(content|text|body|message|desc|description|note|query|prompt|value|name|title)/.test(f)) return "";
  if (/(items|list|array|files|paths|commands|lines|tags|entries)/.test(f)) return [];
  if (/(options|config|meta|metadata|params|headers|extra|settings)/.test(f)) return {};
  if (/(flag|enabled|force|recursive|dryrun|dry_run|verbose|overwrite)/.test(f)) return false;
  return void 0;
}
function isWriteTool(toolName) {
  return WRITE_TOOL_RE.test(toolName);
}
function switchToolAdvice(toolName) {
  const n = toolName.toLowerCase();
  if (/(shell|bash|exec|execute|terminal|cmd)/.test(n)) {
    return "\u6539\u7528\u4E13\u95E8\u7684\u6587\u4EF6\u5DE5\u5177\uFF08read_file / list_dir / write_file\uFF09\uFF0C\u4E0D\u8981\u7528 shell \u5904\u7406\u8DEF\u5F84\u4E0E\u6743\u9650";
  }
  if (/(write|edit|create|save|patch|modify|update)/.test(n)) {
    return "\u5148\u7528 list_dir \u6838\u5B9E\u76EE\u5F55\u662F\u5426\u53EF\u5199\uFF0C\u518D\u6362\u4E00\u4E2A\u53EF\u5199\u8DEF\u5F84\u5199\u5165\uFF1B\u6216\u6539\u7528\u5E26\u6743\u9650\u68C0\u67E5\u7684\u4E13\u7528\u5199\u5165\u5DE5\u5177";
  }
  if (/(read|cat|open|view|get_file)/.test(n)) {
    return "\u6539\u7528 list_dir \u786E\u8BA4\u76EE\u6807\u662F\u5426\u5B58\u5728\uFF0C\u6216\u6539\u7528 search_content \u5728\u5DF2\u77E5\u76EE\u5F55\u5185\u5B9A\u4F4D\u6587\u4EF6";
  }
  if (/(search|find|grep|glob)/.test(n)) {
    return "\u5148\u7528 list_dir \u7F29\u5C0F\u5230\u5177\u4F53\u76EE\u5F55\uFF0C\u518D\u5728\u8BE5\u76EE\u5F55\u5185\u68C0\u7D22\uFF0C\u907F\u514D\u5168\u76D8\u626B\u63CF";
  }
  return "\u6362\u4E00\u4E2A\u529F\u80FD\u7B49\u4EF7\u4F46\u5B9E\u73B0\u4E0D\u540C\u7684\u5DE5\u5177\uFF0C\u5148\u7528\u6700\u5C0F\u8F93\u5165\u9A8C\u8BC1\u524D\u63D0\u662F\u5426\u6210\u7ACB";
}
const KIND_LABEL = {
  not_found: "\u8DEF\u5F84\u4E0D\u5B58\u5728",
  permission: "\u6743\u9650\u62D2\u7EDD",
  invalid_args: "\u53C2\u6570\u9519\u8BEF",
  tool_error: "\u5DE5\u5177\u9519\u8BEF",
  context_overflow: "\u4E0A\u4E0B\u6587\u8FC7\u957F",
  repeated: "\u91CD\u590D\u7A7A\u8F6C",
  unknown: "\u672A\u77E5\u9519\u8BEF"
};
function routeLabel(kind, action) {
  if (!action) return "\u5C1A\u672A\u7ED9\u51FA\u6062\u590D\u7B56\u7565";
  switch (action) {
    case "retry_same":
      return "\u5DF2\u539F\u6837\u91CD\u8BD5";
    case "fix_args":
      return "\u5DF2\u5EFA\u8BAE\u4FEE\u6B63\u53C2\u6570";
    case "switch_tool":
      return kind === "permission" ? "\u5DF2\u5EFA\u8BAE\u6362\u8DEF\u5F84" : "\u5DF2\u5EFA\u8BAE\u6362\u5DE5\u5177";
    case "read_first":
      return "\u5DF2\u8BD5 list_dir \u6838\u5BF9\u8DEF\u5F84";
    case "summarize_exit":
      return "\u5DF2\u5EFA\u8BAE\u6536\u5C3E\u603B\u7ED3";
    case "should_stop":
      return "\u5DF2\u5EFA\u8BAE\u505C\u6B62\u7A7A\u8F6C";
  }
}
const ALL_KINDS = [
  "not_found",
  "permission",
  "invalid_args",
  "tool_error",
  "context_overflow",
  "repeated",
  "unknown"
];
class FailureRecovery {
  /** 固定长度环形数组，head 指向下一次写入位置 */
  buf = new Array(RING_BUFFER_LIMIT);
  head = 0;
  size = 0;
  /** 分工具连续失败槽：键为 toolName，值自上次 reset() 以来的失败次数 */
  consecutive = /* @__PURE__ */ new Map();
  /** 已下发的恢复决策（上限 100，与缓冲同量级） */
  planLog = [];
  /** 累计统计（reset 不清，便于跨请求观测） */
  totalFailures = 0;
  byKindCount = {};
  recoveryCount = 0;
  constructor() {
    for (const k of ALL_KINDS) this.byKindCount[k] = 0;
  }
  /**
   * 记录一次失败。同一事件重复 record 会各记一次（重复调用本身就是信号），
   * 不会去重；去重由 plan() 在"虚拟视图"里处理。
   */
  record(ev) {
    const kind = this.classifyWithRepeats(ev);
    const rec = {
      ev,
      kind,
      signature: argsSignature(ev.toolName, ev.args)
    };
    this.buf[this.head] = rec;
    this.head = (this.head + 1) % RING_BUFFER_LIMIT;
    if (this.size < RING_BUFFER_LIMIT) this.size++;
    this.consecutive.set(ev.toolName, (this.consecutive.get(ev.toolName) || 0) + 1);
    this.totalFailures++;
    this.byKindCount[kind] = (this.byKindCount[kind] || 0) + 1;
  }
  /**
   * 给出恢复策略。纯计算：不写环形缓冲、不清零计数；只追加一条 planLog
   * 用于 shouldStop()/summary()。因此同一事件多次调用 plan() 决策稳定。
   */
  plan(ev) {
    const entries = this.entries();
    const recorded = entries.some((e) => sameEvent(e.ev, ev));
    const view = recorded ? entries : [...entries, { ev, kind: classifyFailureKind(ev.errorText), signature: argsSignature(ev.toolName, ev.args) }];
    const kind = this.classifyWithRepeatsIn(view, ev, recorded);
    const n = (this.consecutive.get(ev.toolName) || 0) + (recorded ? 0 : 1);
    const plan = this.decide(ev, kind, n, view, recorded);
    const isNew = this.logPlan(ev, kind, plan.action);
    if (isNew && plan.action !== "should_stop" && plan.action !== "summarize_exit") this.recoveryCount++;
    return plan;
  }
  /**
   * 是否应停止当前工具轮次。
   * 条件（同时满足）：最近 5 次失败里 ≥4 次同一 kind，且其中至少 2 次
   * 已经给过 fix_args / switch_tool 策略仍然失败——说明"给策略"这条路也走不通。
   */
  shouldStop() {
    const win = this.entries().slice(-STOP_WINDOW);
    if (win.length < STOP_SAME_KIND) return false;
    const counts = {};
    for (const r of win) counts[r.kind] = (counts[r.kind] || 0) + 1;
    let dominant = "";
    let max = 0;
    for (const k of ALL_KINDS) {
      if ((counts[k] || 0) > max) {
        max = counts[k] || 0;
        dominant = k;
      }
    }
    if (!dominant || max < STOP_SAME_KIND) return false;
    const winKeys = new Set(win.map((r) => keyOf(r.ev)));
    let actionable = 0;
    for (const p of this.planLog) {
      if (!winKeys.has(p.key) || p.kind !== dominant) continue;
      if (p.action === "fix_args" || p.action === "switch_tool") actionable++;
    }
    return actionable >= STOP_ACTIONABLE;
  }
  /**
   * 给模型的失败摘要：列出最近 3 次失败的类型与已尝试路线，末尾要求"勿重复"。
   * 路线取自 planLog，因此只有真正下发过策略的失败才会标注路线。
   */
  summary() {
    const win = this.entries().slice(-3);
    if (win.length === 0) return "\u6682\u65E0\u5931\u8D25\u8BB0\u5F55\u3002";
    const parts = [];
    for (const r of win) {
      const action = this.lastActionFor(keyOf(r.ev));
      parts.push(r.ev.toolName + "(" + KIND_LABEL[r.kind] + ")\u2192" + routeLabel(r.kind, action));
    }
    return "\u6700\u8FD1 " + win.length + " \u6B21\u5931\u8D25\uFF1A" + parts.join("\uFF1B") + "\u3002\u8BF7\u52FF\u91CD\u590D\u8FD9\u4E9B\u8DEF\u7EBF\u3002";
  }
  /** 工具成功后调用：清空失败历史、连续计数与决策日志；累计统计保留 */
  reset() {
    this.head = 0;
    this.size = 0;
    this.consecutive.clear();
    this.planLog = [];
  }
  /** 累计统计的快照（深拷贝 byKind） */
  stats() {
    return {
      total: this.totalFailures,
      byKind: { ...this.byKindCount },
      recoveries: this.recoveryCount
    };
  }
  /** 只读历史快照，便于调用方/测试检查环形缓冲状态 */
  get history() {
    return this.entries().map((r) => r.ev);
  }
  // ── 内部方法 ──────────────────────────────────────────────────────────────
  /** 按写入顺序展开环形缓冲（旧 -> 新） */
  entries() {
    const out = [];
    const start = (this.head - this.size + RING_BUFFER_LIMIT) % RING_BUFFER_LIMIT;
    for (let i = 0; i < this.size; i++) out.push(this.buf[(start + i) % RING_BUFFER_LIMIT]);
    return out;
  }
  /** record 时的分类：叠加"连续重复"判定 */
  classifyWithRepeats(ev) {
    const base = classifyFailureKind(ev.errorText);
    const sig = argsSignature(ev.toolName, ev.args);
    let repeats = 0;
    for (let i = this.size - 1; i >= 0; i--) {
      const r = this.buf[(this.head - 1 - i + RING_BUFFER_LIMIT) % RING_BUFFER_LIMIT];
      if (r && r.signature === sig) repeats++;
      else break;
    }
    return repeats + 1 >= REPEAT_STOP_LIMIT ? "repeated" : base;
  }
  /** plan 时的分类：使用虚拟视图（含尚未记录的事件） */
  classifyWithRepeatsIn(view, ev, recorded) {
    const base = classifyFailureKind(ev.errorText);
    const sig = argsSignature(ev.toolName, ev.args);
    let repeats = 0;
    for (let i = view.length - 1; i >= 0; i--) {
      if (view[i].signature === sig) repeats++;
      else break;
    }
    if (!recorded) repeats++;
    return repeats >= REPEAT_STOP_LIMIT ? "repeated" : base;
  }
  /** 具体决策：每个分支都给出明确指令、理由与置信度 */
  decide(ev, kind, n, view, recorded) {
    const tool = ev.toolName;
    switch (kind) {
      case "context_overflow":
        return {
          kind,
          action: "summarize_exit",
          instruction: `\u4E0A\u4E0B\u6587\u5DF2\u63A5\u8FD1\u4E0A\u9650\uFF0C\u505C\u6B62\u7EE7\u7EED\u8C03\u7528\u5DE5\u5177\u3002\u8BF7\u57FA\u4E8E\u5DF2\u6709\u7ED3\u679C\u6536\u5C3E\u603B\u7ED3\uFF0C\u660E\u786E\u8BF4\u660E\u672A\u5B8C\u6210\u90E8\u5206\u4E0E\u963B\u585E\u539F\u56E0\uFF0C\u4E0D\u8981\u518D\u53D1\u8D77\u65B0\u7684\u5DE5\u5177\u8C03\u7528\u3002`,
          confidence: 0.96,
          reason: "\u9519\u8BEF\u6587\u6848\u547D\u4E2D\u4E0A\u4E0B\u6587\u957F\u5EA6/token \u9650\u5236\uFF0C\u7EE7\u7EED\u8C03\u7528\u53EA\u4F1A\u8BA9\u6EA2\u51FA\u52A0\u91CD"
        };
      case "repeated": {
        const repeats = this.countRepeats(view, ev, recorded);
        return {
          kind,
          action: "should_stop",
          instruction: `\u300C${tool}\u300D\u4EE5\u5B8C\u5168\u76F8\u540C\u7684\u53C2\u6570\u5DF2\u8FDE\u7EED\u5931\u8D25 ${repeats} \u6B21\uFF0C\u5C5E\u4E8E\u7A7A\u8F6C\u3002\u7ACB\u5373\u505C\u6B62\u91CD\u590D\u8C03\u7528\uFF1A\u6362\u53C2\u6570\u3001\u6362\u5DE5\u5177\uFF0C\u6216\u76F4\u63A5\u57FA\u4E8E\u5DF2\u6709\u7ED3\u679C\u7ED9\u51FA\u7ED3\u8BBA\u3002`,
          confidence: 0.97,
          reason: `\u76F8\u540C\u8C03\u7528\u7B7E\u540D\u8FDE\u7EED\u51FA\u73B0 ${repeats} \u6B21\uFF08\u9608\u503C ${REPEAT_STOP_LIMIT}\uFF09\uFF0C\u91CD\u590D\u6267\u884C\u4E0D\u4F1A\u6539\u53D8\u7ED3\u679C`
        };
      }
      case "not_found": {
        const pathValue = this.firstPathArg(ev.args);
        const suggested = extractSuggestedPath(ev.errorText);
        if (!pathValue) {
          return {
            kind,
            action: "read_first",
            instruction: `\u627E\u4E0D\u5230\u76EE\u6807\u4E14\u53C2\u6570\u91CC\u6CA1\u6709\u660E\u786E\u7684 path\u3002\u8BF7\u5148\u7528 list_dir \u67E5\u770B\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u786E\u8BA4\u771F\u5B9E\u8DEF\u5F84\u540E\u518D\u8C03\u7528 ${tool}\uFF1B\u4E0D\u8981\u51ED\u731C\u6D4B\u91CD\u8BD5\u3002`,
            confidence: 0.8,
            reason: "\u9519\u8BEF\u547D\u4E2D\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF0C\u4F46\u6CA1\u6709 path \u53C2\u6570\u53EF\u636E\u6B64\u5B9A\u4F4D\u7236\u76EE\u5F55"
          };
        }
        const parent = parentPath(pathValue);
        let instruction = `\u8DEF\u5F84\u300C${pathValue}\u300D\u4E0D\u5B58\u5728\u3002\u8BF7\u5148\u7528 list_dir \u67E5\u770B\u7236\u76EE\u5F55\u300C${parent}\u300D\uFF0C\u786E\u8BA4\u771F\u5B9E\u8DEF\u5F84\u540E\u518D\u91CD\u8BD5 ${tool}\uFF1B\u4E0D\u8981\u628A\u4E0D\u5B58\u5728\u7684\u8DEF\u5F84\u539F\u6837\u518D\u4F20\u4E00\u6B21\u3002`;
        if (suggested) instruction += ` \u9519\u8BEF\u91CC\u7591\u4F3C\u6B63\u786E\u8DEF\u5F84\u4E3A\u300C${suggested}\u300D\uFF0C\u53EF\u5148\u6838\u5BF9\u518D\u6539\u7528\u8BE5\u8DEF\u5F84\u3002`;
        const patches = {};
        if (suggested) patches.path = suggested;
        return {
          kind,
          action: "read_first",
          instruction,
          ...suggested ? { patches } : {},
          confidence: suggested ? 0.94 : 0.92,
          reason: "\u9519\u8BEF\u547D\u4E2D ENOENT/not found\uFF0C\u5148\u8BFB\u7236\u76EE\u5F55\u786E\u8BA4\u771F\u5B9E\u8DEF\u5F84\uFF0C\u907F\u514D\u76F2\u5199\u6216\u76F2\u8BFB"
        };
      }
      case "permission": {
        const advice = switchToolAdvice(tool);
        if (READ_ONLY_RE.test(ev.errorText) && isWriteTool(tool)) {
          return {
            kind,
            action: "summarize_exit",
            instruction: `\u76EE\u6807\u76EE\u5F55\u53EA\u8BFB\u6216\u5F53\u524D\u8D26\u53F7\u65E0\u5199\u6743\u9650\uFF0C${tool} \u7684\u5199\u5165\u4E0D\u4F1A\u6210\u529F\u3002\u8BF7\u6362\u4E00\u4E2A\u53EF\u5199\u8DEF\u5F84\uFF08\u5982\u5DE5\u4F5C\u533A\u5185\u7684\u4E34\u65F6\u76EE\u5F55\uFF09\uFF0C\u6216\u8BF7\u7528\u6237\u8C03\u6574\u6743\u9650\u540E\u518D\u5199\uFF1B\u4E0D\u8981\u91CD\u590D\u540C\u4E00\u5199\u5165\u3002\u82E5\u65E0\u6CD5\u6539\u5199\uFF0C\u8BF7\u57FA\u4E8E\u5DF2\u6709\u7ED3\u679C\u6536\u5C3E\u8BF4\u660E\u963B\u585E\u539F\u56E0\u3002`,
            confidence: 0.9,
            reason: "\u5199\u64CD\u4F5C\u547D\u4E2D\u53EA\u8BFB/\u6743\u9650\u62D2\u7EDD\uFF0C\u662F\u672C\u8F6E\u65E0\u6CD5\u81EA\u6108\u7684\u73AF\u5883\u95EE\u9898\uFF0C\u7EE7\u7EED\u8BD5\u65E0\u6536\u76CA"
          };
        }
        return {
          kind,
          action: "switch_tool",
          instruction: `\u6743\u9650\u88AB\u62D2\u7EDD\uFF0C${tool} \u5728\u5F53\u524D\u73AF\u5883\u4E0B\u4E0D\u53EF\u7528\u3002${advice}\u3002\u5148\u786E\u8BA4\u8BBF\u95EE\u6743\u9650\u518D\u7EE7\u7EED\uFF0C\u4E0D\u8981\u539F\u6837\u91CD\u8BD5\u3002`,
          confidence: 0.88,
          reason: "\u9519\u8BEF\u547D\u4E2D permission/denied/EACCES\uFF0C\u6362\u7528\u5B9E\u73B0\u4E0D\u540C\u7684\u5DE5\u5177\u901A\u5E38\u80FD\u7ED5\u8FC7\u5355\u4E00\u5DE5\u5177\u7684\u6743\u9650\u9650\u5236"
        };
      }
      case "invalid_args": {
        const info = parseInvalidArgs(ev.errorText);
        const patches = {};
        for (const f of info.fields) {
          const d = defaultForField(f, ev.args);
          if (d !== void 0) patches[f] = d;
        }
        const patchKeys = Object.keys(patches);
        const parts = [`\u53C2\u6570\u6821\u9A8C\u5931\u8D25`];
        if (info.fields.length) parts.push(`\u6D89\u53CA\u5B57\u6BB5\uFF1A${info.fields.join("\u3001")}`);
        if (info.emptyFields.length) parts.push(`\u4E0D\u80FD\u4E3A\u7A7A\uFF1A${info.emptyFields.join("\u3001")}`);
        if (info.jsonBroken) parts.push("\u53C2\u6570\u662F\u7834\u635F\u7684 JSON\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u5408\u6CD5 JSON \u5BF9\u8C61\u540E\u518D\u8C03\u7528");
        if (patchKeys.length) {
          parts.push(`\u53EF\u5B89\u5168\u8865\u7684\u9ED8\u8BA4\u503C\uFF1A${patchKeys.map((k) => k + "=" + JSON.stringify(patches[k])).join("\uFF0C")}`);
        }
        parts.push(`\u8BF7\u5148\u4FEE\u6B63\u53C2\u6570\u518D\u91CD\u65B0\u8C03\u7528 ${tool}\uFF0C\u4E0D\u8981\u539F\u6837\u91CD\u8BD5\u3002`);
        const hasPatch = patchKeys.length > 0;
        return {
          kind,
          action: "fix_args",
          instruction: parts.join("\u3002"),
          ...hasPatch ? { patches } : {},
          confidence: info.jsonBroken ? 0.78 : info.fields.length ? 0.88 : 0.72,
          reason: "\u9519\u8BEF\u547D\u4E2D\u53C2\u6570/\u6821\u9A8C/JSON \u5173\u952E\u8BCD\uFF0C\u5C5E\u4E8E\u8F93\u5165\u95EE\u9898\uFF1A\u4FEE\u6B63\u540E\u91CD\u8BD5\u5373\u53EF\u6062\u590D"
        };
      }
      case "tool_error": {
        if (n < TOOL_ERROR_SWITCH_LIMIT) {
          return {
            kind,
            action: "retry_same",
            instruction: `${tool} \u51FA\u73B0\u4E34\u65F6\u9519\u8BEF\uFF08\u8D85\u65F6/\u4E0A\u6E38\u6545\u969C\uFF09\uFF0C\u53EF\u539F\u6837\u91CD\u8BD5\u4E00\u6B21\uFF1B\u82E5\u4ECD\u5931\u8D25\u8BF7\u6362\u5DE5\u5177\uFF0C\u4E0D\u8981\u65E0\u9650\u91CD\u8BD5\u3002`,
            confidence: 0.86,
            reason: `\u8BE5\u5DE5\u5177\u8FDE\u7EED\u5931\u8D25 ${n} \u6B21\uFF08<${TOOL_ERROR_SWITCH_LIMIT}\uFF09\uFF0C\u4E34\u65F6\u6027\u9519\u8BEF\u539F\u6837\u91CD\u8BD5\u6709\u6062\u590D\u6982\u7387`
          };
        }
        const advice = switchToolAdvice(tool);
        return {
          kind,
          action: "switch_tool",
          instruction: `${tool} \u5DF2\u8FDE\u7EED ${n} \u6B21\u4E34\u65F6\u9519\u8BEF\uFF0C\u539F\u6837\u91CD\u8BD5\u65E0\u610F\u4E49\u3002${advice}\u3002\u82E5\u6362\u5DE5\u5177\u4ECD\u5931\u8D25\uFF0C\u8BF7\u6536\u5C3E\u8BF4\u660E\u4E0A\u6E38\u72B6\u6001\u3002`,
          confidence: 0.82,
          reason: `\u540C\u4E00\u5DE5\u5177\u8FDE\u7EED\u5931\u8D25 ${n} \u6B21\uFF08\u2265${TOOL_ERROR_SWITCH_LIMIT}\uFF09\uFF0C\u5224\u5B9A\u4E3A\u6301\u7EED\u6027\u4E0A\u6E38\u6545\u969C\uFF0C\u9700\u6362\u8DEF\u7EBF`
        };
      }
      case "unknown":
      default:
        if (n < UNKNOWN_SUMMARY_LIMIT) {
          return {
            kind: "unknown",
            action: "retry_same",
            instruction: `\u5DE5\u5177 ${tool} \u8FD4\u56DE\u4E86\u65E0\u6CD5\u5F52\u7C7B\u7684\u9519\u8BEF\uFF0C\u53EF\u539F\u6837\u91CD\u8BD5\u4E00\u6B21\uFF1B\u91CD\u8BD5\u524D\u7559\u610F\u9519\u8BEF\u6587\u6848\u91CC\u662F\u5426\u542B\u8DEF\u5F84\u3001\u6743\u9650\u6216\u53C2\u6570\u4FE1\u606F\uFF0C\u82E5\u6709\u8BF7\u6309\u5BF9\u5E94\u65B9\u5F0F\u5904\u7406\u3002`,
            confidence: 0.4,
            reason: `\u672A\u77E5\u9519\u8BEF\u4EC5 ${n} \u6B21\uFF08<${UNKNOWN_SUMMARY_LIMIT}\uFF09\uFF0C\u5148\u4F4E\u6210\u672C\u91CD\u8BD5\u6536\u96C6\u4FE1\u606F`
          };
        }
        return {
          kind: "unknown",
          action: "summarize_exit",
          instruction: `${tool} \u5DF2\u8FDE\u7EED ${n} \u6B21\u672A\u77E5\u9519\u8BEF\uFF0C\u7EE7\u7EED\u76F2\u8BD5\u6CA1\u6709\u6536\u76CA\u3002\u8BF7\u6536\u5C3E\u603B\u7ED3\u5DF2\u5B8C\u6210\u7684\u6B65\u9AA4\u548C\u963B\u585E\u539F\u56E0\uFF0C\u7B49\u5F85\u7528\u6237\u6307\u793A\u3002`,
          confidence: 0.6,
          reason: `\u672A\u77E5\u9519\u8BEF\u7D2F\u8BA1 ${n} \u6B21\uFF08\u2265${UNKNOWN_SUMMARY_LIMIT}\uFF09\uFF0C\u5206\u7C7B\u4FE1\u53F7\u4E0D\u8DB3\uFF0C\u505C\u6B62\u8BD5\u9519\u4EA4\u7531\u7528\u6237\u51B3\u7B56`
        };
    }
  }
  /** 取第一个可用的路径类参数：path 优先，其次常见别名 */
  firstPathArg(args) {
    for (const k of ["path", "filePath", "file_path", "file", "dir", "directory"]) {
      const v = args[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  }
  /** 统计当前调用签名在虚拟视图尾部的连续重复次数 */
  countRepeats(view, ev, recorded) {
    const sig = argsSignature(ev.toolName, ev.args);
    let repeats = 0;
    for (let i = view.length - 1; i >= 0; i--) {
      if (view[i].signature === sig) repeats++;
      else break;
    }
    return recorded ? repeats : repeats + 1;
  }
  /**
   * 记录决策；同一事件同一动作只记一次，避免 plan() 幂等调用被当成多次策略。
   * 返回是否为新策略，供 recoveries 计数使用。
   */
  logPlan(ev, kind, action) {
    const key = keyOf(ev);
    if (this.planLog.some((p) => p.key === key && p.action === action)) return false;
    this.planLog.push({ key, kind, action });
    if (this.planLog.length > RING_BUFFER_LIMIT) this.planLog.splice(0, this.planLog.length - RING_BUFFER_LIMIT);
    return true;
  }
  /** 取某事件最近一次下发过的动作 */
  lastActionFor(key) {
    for (let i = this.planLog.length - 1; i >= 0; i--) {
      if (this.planLog[i].key === key) return this.planLog[i].action;
    }
    return void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FailureRecovery,
  HARD_CONSECUTIVE_LIMIT,
  REPEAT_STOP_LIMIT,
  RING_BUFFER_LIMIT,
  STOP_ACTIONABLE,
  STOP_SAME_KIND,
  STOP_WINDOW,
  TOOL_ERROR_SWITCH_LIMIT,
  UNKNOWN_SUMMARY_LIMIT,
  argsSignature,
  classifyFailureKind,
  defaultForField,
  extractSuggestedPath,
  isWriteTool,
  parentPath,
  parseInvalidArgs,
  switchToolAdvice
});
