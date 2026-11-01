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
var workflow_exports = {};
__export(workflow_exports, {
  WORKFLOW_EXAMPLES: () => WORKFLOW_EXAMPLES,
  collectInputs: () => collectInputs,
  renderTemplate: () => renderTemplate,
  renderToolArgs: () => renderToolArgs,
  summarizeRun: () => summarizeRun,
  validateWorkflow: () => validateWorkflow
});
module.exports = __toCommonJS(workflow_exports);
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
function validateWorkflow(wf) {
  const name = String(wf.name || "").trim();
  if (!name) return "\u5DE5\u4F5C\u6D41\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A";
  const steps = Array.isArray(wf.steps) ? wf.steps : [];
  if (steps.length === 0) return "\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6B65\u9AA4";
  if (steps.length > 20) return "\u6B65\u9AA4\u8FC7\u591A\uFF08\u6700\u591A 20 \u6B65\uFF09";
  const seen = /* @__PURE__ */ new Set();
  for (const [i, s] of steps.entries()) {
    const id = String(s.id || "").trim();
    if (!id) return `\u7B2C ${i + 1} \u6B65\u7F3A\u5C11 id`;
    if (!ID_RE.test(id)) return `\u7B2C ${i + 1} \u6B65\u7684 id\u300C${id}\u300D\u4E0D\u5408\u6CD5\uFF08\u5B57\u6BCD\u5F00\u5934\uFF0C\u53EA\u542B\u5B57\u6BCD\u6570\u5B57 _ -\uFF09`;
    if (seen.has(id)) return `\u6B65\u9AA4 id \u91CD\u590D\uFF1A${id}`;
    seen.add(id);
    if (s.type !== "prompt" && s.type !== "tool") return `\u7B2C ${i + 1} \u6B65\u7C7B\u578B\u4E0D\u5408\u6CD5`;
    if (s.type === "prompt" && !String(s.prompt || "").trim()) return `\u7B2C ${i + 1} \u6B65\uFF08${id}\uFF09\u7F3A\u5C11\u63D0\u793A\u8BCD`;
    if (s.type === "tool") {
      if (!String(s.tool || "").trim()) return `\u7B2C ${i + 1} \u6B65\uFF08${id}\uFF09\u7F3A\u5C11\u5DE5\u5177\u540D`;
      const err = validateArgsJson(String(s.args || "{}"));
      if (err) return `\u7B2C ${i + 1} \u6B65\uFF08${id}\uFF09\u7684\u53C2\u6570 JSON ${err}`;
    }
  }
  const inputs = Array.isArray(wf.inputs) ? wf.inputs : [];
  const inputKeys = /* @__PURE__ */ new Set();
  for (const [i, inp] of inputs.entries()) {
    const k = String(inp.key || "").trim();
    if (!k) return `\u7B2C ${i + 1} \u4E2A\u8F93\u5165\u7F3A\u5C11 key`;
    if (!ID_RE.test(k)) return `\u8F93\u5165 key\u300C${k}\u300D\u4E0D\u5408\u6CD5\uFF08\u5B57\u6BCD\u5F00\u5934\uFF0C\u53EA\u542B\u5B57\u6BCD\u6570\u5B57 _ -\uFF09`;
    if (inputKeys.has(k)) return `\u8F93\u5165 key \u91CD\u590D\uFF1A${k}`;
    inputKeys.add(k);
  }
  return null;
}
function validateArgsJson(raw) {
  const s = raw.trim();
  if (!s) return null;
  if (!s.startsWith("{") || !s.endsWith("}")) return "\u5FC5\u987B\u662F\u5BF9\u8C61\uFF08{ ... }\uFF09";
  const stripped = s.replace(/\{\{[^}]+\}\}/g, "0");
  try {
    const v = JSON.parse(stripped);
    if (!v || typeof v !== "object" || Array.isArray(v)) return "\u5FC5\u987B\u662F\u5BF9\u8C61\uFF08{ ... }\uFF09";
  } catch (e) {
    return "\u65E0\u6CD5\u89E3\u6790\uFF1A" + e.message;
  }
  return null;
}
const PLACEHOLDER = /\{\{\s*(input|step|prev)(?:\.([a-zA-Z0-9_-]+))?(?:\.output)?\s*\}\}/g;
function renderTemplate(text, ctx) {
  const warnings = [];
  const out = String(text ?? "").replace(PLACEHOLDER, (_m, scope, key) => {
    if (scope === "input") {
      if (!key) return "";
      const v = ctx.inputs[key];
      if (v === void 0 || v === "") {
        warnings.push(`\u8F93\u5165 ${key} \u4E3A\u7A7A`);
        return "";
      }
      return v;
    }
    if (scope === "prev") return ctx.prev ?? "";
    if (scope === "step") {
      if (!key) return "";
      const v = ctx.steps[key];
      if (v === void 0) {
        warnings.push(`\u6B65\u9AA4 ${key} \u5C1A\u65E0\u8F93\u51FA`);
        return "";
      }
      return v;
    }
    return "";
  });
  return { text: out, warnings };
}
function renderToolArgs(raw, ctx) {
  const warnings = [];
  const src = String(raw || "{}").trim() || "{}";
  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch (e) {
    return { error: "\u53C2\u6570 JSON \u89E3\u6790\u5931\u8D25\uFF1A" + e.message, warnings };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\uFF08{ ... }\uFF09", warnings };
  }
  const walk = (v) => {
    if (typeof v === "string") {
      const r = renderTemplate(v, ctx);
      warnings.push(...r.warnings);
      const onlyPlaceholder = /^\{\{\s*[^}]+\}\}$/.test(v.trim());
      if (onlyPlaceholder) {
        const t = r.text.trim();
        if (t === "true") return true;
        if (t === "false") return false;
        if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
      }
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = walk(val);
      return o;
    }
    return v;
  };
  return { args: walk(parsed), warnings };
}
function collectInputs(wf, provided) {
  const values = {};
  for (const inp of wf.inputs || []) {
    const raw = provided[inp.key];
    const v = raw === void 0 || raw === null ? "" : String(raw);
    if (!v && inp.default) {
      values[inp.key] = String(inp.default);
      continue;
    }
    if (!v && inp.required) return { values, error: `\u7F3A\u5C11\u5FC5\u586B\u8F93\u5165\uFF1A${inp.label || inp.key}` };
    values[inp.key] = v;
  }
  return { values };
}
function summarizeRun(results) {
  const done = results.filter((r) => r.status === "done").length;
  const failed = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const ms = results.reduce((a, r) => a + (r.ms || 0), 0);
  return `${done} \u6210\u529F${failed ? ` / ${failed} \u5931\u8D25` : ""}${skipped ? ` / ${skipped} \u8DF3\u8FC7` : ""} \xB7 ${(ms / 1e3).toFixed(1)}s`;
}
const WORKFLOW_EXAMPLES = [
  {
    key: "web-digest",
    label: "\u7F51\u9875\u6458\u8981\u5165\u5E93",
    description: "\u6293\u53D6\u7F51\u9875 \u2192 \u603B\u7ED3\u8981\u70B9 \u2192 \u5B58\u5165\u77E5\u8BC6\u5E93",
    build: () => ({
      id: "",
      name: "\u7F51\u9875\u6458\u8981\u5165\u5E93",
      description: "\u6293\u53D6\u6307\u5B9A\u7F51\u9875\u5E76\u603B\u7ED3\u6210\u8981\u70B9\uFF0C\u5B58\u5165\u77E5\u8BC6\u5E93",
      inputs: [{ key: "url", label: "\u7F51\u9875\u5730\u5740", required: true, placeholder: "https://example.com" }],
      steps: [
        { id: "fetch", type: "tool", title: "\u6293\u53D6\u7F51\u9875", tool: "web_fetch", args: '{"url":"{{input.url}}"}' },
        { id: "digest", type: "prompt", title: "\u603B\u7ED3\u8981\u70B9", prompt: "\u628A\u4E0B\u9762\u7684\u7F51\u9875\u5185\u5BB9\u603B\u7ED3\u6210 3-5 \u6761\u8981\u70B9\uFF08\u6BCF\u6761\u4E00\u884C\uFF0C\u4E2D\u6587\uFF09\uFF1A\n\n{{prev.output}}" },
        { id: "save", type: "tool", title: "\u5B58\u5165\u77E5\u8BC6\u5E93", tool: "save_knowledge", args: '{"key":"web-digest-{{input.url}}","value":"{{step.digest.output}}"}' }
      ]
    })
  },
  {
    key: "dir-report",
    label: "\u76EE\u5F55\u4F53\u68C0\u62A5\u544A",
    description: "\u5217\u51FA\u76EE\u5F55 \u2192 \u5206\u6790 \u2192 \u5199\u6210\u62A5\u544A\u6587\u4EF6",
    build: () => ({
      id: "",
      name: "\u76EE\u5F55\u4F53\u68C0\u62A5\u544A",
      description: "\u626B\u63CF\u6307\u5B9A\u76EE\u5F55\u5E76\u751F\u6210\u4E00\u4EFD\u7ED3\u6784\u5206\u6790\u62A5\u544A",
      inputs: [{ key: "dir", label: "\u76EE\u5F55", required: true, placeholder: "." }],
      steps: [
        { id: "ls", type: "tool", title: "\u5217\u51FA\u76EE\u5F55", tool: "list_dir", args: '{"path":"{{input.dir}}"}' },
        { id: "analyze", type: "prompt", title: "\u5206\u6790\u7ED3\u6784", prompt: "\u5206\u6790\u4E0B\u9762\u7684\u76EE\u5F55\u6E05\u5355\uFF1A\u6587\u4EF6\u7C7B\u578B\u5206\u5E03\u3001\u6700\u5927\u7684\u7591\u4F3C\u5197\u4F59\u3001\u6574\u7406\u5EFA\u8BAE\uFF08\u4E2D\u6587\uFF0C\u7B80\u77ED\uFF09\uFF1A\n\n{{prev.output}}" },
        { id: "report", type: "tool", title: "\u5199\u62A5\u544A", tool: "write_file", args: '{"path":"reports/dir-report.md","content":"# \u76EE\u5F55\u4F53\u68C0\\n\\n{{step.analyze.output}}"}' }
      ]
    })
  },
  {
    key: "daily-note",
    label: "\u6BCF\u65E5\u901F\u8BB0",
    description: "\u8BB0\u5F55\u5F53\u5929\u8981\u70B9 \u2192 \u8FFD\u52A0\u5230\u65E5\u8BB0\u6587\u4EF6",
    build: () => ({
      id: "",
      name: "\u6BCF\u65E5\u901F\u8BB0",
      description: "\u628A\u8F93\u5165\u7684\u8981\u70B9\u6574\u7406\u6210\u4E00\u6BB5\u8BDD\uFF0C\u8FFD\u52A0\u5230\u5F53\u65E5\u7B14\u8BB0",
      inputs: [{ key: "note", label: "\u8981\u70B9", required: true, placeholder: "\u4ECA\u5929\u505A\u4E86\u4EC0\u4E48" }],
      steps: [
        { id: "polish", type: "prompt", title: "\u6574\u7406\u6210\u6BB5", prompt: "\u628A\u4E0B\u9762\u7684\u8981\u70B9\u6574\u7406\u6210\u4E00\u6BB5\u901A\u987A\u7684\u8BDD\uFF08\u4E2D\u6587\uFF0C\u4E0D\u8D85\u8FC7 120 \u5B57\uFF09\uFF1A\n\n{{input.note}}" },
        { id: "append", type: "tool", title: "\u5199\u5165\u7B14\u8BB0", tool: "write_file", args: '{"path":"notes/daily.md","content":"{{prev.output}}"}' }
      ]
    })
  }
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  WORKFLOW_EXAMPLES,
  collectInputs,
  renderTemplate,
  renderToolArgs,
  summarizeRun,
  validateWorkflow
});
