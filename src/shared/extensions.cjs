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
var extensions_exports = {};
__export(extensions_exports, {
  EXT_ALLOWED_FILE_RE: () => EXT_ALLOWED_FILE_RE,
  EXT_API_VERSION: () => EXT_API_VERSION,
  EXT_CAPABILITIES: () => EXT_CAPABILITIES,
  EXT_MAX_FILE_BYTES: () => EXT_MAX_FILE_BYTES,
  defaultExtManifest: () => defaultExtManifest,
  isExtCompatible: () => isExtCompatible,
  isSafeExtPath: () => isSafeExtPath,
  normalizeExtId: () => normalizeExtId,
  validateExtManifest: () => validateExtManifest
});
module.exports = __toCommonJS(extensions_exports);
const EXT_API_VERSION = 1;
const EXT_CAPABILITIES = ["settings", "sessions", "notices", "workspace"];
const EXT_MAX_FILE_BYTES = 512 * 1024;
const EXT_ALLOWED_FILE_RE = /\.(html?|css|js|json|svg|png|jpe?g|gif|webp|txt|md)$/i;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ENTRY_RE = /^[a-z0-9][a-z0-9_./-]{0,127}$/i;
function normalizeExtId(raw) {
  return String(raw || "").trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}
function isSafeExtPath(raw) {
  const p = String(raw || "");
  if (!p || !ENTRY_RE.test(p)) return false;
  if (pathIsAbsolute(p) || p.includes("..") || p.includes("\\")) return false;
  if (p.startsWith("/") || p.startsWith("./")) return false;
  return EXT_ALLOWED_FILE_RE.test(p);
}
function pathIsAbsolute(p) {
  return p.startsWith("/") || /^[a-zA-Z]:/.test(p);
}
function validateExtManifest(raw, opts) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["manifest \u4E0D\u662F\u5BF9\u8C61"], manifest: null };
  const m = raw;
  const id = normalizeExtId(m.id);
  if (!id || !ID_RE.test(id)) errors.push("id \u975E\u6CD5\uFF08\u9700\u5B57\u6BCD\u6570\u5B57\u5F00\u5934\uFF0C\u4EC5 a-z0-9_-\uFF0C\u226464 \u5B57\u7B26\uFF09");
  const name = String(m.name || "").trim().slice(0, 60);
  if (!name) errors.push("\u7F3A\u5C11 name");
  const version = String(m.version || "0.1.0").slice(0, 32);
  const apiVersion = Number(m.apiVersion);
  if (!Number.isInteger(apiVersion) || apiVersion < 1) errors.push("apiVersion \u5FC5\u987B\u662F\u6B63\u6574\u6570");
  else if (Math.floor(apiVersion) !== Math.floor(EXT_API_VERSION)) {
    errors.push(`apiVersion ${apiVersion} \u4E0E\u5BBF\u4E3B ${EXT_API_VERSION} \u4E0D\u517C\u5BB9`);
  }
  const slot = m.slot ? String(m.slot) : "tab";
  if (!["tab", "sidebar", "statusbar"].includes(slot)) errors.push("slot \u975E\u6CD5");
  const entry = String(m.entry || "panel.html");
  if (!isSafeExtPath(entry)) errors.push("entry \u8DEF\u5F84\u975E\u6CD5\uFF08\u5FC5\u987B\u76F8\u5BF9\u3001\u65E0\u7A7F\u8D8A\u3001\u540E\u7F00\u5728\u767D\u540D\u5355\u5185\uFF09");
  const rawCaps = Array.isArray(m.capabilities) ? m.capabilities : [];
  const caps = rawCaps.map(String).filter((c) => EXT_CAPABILITIES.includes(c));
  if (rawCaps.some((c) => !EXT_CAPABILITIES.includes(String(c)))) {
    errors.push("capabilities \u542B\u672A\u77E5\u9879\uFF08\u53EA\u5141\u8BB8 settings/sessions/notices/workspace\uFF09");
  }
  const icon = String(m.icon || "\u{1F9E9}").slice(0, 8);
  const description = String(m.description || "").slice(0, 300);
  const author = String(m.author || "AI \u751F\u6210").slice(0, 60);
  if (opts?.strict && m.approved !== true) errors.push("\u5C1A\u672A\u7ECF\u7528\u6237\u6279\u51C6");
  if (opts?.strict && m.enabled === false) errors.push("\u5DF2\u7981\u7528");
  const manifest = errors.length ? null : {
    id,
    name,
    version,
    description,
    apiVersion,
    slot,
    entry,
    icon,
    capabilities: caps,
    author,
    createdAt: String(m.createdAt || (/* @__PURE__ */ new Date()).toISOString()),
    approved: m.approved === true,
    enabled: m.enabled !== false
  };
  return { ok: errors.length === 0, errors, manifest };
}
function isExtCompatible(hostApiVersion, ext) {
  return Math.floor(ext.apiVersion) === Math.floor(hostApiVersion);
}
function defaultExtManifest(input) {
  const id = normalizeExtId(input.id);
  return {
    id,
    name: String(input.name || id).slice(0, 60),
    version: "0.1.0",
    description: String(input.description || "").slice(0, 300),
    apiVersion: EXT_API_VERSION,
    slot: input.slot || "tab",
    entry: "panel.html",
    icon: String(input.icon || "\u{1F9E9}").slice(0, 8),
    capabilities: [],
    author: "AI \u751F\u6210",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    approved: false,
    enabled: true
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXT_ALLOWED_FILE_RE,
  EXT_API_VERSION,
  EXT_CAPABILITIES,
  EXT_MAX_FILE_BYTES,
  defaultExtManifest,
  isExtCompatible,
  isSafeExtPath,
  normalizeExtId,
  validateExtManifest
});
