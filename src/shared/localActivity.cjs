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
var localActivity_exports = {};
__export(localActivity_exports, {
  LA_FILE: () => LA_FILE,
  LA_MAX: () => LA_MAX,
  appendActivity: () => appendActivity,
  normalizeSource: () => normalizeSource,
  previewOf: () => previewOf,
  relTime: () => relTime,
  sanitizeActivity: () => sanitizeActivity
});
module.exports = __toCommonJS(localActivity_exports);
const LA_MAX = 30;
const LA_FILE = "local-api-activity.json";
function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function normalizeSource(ua, fromLoopback) {
  const raw = String(ua || "").trim();
  const origin = fromLoopback ? "\u672C\u673A" : "\u5C40\u57DF\u7F51\u8BBE\u5907";
  if (!raw) return origin;
  const m = raw.match(/^([a-zA-Z][a-zA-Z0-9 _.-]+)/);
  const name = (m ? m[1] : raw.replace(/\s+/g, " ")).slice(0, 40);
  return `${origin} \xB7 ${name}`;
}
function previewOf(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 80);
}
function appendActivity(list, entry) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const id = String(entry.id || "");
  if (id) {
    const idx = arr.findIndex((x) => x.id === id);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...entry, id };
      return arr.slice(0, LA_MAX);
    }
  }
  arr.unshift({
    id: id || uid(),
    ts: entry.ts || Date.now(),
    source: entry.source || "\u672C\u673A",
    origin: entry.origin || "local",
    method: entry.method || "POST",
    path: entry.path || "/v1/chat/completions",
    model: entry.model || "",
    preview: entry.preview || "",
    status: entry.status || "started",
    ttft: entry.ttft,
    totalMs: entry.totalMs,
    error: entry.error
  });
  return arr.slice(0, LA_MAX);
}
function sanitizeActivity(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object" && typeof x.ts === "number").map((x) => {
    const r = x;
    const status = ["started", "done", "error"].includes(String(r.status)) ? String(r.status) : "done";
    return {
      id: String(r.id || ""),
      ts: Number(r.ts),
      source: String(r.source || "\u672C\u673A"),
      origin: String(r.origin || "local"),
      method: String(r.method || "POST"),
      path: String(r.path || ""),
      model: String(r.model || ""),
      preview: String(r.preview || ""),
      status,
      ttft: typeof r.ttft === "number" ? r.ttft : void 0,
      totalMs: typeof r.totalMs === "number" ? r.totalMs : void 0,
      error: String(r.error || "")
    };
  }).slice(0, LA_MAX);
}
function relTime(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ts) / 1e3));
  if (s < 5) return "\u521A\u521A";
  if (s < 60) return `${s} \u79D2\u524D`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} \u5206\u949F\u524D`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} \u5C0F\u65F6\u524D`;
  return `${Math.floor(h / 24)} \u5929\u524D`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LA_FILE,
  LA_MAX,
  appendActivity,
  normalizeSource,
  previewOf,
  relTime,
  sanitizeActivity
});
