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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  collectInputs,
  renderTemplate,
  renderToolArgs,
  summarizeRun,
  validateWorkflow
});
