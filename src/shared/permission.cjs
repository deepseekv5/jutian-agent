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

// src/shared/permission.ts
var permission_exports = {};
__export(permission_exports, {
  buildPermissionRequest: () => buildPermissionRequest,
  denialMessage: () => denialMessage,
  isOutsideWorkDir: () => isOutsideWorkDir,
  isSystemDir: () => isSystemDir
});
module.exports = __toCommonJS(permission_exports);

// src/shared/sensitiveOps.ts
var DESTRUCTIVE_TOOLS = {
  delete_file: "\u5220\u9664\u6587\u4EF6",
  move_file: "\u79FB\u52A8\u6587\u4EF6"
  // 移动会覆盖目标，且源路径消失
};
var DANGEROUS_CMD = [
  { re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, label: "\u9012\u5F52/\u5F3A\u5236\u5220\u9664" },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force)/i, label: "Git \u7834\u574F\u6027\u64CD\u4F5C" },
  // git_operation 工具传的是子命令（如 "reset --hard"），不带 git 前缀，
  // 因此这里同时匹配裸子命令形态
  { re: /(^|\s)(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force)/i, label: "Git \u7834\u574F\u6027\u64CD\u4F5C" },
  // Windows del/rd 的参数可任意顺序（del /f /s /q、del /s /f 都常见），
  // 只要出现 /s 或 /q 即视为递归/静默删除
  { re: /\b(del|rd|rmdir)\b[^\n]*\s\/[a-z]*[sq]/i, label: "Windows \u9012\u5F52\u5220\u9664" },
  { re: /\b(drop|truncate)\s+(table|database)/i, label: "\u6570\u636E\u5E93\u7834\u574F\u6027\u8BED\u53E5" },
  { re: /\b(shutdown|reboot|diskpart|mkfs)\b/i, label: "\u7CFB\u7EDF\u7EA7\u64CD\u4F5C" },
  { re: /\bchmod\s+-R\s+777\b/i, label: "\u5371\u9669\u7684\u6743\u9650\u53D8\u66F4" },
  { re: />\s*\/dev\/(sd|disk)/i, label: "\u76F4\u5199\u5757\u8BBE\u5907" }
];
function checkSensitiveTool(name, args) {
  if (!name) return null;
  const destructive = DESTRUCTIVE_TOOLS[name];
  if (destructive) return { label: destructive, level: "high" };
  if (name === "shell" || name === "git_operation") {
    const cmd = String(args?.command || "");
    for (const { re, label } of DANGEROUS_CMD) {
      if (re.test(cmd)) return { label, level: "high" };
    }
  }
  if (name === "write_file") {
    const content = String(args?.content ?? "");
    if (content === "") return { label: "\u6E05\u7A7A\u6587\u4EF6\u5185\u5BB9", level: "warn" };
  }
  return null;
}

// src/shared/permission.ts
var SYSTEM_DIRS = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/System",
  "/Library",
  "/var",
  "/boot",
  "/opt",
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\ProgramData"
];
function norm(p) {
  return String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
}
function isOutsideWorkDir(target, workDir) {
  if (!workDir) return false;
  const t = norm(target);
  const w = norm(workDir);
  if (!t) return false;
  if (!t.startsWith("/") && !/^[a-zA-Z]:\//.test(t)) return false;
  return !(t === w || t.startsWith(w + "/"));
}
function isSystemDir(target) {
  const t = norm(target);
  return SYSTEM_DIRS.some((d) => {
    const dd = norm(d);
    return t === dd || t.startsWith(dd + "/");
  });
}
function targetPathOf(tool, args) {
  const pick = (k) => typeof args[k] === "string" ? String(args[k]) : "";
  switch (tool) {
    case "write_file":
    case "edit_file":
    case "read_file":
    case "list_dir":
    case "delete_file":
    case "get_file_info":
      return pick("path");
    case "move_file":
      return pick("dest") || pick("src");
    default:
      return "";
  }
}
function buildPermissionRequest(id, tool, args, workDir = "") {
  const base = { id, tool, args };
  if (tool === "shell" || tool === "npm_run" || tool === "git_operation") {
    const cmd = String(args.command || args.script || args.args || "").trim();
    const hit2 = checkSensitiveTool(tool, args);
    if (hit2 && hit2.level === "high") {
      return {
        ...base,
        reason: "dangerous-command",
        risk: "dangerous",
        title: hit2.label,
        preview: cmd.slice(0, 300) || "(\u7A7A\u547D\u4EE4)",
        scopeKey: `cmd:${tool}:${hit2.label}`
      };
    }
    const sysHit = SYSTEM_DIRS.find((d) => cmd.includes(d));
    if (sysHit) {
      return {
        ...base,
        reason: "system-dir",
        risk: "dangerous",
        title: "\u547D\u4EE4\u6D89\u53CA\u7CFB\u7EDF\u76EE\u5F55",
        preview: cmd.slice(0, 300),
        scopeKey: `sys:${tool}:${sysHit}`
      };
    }
    return null;
  }
  const target = targetPathOf(tool, args);
  if (tool === "delete_file") {
    return {
      ...base,
      reason: "sensitive-tool",
      risk: "dangerous",
      title: "\u5220\u9664\u6587\u4EF6",
      preview: target || "(\u672A\u63D0\u4F9B\u8DEF\u5F84)",
      scopeKey: `del:${target}`
    };
  }
  if (tool === "move_file") {
    return {
      ...base,
      reason: "sensitive-tool",
      risk: "normal",
      title: "\u79FB\u52A8/\u91CD\u547D\u540D\u6587\u4EF6",
      preview: `${String(args.src || "")} \u2192 ${String(args.dest || "")}`,
      scopeKey: `mv:${target}`
    };
  }
  if (tool === "write_file" || tool === "edit_file") {
    if (isSystemDir(target)) {
      return {
        ...base,
        reason: "system-dir",
        risk: "dangerous",
        title: "\u4FEE\u6539\u7CFB\u7EDF\u76EE\u5F55\u6587\u4EF6",
        preview: target,
        scopeKey: `sysfile:${target}`
      };
    }
    if (isOutsideWorkDir(target, workDir)) {
      return {
        ...base,
        reason: "outside-cwd",
        risk: "normal",
        title: "\u4FEE\u6539\u5DE5\u4F5C\u76EE\u5F55\u4E4B\u5916\u7684\u6587\u4EF6",
        preview: target,
        scopeKey: `outside:${target}`
      };
    }
    if (tool === "write_file" && String(args.content ?? "") === "") {
      return {
        ...base,
        reason: "empty-overwrite",
        risk: "normal",
        title: "\u6E05\u7A7A\u6587\u4EF6\u5185\u5BB9",
        preview: target,
        scopeKey: `empty:${target}`
      };
    }
    return null;
  }
  const hit = checkSensitiveTool(tool, args);
  if (hit && hit.level === "high") {
    return {
      ...base,
      reason: "sensitive-tool",
      risk: "dangerous",
      title: hit.label,
      preview: JSON.stringify(args).slice(0, 300),
      scopeKey: `tool:${tool}`
    };
  }
  return null;
}
function denialMessage(req) {
  return JSON.stringify({
    ok: false,
    error: `\u3010\u7528\u6237\u62D2\u7EDD\u3011\u300C${req.title}\u300D\u9700\u8981\u7528\u6237\u786E\u8BA4\uFF0C\u7528\u6237\u672C\u6B21\u672A\u6279\u51C6\u3002\u8BF7\u6539\u7528\u975E\u7834\u574F\u6027\u65B9\u6848\uFF0C\u6216\u5148\u5411\u7528\u6237\u8BF4\u660E\u5C06\u8981\u505A\u4EC0\u4E48\u3001\u5F81\u5F97\u540C\u610F\u540E\u518D\u8BD5\u3002`
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildPermissionRequest,
  denialMessage,
  isOutsideWorkDir,
  isSystemDir
});
