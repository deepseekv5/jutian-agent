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
var shellGuard_exports = {};
__export(shellGuard_exports, {
  blockingMessage: () => blockingMessage,
  checkBlockingCommand: () => checkBlockingCommand
});
module.exports = __toCommonJS(shellGuard_exports);
const MITIGATED = /(^|\s)(&\s*$|&>|timeout\s|--yes\b|-y\b|--non-interactive\b|--no-input\b|CI=1\b|nohup\s)/i;
const EDITOR = /^\s*(sudo\s+)?(vim|vi|nvim|nano|pico|emacs|micro|less|more|most|man|info)\b/;
const REPL = /^\s*(sudo\s+)?(python3?|node|deno|bun|irb|iex|ghci|php)\s*(-i)?\s*$/;
const FOLLOWER = /^\s*(sudo\s+)?(tail\s+(-[a-zA-Z]*f|--follow)|journalctl\s+-f|dmesg\s+-w|watch\s)/;
const SERVER = /^\s*(sudo\s+)?(npm\s+(run\s+)?(dev|start|serve)|pnpm\s+(run\s+)?(dev|start)|yarn\s+(dev|start)|vite|next\s+dev|nuxt\s+dev|flask\s+run|uvicorn|gunicorn|nodemon|webpack\s+serve|http-server|python3?\s+-m\s+http\.server)/;
const SSH = /^\s*ssh\s+[^-][^\s]*\s*$/;
const HINTS = {
  editor: "\u4EA4\u4E92\u5F0F\u7F16\u8F91\u5668/\u5206\u9875\u5668\u65E0\u6CD5\u5728\u975E\u4EA4\u4E92\u73AF\u5883\u4F7F\u7528\u3002\u6539\u7528 read_file \u67E5\u770B\u5185\u5BB9\uFF0C\u6216\u7528 sed/head \u6253\u5370\u7247\u6BB5\u3002",
  repl: '\u88F8 REPL \u4F1A\u4E00\u76F4\u7B49\u5F85\u8F93\u5165\u3002\u6539\u7528 `python script.py` / `node script.js`\uFF0C\u6216 `-c "..."` \u76F4\u63A5\u6267\u884C\u4EE3\u7801\u3002',
  follower: "\u8BE5\u547D\u4EE4\u4F1A\u6301\u7EED\u8F93\u51FA\u4E0D\u8FD4\u56DE\u3002\u6539\u7528 `tail -n 100 \u6587\u4EF6` \u53D6\u4E00\u6B21\u5FEB\u7167\uFF0C\u9700\u8981\u6301\u7EED\u89C2\u5BDF\u65F6\u7528\u540E\u53F0\u8FD0\u884C\uFF08`... &`\uFF09\u3002",
  server: "\u5E38\u9A7B\u670D\u52A1\u4E0D\u4F1A\u9000\u51FA\u3002\u8BF7\u540E\u53F0\u542F\u52A8\uFF08`npm run dev > /tmp/dev.log 2>&1 &`\uFF09\u540E\u7528 sleep + tail \u8BFB\u65E5\u5FD7\uFF1B\u6784\u5EFA\u7C7B\u4EFB\u52A1\u7528 `npm run build`\u3002",
  ssh: '\u65E0\u547D\u4EE4\u7684 ssh \u4F1A\u8FDB\u5165\u4EA4\u4E92 shell\u3002\u8BF7\u5199\u6210 `ssh host "\u547D\u4EE4"` \u5F62\u5F0F\u3002'
};
function checkBlockingCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd) return { blocked: false };
  if (MITIGATED.test(cmd)) return { blocked: false };
  const tests = [
    ["editor", EDITOR],
    ["repl", REPL],
    ["follower", FOLLOWER],
    ["server", SERVER],
    ["ssh", SSH]
  ];
  for (const [kind, re] of tests) {
    if (re.test(cmd)) return { blocked: true, kind, hint: HINTS[kind] };
  }
  return { blocked: false };
}
function blockingMessage(result) {
  return `\u26A0\uFE0F \u8BE5\u547D\u4EE4\u4F1A\u963B\u585E\uFF08\u4E0D\u4F1A\u81EA\u884C\u7ED3\u675F\uFF09\uFF0C\u5DF2\u8DF3\u8FC7\u6267\u884C\u4EE5\u514D\u7A7A\u7B49 180 \u79D2\u3002
${result.hint || ""}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  blockingMessage,
  checkBlockingCommand
});
