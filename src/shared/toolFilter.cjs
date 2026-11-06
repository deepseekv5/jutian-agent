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

// src/shared/toolFilter.ts
var toolFilter_exports = {};
__export(toolFilter_exports, {
  filterTools: () => filterTools,
  repairToolCallJson: () => repairToolCallJson,
  stepToolFilter: () => stepToolFilter
});
module.exports = __toCommonJS(toolFilter_exports);
var CATEGORY_KEYWORDS = {
  file: [
    "file",
    "read",
    "write",
    "edit",
    "save",
    "open",
    "folder",
    "directory",
    "rename",
    "move",
    "copy",
    "delete",
    "\u6587\u4EF6",
    "\u8BFB\u53D6",
    "\u5199\u5165",
    "\u7F16\u8F91",
    "\u4FDD\u5B58",
    "\u6253\u5F00",
    "\u91CD\u547D\u540D",
    "\u79FB\u52A8",
    "\u590D\u5236",
    "\u5220\u9664",
    "\u76EE\u5F55",
    "\u6587\u4EF6\u5939"
  ],
  terminal: [
    "terminal",
    "command",
    "bash",
    "shell",
    "run",
    "execute",
    "install",
    "npm",
    "node",
    "python",
    "script",
    "\u8FD0\u884C",
    "\u6267\u884C",
    "\u547D\u4EE4",
    "\u5B89\u88C5",
    "\u7EC8\u7AEF",
    "\u811A\u672C",
    "\u542F\u52A8",
    "\u7F16\u8BD1",
    "build",
    "deploy",
    "test"
  ],
  web: [
    "search",
    "fetch",
    "web",
    "browse",
    "url",
    "http",
    "api",
    "internet",
    "online",
    "\u641C\u7D22",
    "\u7F51\u9875",
    "\u6293\u53D6",
    "\u6D4F\u89C8",
    "\u8054\u7F51",
    "\u4E92\u8054\u7F51",
    "url",
    "\u94FE\u63A5",
    "\u8BF7\u6C42"
  ],
  data: [
    "json",
    "csv",
    "data",
    "process",
    "text",
    "parse",
    "format",
    "base64",
    "hash",
    "encode",
    "decode",
    "\u6570\u636E",
    "\u5904\u7406",
    "\u6587\u672C",
    "\u89E3\u6790",
    "\u683C\u5F0F\u5316",
    "\u7F16\u7801",
    "\u89E3\u7801",
    "\u54C8\u5E0C",
    "\u52A0\u5BC6"
  ],
  memory: [
    "remember",
    "recall",
    "memory",
    "save",
    "store",
    "remember",
    "forget",
    "\u8BB0\u4F4F",
    "\u56DE\u5FC6",
    "\u8BB0\u5FC6",
    "\u5FD8\u8BB0",
    "\u4FDD\u5B58",
    "\u504F\u597D",
    "\u4FE1\u606F"
  ],
  git: [
    "git",
    "commit",
    "branch",
    "merge",
    "push",
    "pull",
    "rebase",
    "tag",
    "\u63D0\u4EA4",
    "\u5206\u652F",
    "\u5408\u5E76",
    "\u63A8\u9001",
    "\u62C9\u53D6",
    "\u7248\u672C"
  ],
  media: [
    "image",
    "screenshot",
    "generate",
    "picture",
    "photo",
    "draw",
    "\u56FE\u7247",
    "\u622A\u5C4F",
    "\u751F\u6210",
    "\u753B",
    "\u62CD\u7167",
    "\u622A\u56FE"
  ],
  knowledge: ["knowledge", "kb", "note", "document", "wiki", "\u7B14\u8BB0", "\u77E5\u8BC6", "\u6587\u6863", "\u8D44\u6599", "\u5E93"],
  code: [
    "code",
    "debug",
    "refactor",
    "analyze",
    "lint",
    "typescript",
    "javascript",
    "python",
    "\u4EE3\u7801",
    "\u8C03\u8BD5",
    "\u91CD\u6784",
    "\u5206\u6790",
    "\u7C7B\u578B",
    "\u8BED\u6CD5",
    "\u51FD\u6570",
    "\u53D8\u91CF",
    "\u63A5\u53E3"
  ],
  scheduling: ["cron", "schedule", "timer", "\u5B9A\u65F6", "\u8BA1\u5212", "\u8C03\u5EA6", "\u95F9\u949F", "\u63D0\u9192"],
  workflow: ["workflow", "pipeline", "automation", "\u5DE5\u4F5C\u6D41", "\u6D41\u6C34\u7EBF", "\u81EA\u52A8\u5316", "\u7F16\u6392"],
  /** 界面扩展（v14.11）：AI 给自己做面板/小工具 — 必须能匹配「日历/番茄钟/看板」等意图 */
  extension: [
    "extension",
    "plugin",
    "widget",
    "panel",
    "ui",
    "interface",
    "calendar",
    "timer",
    "pomodoro",
    "dashboard",
    "kanban",
    "\u6269\u5C55",
    "\u63D2\u4EF6",
    "\u9762\u677F",
    "\u754C\u9762",
    "\u5C0F\u5DE5\u5177",
    "\u65E5\u5386",
    "\u756A\u8304\u949F",
    "\u770B\u677F",
    "\u8BA1\u65F6\u5668",
    "\u7ED9\u81EA\u5DF1\u505A",
    "\u52A0\u4E2A",
    "\u505A\u4E2A",
    "\u505A\u4E00\u4E2A",
    "\u751F\u6210\u754C\u9762",
    "\u6539\u9020\u754C\u9762",
    "\u6362\u4E2A\u754C\u9762",
    "\u4E3B\u9898\u76AE\u80A4"
  ]
};
var ALWAYS_INCLUDE = /* @__PURE__ */ new Set([
  "read_file",
  "write_file",
  "list_dir",
  "search_content",
  "shell",
  "system_info",
  "recall",
  "save_knowledge",
  // v14.11：造界面扩展是「AI 改自己」的入口，任何任务都不该被动态过滤截掉
  "create_extension"
]);
var TOOL_CATEGORY_MAP = {
  read_file: "file",
  write_file: "file",
  edit_file: "file",
  list_dir: "file",
  search_files: "file",
  search_content: "file",
  get_file_info: "file",
  move_file: "file",
  delete_file: "file",
  shell: "terminal",
  npm_run: "terminal",
  web_search: "web",
  web_fetch: "web",
  http_request: "web",
  json_process: "data",
  text_tools: "data",
  base64_tools: "data",
  hash_tools: "data",
  url_tools: "data",
  random_tools: "data",
  timestamp_tools: "data",
  color_tools: "data",
  remember: "memory",
  recall: "memory",
  forget: "memory",
  save_knowledge: "memory",
  git_operation: "git",
  code_analysis: "code",
  image_generate: "media",
  screenshot: "media",
  create_extension: "extension",
  create_skill: "extension"
};
function matchedCategories(message) {
  const msg = message.toLowerCase();
  const matched = /* @__PURE__ */ new Set();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (msg.includes(kw.toLowerCase())) {
        matched.add(cat);
        break;
      }
    }
  }
  return matched;
}
function filterTools(tools, userMessage, maxTools = 15) {
  if (tools.length <= maxTools) return tools;
  const matched = matchedCategories(userMessage || "");
  const scored = tools.map((t) => {
    if (ALWAYS_INCLUDE.has(t.name)) return { t, score: 3 };
    const cat = TOOL_CATEGORY_MAP[t.name];
    if (cat && matched.has(cat)) return { t, score: 2 };
    return { t, score: 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxTools).map((s) => s.t);
}
function repairToolCallJson(raw) {
  if (!raw || !raw.trim()) return {};
  let s = String(raw).trim();
  try {
    return JSON.parse(s);
  } catch {
  }
  s = s.replace(/,\s*([}\]])/g, "$1");
  if (s.startsWith("{'") || s.includes("': '")) {
    s = s.replace(/'/g, '"').replace(/"\s*":\s*"/g, ': "').replace(/"\s*":\s*"/g, ': "');
  }
  s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');
  s = s.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function stepToolFilter(stepNumber) {
  if (stepNumber === 0) {
    return [
      "read_file",
      "list_dir",
      "search_files",
      "search_content",
      "web_search",
      "web_fetch",
      "system_info",
      "recall",
      "code_analysis",
      "get_file_info",
      "json_process",
      "text_tools",
      "timestamp_tools"
    ];
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  filterTools,
  repairToolCallJson,
  stepToolFilter
});
