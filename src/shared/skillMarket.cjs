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
var skillMarket_exports = {};
__export(skillMarket_exports, {
  SKILL_FILE_EXT: () => SKILL_FILE_EXT,
  SKILL_INSTALL_LIMITS: () => SKILL_INSTALL_LIMITS,
  SKILL_SOURCES: () => SKILL_SOURCES,
  isAllowedSkillFile: () => isAllowedSkillFile,
  normalizeRemoteSkill: () => normalizeRemoteSkill,
  parseFrontmatter: () => parseFrontmatter,
  sanitizeSkillId: () => sanitizeSkillId
});
module.exports = __toCommonJS(skillMarket_exports);
const SKILL_SOURCES = [
  { id: "anthropic-official", repo: "anthropics/skills", dir: "skills", label: "Anthropic \u5B98\u65B9", source: "official" },
  { id: "superpowers", repo: "obra/superpowers", dir: "skills", label: "Superpowers \u793E\u533A", source: "community" }
];
function parseFrontmatter(md) {
  const out = {};
  if (typeof md !== "string") return out;
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return out;
  let lastKey = "";
  for (const rawLine of m[1].split(/\r?\n/)) {
    const cont = rawLine.match(/^\s+(.*)$/);
    if (cont && lastKey) {
      const v2 = cont[1].trim();
      if (v2) out[lastKey] = (out[lastKey] + " " + v2).trim();
      continue;
    }
    const kv = rawLine.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (v === ">" || v === "|" || v === ">-" || v === "|-") v = "";
    if (v) out[kv[1]] = v;
    else if (!(kv[1] in out)) out[kv[1]] = "";
    lastKey = kv[1];
  }
  return out;
}
function sanitizeSkillId(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (!s || s.length > 64) return null;
  if (s.includes("..") || s.startsWith(".")) return null;
  return s;
}
const SKILL_FILE_EXT = /* @__PURE__ */ new Set([
  ".md",
  ".txt",
  ".py",
  ".sh",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".html",
  ".css",
  ".xml",
  ".svg",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".sql",
  ".ps1",
  ".lua",
  ".swift",
  ".kt"
]);
function isAllowedSkillFile(name) {
  if (typeof name !== "string") return false;
  const base = name.split("/").pop() || "";
  if (base.startsWith(".") || base.includes("..")) return false;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return SKILL_FILE_EXT.has(base.slice(dot).toLowerCase());
}
const SKILL_INSTALL_LIMITS = {
  maxFileBytes: 512 * 1024,
  maxFiles: 80,
  maxTotalBytes: 4 * 1024 * 1024,
  maxDepth: 3
};
function normalizeRemoteSkill(entry, src, mdText) {
  const id = sanitizeSkillId(entry.name);
  if (!id) return null;
  const fm = mdText ? parseFrontmatter(mdText) : {};
  const description = (fm.description || "").trim();
  if (!description) return null;
  const author = src.repo.split("/")[0];
  return {
    id,
    name: (fm.name || entry.name).trim(),
    description,
    author,
    version: (fm.version || "1.0.0").trim(),
    source: src.source,
    sourceLabel: src.label,
    repo: src.repo,
    path: entry.path
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SKILL_FILE_EXT,
  SKILL_INSTALL_LIMITS,
  SKILL_SOURCES,
  isAllowedSkillFile,
  normalizeRemoteSkill,
  parseFrontmatter,
  sanitizeSkillId
});
