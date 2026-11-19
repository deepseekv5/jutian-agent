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

// src/shared/superCore.ts
var superCore_exports = {};
__export(superCore_exports, {
  createAdaptationEngine: () => createAdaptationEngine,
  runSuperLoop: () => runSuperLoop,
  summarizeTrace: () => summarizeTrace
});
module.exports = __toCommonJS(superCore_exports);

// src/shared/super/signals/extractor.ts
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isAsciiKeyword(keyword) {
  return /^[a-z0-9]/i.test(keyword) && /^[a-z0-9+#.\-_ /]+$/i.test(keyword) && /[a-z]/i.test(keyword);
}
function compileKeywords(keywords) {
  return keywords.map((keyword) => {
    const escaped = escapeRegExp(keyword);
    if (isAsciiKeyword(keyword)) {
      const head = "(?<![a-z0-9])";
      const tail = /[a-z0-9]$/i.test(keyword) ? "(?![a-z0-9])" : "";
      return new RegExp(`${head}${escaped}${tail}`, "i");
    }
    return new RegExp(escaped, "i");
  });
}
function matchesAny(patterns, text) {
  if (!text) return false;
  return patterns.some((re) => re.test(text));
}
function countPattern(pattern, text) {
  if (!text) return 0;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  const found = text.match(global);
  return found ? found.length : 0;
}
function countAny(patterns, text) {
  if (!text) return 0;
  let total = 0;
  for (const re of patterns) total += countPattern(re, text);
  return total;
}
var CODE_KEYWORDS = [
  // 英文：定义与声明
  "function",
  "def",
  "class",
  "interface",
  "enum",
  "struct",
  "trait",
  "impl",
  "typedef",
  "type alias",
  "namespace",
  "module",
  "package",
  // 英文：导入导出与依赖
  "import",
  "export",
  "require",
  "from",
  "dependency",
  "dependencies",
  // 英文：变量与控制流
  "const",
  "let",
  "var",
  "return",
  "async",
  "await",
  "promise",
  "callback",
  "lambda",
  "closure",
  "generator",
  "yield",
  "try",
  "catch",
  "throw",
  "finally",
  "if else",
  "switch case",
  "for loop",
  "while loop",
  "foreach",
  // 英文：类型与 OOP
  "public",
  "private",
  "protected",
  "static",
  "abstract",
  "virtual",
  "override",
  "extends",
  "implements",
  "generic",
  "template",
  "inheritance",
  "polymorphism",
  "encapsulation",
  "constructor",
  "destructor",
  "this",
  "super",
  // 英文：其他语言要素
  "null",
  "undefined",
  "boolean",
  "integer",
  "float",
  "string",
  "array",
  "object",
  "dictionary",
  "hashmap",
  "list",
  "tuple",
  "set",
  "regex",
  "regular expression",
  "json",
  "xml",
  "yaml",
  "sql query",
  "api call",
  "http request",
  "algorithm",
  "complexity",
  "time complexity",
  "space complexity",
  "recursion",
  "memoization",
  "sort",
  "search algorithm",
  "binary search",
  "dynamic programming",
  // 英文：工程动作
  "refactor",
  "compile",
  "build",
  "debug",
  "stack trace",
  "unit test",
  "source code",
  "codebase",
  "code snippet",
  "pseudocode",
  "git commit",
  // 中文：定义与结构
  "\u51FD\u6570",
  "\u65B9\u6CD5",
  "\u7C7B",
  "\u63A5\u53E3",
  "\u679A\u4E3E",
  "\u7ED3\u6784\u4F53",
  "\u547D\u540D\u7A7A\u95F4",
  "\u6A21\u5757",
  "\u5305",
  "\u53D8\u91CF",
  "\u5E38\u91CF",
  "\u53C2\u6570",
  "\u8FD4\u56DE\u503C",
  "\u95ED\u5305",
  "\u9012\u5F52",
  "\u5FAA\u73AF",
  "\u6570\u7EC4",
  "\u5BF9\u8C61",
  "\u5B57\u7B26\u4E32",
  "\u5E03\u5C14",
  "\u6574\u6570",
  "\u6D6E\u70B9",
  "\u5B57\u5178",
  "\u5217\u8868",
  "\u5143\u7EC4",
  "\u96C6\u5408",
  // 中文：语言特性
  "\u7EE7\u627F",
  "\u591A\u6001",
  "\u5C01\u88C5",
  "\u62BD\u8C61",
  "\u6CDB\u578B",
  "\u6A21\u677F",
  "\u88C5\u9970\u5668",
  "\u6CE8\u89E3",
  "\u6784\u9020\u51FD\u6570",
  "\u9759\u6001",
  "\u79C1\u6709",
  "\u516C\u6709",
  "\u5F02\u5E38\u5904\u7406",
  "\u6355\u83B7\u5F02\u5E38",
  "\u6B63\u5219\u8868\u8FBE\u5F0F",
  "\u9762\u5411\u5BF9\u8C61",
  // 中文：工程动作
  "\u4EE3\u7801",
  "\u6E90\u7801",
  "\u4EE3\u7801\u7247\u6BB5",
  "\u4F2A\u4EE3\u7801",
  "\u7B97\u6CD5",
  "\u65F6\u95F4\u590D\u6742\u5EA6",
  "\u7A7A\u95F4\u590D\u6742\u5EA6",
  "\u91CD\u6784",
  "\u7F16\u8BD1",
  "\u8C03\u8BD5",
  "\u8C03\u7528\u6808",
  "\u5355\u5143\u6D4B\u8BD5",
  "\u5199\u4EE3\u7801",
  "\u5199\u51FD\u6570",
  "\u5B9E\u73B0"
];
var CODE_STRUCTURE_PATTERNS = [
  /```[\s\S]*?```/,
  // Markdown 代码块
  /```/,
  // 未闭合的代码围栏也算
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/i,
  // JS function foo(
  /\basync\s+function\s+[A-Za-z_$][\w$]*\s*\(/i,
  // async function
  /\bdef\s+[A-Za-z_][\w]*\s*\(/i,
  // Python def foo(
  /\bclass\s+[A-Za-z_][\w]*[\s(:]/i,
  // class Foo: / class Foo {
  /\b(interface|enum|struct|trait|impl)\s+[A-Za-z_][\w]*/i,
  /\bimport\s+(?:\{[^}]*\}|[\w*]+|\([^)]*\))\s+from\s+['"]/i,
  /\bimport\s+['"][^'"]+['"]/i,
  /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/i,
  /\bfrom\s+['"][^'"]+['"]\s+import\b/i,
  /\bexport\s+(?:default|const|function|class|interface|type|\{)/i,
  /\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/i,
  /\b[A-Za-z_$][\w$]*\s*=>\s*[({\w'"`]/,
  // 箭头函数
  /\breturn\s+[^\s;]{1,80}/i,
  /\btry\s*\{[\s\S]{0,400}?\}\s*catch\b/i,
  /\bnew\s+[A-Z][\w$]*(?:\(|\s)/,
  /<\/?[A-Za-z][\w-]*(?:\s[^<>]{0,80})?>/,
  // JSX / HTML 标签
  /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+[\w*`,\s]+\s+FROM\b/i,
  /\b(?:public|private|protected|static)\s+[\w<>,]+\s+[\w]+\s*\(/i,
  /\b(?:console\.(?:log|error|warn|debug)|print\s*\(|println\s*\()/i,
  /\b(?:npm|yarn|pnpm|pip|pip3|cargo|go\s+(?:mod|build|run))\s+[\w-]+/i,
  /\bgit\s+(?:clone|commit|push|pull|checkout|merge|rebase)\b/i,
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|swift|cpp|cc|cxx|c|h|hpp|rb|php|pl|sh|bash|sql|vue|svelte)\b/i,
  /\b(?:TODO|FIXME|HACK|XXX)\b/
];
var FILE_OP_KEYWORDS = [
  // 英文：基础 CRUD
  "read",
  "write",
  "edit",
  "modify",
  "change",
  "create",
  "make",
  "new file",
  "open",
  "close",
  "save",
  "save as",
  "rename",
  "move",
  "copy",
  "paste",
  "delete",
  "remove",
  "erase",
  "unlink",
  "destroy",
  "wipe",
  "truncate",
  // 英文：目录与路径
  "folder",
  "directory",
  "path",
  "mkdir",
  "rmdir",
  "rm -r",
  "touch",
  "list files",
  "list directory",
  "browse files",
  "traverse",
  // 英文：内容操作
  "append",
  "insert",
  "overwrite",
  "prepend",
  "replace",
  "update file",
  "rewrite",
  "patch",
  "duplicate",
  "clone file",
  "file content",
  "upload",
  "download",
  "load file",
  "dump file",
  "export file",
  "import file",
  "serialize",
  "deserialize",
  "parse file",
  "write to file",
  "read from file",
  // 英文：文件类型名词（帮助识别「操作对象」）
  "text file",
  "config file",
  "source file",
  "log file",
  "binary file",
  "temp file",
  "cache file",
  "lock file",
  "zip file",
  "archive",
  // 中文：读取
  "\u8BFB\u53D6",
  "\u8BFB",
  "\u8F7D\u5165",
  "\u52A0\u8F7D",
  "\u6253\u5F00\u6587\u4EF6",
  "\u6253\u5F00",
  "\u67E5\u770B\u6587\u4EF6",
  "\u6D4F\u89C8\u6587\u4EF6",
  // 中文：写入
  "\u5199\u5165",
  "\u5199",
  "\u4FDD\u5B58",
  "\u53E6\u5B58",
  "\u53E6\u5B58\u4E3A",
  "\u5199\u5165\u6587\u4EF6",
  "\u5BFC\u51FA\u6587\u4EF6",
  "\u843D\u76D8",
  // 中文：修改
  "\u7F16\u8F91",
  "\u4FEE\u6539",
  "\u6539\u52A8",
  "\u6539",
  "\u6539\u5199",
  "\u91CD\u5199",
  "\u66F4\u65B0\u6587\u4EF6",
  "\u66FF\u6362",
  "\u8FFD\u52A0",
  "\u63D2\u5165",
  "\u8986\u76D6",
  "\u91CD\u547D\u540D",
  "\u6539\u540D",
  "\u8C03\u6574\u6587\u4EF6",
  "\u6574\u7406\u6587\u4EF6",
  // 中文：删除
  "\u5220\u9664",
  "\u5220\u6389",
  "\u5220",
  "\u79FB\u9664",
  "\u6E05\u9664",
  "\u6E05\u7A7A",
  "\u5220\u5E93",
  "\u5220\u9664\u6587\u4EF6",
  "\u5220\u9664\u76EE\u5F55",
  // 中文：创建
  "\u521B\u5EFA",
  "\u65B0\u5EFA",
  "\u5EFA\u7ACB",
  "\u521B\u5EFA\u6587\u4EF6",
  "\u65B0\u5EFA\u6587\u4EF6",
  "\u521B\u5EFA\u76EE\u5F55",
  "\u65B0\u5EFA\u6587\u4EF6\u5939",
  // 中文：复制移动与其他
  "\u590D\u5236",
  "\u62F7\u8D1D",
  "\u7C98\u8D34",
  "\u79FB\u52A8",
  "\u526A\u5207",
  "\u4E0A\u4F20",
  "\u4E0B\u8F7D",
  "\u89E3\u538B",
  "\u538B\u7F29",
  "\u904D\u5386\u76EE\u5F55",
  "\u5217\u51FA\u6587\u4EF6",
  "\u67E5\u627E\u6587\u4EF6",
  "\u6587\u4EF6\u8DEF\u5F84",
  "\u6587\u4EF6\u540D",
  "\u76EE\u5F55",
  "\u6587\u4EF6\u5939"
];
var SHELL_KEYWORDS = [
  // 解释器与终端
  "bash",
  "zsh",
  "fish",
  "shell",
  "terminal",
  "console",
  "powershell",
  "cmd.exe",
  "command line",
  "\u547D\u4EE4\u884C",
  "\u7EC8\u7AEF",
  "\u63A7\u5236\u53F0",
  "\u811A\u672C",
  "\u6267\u884C\u811A\u672C",
  "shell script",
  "batch script",
  "\u6279\u5904\u7406",
  // 包管理器 / 语言工具链
  "npm",
  "yarn",
  "pnpm",
  "npx",
  "bun",
  "pip",
  "pip3",
  "conda",
  "poetry",
  "cargo",
  "rustc",
  "go build",
  "go run",
  "go mod",
  "go install",
  "mvn",
  "gradle",
  "composer",
  "gem install",
  "dotnet",
  "makefile",
  // 容器与编排
  "docker",
  "docker-compose",
  "dockerfile",
  "kubectl",
  "helm",
  "container",
  "\u5BB9\u5668",
  "\u7F16\u6392",
  "\u955C\u50CF",
  // 版本控制与网络
  "git clone",
  "git commit",
  "git push",
  "git pull",
  "git status",
  "git log",
  "curl",
  "wget",
  "httpie",
  "ssh",
  "scp",
  "rsync",
  "ping",
  "netstat",
  // 系统命令
  "sudo",
  "su -",
  "chmod",
  "chown",
  "chgrp",
  "systemctl",
  "crontab",
  "ls -",
  "pwd",
  "cd ",
  "mkdir",
  "rm ",
  "rm -f",
  "cp ",
  "mv ",
  "cat ",
  "grep",
  "awk",
  "sed",
  "find .",
  "xargs",
  "head ",
  "tail ",
  "sort ",
  "tar ",
  "gzip",
  "unzip",
  "zip ",
  "make ",
  "cmake",
  "touch ",
  "env ",
  "export ",
  "source ",
  "ps aux",
  "kill -",
  "top ",
  "df -",
  "du -",
  // 操作符（作为正则子串出现，通常伴随真实命令）
  "&&",
  "||",
  "| grep",
  ">>",
  "2>&1",
  "./",
  "../"
];
var RESEARCH_KEYWORDS = [
  // 英文
  "search",
  "search for",
  "google",
  "bing",
  "duckduckgo",
  "yahoo",
  "lookup",
  "look up",
  "find out",
  "research",
  "investigate",
  "explore",
  "browse",
  "fetch",
  "crawl",
  "scrape",
  "spider",
  "query the web",
  "web search",
  "online search",
  "find information",
  "gather information",
  "fact-check",
  "cross-check",
  "source",
  "reference",
  "citation",
  "bibliography",
  "documentation",
  "docs",
  "paper",
  "publication",
  "wikipedia",
  "wiki",
  "forum",
  "stackoverflow",
  "github issue",
  "news",
  "headline",
  "article",
  "blog post",
  "tutorial",
  "guide",
  "specification",
  "rfc",
  "whitepaper",
  "competitor",
  "market research",
  "survey",
  "benchmark",
  "case study",
  "recent",
  "latest news",
  "discover",
  "learn about",
  "what is",
  "how to",
  // 中文
  "\u641C\u7D22",
  "\u641C\u4E00\u4E0B",
  "\u641C\u641C",
  "\u67E5\u627E",
  "\u67E5\u4E00\u4E0B",
  "\u67E5\u67E5",
  "\u68C0\u7D22",
  "\u67E5\u8BE2",
  "\u8C03\u7814",
  "\u7814\u7A76",
  "\u8C03\u67E5",
  "\u4E86\u89E3",
  "\u63A2\u5BFB",
  "\u63A2\u7A76",
  "\u641C\u96C6",
  "\u6536\u96C6\u8D44\u6599",
  "\u627E\u8D44\u6599",
  "\u67E5\u8D44\u6599",
  "\u8D44\u6599",
  "\u6587\u732E",
  "\u8BBA\u6587",
  "\u51FA\u5904",
  "\u6765\u6E90",
  "\u67E5\u8BC1",
  "\u6838\u5B9E",
  "\u7F51\u9875",
  "\u7F51\u7AD9",
  "\u5728\u7EBF",
  "\u7F51\u4E0A",
  "\u4E92\u8054\u7F51",
  "\u7F51\u7EDC",
  "\u8C37\u6B4C",
  "\u767E\u5EA6",
  "\u5FC5\u5E94",
  "\u7EF4\u57FA",
  "\u767E\u79D1",
  "\u5B98\u65B9\u6587\u6863",
  "\u53C2\u8003\u6587\u6863",
  "\u6559\u7A0B",
  "\u6307\u5357",
  "\u89C4\u8303",
  "\u6807\u51C6",
  "\u7ADE\u54C1",
  "\u5E02\u573A",
  "\u73B0\u72B6",
  "\u65B0\u95FB",
  "\u6700\u65B0\u6D88\u606F",
  "\u8D44\u8BAF",
  "\u62A5\u9053",
  "\u8BBA\u575B",
  "\u5E16\u5B50"
];
var CREATIVE_KEYWORDS = [
  // 英文
  "write a poem",
  "write a story",
  "write an article",
  "poem",
  "poetry",
  "story",
  "short story",
  "novel",
  "fiction",
  "fictional",
  "narrative",
  "screenplay",
  "script",
  "lyrics",
  "song",
  "compose",
  "melody",
  "music",
  "draw",
  "drawing",
  "paint",
  "painting",
  "sketch",
  "illustrate",
  "illustration",
  "image generation",
  "generate an image",
  "generate image",
  "create an image",
  "picture",
  "artwork",
  "art",
  "poster",
  "logo design",
  "design a",
  "creative",
  "imagine",
  "imaginative",
  "character",
  "worldbuilding",
  "plot",
  "metaphor",
  "rhyme",
  "slogan",
  "tagline",
  "brainstorm ideas",
  "\u5E7F\u544A\u8BED",
  "\u6587\u6848",
  // 中文
  "\u521B\u4F5C",
  "\u5199\u8BD7",
  "\u4F5C\u8BD7",
  "\u8BD7",
  "\u8BD7\u6B4C",
  "\u6563\u6587",
  "\u5199\u6545\u4E8B",
  "\u6545\u4E8B",
  "\u5C0F\u8BF4",
  "\u5267\u672C",
  "\u53F0\u8BCD",
  "\u6B4C\u8BCD",
  "\u4F5C\u8BCD",
  "\u4F5C\u66F2",
  "\u7F16\u66F2",
  "\u65CB\u5F8B",
  "\u5199\u6B4C",
  "\u753B\u753B",
  "\u7ED8\u753B",
  "\u753B\u4E00\u5E45",
  "\u753B\u4E00\u5F20",
  "\u7ED8\u56FE",
  "\u753B\u56FE",
  "\u751F\u6210\u56FE\u7247",
  "\u751F\u6210\u56FE\u50CF",
  "\u751F\u6210\u4E00\u5F20\u56FE",
  "\u63D2\u753B",
  "\u6F2B\u753B",
  "\u6D77\u62A5",
  "logo",
  "\u6807\u5FD7\u8BBE\u8BA1",
  "\u5934\u50CF",
  "\u58C1\u7EB8",
  "\u521B\u610F",
  "\u60F3\u8C61",
  "\u865A\u6784",
  "\u89D2\u8272",
  "\u573A\u666F\u63CF\u5199",
  "\u60C5\u8282",
  "\u8BBE\u5B9A",
  "\u53D6\u540D",
  "\u8D77\u540D",
  "\u6807\u8BED",
  "\u53E3\u53F7",
  "\u5E7F\u544A\u8BCD",
  "\u6587\u6848",
  "\u6DA6\u8272",
  "\u4EFF\u5199",
  "\u7EED\u5199"
];
var DATA_KEYWORDS = [
  // 英文：动作
  "analyze",
  "analyse",
  "analysis",
  "statistical",
  "statistics",
  "aggregate",
  "aggregation",
  "group by",
  "pivot",
  "summarize",
  "summarise",
  "visualize",
  "visualise",
  "visualization",
  "plot",
  "chart",
  "graph",
  "histogram",
  "scatter plot",
  "bar chart",
  "line chart",
  "pie chart",
  "dashboard",
  // 英文：数据对象与工具
  "dataset",
  "data set",
  "dataframe",
  "data frame",
  "pandas",
  "numpy",
  "scipy",
  "sklearn",
  "scikit-learn",
  "matplotlib",
  "seaborn",
  "tableau",
  "csv",
  "excel",
  "spreadsheet",
  "xlsx",
  "parquet",
  "json data",
  "sql query",
  "database query",
  "data warehouse",
  "data pipeline",
  "etl",
  // 英文：统计方法
  "regression",
  "clustering",
  "cluster analysis",
  "classification",
  "prediction",
  "predict",
  "forecast",
  "trend",
  "correlation",
  "distribution",
  "probability",
  "variance",
  "standard deviation",
  "mean",
  "median",
  "mode",
  "percentile",
  "outlier",
  "sampling",
  "sample",
  "hypothesis test",
  "machine learning",
  "training model",
  "feature engineering",
  "cross validation",
  "metric",
  "kpi",
  "a/b test",
  "cohort",
  "funnel",
  // 中文：动作
  "\u5206\u6790",
  "\u6570\u636E\u5206\u6790",
  "\u7EDF\u8BA1\u5206\u6790",
  "\u7EDF\u8BA1",
  "\u6C47\u603B",
  "\u805A\u5408",
  "\u5206\u7EC4",
  "\u900F\u89C6",
  "\u53EF\u89C6\u5316",
  "\u753B\u56FE",
  "\u7ED8\u5236\u56FE\u8868",
  "\u753B\u56FE\u8868",
  "\u751F\u6210\u62A5\u8868",
  "\u505A\u62A5\u8868",
  "\u5EFA\u6A21",
  // 中文：对象
  "\u6570\u636E",
  "\u6570\u636E\u96C6",
  "\u6570\u636E\u6E90",
  "\u6570\u636E\u8868",
  "\u8868\u683C",
  "\u7535\u5B50\u8868\u683C",
  "\u62A5\u8868",
  "\u6307\u6807",
  "\u7EF4\u5EA6",
  "\u5EA6\u91CF",
  "\u5B57\u6BB5",
  "\u6837\u672C",
  "\u8BAD\u7EC3\u96C6",
  "\u6D4B\u8BD5\u96C6",
  "\u7279\u5F81",
  // 中文：方法与图表
  "\u56DE\u5F52",
  "\u805A\u7C7B",
  "\u5206\u7C7B",
  "\u9884\u6D4B",
  "\u8D8B\u52BF",
  "\u76F8\u5173\u6027",
  "\u5206\u5E03",
  "\u6982\u7387",
  "\u65B9\u5DEE",
  "\u5E73\u5747\u503C",
  "\u4E2D\u4F4D\u6570",
  "\u6C42\u548C",
  "\u8BA1\u6570",
  "\u5206\u4F4D\u6570",
  "\u5F02\u5E38\u503C",
  "\u62BD\u6837",
  "\u5047\u8BBE\u68C0\u9A8C",
  "\u673A\u5668\u5B66\u4E60",
  "\u67F1\u72B6\u56FE",
  "\u6298\u7EBF\u56FE",
  "\u997C\u56FE",
  "\u6563\u70B9\u56FE",
  "\u76F4\u65B9\u56FE",
  "\u6F0F\u6597",
  "\u8F6C\u5316",
  "\u540C\u6BD4\u589E\u957F",
  "\u73AF\u6BD4",
  "\u7559\u5B58",
  "csv",
  "excel",
  "xlsx"
];
var MULTI_STEP_KEYWORDS = [
  // 中文：序数步骤
  "\u6B65\u9AA4",
  "\u7B2C\u4E00\u6B65",
  "\u7B2C\u4E8C\u6B65",
  "\u7B2C\u4E09\u6B65",
  "\u7B2C\u56DB\u6B65",
  "\u7B2C\u4E94\u6B65",
  "\u6B65\u9AA4\u4E00",
  "\u6B65\u9AA4\u4E8C",
  "\u7B2C\u4E00\u6B65\u5148",
  "\u6700\u540E\u4E00\u6B65",
  "\u6BCF\u4E00\u6B65",
  // 中文：顺序连接词
  "\u9996\u5148",
  "\u5176\u6B21",
  "\u518D\u6B21",
  "\u7136\u540E",
  "\u63A5\u7740",
  "\u968F\u540E",
  "\u4E4B\u540E",
  "\u6700\u540E",
  "\u6700\u7EC8",
  "\u5148",
  "\u518D",
  "\u540E",
  "\u540C\u65F6",
  "\u7D27\u63A5\u7740",
  "\u63A5\u4E0B\u6765",
  "\u968F\u540E\u518D",
  "\u4F9D\u6B21",
  "\u9010\u6B65",
  "\u4E00\u8FB9",
  "\u4E00\u8FB9",
  "\u5728\u6B64\u57FA\u7840\u4E4B\u4E0A",
  "\u5728\u6B64\u57FA\u7840\u4E0A",
  "\u5B8C\u6210\u4E0A\u8FF0",
  "\u5B8C\u6210\u4E0A\u8FF0\u540E",
  // 中文：流程名词
  "\u5206\u6B65\u9AA4",
  "\u5206\u9636\u6BB5",
  "\u9636\u6BB5",
  "\u6D41\u7A0B",
  "\u6D41\u6C34\u7EBF",
  "\u73AF\u8282",
  "\u987A\u5E8F",
  "\u6B21\u5E8F",
  "\u62C6\u89E3",
  "\u5206\u89E3",
  "\u9012\u8FDB",
  "\u5206\u6B65\u6267\u884C",
  // 英文
  "first",
  "secondly",
  "second",
  "third",
  "thirdly",
  "then",
  "next",
  "after that",
  "afterwards",
  "subsequently",
  "finally",
  "lastly",
  "step by step",
  "step-by-step",
  "steps",
  "in steps",
  "sequentially",
  "in order",
  "in sequence",
  "phase",
  "phased",
  "stage",
  "stages",
  "workflow",
  "pipeline",
  "meanwhile",
  "once done",
  "after completing",
  "before that",
  "at each stage",
  "progressively"
];
var MULTI_STEP_STRUCTURE_PATTERNS = [
  /第[一二三四五六七八九十百两\d]+步/g,
  /步骤[一二三四五六七八九十百两\d]+/g,
  /(?:^|[\s。；;，,])[一二三四五六七八九十\d]{1,3}[.、)）]/gm,
  /\bstep\s*[-#]?\s*\d{1,3}\b/gi,
  /先[^。；;\n]{1,60}再/s,
  /先[^。；;\n]{1,60}后/s,
  /(?:^|\n)\s*[-*•]\s+\S/gm,
  /\b(?:1st|2nd|3rd|4th|5th)\b/gi,
  /\b(?:first|second|third|fourth|fifth)\b(?=\s*[,:.)])/gi
];
var GOAL_LOOP_KEYWORDS = [
  // 中文
  "\u5B8C\u6210",
  "\u505A\u5B8C",
  "\u505A\u5B8C\u4E3A\u6B62",
  "\u641E\u5B9A",
  "\u5F04\u597D",
  "\u76F4\u5230",
  "\u76F4\u81F3",
  "\u4E00\u76F4\u5230",
  "\u81EA\u52A8",
  "\u81EA\u52A8\u5316",
  "\u81EA\u52A8\u5B8C\u6210",
  "\u5168\u90E8",
  "\u6240\u6709",
  "\u6BCF\u4E00\u4E2A",
  "\u6BCF\u4E2A",
  "\u5F7B\u5E95",
  "\u5B8C\u5168",
  "\u5168\u7A0B",
  "\u95ED\u73AF",
  "\u81EA\u5DF1",
  "\u81EA\u4E3B",
  "\u81EA\u884C",
  "\u4E3B\u52A8",
  "\u7AEF\u5230\u7AEF",
  "\u4E00\u6C14\u5475\u6210",
  "\u53CD\u590D",
  "\u6301\u7EED",
  "\u4E00\u76F4",
  "\u4E0D\u65AD",
  "\u5FAA\u73AF",
  "\u8FED\u4EE3",
  "\u8FED\u4EE3\u5230",
  "\u786E\u4FDD",
  "\u786E\u4FDD\u5168\u90E8",
  "\u5168\u90E8\u5B8C\u6210",
  "\u6700\u7EC8\u5B8C\u6210",
  "\u4E0D\u8FBE\u76EE\u7684",
  "\u76F4\u5230\u6210\u529F",
  "\u5C3D\u53EF\u80FD",
  "\u5C3D\u529B",
  "\u52A1\u5FC5",
  "\u4E00\u5B9A",
  "\u4FDD\u8BC1",
  "\u8D1F\u8D23\u5230\u5E95",
  "\u5168\u7A0B\u8D1F\u8D23",
  // 英文
  "finish",
  "finish it",
  "complete",
  "complete it",
  "until",
  "till",
  "until done",
  "automatically",
  "auto",
  "automate",
  "automated",
  "all",
  "all of them",
  "every",
  "each",
  "entire",
  "whole",
  "end-to-end",
  "autonomously",
  "autonomous",
  "on your own",
  "by yourself",
  "loop",
  "iterate",
  "iteration",
  "repeatedly",
  "continuously",
  "keep going",
  "ensure",
  "make sure",
  "ultimately",
  "thorough",
  "thoroughly",
  "final result",
  "to the end",
  "no matter what",
  "get it done"
];
var PLANNING_KEYWORDS = [
  // 中文
  "\u8BA1\u5212",
  "\u65B9\u6848",
  "\u8BBE\u8BA1",
  "\u67B6\u6784",
  "\u89C4\u5212",
  "\u7B56\u7565",
  "\u84DD\u56FE",
  "\u8DEF\u7EBF\u56FE",
  "\u5236\u5B9A",
  "\u62DF\u5B9A",
  "\u5927\u7EB2",
  "\u63D0\u7EB2",
  "\u6846\u67B6",
  "\u7ED3\u6784\u8BBE\u8BA1",
  "\u67B6\u6784\u8BBE\u8BA1",
  "\u6280\u672F\u65B9\u6848",
  "\u5B9E\u65BD\u65B9\u6848",
  "\u89C4\u5212\u4E00\u4E0B",
  "\u505A\u4E2A\u8BA1\u5212",
  "\u5148\u89C4\u5212",
  "\u62C6\u89E3\u4EFB\u52A1",
  "\u4EFB\u52A1\u5206\u89E3",
  "\u6392\u671F",
  "\u91CC\u7A0B\u7891",
  "\u76EE\u6807",
  "\u5206\u9636\u6BB5",
  "\u5206\u6B65\u9AA4",
  "\u9876\u5C42\u8BBE\u8BA1",
  "\u7EDF\u7B79",
  "\u5E03\u5C40",
  "\u63A8\u6F14",
  "\u8BBE\u60F3",
  "\u6784\u601D",
  // 英文
  "plan",
  "planning",
  "a plan",
  "design",
  "architecture",
  "strategy",
  "roadmap",
  "blueprint",
  "outline",
  "scheme",
  "proposal",
  "structure",
  "framework",
  "approach",
  "breakdown",
  "task breakdown",
  "milestone",
  "schedule",
  "organize",
  "lay out",
  "draft a plan",
  "think through",
  "architect",
  "high-level design",
  "low-level design",
  "staging",
  " phased",
  "decompose",
  "decomposition",
  "design doc",
  "rfc"
];
var VERIFICATION_KEYWORDS = [
  // 中文
  "\u6D4B\u8BD5",
  "\u6D4B\u8BD5\u4E00\u4E0B",
  "\u9A8C\u8BC1",
  "\u9A8C\u8BC1\u4E00\u4E0B",
  "\u68C0\u67E5",
  "\u68C0\u67E5\u4E00\u4E0B",
  "\u6821\u9A8C",
  "\u6838\u5BF9",
  "\u590D\u6838",
  "\u5BA1\u67E5",
  "\u8FD0\u884C",
  "\u8FD0\u884C\u4E00\u4E0B",
  "\u8C03\u8BD5",
  "\u6392\u67E5",
  "\u786E\u8BA4",
  "\u8BD5\u8FD0\u884C",
  "\u8DD1\u4E00\u4E0B",
  "\u8DD1\u4E00\u904D",
  "\u5355\u6D4B",
  "\u5355\u5143\u6D4B\u8BD5",
  "\u96C6\u6210\u6D4B\u8BD5",
  "\u56DE\u5F52\u6D4B\u8BD5",
  "\u7AEF\u5230\u7AEF\u6D4B\u8BD5",
  "\u81EA\u68C0",
  "\u9A8C\u6536",
  "\u770B\u770B\u7ED3\u679C",
  "\u786E\u4FDD\u6B63\u786E",
  "\u590D\u67E5",
  "\u6D4B\u8BD5\u901A\u8FC7",
  "\u8DD1\u6D4B\u8BD5",
  // 英文
  "test",
  "tests",
  "testing",
  "verify",
  "verification",
  "validate",
  "validation",
  "check",
  "checking",
  "run",
  "running",
  "debug",
  "debugging",
  "execute",
  "inspect",
  "review",
  "confirm",
  "sanity check",
  "unit test",
  "integration test",
  "e2e test",
  "regression",
  "build",
  "compile",
  "lint",
  "try it",
  "try out",
  "dry run",
  "smoke test",
  "assert",
  "assertion",
  "ensure correct",
  "proofread",
  "proofreading",
  "double-check",
  "cross-check",
  "test suite",
  "test case",
  "coverage",
  "pass all tests"
];
var TIME_SENSITIVE_KEYWORDS = [
  // 中文
  "\u4ECA\u5929",
  "\u4ECA\u65E5",
  "\u4ECA\u5929\u4E4B\u5185",
  "\u4ECA\u660E\u4E24\u5929",
  "\u73B0\u5728",
  "\u6B64\u523B",
  "\u7ACB\u523B",
  "\u9A6C\u4E0A",
  "\u7ACB\u5373",
  "\u5373\u523B",
  "\u5C3D\u5FEB",
  "\u5B9E\u65F6",
  "\u5373\u65F6",
  "\u540C\u6B65",
  "\u6700\u65B0",
  "\u6700\u65B0\u7684",
  "\u521A\u521A",
  "\u521A\u624D",
  "\u5F53\u524D",
  "\u76EE\u524D",
  "\u8FD1\u65E5",
  "\u8FD1\u671F",
  "\u672C\u5468",
  "\u8FD9\u5468",
  "\u9650\u65F6",
  "\u7D27\u6025",
  "\u52A0\u6025",
  "\u622A\u6B62",
  "\u671F\u9650",
  " deadline",
  "\u9A6C\u4E0A\u8981",
  // 英文
  "today",
  "today's",
  "now",
  "right now",
  "immediately",
  "at once",
  "instantly",
  "asap",
  "urgent",
  "urgently",
  "realtime",
  "real-time",
  "live",
  "latest",
  "up-to-date",
  "up to date",
  "current",
  "currently",
  "recent",
  "recently",
  "just now",
  "this week",
  "tonight",
  "deadline",
  "breaking",
  "hot",
  "fresh",
  "time-sensitive",
  "time sensitive"
];
var HIGH_RISK_KEYWORDS = [
  // ── 破坏性操作 ──
  { keyword: "\u5220\u9664", category: "destructive", weight: 1.5 },
  { keyword: "\u5220\u6389", category: "destructive", weight: 1.5 },
  { keyword: "\u5220\u5E93", category: "destructive", weight: 2 },
  { keyword: "\u5220\u6587\u4EF6", category: "destructive", weight: 1.5 },
  { keyword: "\u6E05\u7A7A", category: "destructive", weight: 1.5 },
  { keyword: "\u6E05\u9664", category: "destructive", weight: 1.2 },
  { keyword: "\u683C\u5F0F\u5316", category: "destructive", weight: 2 },
  { keyword: "\u8986\u76D6", category: "destructive", weight: 1.2 },
  { keyword: "\u5378\u8F7D", category: "destructive", weight: 1.3 },
  { keyword: "\u79FB\u9664", category: "destructive", weight: 1 },
  { keyword: "\u9500\u6BC1", category: "destructive", weight: 2 },
  { keyword: "\u62B9\u6389", category: "destructive", weight: 1.8 },
  { keyword: "\u56DE\u6EDA", category: "destructive", weight: 1 },
  { keyword: "reset --hard", category: "destructive", weight: 1.8 },
  { keyword: "rm -rf", category: "destructive", weight: 2 },
  { keyword: "rm -r", category: "destructive", weight: 1.6 },
  { keyword: "drop table", category: "destructive", weight: 2 },
  { keyword: "delete", category: "destructive", weight: 1.5 },
  { keyword: "drop", category: "destructive", weight: 1.5 },
  { keyword: "truncate", category: "destructive", weight: 1.6 },
  { keyword: "wipe", category: "destructive", weight: 1.8 },
  { keyword: "erase", category: "destructive", weight: 1.6 },
  { keyword: "uninstall", category: "destructive", weight: 1.3 },
  { keyword: "format", category: "destructive", weight: 1.8 },
  { keyword: "purge", category: "destructive", weight: 1.6 },
  { keyword: "destroy", category: "destructive", weight: 2 },
  { keyword: "overwrite", category: "destructive", weight: 1.2 },
  // ── 资金相关 ──
  { keyword: "\u4ED8\u8D39", category: "financial", weight: 1.5 },
  { keyword: "\u652F\u4ED8", category: "financial", weight: 1.6 },
  { keyword: "\u4ED8\u6B3E", category: "financial", weight: 1.6 },
  { keyword: "\u8D2D\u4E70", category: "financial", weight: 1.5 },
  { keyword: "\u4E0B\u5355", category: "financial", weight: 1.5 },
  { keyword: "\u8BA2\u9605", category: "financial", weight: 1.2 },
  { keyword: "\u6263\u8D39", category: "financial", weight: 1.8 },
  { keyword: "\u5145\u503C", category: "financial", weight: 1.6 },
  { keyword: "\u8F6C\u8D26", category: "financial", weight: 2 },
  { keyword: "\u6C47\u6B3E", category: "financial", weight: 2 },
  { keyword: "buy", category: "financial", weight: 1.5 },
  { keyword: "purchase", category: "financial", weight: 1.6 },
  { keyword: "pay", category: "financial", weight: 1.5 },
  { keyword: "payment", category: "financial", weight: 1.6 },
  { keyword: "subscribe", category: "financial", weight: 1.2 },
  { keyword: "charge", category: "financial", weight: 1.5 },
  { keyword: "billing", category: "financial", weight: 1.4 },
  { keyword: "checkout", category: "financial", weight: 1.6 },
  { keyword: "order", category: "financial", weight: 1 },
  { keyword: "transfer money", category: "financial", weight: 2 },
  // ── 对外发送 / 发布 ──
  { keyword: "\u53D1\u9001", category: "external", weight: 1.3 },
  { keyword: "\u53D1\u90AE\u4EF6", category: "external", weight: 1.5 },
  { keyword: "\u53D1\u77ED\u4FE1", category: "external", weight: 1.5 },
  { keyword: "\u7FA4\u53D1", category: "external", weight: 1.6 },
  { keyword: "\u53D1\u5E03", category: "external", weight: 1.5 },
  { keyword: "\u63A8\u9001", category: "external", weight: 1.3 },
  { keyword: "\u63D0\u4EA4", category: "external", weight: 1.1 },
  { keyword: "\u4E0A\u4F20", category: "external", weight: 1.1 },
  { keyword: "\u5206\u4EAB", category: "external", weight: 1.1 },
  { keyword: "\u53D1\u63A8", category: "external", weight: 1.3 },
  { keyword: "email", category: "external", weight: 1.3 },
  { keyword: "sms", category: "external", weight: 1.4 },
  { keyword: "send", category: "external", weight: 1.2 },
  { keyword: "publish", category: "external", weight: 1.5 },
  { keyword: "deploy", category: "external", weight: 1.5 },
  { keyword: "push", category: "external", weight: 1.2 },
  { keyword: "tweet", category: "external", weight: 1.3 },
  { keyword: "post", category: "external", weight: 1 },
  { keyword: "broadcast", category: "external", weight: 1.5 },
  { keyword: "notify", category: "external", weight: 1.1 },
  // ── 系统级 ──
  { keyword: "\u7CFB\u7EDF\u7EA7", category: "system", weight: 2 },
  { keyword: "\u7CFB\u7EDF\u8BBE\u7F6E", category: "system", weight: 1.8 },
  { keyword: "\u6CE8\u518C\u8868", category: "system", weight: 1.8 },
  { keyword: "\u5185\u6838", category: "system", weight: 2 },
  { keyword: "\u5173\u673A", category: "system", weight: 1.8 },
  { keyword: "\u91CD\u542F", category: "system", weight: 1.6 },
  { keyword: "\u751F\u4EA7\u73AF\u5883", category: "system", weight: 2 },
  { keyword: "\u7EBF\u4E0A\u73AF\u5883", category: "system", weight: 2 },
  { keyword: "root", category: "system", weight: 1.8 },
  { keyword: "sudo", category: "system", weight: 1.6 },
  { keyword: "kernel", category: "system", weight: 2 },
  { keyword: "shutdown", category: "system", weight: 1.8 },
  { keyword: "reboot", category: "system", weight: 1.6 },
  { keyword: "production", category: "system", weight: 1.8 },
  { keyword: "prod", category: "system", weight: 1.4 },
  { keyword: "system", category: "system", weight: 1.2 },
  { keyword: "registry", category: "system", weight: 1.6 },
  { keyword: "privileged", category: "system", weight: 1.6 },
  // ── 权限 / 授权 ──
  { keyword: "\u6743\u9650", category: "permission", weight: 1.3 },
  { keyword: "\u6388\u6743", category: "permission", weight: 1.4 },
  { keyword: "\u7BA1\u7406\u5458\u6743\u9650", category: "permission", weight: 1.8 },
  { keyword: "\u63D0\u6743", category: "permission", weight: 1.8 },
  { keyword: "chmod", category: "permission", weight: 1.3 },
  { keyword: "chmod 777", category: "permission", weight: 1.8 },
  { keyword: "chown", category: "permission", weight: 1.4 },
  { keyword: "grant", category: "permission", weight: 1.4 },
  { keyword: "permission", category: "permission", weight: 1.2 },
  { keyword: "access control", category: "permission", weight: 1.3 },
  { keyword: "admin", category: "permission", weight: 1.2 }
];
function analyzeRisk(text) {
  const categories = /* @__PURE__ */ new Set();
  let hits = 0;
  let weighted = 0;
  if (!text) return { hits, categories, weighted };
  for (const entry of HIGH_RISK_KEYWORDS) {
    const pattern = RISK_PATTERNS.get(entry.keyword);
    if (!pattern) continue;
    const count = countPattern(pattern, text);
    if (count > 0) {
      hits += 1;
      categories.add(entry.category);
      weighted += entry.weight * Math.min(count, 3);
    }
  }
  return { hits, categories, weighted };
}
var FILE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "pyw",
  "ipynb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "swift",
  "cpp",
  "cc",
  "cxx",
  "c",
  "h",
  "hpp",
  "rb",
  "php",
  "pl",
  "sh",
  "bash",
  "zsh",
  "sql",
  "vue",
  "svelte",
  "astro",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "md",
  "mdx",
  "txt",
  "log",
  "csv",
  "tsv",
  "xlsx",
  "xls",
  "docx",
  "doc",
  "pptx",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "mp3",
  "mp4",
  "wav",
  "zip",
  "tar",
  "gz",
  "lock",
  "env",
  "gitignore",
  "dockerfile",
  "gradle",
  "xml",
  "properties"
];
var TECH_STACKS = [
  // 前端框架 / 库
  { name: "React", pattern: /\breact(?:\.js)?\b|\buseState\b|\buseEffect\b|\bJSX\b/i },
  { name: "Vue", pattern: /\bvue(?:\.js)?\b|\bv-if\b|\bv-for\b|\bdefineComponent\b/i },
  { name: "Angular", pattern: /\bangular(?:\.js)?\b|\b@Component\b/i },
  { name: "Svelte", pattern: /\bsvelte\b|\bsveltekit\b/i },
  { name: "Next.js", pattern: /\bnext(?:\.js)?\b|\bnextjs\b/i },
  { name: "Nuxt", pattern: /\bnuxt(?:\.js)?\b/i },
  { name: "Tailwind CSS", pattern: /\btailwind(?:\s*css)?\b/i },
  { name: "jQuery", pattern: /\bjquery\b/i },
  { name: "Three.js", pattern: /\bthree(?:\.js)?\b|\bwebgl\b/i },
  // 编程语言
  { name: "TypeScript", pattern: /\btype\s?script\b|\bts(?:config)?\b/i },
  { name: "JavaScript", pattern: /\bjava\s?script\b|\becmascript\b/i },
  { name: "Python", pattern: /\bpython\b|\bpy(?:thon)?\b|\b__init__\b/i },
  { name: "Go", pattern: /\bgo(?:lang)?\b|\bgofmt\b/i },
  { name: "Rust", pattern: /\brust\b|\bcargo\b/i },
  { name: "Java", pattern: /\bjava\b(?!script)|\bjvm\b|\bmaven\b|\bgradle\b/i },
  { name: "Kotlin", pattern: /\bkotlin\b/i },
  { name: "Swift", pattern: /\bswift\b/i },
  { name: "Objective-C", pattern: /\bobjective-c\b|\bobjc\b/i },
  { name: "C++", pattern: /\bc\+\+\b|\bcpp\b/i },
  { name: "C#", pattern: /\bc#\b|\bcsharp\b|\b\.net\b/i },
  { name: "C", pattern: /\bc语言\b|\bc program\b/i },
  { name: "PHP", pattern: /\bphp\b|\bcomposer\b/i },
  { name: "Ruby", pattern: /\bruby\b|\brails\b|\bgem\b/i },
  { name: "Perl", pattern: /\bperl\b/i },
  { name: "Scala", pattern: /\bscala\b/i },
  { name: "Dart", pattern: /\bdart\b/i },
  { name: "R", pattern: /\br语言\b|\bcran\b/i },
  { name: "MATLAB", pattern: /\bmatlab\b/i },
  { name: "Shell", pattern: /\bshell\b|\bbash\b|\bzsh\b/i },
  { name: "SQL", pattern: /\bsql\b|\bpostgres(?:ql)?\b/i },
  { name: "Solidity", pattern: /\bsolidity\b|\b智能合约\b/i },
  // 运行时 / 服务端
  { name: "Node.js", pattern: /\bnode(?:\.js)?\b|\bnpm\b|\bexpress\b/i },
  { name: "Deno", pattern: /\bdeno\b/i },
  { name: "Bun", pattern: /\bbun\b/i },
  { name: "Django", pattern: /\bdjango\b/i },
  { name: "Flask", pattern: /\bflask\b/i },
  { name: "FastAPI", pattern: /\bfastapi\b/i },
  { name: "Spring", pattern: /\bspring\b|\bspring boot\b/i },
  { name: "Express", pattern: /\bexpress(?:\.js)?\b/i },
  { name: "NestJS", pattern: /\bnest(?:js)?\b/i },
  { name: "Gin", pattern: /\bgin(?:\.go|框架)?\b/i },
  { name: "Rails", pattern: /\bruby on rails\b|\brails\b/i },
  { name: "Laravel", pattern: /\blaravel\b/i },
  // 移动端 / 桌面
  { name: "React Native", pattern: /\breact native\b/i },
  { name: "Flutter", pattern: /\bflutter\b|\bdart\b/i },
  { name: "Electron", pattern: /\belectron\b/i },
  { name: "Unity", pattern: /\bunity\b|\bunity3d\b/i },
  { name: "Unreal Engine", pattern: /\bunreal\b|\bue[45]\b/i },
  // 数据库 / 存储
  { name: "PostgreSQL", pattern: /\bpostgre(?:sql)?\b|\bpsql\b/i },
  { name: "MySQL", pattern: /\bmysql\b|\bmariadb\b/i },
  { name: "MongoDB", pattern: /\bmongo(?:db)?\b/i },
  { name: "Redis", pattern: /\bredis\b/i },
  { name: "SQLite", pattern: /\bsqlite\b/i },
  { name: "Oracle", pattern: /\boracle\b/i },
  { name: "SQL Server", pattern: /\bsql server\b|\bmssql\b/i },
  { name: "Elasticsearch", pattern: /\belasticsearch\b|\belk\b/i },
  { name: "Kafka", pattern: /\bkafka\b/i },
  { name: "RabbitMQ", pattern: /\brabbitmq\b/i },
  // DevOps / 云
  { name: "Docker", pattern: /\bdocker\b|\bdockerfile\b|\bdocker-compose\b/i },
  { name: "Kubernetes", pattern: /\bkubernetes\b|\bk8s\b|\bkubectl\b|\bhelm\b/i },
  { name: "AWS", pattern: /\baws\b|\bamazon web services\b|\bs3\b|\bec2\b/i },
  { name: "Azure", pattern: /\bazure\b/i },
  { name: "GCP", pattern: /\bgcp\b|\bgoogle cloud\b|\bbigquery\b/i },
  { name: "Terraform", pattern: /\bterraform\b/i },
  { name: "Nginx", pattern: /\bnginx\b/i },
  { name: "Linux", pattern: /\blinux\b|\bubuntu\b|\bcentos\b|\bdebian\b/i },
  { name: "macOS", pattern: /\bmacos\b|\bmac os\b|\bosx\b/i },
  { name: "Windows", pattern: /\bwindows\b|\bwin32\b/i },
  { name: "Git", pattern: /\bgit\b|\bgithub\b|\bgitlab\b/i },
  { name: "CI/CD", pattern: /\bci\/cd\b|\bjenkins\b|\bgithub actions\b|\bgitlab ci\b/i },
  // API / 数据 / ML
  { name: "GraphQL", pattern: /\bgraphql\b/i },
  { name: "REST API", pattern: /\brest(?:ful)?\s*api\b|\brestful\b/i },
  { name: "WebSocket", pattern: /\bwebsocket\b|\bws:\/\//i },
  { name: "Pandas", pattern: /\bpandas\b/i },
  { name: "NumPy", pattern: /\bnumpy\b/i },
  { name: "PyTorch", pattern: /\bpytorch\b|\btorch\b/i },
  { name: "TensorFlow", pattern: /\btensorflow\b|\bkeras\b/i },
  { name: "Scikit-learn", pattern: /\bscikit-learn\b|\bsklearn\b/i }
];
var RISK_PATTERNS = new Map(
  HIGH_RISK_KEYWORDS.map((entry) => [entry.keyword, compileKeywords([entry.keyword])[0]])
);
var MATCHERS = {
  code: [...compileKeywords(CODE_KEYWORDS), ...CODE_STRUCTURE_PATTERNS],
  fileOp: compileKeywords(FILE_OP_KEYWORDS),
  shell: compileKeywords(SHELL_KEYWORDS),
  research: compileKeywords(RESEARCH_KEYWORDS),
  creative: compileKeywords(CREATIVE_KEYWORDS),
  data: compileKeywords(DATA_KEYWORDS),
  multiStep: compileKeywords(MULTI_STEP_KEYWORDS),
  goalLoop: compileKeywords(GOAL_LOOP_KEYWORDS),
  planning: compileKeywords(PLANNING_KEYWORDS),
  verification: compileKeywords(VERIFICATION_KEYWORDS),
  timeSensitive: compileKeywords(TIME_SENSITIVE_KEYWORDS)
};
var MEDIA_TYPE_PATTERN = /image|audio|video|file|attachment|document|binary|image_url|input_image/i;
var INLINE_MEDIA_PATTERN = /data:image\/|\[图片\]|\[附件\]|!\[[^\]]*\]\(/i;
function normalizeText(text) {
  if (!text) return "";
  return text.normalize("NFKC").toLowerCase().replace(/[\s\u00a0]+/g, "").replace(/[\p{P}\p{S}]/gu, "");
}
function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length;
  const words = (text.match(/[A-Za-z][A-Za-z0-9_'’-]*/g) || []).length;
  const numbers = (text.match(/\d+(?:\.\d+)?/g) || []).length;
  const symbols = (text.match(/[^\s\p{L}\p{N}]/gu) || []).length;
  return cjk + words + numbers + Math.floor(symbols / 4);
}
function pushPath(set, raw) {
  const cleaned = raw.replace(/[.,;:)\]}"'，。；：）】、]+$/g, "").trim();
  if (cleaned.length > 1) set.add(cleaned);
}
function extractFilePaths(text) {
  const found = /* @__PURE__ */ new Set();
  if (!text) return [];
  for (const match of text.matchAll(/[a-zA-Z]:\\[^\s"'<>|，。；、]+/g)) {
    pushPath(found, match[0]);
  }
  for (const match of text.matchAll(/(?<![:\w/])(\/(?:[\w.@~+-]+\/)*[\w.@~+-]+)/g)) {
    const candidate = match[1];
    if (/[\w]/.test(candidate) && candidate.length > 1) pushPath(found, candidate);
  }
  const ext = FILE_EXTENSIONS.map(escapeRegExp).join("|");
  const relative = new RegExp(
    `(?<![\\w/])((?:\\.{1,2}/)?[\\w.@~+-]+(?:\\/[\\w.@~+-]+)*\\.(?:${ext}))\\b`,
    "gi"
  );
  for (const match of text.matchAll(relative)) {
    pushPath(found, match[1]);
  }
  return [...found];
}
function detectTechStacks(text) {
  const out = [];
  if (!text) return out;
  for (const { name, pattern } of TECH_STACKS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    if (global.test(text) && !out.includes(name)) out.push(name);
  }
  return out;
}
function countStepMarkers(text) {
  if (!text) return 0;
  let total = 0;
  for (const pattern of MULTI_STEP_STRUCTURE_PATTERNS) {
    total += countPattern(pattern, text);
  }
  return total;
}
function extractTextFromContent(content) {
  if (typeof content === "string") {
    return { text: content, hasMedia: INLINE_MEDIA_PATTERN.test(content) };
  }
  if (Array.isArray(content)) {
    let text = "";
    let hasMedia = false;
    for (const part of content) {
      if (typeof part === "string") {
        text += part;
        continue;
      }
      if (!part || typeof part !== "object") continue;
      const record = part;
      const type = typeof record.type === "string" ? record.type : "";
      if (MEDIA_TYPE_PATTERN.test(type)) hasMedia = true;
      if (typeof record.text === "string") text += record.text;
      else if (typeof record.content === "string") text += record.content;
      else if (typeof record.alt === "string") text += record.alt;
      if ("image_url" in record || "image" in record || "input_image" in record) hasMedia = true;
    }
    return { text, hasMedia: hasMedia || INLINE_MEDIA_PATTERN.test(text) };
  }
  if (content && typeof content === "object") {
    const record = content;
    const type = typeof record.type === "string" ? record.type : "";
    const text = typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : "";
    return {
      text,
      hasMedia: MEDIA_TYPE_PATTERN.test(type) || INLINE_MEDIA_PATTERN.test(text)
    };
  }
  return { text: "", hasMedia: false };
}
function scanMessages(messages) {
  const empty = { lastUserText: "", hasAttachment: false, historyTurns: 0, allUserText: "" };
  if (!Array.isArray(messages) || messages.length === 0) return empty;
  let lastUserText = "";
  let hasAttachment = false;
  let historyTurns = 0;
  const userTexts = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
    const extracted = extractTextFromContent(message.content);
    const rootAttachments = message.attachments || message.images || message.files;
    if (extracted.hasMedia || Array.isArray(rootAttachments) && rootAttachments.length > 0) {
      hasAttachment = true;
    }
    if (role === "user") {
      historyTurns += 1;
      lastUserText = extracted.text;
      userTexts.push(extracted.text);
    }
  }
  return {
    lastUserText,
    hasAttachment,
    historyTurns,
    allUserText: userTexts.join("\n")
  };
}
var SignalExtractorImpl = class {
  /** 可传入自定义词表扩展（默认使用内置的全部词表）。 */
  constructor(options = {}) {
    this.options = options;
  }
  extract(messages) {
    const scan = scanMessages(messages);
    const rawText = scan.lastUserText;
    const codeHit = matchesAny(MATCHERS.code, rawText) || (this.options.extraCodeKeywords?.length ? matchesAny(compileKeywords(this.options.extraCodeKeywords), rawText) : false);
    const risk = analyzeRisk(rawText);
    const techStacks = detectTechStacks(rawText);
    if (this.options.extraTechStacks?.length) {
      for (const { name, pattern } of this.options.extraTechStacks) {
        const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
        if (re.test(rawText) && !techStacks.includes(name)) techStacks.push(name);
      }
    }
    return {
      rawText,
      normalized: normalizeText(rawText),
      charLength: rawText.length,
      tokenEstimate: estimateTokens(rawText),
      hasCode: codeHit,
      hasFileOp: matchesAny(MATCHERS.fileOp, rawText),
      hasShell: matchesAny(MATCHERS.shell, rawText),
      hasResearch: matchesAny(MATCHERS.research, rawText),
      hasCreative: matchesAny(MATCHERS.creative, rawText),
      hasData: matchesAny(MATCHERS.data, rawText),
      hasMultiStep: matchesAny(MATCHERS.multiStep, rawText) || countStepMarkers(rawText) > 0,
      hasGoalLoop: matchesAny(MATCHERS.goalLoop, rawText),
      hasPlanning: matchesAny(MATCHERS.planning, rawText),
      hasVerification: matchesAny(MATCHERS.verification, rawText),
      fileRefs: extractFilePaths(rawText),
      techStacks,
      historyTurns: scan.historyTurns,
      hasAttachment: scan.hasAttachment,
      isTimeSensitive: matchesAny(MATCHERS.timeSensitive, rawText),
      hasHighRisk: risk.hits > 0
    };
  }
};
var DEFAULT_SIGNAL_EXTRACTOR = new SignalExtractorImpl();
function extractSignals(messages) {
  return DEFAULT_SIGNAL_EXTRACTOR.extract(messages);
}
var NEGATION_KEYWORDS = [
  // 中文
  "\u4E0D",
  "\u4E0D\u8981",
  "\u4E0D\u7528",
  "\u4E0D\u9700\u8981",
  "\u522B",
  "\u522B\u518D",
  "\u4E0D\u518D",
  "\u6CA1\u6709",
  "\u6CA1",
  "\u975E",
  "\u65E0\u9700",
  "\u65E0\u987B",
  "\u4E0D\u5FC5",
  "\u7981\u6B62",
  "\u5207\u52FF",
  "\u5343\u4E07\u4E0D",
  "\u907F\u514D",
  "\u522B\u628A",
  "\u522B\u7ED9",
  "\u4E0D\u505A",
  "\u4E0D\u5199",
  "\u4E0D\u5220",
  "\u4E0D\u8FD0\u884C",
  "\u4E0D\u521B\u5EFA",
  "\u4E0D\u4FEE\u6539",
  "\u4E0D\u53D1\u9001",
  "\u4E0D\u4E70",
  "\u4E0D\u7528\u7BA1",
  "\u5148\u4E0D",
  "\u6682\u65F6\u4E0D",
  "\u6682\u65F6\u4E0D\u7528",
  "\u53D6\u6D88",
  "\u64A4\u9500",
  "\u653E\u5F03",
  "\u505C\u6B62",
  "\u7B97\u4E86",
  "\u4E0D\u7528\u4E86",
  "\u4E0D\u9700\u8981\u4E86",
  "\u4E0D\u4F5C",
  // 英文
  "no",
  "not",
  "don't",
  "do not",
  "dont",
  "never",
  "none",
  "nothing",
  "without",
  "skip",
  "avoid",
  "stop",
  "cancel",
  "abort",
  "undo",
  "isn't",
  "aren't",
  "can't",
  "cannot",
  "won't",
  "wouldn't",
  "shouldn't",
  "never mind",
  "forget it",
  "no need",
  "not necessary",
  "hold off"
];
var UNCERTAINTY_KEYWORDS = [
  // 中文
  "\u4E5F\u8BB8",
  "\u6216\u8BB8",
  "\u53EF\u80FD",
  "\u5927\u6982",
  "\u4E5F\u8BB8\u5427",
  "\u597D\u50CF",
  "\u4F3C\u4E4E",
  "\u6216\u8BB8\u53EF\u4EE5",
  "\u80FD\u4E0D\u80FD",
  "\u53EF\u4E0D\u53EF\u4EE5",
  "\u8981\u4E0D\u8981",
  "\u662F\u4E0D\u662F",
  "\u6709\u6CA1\u6709",
  "\u8BF7\u95EE",
  "\u5982\u679C",
  "\u5047\u5982",
  "\u5047\u8BBE",
  "\u4E07\u4E00",
  "\u4E0D\u4E00\u5B9A",
  "\u4E0D\u786E\u5B9A",
  "\u6211\u4E0D\u786E\u5B9A",
  "\u8BD5\u8BD5",
  "\u8BD5\u7740",
  "\u968F\u4FBF",
  "\u90FD\u53EF\u4EE5",
  "\u4F60\u770B\u7740\u529E",
  "\u914C\u60C5",
  "\u89C6\u60C5\u51B5",
  "\u5927\u81F4",
  "\u5DEE\u4E0D\u591A",
  // 英文
  "maybe",
  "perhaps",
  "possibly",
  "probably",
  "might",
  "could",
  "perhaps",
  "i think",
  "i guess",
  "not sure",
  "unsure",
  "perhaps not",
  "if possible",
  "try to",
  "attempt to",
  "roughly",
  "about",
  "around",
  "sort of",
  "kind of"
];
var NEGATION_PATTERNS = compileKeywords(NEGATION_KEYWORDS);
var UNCERTAINTY_PATTERNS = compileKeywords(UNCERTAINTY_KEYWORDS);

// src/shared/super/analysis/complexity.ts
var DEFAULT_WEIGHTS = {
  length: 0.18,
  domain: 0.25,
  steps: 0.22,
  risk: 0.2,
  context: 0.15
};
var LEVEL_THRESHOLDS = [
  { min: 82, level: "expert" },
  { min: 60, level: "complex" },
  { min: 35, level: "moderate" },
  { min: 15, level: "simple" },
  { min: 0, level: "trivial" }
];
function clamp100(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
function round(value) {
  return Math.round(value);
}
function scoreLength(signals) {
  const tokens = Math.max(0, signals.tokenEstimate || 0);
  const chars = Math.max(0, signals.charLength || 0);
  const tokenPart = 100 * Math.log(1 + tokens) / Math.log(1 + 3e3);
  const charPart = Math.min(100, 100 * chars / 12e3);
  return clamp100(0.85 * tokenPart + 0.15 * charPart);
}
function scoreDomainDetailed(signals) {
  const hits = [];
  if (signals.hasCode) hits.push("\u4EE3\u7801");
  if (signals.hasData) hits.push("\u6570\u636E");
  if (signals.hasShell) hits.push("\u547D\u4EE4\u884C");
  if (signals.hasFileOp) hits.push("\u6587\u4EF6\u64CD\u4F5C");
  if (signals.hasResearch) hits.push("\u8C03\u7814");
  if (signals.hasCreative) hits.push("\u521B\u4F5C");
  const base = hits.length * 18;
  const techCount = Array.isArray(signals.techStacks) ? signals.techStacks.length : 0;
  const tech = Math.min(techCount, 5) * 4;
  return { score: clamp100(base + tech), hits };
}
function scoreStepsDetailed(signals) {
  const stepMarkers = countStepMarkers(signals.rawText || "");
  const flags = [];
  let x = 0;
  if (signals.hasMultiStep) {
    x += 1.6;
    flags.push("\u591A\u6B65\u9AA4");
  }
  if (signals.hasGoalLoop) {
    x += 1.4;
    flags.push("\u76EE\u6807\u95ED\u73AF");
  }
  if (signals.hasPlanning) {
    x += 1.2;
    flags.push("\u89C4\u5212");
  }
  if (signals.hasVerification) {
    x += 0.8;
    flags.push("\u9A8C\u8BC1");
  }
  x += 0.25 * Math.min(stepMarkers, 8);
  if (stepMarkers > 0 && !signals.hasMultiStep) flags.push(`${stepMarkers} \u4E2A\u6B65\u9AA4\u6807\u8BB0`);
  const k = 0.42;
  const normalize = 1 - Math.exp(-k * 6.6);
  const score = normalize > 0 ? 100 * (1 - Math.exp(-k * x)) / normalize : 0;
  return { score: clamp100(score), stepMarkers, flags };
}
function scoreRiskDetailed(signals, rawText) {
  const text = rawText ?? signals.rawText ?? "";
  const analysis = analyzeRisk(text);
  const base = Math.min(analysis.weighted, 12) * 6;
  const cross = Math.max(0, analysis.categories.size - 1) * 12;
  const boolBoost = signals.hasHighRisk ? 6 : 0;
  const score = clamp100(base + cross + boolBoost);
  const categoryNames = {
    destructive: "\u7834\u574F\u6027",
    financial: "\u8D44\u91D1",
    external: "\u5BF9\u5916\u53D1\u9001",
    system: "\u7CFB\u7EDF\u7EA7",
    permission: "\u6743\u9650"
  };
  const names = [...analysis.categories].map((c) => categoryNames[c] || c);
  const detail = names.length > 0 ? `\u9AD8\u98CE\u9669\u7C7B\u522B\uFF1A${names.join("\u3001")}\uFF08\u52A0\u6743 ${analysis.weighted.toFixed(1)}\uFF09` : "\u65E0\u9AD8\u98CE\u9669\u64CD\u4F5C";
  return { score, analysis, detail };
}
function scoreContextDetailed(signals) {
  const flags = [];
  const turns = Math.max(0, signals.historyTurns || 0);
  const history = Math.min(turns, 20) * 2.2;
  if (turns > 3) flags.push(`${turns} \u8F6E\u5386\u53F2`);
  const attach = signals.hasAttachment ? 12 : 0;
  if (signals.hasAttachment) flags.push("\u542B\u9644\u4EF6");
  const time = signals.isTimeSensitive ? 10 : 0;
  if (signals.isTimeSensitive) flags.push("\u65F6\u95F4\u654F\u611F");
  const refs = Math.min(Array.isArray(signals.fileRefs) ? signals.fileRefs.length : 0, 8) * 3;
  if (refs > 0) flags.push(`${signals.fileRefs.length} \u4E2A\u6587\u4EF6\u5F15\u7528`);
  return { score: clamp100(history + attach + time + refs), flags };
}
function levelFromScore(score) {
  const safe = clamp100(score);
  for (const { min, level } of LEVEL_THRESHOLDS) {
    if (safe >= min) return level;
  }
  return "trivial";
}
function computeDetailedDimensions(signals, weights = DEFAULT_WEIGHTS) {
  const length = scoreLength(signals);
  const domain = scoreDomainDetailed(signals);
  const steps = scoreStepsDetailed(signals);
  const risk = scoreRiskDetailed(signals);
  const context = scoreContextDetailed(signals);
  const weighted = {
    length: length * weights.length,
    domain: domain.score * weights.domain,
    steps: steps.score * weights.steps,
    risk: risk.score * weights.risk,
    context: context.score * weights.context
  };
  const total = weighted.length + weighted.domain + weighted.steps + weighted.risk + weighted.context;
  return {
    dimensions: { length: round(length), domain: round(domain.score), steps: round(steps.score), risk: round(risk.score), context: round(context.score) },
    detailed: { length, domain, steps, risk, context },
    weighted,
    total: clamp100(total)
  };
}
function buildReasons(detailed, weighted) {
  const reasons = [];
  if (detailed.length >= 40) {
    reasons.push(`\u6587\u672C\u8F83\u957F\uFF1A\u7EA6 ${Math.round(detailed.length)}/100\uFF08\u957F\u5EA6\u6743\u91CD\u8D21\u732E ${weighted.length.toFixed(1)}\uFF09`);
  }
  if (detailed.domain.hits.length > 0) {
    reasons.push(`\u8DE8\u57DF\u786C\u4FE1\u53F7 ${detailed.domain.hits.length} \u9879\uFF1A${detailed.domain.hits.join("\u3001")}`);
  }
  if (detailed.steps.flags.length > 0) {
    reasons.push(`\u7ED3\u6784\u5316\u6B65\u9AA4\uFF1A${detailed.steps.flags.join("\u3001")}`);
  }
  if (detailed.risk.analysis.hits > 0) {
    reasons.push(detailed.risk.detail);
  }
  if (detailed.context.flags.length > 0) {
    reasons.push(`\u4E0A\u4E0B\u6587\u8D1F\u62C5\uFF1A${detailed.context.flags.join("\u3001")}`);
  }
  if (reasons.length === 0) {
    reasons.push("\u5404\u7EF4\u5EA6\u4FE1\u53F7\u5747\u8F83\u5F31\uFF0C\u5C5E\u76F4\u63A5\u7B54\u590D\u578B\u4EFB\u52A1");
  }
  return reasons;
}
var ComplexityScorerImpl = class {
  constructor(weights = DEFAULT_WEIGHTS) {
    this.weights = weights;
  }
  score(signals) {
    const computed = computeDetailedDimensions(signals, this.weights);
    const score = round(computed.total);
    return {
      score,
      level: levelFromScore(score),
      dimensions: computed.dimensions,
      reasons: buildReasons(computed.detailed, computed.weighted)
    };
  }
};
var DEFAULT_COMPLEXITY_SCORER = new ComplexityScorerImpl();
function scoreComplexity(signals) {
  return DEFAULT_COMPLEXITY_SCORER.score(signals);
}

// src/shared/super/analysis/analyzer.ts
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function round2(value) {
  return Math.round(value * 100) / 100;
}
var domainKeywords = {
  code: [
    // 英文：动作
    "code",
    "coding",
    "program",
    "programming",
    "develop",
    "implement",
    "refactor",
    "debug",
    "compile",
    "build",
    "write function",
    "fix bug",
    "fix the bug",
    "optimize",
    "migrate",
    "port code",
    "deploy code",
    "commit",
    "merge",
    // 英文：结构
    "function",
    "class",
    "interface",
    "module",
    "api",
    "endpoint",
    "algorithm",
    "data structure",
    "source code",
    "repository",
    "git",
    "typescript",
    "javascript",
    "python",
    "java",
    "golang",
    "rust",
    "c++",
    "component",
    "service",
    "server",
    // 中文
    "\u5199\u4EE3\u7801",
    "\u4EE3\u7801",
    "\u7F16\u7A0B",
    "\u7A0B\u5E8F",
    "\u51FD\u6570",
    "\u7C7B",
    "\u63A5\u53E3",
    "\u6A21\u5757",
    "\u91CD\u6784",
    "\u8C03\u8BD5",
    "\u7F16\u8BD1",
    "\u4FEE\u590D",
    "\u5B9E\u73B0",
    "\u4F18\u5316",
    "\u7B97\u6CD5",
    "\u6570\u636E\u7ED3\u6784",
    "\u6E90\u7801",
    "\u4ED3\u5E93",
    "\u5F00\u53D1",
    "\u5C01\u88C5",
    "\u7EE7\u627F",
    "\u591A\u6001",
    "\u5199\u4E2A\u51FD\u6570",
    "\u5199\u4E2A\u65B9\u6CD5",
    "\u811A\u672C",
    "\u540E\u7AEF",
    "\u524D\u7AEF",
    "\u5168\u6808",
    "\u6846\u67B6",
    "\u4F9D\u8D56",
    "\u7248\u672C",
    "\u5355\u5143\u6D4B\u8BD5",
    "\u63A5\u53E3\u5F00\u53D1"
  ],
  file: [
    // 英文
    "file",
    "files",
    "folder",
    "directory",
    "path",
    "read file",
    "write file",
    "create file",
    "delete file",
    "edit file",
    "rename",
    "move file",
    "copy file",
    "list files",
    "open file",
    "save",
    "upload",
    "download",
    "parse file",
    "text file",
    "config file",
    "json file",
    "csv file",
    // 中文
    "\u6587\u4EF6",
    "\u6587\u4EF6\u5939",
    "\u76EE\u5F55",
    "\u8DEF\u5F84",
    "\u8BFB\u53D6",
    "\u5199\u5165",
    "\u521B\u5EFA\u6587\u4EF6",
    "\u5220\u9664\u6587\u4EF6",
    "\u7F16\u8F91\u6587\u4EF6",
    "\u4FEE\u6539\u6587\u4EF6",
    "\u91CD\u547D\u540D",
    "\u79FB\u52A8\u6587\u4EF6",
    "\u590D\u5236\u6587\u4EF6",
    "\u5217\u51FA\u6587\u4EF6",
    "\u6253\u5F00\u6587\u4EF6",
    "\u4FDD\u5B58",
    "\u4E0A\u4F20",
    "\u4E0B\u8F7D",
    "\u6587\u4EF6\u540D",
    "\u6587\u4EF6\u8DEF\u5F84",
    "\u6587\u4EF6\u7CFB\u7EDF"
  ],
  shell: [
    // 英文
    "shell",
    "command",
    "terminal",
    "bash",
    "zsh",
    "powershell",
    "cli",
    "npm",
    "yarn",
    "pnpm",
    "pip",
    "cargo",
    "docker",
    "kubectl",
    "sudo",
    "chmod",
    "grep",
    "awk",
    "sed",
    "curl",
    "wget",
    "ssh",
    "script",
    "run command",
    "execute command",
    "ls",
    "cd",
    "mkdir",
    "rm",
    "cp",
    "mv",
    // 中文
    "\u547D\u4EE4\u884C",
    "\u7EC8\u7AEF",
    "\u811A\u672C",
    "\u6267\u884C",
    "\u8FD0\u884C\u547D\u4EE4",
    "\u7EC8\u7AEF\u547D\u4EE4",
    "shell\u811A\u672C",
    "\u6279\u5904\u7406",
    "\u63A7\u5236\u53F0",
    "\u63A7\u5236\u53F0\u547D\u4EE4",
    "\u5B89\u88C5\u4F9D\u8D56",
    "\u6253\u5305",
    "\u90E8\u7F72\u547D\u4EE4"
  ],
  research: [
    // 英文
    "search",
    "research",
    "find",
    "lookup",
    "google",
    "browse",
    "investigate",
    "explore",
    "fetch",
    "crawl",
    "scrape",
    "documentation",
    "docs",
    "paper",
    "article",
    "news",
    "source",
    "citation",
    "reference",
    "wikipedia",
    "stackoverflow",
    "github",
    "tutorial",
    "guide",
    "compare",
    "benchmark",
    "competitor",
    "market",
    "what is",
    "how to",
    "latest",
    // 中文
    "\u641C\u7D22",
    "\u67E5\u627E",
    "\u67E5\u4E00\u4E0B",
    "\u68C0\u7D22",
    "\u8C03\u7814",
    "\u7814\u7A76",
    "\u8C03\u67E5",
    "\u4E86\u89E3",
    "\u641C\u96C6",
    "\u8D44\u6599",
    "\u6587\u732E",
    "\u8BBA\u6587",
    "\u51FA\u5904",
    "\u6765\u6E90",
    "\u67E5\u8BC1",
    "\u6838\u5B9E",
    "\u7F51\u9875",
    "\u7F51\u7AD9",
    "\u5728\u7EBF",
    "\u7F51\u4E0A",
    "\u4E92\u8054\u7F51",
    "\u8C37\u6B4C",
    "\u767E\u5EA6",
    "\u7EF4\u57FA",
    "\u767E\u79D1",
    "\u5B98\u65B9\u6587\u6863",
    "\u6559\u7A0B",
    "\u6307\u5357",
    "\u89C4\u8303",
    "\u7ADE\u54C1",
    "\u5E02\u573A",
    "\u73B0\u72B6",
    "\u65B0\u95FB",
    "\u6700\u65B0",
    "\u5BF9\u6BD4"
  ],
  writing: [
    // 英文
    "write",
    "article",
    "blog",
    "essay",
    "report",
    "summary",
    "translate",
    "rewrite",
    "edit text",
    "proofread",
    "draft",
    "copywriting",
    "caption",
    "documentation",
    "readme",
    "email draft",
    "resume",
    "letter",
    "script writing",
    // 中文
    "\u5199",
    "\u5199\u4F5C",
    "\u6587\u7AE0",
    "\u535A\u5BA2",
    "\u4F5C\u6587",
    "\u62A5\u544A",
    "\u603B\u7ED3",
    "\u6458\u8981",
    "\u7FFB\u8BD1",
    "\u6539\u5199",
    "\u6DA6\u8272",
    "\u6821\u5BF9",
    "\u8349\u6848",
    "\u6587\u6848",
    "\u64B0\u5199",
    "\u8D77\u8349",
    "\u6269\u5199",
    "\u7F29\u5199",
    "\u7EED\u5199",
    "\u4EFF\u5199",
    "\u7B80\u5386",
    "\u4FE1\u4EF6",
    "\u8BF4\u660E\u6587",
    "\u8BAE\u8BBA\u6587",
    "\u8BB0\u53D9\u6587"
  ],
  data: [
    // 英文
    "data",
    "analyze data",
    "analysis",
    "statistics",
    "csv",
    "excel",
    "database",
    "sql",
    "query",
    "pandas",
    "numpy",
    "chart",
    "graph",
    "visualize",
    "plot",
    "dashboard",
    "regression",
    "clustering",
    "prediction",
    "machine learning",
    "dataset",
    "table",
    "metric",
    "kpi",
    "aggregate",
    "pivot",
    "etl",
    // 中文
    "\u6570\u636E",
    "\u6570\u636E\u5206\u6790",
    "\u7EDF\u8BA1",
    "\u6570\u636E\u5E93",
    "\u67E5\u8BE2",
    "\u8868\u683C",
    "\u7535\u5B50\u8868\u683C",
    "\u62A5\u8868",
    "\u53EF\u89C6\u5316",
    "\u56FE\u8868",
    "\u67F1\u72B6\u56FE",
    "\u6298\u7EBF\u56FE",
    "\u997C\u56FE",
    "\u56DE\u5F52",
    "\u805A\u7C7B",
    "\u9884\u6D4B",
    "\u8D8B\u52BF",
    "\u76F8\u5173\u6027",
    "\u5206\u5E03",
    "\u673A\u5668\u5B66\u4E60",
    "\u6570\u636E\u96C6",
    "\u6307\u6807",
    "\u6C42\u548C",
    "\u5E73\u5747\u503C"
  ],
  creative: [
    // 英文
    "create",
    "creative",
    "imagine",
    "story",
    "poem",
    "poetry",
    "novel",
    "fiction",
    "screenplay",
    "lyrics",
    "song",
    "draw",
    "paint",
    "illustrate",
    "image",
    "generate image",
    "design",
    "logo",
    "poster",
    "artwork",
    "brainstorm",
    // 中文
    "\u521B\u4F5C",
    "\u5199\u8BD7",
    "\u4F5C\u8BD7",
    "\u8BD7\u6B4C",
    "\u6563\u6587",
    "\u6545\u4E8B",
    "\u5C0F\u8BF4",
    "\u5267\u672C",
    "\u6B4C\u8BCD",
    "\u5199\u6B4C",
    "\u753B\u753B",
    "\u7ED8\u753B",
    "\u751F\u6210\u56FE\u7247",
    "\u751F\u6210\u56FE\u50CF",
    "\u63D2\u753B",
    "\u6F2B\u753B",
    "\u6D77\u62A5",
    "logo",
    "\u6807\u5FD7",
    "\u5934\u50CF",
    "\u58C1\u7EB8",
    "\u521B\u610F",
    "\u60F3\u8C61",
    "\u865A\u6784",
    "\u89D2\u8272",
    "\u8BBE\u5B9A",
    "\u53D6\u540D",
    "\u8D77\u540D",
    "\u6807\u8BED",
    "\u53E3\u53F7"
  ],
  planning: [
    // 英文
    "plan",
    "planning",
    "design",
    "architecture",
    "strategy",
    "roadmap",
    "blueprint",
    "outline",
    "proposal",
    "breakdown",
    "milestone",
    "schedule",
    "organize",
    "structure",
    "framework",
    "approach",
    "steps",
    "workflow",
    // 中文
    "\u8BA1\u5212",
    "\u65B9\u6848",
    "\u8BBE\u8BA1",
    "\u67B6\u6784",
    "\u89C4\u5212",
    "\u7B56\u7565",
    "\u84DD\u56FE",
    "\u8DEF\u7EBF\u56FE",
    "\u5927\u7EB2",
    "\u63D0\u7EB2",
    "\u6846\u67B6",
    "\u7ED3\u6784\u8BBE\u8BA1",
    "\u67B6\u6784\u8BBE\u8BA1",
    "\u6280\u672F\u65B9\u6848",
    "\u5B9E\u65BD\u65B9\u6848",
    "\u62C6\u89E3",
    "\u4EFB\u52A1\u5206\u89E3",
    "\u6392\u671F",
    "\u91CC\u7A0B\u7891",
    "\u76EE\u6807",
    "\u5206\u9636\u6BB5",
    "\u5206\u6B65\u9AA4",
    "\u7EDF\u7B79",
    "\u5E03\u5C40"
  ],
  qa: [
    // 英文
    "test",
    "testing",
    "verify",
    "validate",
    "check",
    "debug",
    "inspect",
    "review",
    "audit",
    "lint",
    "regression",
    "unit test",
    "integration test",
    "e2e test",
    "assert",
    "coverage",
    "bug",
    "issue",
    "troubleshoot",
    "quality",
    "sanity check",
    "smoke test",
    // 中文
    "\u6D4B\u8BD5",
    "\u9A8C\u8BC1",
    "\u68C0\u67E5",
    "\u6821\u9A8C",
    "\u6838\u5BF9",
    "\u590D\u6838",
    "\u5BA1\u67E5",
    "\u6392\u67E5",
    "\u8C03\u8BD5",
    "\u786E\u8BA4",
    "\u8BD5\u8FD0\u884C",
    "\u5355\u6D4B",
    "\u5355\u5143\u6D4B\u8BD5",
    "\u96C6\u6210\u6D4B\u8BD5",
    "\u56DE\u5F52\u6D4B\u8BD5",
    "\u7AEF\u5230\u7AEF\u6D4B\u8BD5",
    "\u81EA\u68C0",
    "\u9A8C\u6536",
    "\u8D28\u68C0",
    "\u6D4B\u8BD5\u901A\u8FC7",
    "\u8DD1\u6D4B\u8BD5",
    "\u627Ebug",
    "\u4FEEbug",
    "\u7F3A\u9677"
  ],
  conversation: [
    // 英文
    "hello",
    "hi",
    "hey",
    "thanks",
    "thank you",
    "how are you",
    "chat",
    "tell me",
    "explain",
    "what do you think",
    "opinion",
    "advice",
    "help me",
    "question",
    "answer",
    "discuss",
    "please",
    // 中文
    "\u4F60\u597D",
    "\u60A8\u597D",
    "hi",
    "\u55E8",
    "\u8C22\u8C22",
    "\u611F\u8C22",
    "\u5728\u5417",
    "\u8BF7\u95EE",
    "\u95EE\u4E00\u4E0B",
    "\u804A\u804A",
    "\u600E\u4E48\u770B",
    "\u4F60\u8BA4\u4E3A",
    "\u4F60\u89C9\u5F97",
    "\u5EFA\u8BAE",
    "\u5E2E\u6211",
    "\u80FD\u4E0D\u80FD",
    "\u53EF\u4EE5\u5417",
    "\u662F\u4EC0\u4E48",
    "\u4E3A\u4EC0\u4E48",
    "\u600E\u4E48\u6837",
    "\u4ECB\u7ECD\u4E00\u4E0B",
    "\u89E3\u91CA\u4E00\u4E0B"
  ]
};
var DOMAIN_MATCHERS = Object.keys(domainKeywords).map((domain) => ({
  domain,
  patterns: compileKeywords(domainKeywords[domain])
}));
function domainRawScores(signals, text) {
  const scores = {};
  for (const { domain, patterns } of DOMAIN_MATCHERS) {
    scores[domain] = countAny(patterns, text);
  }
  const boosts = {
    code: (signals.hasCode ? 4 : 0) + Math.min(signals.techStacks?.length || 0, 3),
    file: (signals.hasFileOp ? 4 : 0) + Math.min(signals.fileRefs?.length || 0, 4),
    shell: signals.hasShell ? 5 : 0,
    research: signals.hasResearch ? 4 : 0,
    writing: signals.hasCreative ? 1 : 0,
    data: (signals.hasData ? 5 : 0) + (signals.techStacks?.some((t) => /Pandas|NumPy|SQL|Scikit|PyTorch|TensorFlow/i.test(t)) ? 2 : 0),
    creative: signals.hasCreative ? 5 : 0,
    planning: (signals.hasPlanning ? 5 : 0) + (signals.hasGoalLoop ? 1 : 0),
    qa: signals.hasVerification ? 5 : 0,
    conversation: 0
  };
  for (const key of Object.keys(boosts)) {
    scores[key] += boosts[key] || 0;
  }
  if (text.length <= 40 && signals.historyTurns <= 1) {
    scores.conversation += 1.5;
  }
  return scores;
}
function classifyDomains(signals, text) {
  const source = text ?? signals.rawText ?? "";
  if (!source.trim()) {
    const empty = {};
    for (const key of Object.keys(domainKeywords)) empty[key] = 0;
    return {
      primary: "conversation",
      confidence: 0,
      domains: [{ domain: "conversation", weight: 1 }],
      rawScores: empty
    };
  }
  const raw = domainRawScores(signals, source);
  const entries = Object.keys(raw).map((domain) => ({ domain, score: raw[domain] })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  if (entries.length === 0) {
    return {
      primary: "conversation",
      confidence: 0,
      domains: [{ domain: "conversation", weight: 1 }],
      rawScores: raw
    };
  }
  const total = entries.reduce((sum, entry) => sum + entry.score, 0);
  const domains = entries.map((entry) => ({
    domain: entry.domain,
    weight: round2(entry.score / total)
  }));
  const weightSum = domains.reduce((sum, d) => sum + d.weight, 0);
  if (domains.length > 1 && Math.abs(weightSum - 1) > 1e-3) {
    domains[domains.length - 1].weight = round2(domains[domains.length - 1].weight + (1 - weightSum));
  }
  const top1 = entries[0].score;
  const top2 = entries.length > 1 ? entries[1].score : 0;
  const dominance = top2 === 0 ? 1 : top1 / (top1 + top2);
  const strength = clamp(top1 / 8, 0, 1);
  const confidence = round2(clamp(dominance * (0.5 + 0.5 * strength), 0, 1));
  return { primary: entries[0].domain, confidence, domains, rawScores: raw };
}
function gradeRisk(signals, text) {
  const source = text ?? signals.rawText ?? "";
  const analysis = analyzeRisk(source);
  const categoryNames = {
    destructive: "\u7834\u574F\u6027",
    financial: "\u8D44\u91D1",
    external: "\u5BF9\u5916\u53D1\u9001",
    system: "\u7CFB\u7EDF\u7EA7",
    permission: "\u6743\u9650"
  };
  const categories = [...analysis.categories].map((c) => categoryNames[c] || c);
  const hasExtreme = Boolean(source && EXTREME_PATTERNS.some((re) => re.test(source)));
  let level;
  if (hasExtreme || analysis.categories.size >= 3 && analysis.weighted >= 8) {
    level = "critical";
  } else if (analysis.weighted > 5 || analysis.categories.size >= 2) {
    level = "high";
  } else if (analysis.weighted > 2) {
    level = "medium";
  } else {
    level = "low";
  }
  const score = round2(clamp(
    analysis.weighted / 12 * 0.6 + analysis.categories.size / 5 * 0.4,
    0,
    1
  ));
  return { level, score, categories };
}
var EXTREME_KEYWORDS = [
  "\u5220\u5E93",
  "\u683C\u5F0F\u5316",
  "\u9500\u6BC1",
  "\u6E05\u7A7A",
  "\u62B9\u6389",
  "rm -rf",
  "drop table",
  "\u8F6C\u8D26",
  "\u6C47\u6B3E",
  "transfer money",
  "\u751F\u4EA7\u73AF\u5883",
  "\u7EBF\u4E0A\u73AF\u5883",
  "\u5185\u6838",
  "kernel",
  "\u7CFB\u7EDF\u7EA7",
  "root",
  "sudo",
  "chmod 777"
];
var EXTREME_PATTERNS = compileKeywords(EXTREME_KEYWORDS);
var INTENT_PATTERNS = [
  // 代码类
  { pattern: /(?:写|编写|实现|implement|write)\s*(?:一个|个|a|an)?\s*(?:函数|方法|function|class|类)/i, intent: "\u5B9E\u73B0\u4EE3\u7801" },
  { pattern: /(?:修复|fix|debug|调试|排查)\s*(?:bug|错误|问题|issue)?/i, intent: "\u4FEE\u590D\u7F3A\u9677" },
  { pattern: /(?:重构|refactor|优化|optimize|性能)/i, intent: "\u91CD\u6784\u4F18\u5316" },
  { pattern: /(?:解释|explain|讲讲|讲一下|介绍一下)\s*(?:代码|这段|这个函数|this)/i, intent: "\u4EE3\u7801\u8BB2\u89E3" },
  // 文件类
  { pattern: /(?:读取|读|write|写|创建|新建|删除|编辑|修改)\s*(?:文件|file|目录|folder)/i, intent: "\u6587\u4EF6\u64CD\u4F5C" },
  // 命令行
  { pattern: /(?:运行|执行|执行一下|run|execute)\s*(?:命令|command|脚本|script|npm|docker)/i, intent: "\u547D\u4EE4\u884C\u6267\u884C" },
  // 调研
  { pattern: /(?:搜索|查找|查一下|search|查找|调研|研究|research|了解|latest|最新)/i, intent: "\u4FE1\u606F\u68C0\u7D22" },
  // 数据分析
  { pattern: /(?:分析|统计|可视化|画图|chart|plot|analyze|数据)/i, intent: "\u6570\u636E\u5206\u6790" },
  // 创作（允许「写一首关于春天的诗」这类动词与名词间有修饰语）
  { pattern: /(?:写|创作|作|画|生成|来一首|来一篇)[^。；;]{0,12}(?:诗|诗歌|故事|小说|歌词|歌|散文|图|图片|image|poem|story|song)/i, intent: "\u5185\u5BB9\u521B\u4F5C" },
  // 写作
  { pattern: /(?:写|撰写|翻译|润色|改写|写篇|写一篇|article|blog|essay|translate)/i, intent: "\u6587\u672C\u5199\u4F5C" },
  // 规划
  { pattern: /(?:计划|规划|设计|方案|架构|plan|design|roadmap)/i, intent: "\u65B9\u6848\u89C4\u5212" },
  // 验证
  { pattern: /(?:测试|验证|检查|跑一下|运行测试|test|verify|check)/i, intent: "\u6D4B\u8BD5\u9A8C\u8BC1" },
  // 问答
  { pattern: /(?:是什么|为什么|怎么样|怎么看|如何|what|why|how|explain|解释)/i, intent: "\u77E5\u8BC6\u95EE\u7B54" },
  // 闲聊
  { pattern: /(?:你好|您好|hi|hello|谢谢|感谢|在吗|聊聊)/i, intent: "\u65E5\u5E38\u5BF9\u8BDD" }
];
function extractIntent(signals, text) {
  const source = text ?? signals.rawText ?? "";
  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(source)) return intent;
  }
  const fallback = {
    code: "\u4EE3\u7801\u76F8\u5173",
    file: "\u6587\u4EF6\u5904\u7406",
    shell: "\u547D\u4EE4\u6267\u884C",
    research: "\u4FE1\u606F\u68C0\u7D22",
    writing: "\u6587\u672C\u5199\u4F5C",
    data: "\u6570\u636E\u5904\u7406",
    creative: "\u521B\u610F\u5185\u5BB9",
    planning: "\u65B9\u6848\u89C4\u5212",
    qa: "\u6D4B\u8BD5\u9A8C\u8BC1",
    conversation: "\u65E5\u5E38\u5BF9\u8BDD"
  };
  if (source.trim().length === 0) return "\u7A7A\u8F93\u5165";
  return fallback[classifyDomains(signals, source).primary];
}
var TOOLS = {
  readFile: "read_file",
  writeFile: "write_file",
  editFile: "edit_file",
  deleteFile: "delete_file",
  listDir: "list_directory",
  shell: "run_command",
  webSearch: "web_search",
  webFetch: "web_fetch",
  codeSearch: "code_search",
  runTests: "run_tests",
  dataAnalysis: "data_analysis",
  imageGen: "image_generation",
  plan: "plan",
  taskList: "task_list"
};
var DOMAIN_TOOLS = {
  code: [TOOLS.codeSearch, TOOLS.readFile],
  file: [TOOLS.listDir, TOOLS.readFile],
  shell: [TOOLS.shell],
  research: [TOOLS.webSearch, TOOLS.webFetch],
  writing: [],
  data: [TOOLS.dataAnalysis],
  creative: [],
  planning: [TOOLS.plan, TOOLS.taskList],
  qa: [TOOLS.runTests, TOOLS.shell],
  conversation: []
};
function recommendTools(signals, primary) {
  const tools = [...DOMAIN_TOOLS[primary] || []];
  const add = (tool) => {
    if (!tools.includes(tool)) tools.push(tool);
  };
  if (signals.hasCode) {
    add(TOOLS.codeSearch);
    add(TOOLS.readFile);
  }
  if (signals.hasFileOp) add(TOOLS.readFile);
  if (Array.isArray(signals.fileRefs) && signals.fileRefs.length >= 2) add(TOOLS.readFile);
  if (signals.hasShell) add(TOOLS.shell);
  if (signals.hasResearch) {
    add(TOOLS.webSearch);
    add(TOOLS.webFetch);
  }
  if (signals.isTimeSensitive && signals.hasResearch) add(TOOLS.webFetch);
  if (signals.hasVerification) add(TOOLS.runTests);
  if (signals.hasData) add(TOOLS.dataAnalysis);
  if (signals.hasCreative) {
    if (/(?:图|图片|image|draw|paint|画一)/i.test(signals.rawText || "")) add(TOOLS.imageGen);
  }
  if (signals.hasMultiStep || signals.hasPlanning) add(TOOLS.taskList);
  if (signals.hasFileOp && /(?:创建|新建|写|写入|create|write)/i.test(signals.rawText || "")) add(TOOLS.writeFile);
  const externalNeed = signals.hasFileOp || signals.hasShell || signals.hasResearch || signals.hasCode || signals.hasData || Array.isArray(signals.fileRefs) && signals.fileRefs.length > 0;
  const needsTools = tools.length > 0 || externalNeed;
  return { needsTools, suggestedTools: tools };
}
function benefitsFromAutonomy(signals, classification, risk) {
  let positive = 0;
  if (signals.hasGoalLoop) positive += 2;
  if (signals.hasMultiStep) positive += 1.5;
  if (signals.hasPlanning) positive += 1;
  if (signals.hasVerification) positive += 1;
  positive += Math.min(classification.domains.length - 1, 2) * 0.5;
  positive += Math.min(signals.historyTurns || 0, 6) / 6;
  if (risk.level === "high" || risk.level === "critical") positive *= 0.3;
  if (signals.isTimeSensitive) positive *= 0.7;
  if (classification.primary === "conversation" && !signals.hasGoalLoop) return false;
  return positive >= 2 && (risk.level === "low" || risk.level === "medium" || signals.hasGoalLoop);
}
var TaskAnalyzerImpl = class {
  constructor(options = {}) {
    this.options = options;
  }
  analyze(signals) {
    const classification = classifyDomains(signals);
    const risk = gradeRisk(signals);
    const complexity = this.options.scorer ? this.options.scorer(signals) : scoreComplexity(signals);
    const intent = extractIntent(signals);
    const { needsTools, suggestedTools } = recommendTools(signals, classification.primary);
    const autonomy = benefitsFromAutonomy(signals, classification, risk);
    return {
      domain: classification.primary,
      confidence: classification.confidence,
      domains: classification.domains,
      complexity,
      risk: risk.level,
      intent,
      needsTools,
      suggestedTools,
      benefitsFromAutonomy: autonomy
    };
  }
};
var DEFAULT_TASK_ANALYZER = new TaskAnalyzerImpl();
function analyzeTask(signals) {
  return DEFAULT_TASK_ANALYZER.analyze(signals);
}

// src/shared/super/planning/dependencyGraph.ts
var DependencyGraphImpl = class {
  /** id -> PlanStep。对外暴露（契约要求），但修改请走本类方法 */
  nodes;
  /** id -> 它依赖的 id 列表 */
  edges;
  /** id -> 依赖它的 id 列表 */
  reverse;
  /**
   * 节点插入顺序。算法输出按此顺序稳定排列，
   * 避免 Map 迭代顺序在不同构建路径下造成测试抖动。
   */
  order = [];
  constructor(steps = []) {
    this.nodes = /* @__PURE__ */ new Map();
    this.edges = /* @__PURE__ */ new Map();
    this.reverse = /* @__PURE__ */ new Map();
    for (const step of steps) {
      if (step && typeof step.id === "string") this.insertNode(step);
    }
    for (const step of steps) {
      if (!step || typeof step.id !== "string") continue;
      const deps = step.dependsOn;
      if (!Array.isArray(deps)) continue;
      for (const dep of deps) {
        if (typeof dep === "string") this.connect(step.id, dep);
      }
    }
  }
  /* ── 内部原语：三张表的一致性维护 ───────────────────────── */
  /** 插入节点（重复 id 保留首次出现的定义），同时初始化两个邻接表 */
  insertNode(step) {
    if (this.nodes.has(step.id)) return false;
    this.nodes.set(step.id, step);
    this.edges.set(step.id, []);
    this.reverse.set(step.id, []);
    this.order.push(step.id);
    return true;
  }
  /** 建立 id -> depId 依赖边；自动去重，并保证两端节点已存在 */
  connect(id, depId) {
    if (!this.nodes.has(id) || !this.nodes.has(depId)) return false;
    const outgoing = this.edges.get(id);
    if (outgoing.includes(depId)) return false;
    outgoing.push(depId);
    const incoming = this.reverse.get(depId);
    if (!incoming.includes(id)) incoming.push(id);
    return true;
  }
  /** 移除一条依赖边，同步清理两个邻接表 */
  disconnect(id, depId) {
    const outgoing = this.edges.get(id);
    if (!outgoing) return false;
    const oi = outgoing.indexOf(depId);
    if (oi < 0) return false;
    outgoing.splice(oi, 1);
    const incoming = this.reverse.get(depId);
    if (incoming) {
      const ii = incoming.indexOf(id);
      if (ii >= 0) incoming.splice(ii, 1);
    }
    return true;
  }
  /* ── 公开的结构维护方法 ─────────────────────────────────── */
  /** 新增/替换一个节点（含其依赖）。返回是否真的插入了新节点 */
  addNode(step) {
    const inserted = this.insertNode(step);
    if (!inserted) return false;
    for (const dep of step.dependsOn ?? []) this.connect(step.id, dep);
    return true;
  }
  /** 删除节点，并把它从所有邻接表中摘除。返回是否删除成功 */
  removeNode(id) {
    if (!this.nodes.has(id)) return false;
    for (const dep of this.edges.get(id) ?? []) {
      const incoming = this.reverse.get(dep);
      if (incoming) {
        const i = incoming.indexOf(id);
        if (i >= 0) incoming.splice(i, 1);
      }
    }
    for (const dependent of this.reverse.get(id) ?? []) {
      const outgoing = this.edges.get(dependent);
      if (outgoing) {
        const i = outgoing.indexOf(id);
        if (i >= 0) outgoing.splice(i, 1);
      }
    }
    this.nodes.delete(id);
    this.edges.delete(id);
    this.reverse.delete(id);
    const oi = this.order.indexOf(id);
    if (oi >= 0) this.order.splice(oi, 1);
    return true;
  }
  /** 新增一条依赖边。返回 false 表示重复、或引用了不存在的节点 */
  addEdge(id, depId) {
    return this.connect(id, depId);
  }
  /** 删除一条依赖边。返回是否删除成功 */
  removeEdge(id, depId) {
    return this.disconnect(id, depId);
  }
  /** 是否存在该节点 */
  hasNode(id) {
    return this.nodes.has(id);
  }
  /** 节点数量 */
  get size() {
    return this.nodes.size;
  }
  /** 按插入顺序返回全部 id（副本） */
  orderedIds() {
    return [...this.order];
  }
  /** 取某节点的图摘要 */
  getNodeInfo(id) {
    const step = this.nodes.get(id);
    if (!step) return null;
    const deps = this.edges.get(id) ?? [];
    const dependents = this.reverse.get(id) ?? [];
    return {
      id,
      dependencies: [...deps],
      dependents: [...dependents],
      difficulty: this.clampDifficulty(step.estimatedDifficulty),
      inDegree: deps.length,
      outDegree: dependents.length
    };
  }
  /**
   * 自检三张表是否一致。返回问题描述数组，空数组表示健康。
   * 用途：单测断言、运行期诊断面板。
   */
  validate() {
    const problems = [];
    if (this.nodes.size !== this.edges.size || this.nodes.size !== this.reverse.size) {
      problems.push(
        `\u4E09\u8868\u5927\u5C0F\u4E0D\u4E00\u81F4\uFF1Anodes=${this.nodes.size} edges=${this.edges.size} reverse=${this.reverse.size}`
      );
    }
    if (this.order.length !== this.nodes.size) {
      problems.push(`\u987A\u5E8F\u8868\u4E0E\u8282\u70B9\u8868\u957F\u5EA6\u4E0D\u4E00\u81F4\uFF1Aorder=${this.order.length} nodes=${this.nodes.size}`);
    }
    for (const id of this.nodes.keys()) {
      if (!this.edges.has(id)) problems.push(`edges \u7F3A\u5C11\u8282\u70B9 ${id}`);
      if (!this.reverse.has(id)) problems.push(`reverse \u7F3A\u5C11\u8282\u70B9 ${id}`);
    }
    for (const id of this.order) {
      if (!this.nodes.has(id)) problems.push(`order \u542B\u672A\u77E5\u8282\u70B9 ${id}`);
    }
    for (const [id, deps] of this.edges) {
      const seen = /* @__PURE__ */ new Set();
      for (const dep of deps) {
        if (!this.nodes.has(dep)) {
          problems.push(`\u8282\u70B9 ${id} \u4F9D\u8D56\u4E86\u4E0D\u5B58\u5728\u7684\u8282\u70B9 ${dep}`);
          continue;
        }
        if (seen.has(dep)) {
          problems.push(`\u8282\u70B9 ${id} \u5BF9 ${dep} \u5B58\u5728\u91CD\u590D\u4F9D\u8D56`);
        }
        seen.add(dep);
        const back = this.reverse.get(dep) ?? [];
        if (!back.includes(id)) {
          problems.push(`reverse[${dep}] \u672A\u56DE\u6307 ${id}`);
        }
      }
    }
    for (const [id, dependents] of this.reverse) {
      for (const dependent of dependents) {
        if (!this.nodes.has(dependent)) {
          problems.push(`\u8282\u70B9 ${id} \u7684\u53CD\u5411\u8FB9\u6307\u5411\u4E0D\u5B58\u5728\u7684\u8282\u70B9 ${dependent}`);
          continue;
        }
        const out = this.edges.get(dependent) ?? [];
        if (!out.includes(id)) {
          problems.push(`edges[${dependent}] \u672A\u5305\u542B ${id}`);
        }
      }
    }
    return problems;
  }
  /* ── 核心图算法 ─────────────────────────────────────────── */
  /**
   * 分层拓扑排序（Kahn 算法的分层变体）。
   *
   * 定义：第 0 层是所有入度为 0 的节点；移除第 k 层后入度降为 0 的节点
   * 构成第 k+1 层。因此同一层内的节点互不依赖，可以并行执行。
   *
   * 环降级：若存在环（或环的后继），这些节点永远不会解锁。
   * 为不丢步骤，算法结束后把所有未处理节点按插入顺序放进最后一个"降级层"。
   * 调用方可借 detectCycle() 判断降级层是否由环造成。
   *
   * @returns 每层一个 id 数组；空图返回 []
   */
  topologicalLevels() {
    if (this.order.length === 0) return [];
    const inDegree = /* @__PURE__ */ new Map();
    for (const id of this.order) {
      inDegree.set(id, (this.edges.get(id) ?? []).length);
    }
    let current = this.order.filter((id) => (inDegree.get(id) ?? 0) === 0);
    const levels = [];
    const processed = /* @__PURE__ */ new Set();
    while (current.length > 0) {
      current = current.sort((a, b) => this.order.indexOf(a) - this.order.indexOf(b));
      levels.push([...current]);
      for (const id of current) processed.add(id);
      const next = [];
      for (const id of current) {
        for (const dependent of this.reverse.get(id) ?? []) {
          if (processed.has(dependent)) continue;
          const remaining = (inDegree.get(dependent) ?? 0) - 1;
          inDegree.set(dependent, remaining);
          if (remaining === 0) next.push(dependent);
        }
      }
      current = next;
    }
    const stranded = this.order.filter((id) => !processed.has(id));
    if (stranded.length > 0) levels.push(stranded);
    return levels;
  }
  /**
   * 加权关键路径：沿依赖链求 estimatedDifficulty 之和最大的路径。
   *
   * 递推：dist[id] = difficulty(id) + max{ dist[dep] | dep ∈ deps(id) }
   * 若没有前置，max 视为 0。用 topologicalLevels 的展平顺序作为计算序，
   * 保证处理 id 时其所有前置的 dist 已就绪（环内节点按降级顺序近似处理）。
   *
   * @returns 按依赖方向排列的 id 数组（起点 -> 终点）；空图返回 []
   */
  criticalPath() {
    if (this.order.length === 0) return [];
    const flatOrder = [];
    for (const level of this.topologicalLevels()) flatOrder.push(...level);
    const dist = /* @__PURE__ */ new Map();
    const prev = /* @__PURE__ */ new Map();
    for (const id of flatOrder) {
      let best = 0;
      let bestDep = null;
      for (const dep of this.edges.get(id) ?? []) {
        const dv = dist.get(dep);
        if (dv !== void 0 && dv > best) {
          best = dv;
          bestDep = dep;
        }
      }
      const weight = this.clampDifficulty(this.nodes.get(id)?.estimatedDifficulty ?? 0);
      dist.set(id, best + weight);
      prev.set(id, bestDep);
    }
    let endId = flatOrder[0];
    let bestDist = Number.NEGATIVE_INFINITY;
    for (const id of flatOrder) {
      const d = dist.get(id) ?? 0;
      if (d > bestDist) {
        bestDist = d;
        endId = id;
      }
    }
    const path = [];
    let cursor = endId;
    const guard = /* @__PURE__ */ new Set();
    while (cursor !== null && !guard.has(cursor)) {
      guard.add(cursor);
      path.push(cursor);
      cursor = prev.get(cursor) ?? null;
    }
    path.reverse();
    return path;
  }
  /**
   * 三色 DFS 环检测。
   *   白(0)：未访问；灰(1)：在当前递归栈中；黑(2)：已处理完毕。
   * 遇到指向灰色节点的边即为回边，说明存在环。
   *
   * @returns 环路径，首尾相同以闭合（如 [a, c, b, a]）；无环返回 null
   */
  detectCycle() {
    const color = /* @__PURE__ */ new Map();
    for (const id of this.order) color.set(id, 0);
    const stack = [];
    const visit = (id) => {
      color.set(id, 1);
      stack.push(id);
      for (const dep of this.edges.get(id) ?? []) {
        const c = color.get(dep) ?? 0;
        if (c === 1) {
          const start = stack.indexOf(dep);
          const cycle = start >= 0 ? stack.slice(start) : [dep];
          return [...cycle, dep];
        }
        if (c === 0) {
          const found = visit(dep);
          if (found) return found;
        }
      }
      stack.pop();
      color.set(id, 2);
      return null;
    };
    for (const id of this.order) {
      if ((color.get(id) ?? 0) === 0) {
        const found = visit(id);
        if (found) return found;
      }
    }
    return null;
  }
  /** 是否无环 */
  isAcyclic() {
    return this.detectCycle() === null;
  }
  /**
   * 环打破建议：枚举环上的每条依赖边，给出移除建议。
   * 推荐顺序按"被依赖步骤的难度"升序——移除低难度前置的代价更小。
   */
  suggestCycleBreaks() {
    const cycle = this.detectCycle();
    if (!cycle || cycle.length < 2) return [];
    const pairs = [];
    for (let i = 0; i < cycle.length - 1; i += 1) {
      const from = cycle[i];
      const to = cycle[i + 1];
      const difficulty = this.clampDifficulty(this.nodes.get(to)?.estimatedDifficulty ?? 0);
      pairs.push({ from, to, difficulty });
    }
    pairs.sort((a, b) => a.difficulty - b.difficulty || this.order.indexOf(a.from) - this.order.indexOf(b.from));
    return pairs.map((pair, index) => {
      const fromTitle = this.nodes.get(pair.from)?.title || pair.from;
      const toTitle = this.nodes.get(pair.to)?.title || pair.to;
      const recommended = index === 0;
      return {
        from: pair.from,
        to: pair.to,
        recommended,
        reason: `\u300C${fromTitle}\u300D\u4F9D\u8D56\u300C${toTitle}\u300D\u5F62\u6210\u5FAA\u73AF\u4F9D\u8D56\uFF1B\u88AB\u4F9D\u8D56\u6B65\u9AA4\u96BE\u5EA6\u4E3A ${pair.difficulty}\uFF0C${recommended ? "\u4F18\u5148\u79FB\u9664\u6B64\u4F9D\u8D56" : "\u53EF\u4F5C\u4E3A\u5907\u9009\u79FB\u9664"}\u4EE5\u6253\u7834\u73AF\u3002`
      };
    });
  }
  /**
   * 应用"推荐"的打破建议到当前图（就地修改），返回被移除的边数量。
   * 若没有环则不做任何改动。用于需要自动修复的降级路径。
   */
  applyRecommendedCycleBreak() {
    const suggestions = this.suggestCycleBreaks().filter((s) => s.recommended);
    let removed = 0;
    for (const s of suggestions) {
      if (this.disconnect(s.from, s.to)) removed += 1;
    }
    return removed;
  }
  /* ── 工具方法 ───────────────────────────────────────────── */
  /** 难度夹逼到 0-100，NaN/负数/超大值都归位 */
  clampDifficulty(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }
};
function buildDependencyGraph(steps) {
  return new DependencyGraphImpl(steps);
}
function buildConcreteDependencyGraph(steps) {
  return new DependencyGraphImpl(steps);
}

// src/shared/super/planning/planner.ts
var DOMAIN_TEMPLATES = {
  /* ── code：写代码/改代码 ───────────────────────────────── */
  code: [
    {
      key: "understand",
      title: "\u7406\u89E3\u4EE3\u7801\u9700\u6C42\u4E0E\u4E0A\u4E0B\u6587",
      description: "\u89E3\u6790\u7528\u6237\u610F\u56FE\uFF0C\u786E\u8BA4\u76EE\u6807\u51FD\u6570/\u6A21\u5757\u3001\u8F93\u5165\u8F93\u51FA\u7EA6\u675F\u4E0E\u9A8C\u6536\u6807\u51C6\u3002",
      deps: [],
      tools: ["read_file", "grep"],
      expectedOutput: "\u9700\u6C42\u8981\u70B9\u6E05\u5355\u4E0E\u6D89\u53CA\u6587\u4EF6\u5217\u8868",
      estimatedDifficulty: 25,
      parallelizable: false
    },
    {
      key: "scan",
      title: "\u626B\u63CF\u76F8\u5173\u4EE3\u7801\u7ED3\u6784",
      description: "\u8BFB\u53D6\u76EE\u6807\u6587\u4EF6\u53CA\u5176\u4F9D\u8D56\uFF0C\u8BC6\u522B\u73B0\u6709\u5B9E\u73B0\u98CE\u683C\u3001\u63A5\u53E3\u4E0E\u6D4B\u8BD5\u8986\u76D6\u3002",
      deps: ["understand"],
      tools: ["read_file", "list_dir", "grep"],
      expectedOutput: "\u4EE3\u7801\u7ED3\u6784\u56FE\u4E0E\u5173\u952E\u8C03\u7528\u70B9",
      estimatedDifficulty: 40,
      parallelizable: true
    },
    {
      key: "design",
      title: "\u8BBE\u8BA1\u5B9E\u73B0\u65B9\u6848",
      description: "\u786E\u5B9A\u6539\u52A8\u8303\u56F4\u3001\u6570\u636E\u7ED3\u6784\u4E0E\u8FB9\u754C\u5904\u7406\uFF0C\u8BC4\u4F30\u5BF9\u73B0\u6709\u63A5\u53E3\u7684\u5F71\u54CD\u3002",
      deps: ["scan"],
      tools: [],
      expectedOutput: "\u5206\u6B65\u5B9E\u73B0\u65B9\u6848\u4E0E\u98CE\u9669\u70B9",
      estimatedDifficulty: 55,
      parallelizable: false
    },
    {
      key: "implement",
      title: "\u7F16\u5199/\u4FEE\u6539\u4EE3\u7801",
      description: "\u6309\u65B9\u6848\u843D\u5730\u4EE3\u7801\u6539\u52A8\uFF0C\u4FDD\u6301\u547D\u540D\u4E0E\u98CE\u683C\u4E00\u81F4\uFF0C\u8865\u5145\u5FC5\u8981\u6CE8\u91CA\u3002",
      deps: ["design"],
      tools: ["write_file", "edit_file"],
      expectedOutput: "\u53EF\u8FD0\u884C\u7684\u4EE3\u7801\u6539\u52A8",
      estimatedDifficulty: 70,
      parallelizable: false
    },
    {
      key: "lint",
      title: "\u9759\u6001\u68C0\u67E5\u4E0E\u7C7B\u578B\u6821\u9A8C",
      description: "\u8FD0\u884C lint/\u7C7B\u578B\u68C0\u67E5\uFF0C\u4FEE\u6B63\u683C\u5F0F\u3001\u672A\u4F7F\u7528\u53D8\u91CF\u4E0E\u7C7B\u578B\u9519\u8BEF\u3002",
      deps: ["implement"],
      tools: ["shell", "read_file"],
      expectedOutput: "\u65E0 lint/\u7C7B\u578B\u9519\u8BEF\u7684\u6539\u52A8",
      estimatedDifficulty: 35,
      parallelizable: true
    },
    {
      key: "test",
      title: "\u7F16\u5199\u5E76\u8FD0\u884C\u6D4B\u8BD5",
      description: "\u8986\u76D6\u6B63\u5E38\u8DEF\u5F84\u4E0E\u8FB9\u754C\u6761\u4EF6\uFF0C\u8FD0\u884C\u76F8\u5173\u6D4B\u8BD5\u786E\u4FDD\u65E0\u56DE\u5F52\u3002",
      deps: ["implement"],
      tools: ["write_file", "shell"],
      expectedOutput: "\u901A\u8FC7\u7684\u6D4B\u8BD5\u7528\u4F8B\u4E0E\u8986\u76D6\u7387\u8BF4\u660E",
      estimatedDifficulty: 60,
      parallelizable: true
    },
    {
      key: "review",
      title: "\u81EA\u68C0\u4E0E\u6536\u5C3E",
      description: "\u590D\u67E5 diff\uFF0C\u786E\u8BA4\u65E0\u610F\u5916\u6539\u52A8\uFF0C\u6C47\u603B\u6539\u52A8\u8BF4\u660E\u4E0E\u4F7F\u7528\u63D0\u793A\u3002",
      deps: ["lint", "test"],
      tools: ["shell", "read_file"],
      expectedOutput: "\u6700\u7EC8 diff \u6458\u8981\u4E0E\u4EA4\u4ED8\u8BF4\u660E",
      estimatedDifficulty: 30,
      parallelizable: false
    }
  ],
  /* ── file：文件读写/整理 ───────────────────────────────── */
  file: [
    {
      key: "locate",
      title: "\u5B9A\u4F4D\u76EE\u6807\u6587\u4EF6",
      description: "\u6839\u636E\u8DEF\u5F84\u6216\u5173\u952E\u8BCD\u786E\u8BA4\u5F85\u64CD\u4F5C\u6587\u4EF6\u7684\u4F4D\u7F6E\u4E0E\u8303\u56F4\u3002",
      deps: [],
      tools: ["list_dir", "glob", "grep"],
      expectedOutput: "\u76EE\u6807\u6587\u4EF6\u8DEF\u5F84\u6E05\u5355",
      estimatedDifficulty: 25,
      parallelizable: true
    },
    {
      key: "inspect",
      title: "\u68C0\u67E5\u6587\u4EF6\u5185\u5BB9\u4E0E\u72B6\u6001",
      description: "\u8BFB\u53D6\u76EE\u6807\u6587\u4EF6\uFF0C\u786E\u8BA4\u7F16\u7801\u3001\u7ED3\u6784\u4E0E\u5F53\u524D\u5185\u5BB9\uFF0C\u8BC4\u4F30\u51B2\u7A81\u98CE\u9669\u3002",
      deps: ["locate"],
      tools: ["read_file"],
      expectedOutput: "\u6587\u4EF6\u5185\u5BB9\u6458\u8981\u4E0E\u98CE\u9669\u63D0\u793A",
      estimatedDifficulty: 30,
      parallelizable: true
    },
    {
      key: "backup",
      title: "\u5907\u4EFD\u5173\u952E\u6587\u4EF6",
      description: "\u5BF9\u9AD8\u4EF7\u503C\u6216\u5C06\u88AB\u8986\u76D6\u7684\u6587\u4EF6\u521B\u5EFA\u5907\u4EFD\uFF0C\u4FBF\u4E8E\u56DE\u6EDA\u3002",
      deps: ["inspect"],
      tools: ["copy_file"],
      expectedOutput: "\u5907\u4EFD\u6587\u4EF6\u8DEF\u5F84",
      estimatedDifficulty: 15,
      parallelizable: true
    },
    {
      key: "apply",
      title: "\u6267\u884C\u6587\u4EF6\u64CD\u4F5C",
      description: "\u6309\u7528\u6237\u8981\u6C42\u521B\u5EFA\u3001\u4FEE\u6539\u3001\u91CD\u547D\u540D\u6216\u5220\u9664\u6587\u4EF6\u3002",
      deps: ["inspect", "backup"],
      tools: ["write_file", "edit_file", "move_file", "delete_file"],
      expectedOutput: "\u5B8C\u6210\u540E\u7684\u6587\u4EF6\u72B6\u6001",
      estimatedDifficulty: 50,
      parallelizable: false
    },
    {
      key: "verify",
      title: "\u9A8C\u8BC1\u64CD\u4F5C\u7ED3\u679C",
      description: "\u91CD\u65B0\u8BFB\u53D6\u6587\u4EF6\u786E\u8BA4\u5185\u5BB9\u6B63\u786E\uFF0C\u68C0\u67E5\u65E0\u9057\u6F0F\u6216\u8BEF\u5220\u3002",
      deps: ["apply"],
      tools: ["read_file", "list_dir"],
      expectedOutput: "\u9A8C\u8BC1\u62A5\u544A",
      estimatedDifficulty: 25,
      parallelizable: true
    },
    {
      key: "summarize",
      title: "\u6C47\u603B\u53D8\u66F4",
      description: "\u5217\u51FA\u6240\u6709\u53D8\u66F4\u6587\u4EF6\u4E0E\u64CD\u4F5C\u7C7B\u578B\uFF0C\u7ED9\u51FA\u56DE\u6EDA\u63D0\u793A\u3002",
      deps: ["verify"],
      tools: [],
      expectedOutput: "\u53D8\u66F4\u6E05\u5355",
      estimatedDifficulty: 15,
      parallelizable: false
    }
  ],
  /* ── shell：命令/系统操作 ──────────────────────────────── */
  shell: [
    {
      key: "assess",
      title: "\u8BC4\u4F30\u547D\u4EE4\u98CE\u9669",
      description: "\u8BC6\u522B\u547D\u4EE4\u662F\u5426\u6D89\u53CA\u5220\u9664\u3001\u7CFB\u7EDF\u7EA7\u4FEE\u6539\u3001\u7F51\u7EDC\u6216\u4ED8\u8D39\u64CD\u4F5C\uFF0C\u786E\u5B9A\u62A4\u680F\u7B49\u7EA7\u3002",
      deps: [],
      tools: [],
      expectedOutput: "\u98CE\u9669\u8BC4\u4F30\u4E0E\u6267\u884C\u8BB8\u53EF\u5224\u65AD",
      estimatedDifficulty: 30,
      parallelizable: false
    },
    {
      key: "environment",
      title: "\u786E\u8BA4\u6267\u884C\u73AF\u5883",
      description: "\u68C0\u67E5\u64CD\u4F5C\u7CFB\u7EDF\u3001\u5DE5\u4F5C\u76EE\u5F55\u3001\u4F9D\u8D56\u5DE5\u5177\u662F\u5426\u5B58\u5728\u4E0E\u7248\u672C\u517C\u5BB9\u6027\u3002",
      deps: ["assess"],
      tools: ["shell"],
      expectedOutput: "\u73AF\u5883\u68C0\u67E5\u7ED3\u8BBA",
      estimatedDifficulty: 25,
      parallelizable: true
    },
    {
      key: "dryrun",
      title: "\u9884\u6F14\u547D\u4EE4\uFF08\u5982\u53EF\u884C\uFF09",
      description: "\u5BF9\u9AD8\u98CE\u9669\u547D\u4EE4\u5148\u505A dry-run \u6216\u6253\u5370\u5C55\u5F00\u540E\u7684\u53C2\u6570\uFF0C\u786E\u8BA4\u884C\u4E3A\u7B26\u5408\u9884\u671F\u3002",
      deps: ["environment"],
      tools: ["shell"],
      expectedOutput: "\u9884\u6F14\u8F93\u51FA",
      estimatedDifficulty: 35,
      parallelizable: false
    },
    {
      key: "execute",
      title: "\u6267\u884C\u547D\u4EE4",
      description: "\u5728\u786E\u8BA4\u5B89\u5168\u540E\u6267\u884C\u547D\u4EE4\uFF0C\u6355\u83B7 stdout/stderr \u4E0E\u9000\u51FA\u7801\u3002",
      deps: ["dryrun"],
      tools: ["shell"],
      expectedOutput: "\u547D\u4EE4\u8F93\u51FA\u4E0E\u9000\u51FA\u7801",
      estimatedDifficulty: 45,
      parallelizable: false
    },
    {
      key: "diagnose",
      title: "\u8BCA\u65AD\u4E0E\u91CD\u8BD5",
      description: "\u82E5\u5931\u8D25\uFF0C\u5206\u6790\u9519\u8BEF\u4FE1\u606F\u5E76\u7ED9\u51FA\u4FEE\u6B63\u547D\u4EE4\uFF0C\u6700\u591A\u6709\u9650\u6B21\u91CD\u8BD5\u3002",
      deps: ["execute"],
      tools: ["shell", "grep"],
      expectedOutput: "\u5931\u8D25\u8BCA\u65AD\u6216\u6210\u529F\u7ED3\u679C",
      estimatedDifficulty: 55,
      parallelizable: false
    },
    {
      key: "report",
      title: "\u62A5\u544A\u7ED3\u679C",
      description: "\u6C47\u603B\u547D\u4EE4\u6267\u884C\u7ED3\u679C\u3001\u5173\u952E\u8F93\u51FA\u4E0E\u540E\u7EED\u5EFA\u8BAE\u3002",
      deps: ["diagnose"],
      tools: [],
      expectedOutput: "\u6267\u884C\u62A5\u544A",
      estimatedDifficulty: 20,
      parallelizable: false
    }
  ],
  /* ── research：搜索/调研 ───────────────────────────────── */
  research: [
    {
      key: "scope",
      title: "\u754C\u5B9A\u8C03\u7814\u8303\u56F4",
      description: "\u62C6\u89E3\u95EE\u9898\u4E3A\u53EF\u641C\u7D22\u7684\u5B50\u95EE\u9898\uFF0C\u660E\u786E\u65F6\u95F4\u8303\u56F4\u4E0E\u53EF\u4FE1\u6765\u6E90\u8981\u6C42\u3002",
      deps: [],
      tools: [],
      expectedOutput: "\u5B50\u95EE\u9898\u6E05\u5355\u4E0E\u68C0\u7D22\u7B56\u7565",
      estimatedDifficulty: 30,
      parallelizable: false
    },
    {
      key: "collect",
      title: "\u5E76\u884C\u6536\u96C6\u8D44\u6599",
      description: "\u9488\u5BF9\u5404\u5B50\u95EE\u9898\u6267\u884C\u641C\u7D22\uFF0C\u8BB0\u5F55\u6765\u6E90\u3001\u65F6\u95F4\u4E0E\u5173\u952E\u7ED3\u8BBA\u3002",
      deps: ["scope"],
      tools: ["web_search", "read_url"],
      expectedOutput: "\u5E26\u6765\u6E90\u7684\u8D44\u6599\u6458\u5F55",
      estimatedDifficulty: 55,
      parallelizable: true
    },
    {
      key: "filter",
      title: "\u7B5B\u9009\u4E0E\u53BB\u91CD",
      description: "\u6309\u65F6\u6548\u6027\u3001\u6743\u5A01\u6027\u4E0E\u76F8\u5173\u6027\u8FC7\u6EE4\u8D44\u6599\uFF0C\u5254\u9664\u77DB\u76FE\u6216\u4F4E\u8D28\u91CF\u4FE1\u606F\u3002",
      deps: ["collect"],
      tools: [],
      expectedOutput: "\u7B5B\u9009\u540E\u7684\u8BC1\u636E\u96C6",
      estimatedDifficulty: 45,
      parallelizable: true
    },
    {
      key: "crosscheck",
      title: "\u4EA4\u53C9\u9A8C\u8BC1",
      description: "\u5BF9\u5173\u952E\u7ED3\u8BBA\u7528\u72EC\u7ACB\u6765\u6E90\u4EA4\u53C9\u9A8C\u8BC1\uFF0C\u6807\u6CE8\u4E0D\u786E\u5B9A\u6027\u3002",
      deps: ["filter"],
      tools: ["web_search", "read_url"],
      expectedOutput: "\u9A8C\u8BC1\u540E\u7684\u7ED3\u8BBA\u4E0E\u7F6E\u4FE1\u5EA6",
      estimatedDifficulty: 60,
      parallelizable: true
    },
    {
      key: "synthesize",
      title: "\u7EFC\u5408\u5F52\u7EB3",
      description: "\u628A\u8BC1\u636E\u7EC4\u7EC7\u6210\u7ED3\u6784\u5316\u7ED3\u8BBA\uFF0C\u533A\u5206\u4E8B\u5B9E\u3001\u63A8\u65AD\u4E0E\u5F85\u786E\u8BA4\u9879\u3002",
      deps: ["crosscheck"],
      tools: [],
      expectedOutput: "\u7ED3\u6784\u5316\u8C03\u7814\u7ED3\u8BBA",
      estimatedDifficulty: 50,
      parallelizable: false
    },
    {
      key: "cite",
      title: "\u6574\u7406\u5F15\u7528\u4E0E\u51FA\u5904",
      description: "\u4E3A\u6BCF\u4E2A\u7ED3\u8BBA\u9644\u6765\u6E90\u94FE\u63A5/\u51FA\u5904\uFF0C\u751F\u6210\u53C2\u8003\u5217\u8868\u3002",
      deps: ["synthesize"],
      tools: [],
      expectedOutput: "\u5F15\u7528\u5217\u8868",
      estimatedDifficulty: 20,
      parallelizable: false
    }
  ],
  /* ── writing：文档/文案写作 ────────────────────────────── */
  writing: [
    {
      key: "brief",
      title: "\u660E\u786E\u5199\u4F5C\u76EE\u6807",
      description: "\u786E\u5B9A\u53D7\u4F17\u3001\u8BED\u6C14\u3001\u7BC7\u5E45\u3001\u683C\u5F0F\u4E0E\u6838\u5FC3\u4FE1\u606F\u3002",
      deps: [],
      tools: [],
      expectedOutput: "\u5199\u4F5C\u7B80\u62A5",
      estimatedDifficulty: 20,
      parallelizable: false
    },
    {
      key: "outline",
      title: "\u62DF\u5B9A\u5927\u7EB2",
      description: "\u8BBE\u8BA1\u7ED3\u6784\uFF08\u5F00\u5934/\u4E3B\u4F53/\u7ED3\u5C3E\uFF09\u4E0E\u5404\u6BB5\u8981\u70B9\u3002",
      deps: ["brief"],
      tools: [],
      expectedOutput: "\u6587\u7AE0\u5927\u7EB2",
      estimatedDifficulty: 35,
      parallelizable: false
    },
    {
      key: "draft",
      title: "\u64B0\u5199\u521D\u7A3F",
      description: "\u6309\u5927\u7EB2\u5C55\u5F00\u6210\u5B8C\u6574\u521D\u7A3F\uFF0C\u4FDD\u8BC1\u903B\u8F91\u8FDE\u8D2F\u3001\u4FE1\u606F\u5B8C\u6574\u3002",
      deps: ["outline"],
      tools: [],
      expectedOutput: "\u5B8C\u6574\u521D\u7A3F",
      estimatedDifficulty: 55,
      parallelizable: false
    },
    {
      key: "enrich",
      title: "\u8865\u5145\u7EC6\u8282\u4E0E\u4F8B\u8BC1",
      description: "\u589E\u52A0\u6570\u636E\u3001\u6848\u4F8B\u6216\u4FEE\u8F9E\uFF0C\u4F7F\u5185\u5BB9\u66F4\u5177\u4F53\u53EF\u4FE1\u3002",
      deps: ["draft"],
      tools: ["web_search"],
      expectedOutput: "\u5145\u5B9E\u7684\u7A3F\u4EF6",
      estimatedDifficulty: 40,
      parallelizable: true
    },
    {
      key: "polish",
      title: "\u6DA6\u8272\u4E0E\u98CE\u683C\u7EDF\u4E00",
      description: "\u4F18\u5316\u63AA\u8F9E\u3001\u8282\u594F\u4E0E\u4E00\u81F4\u6027\uFF0C\u4FEE\u6B63\u75C5\u53E5\u4E0E\u9519\u522B\u5B57\u3002",
      deps: ["enrich"],
      tools: [],
      expectedOutput: "\u6DA6\u8272\u7A3F",
      estimatedDifficulty: 35,
      parallelizable: true
    },
    {
      key: "proofread",
      title: "\u6821\u5BF9\u5B9A\u7A3F",
      description: "\u6700\u7EC8\u6821\u5BF9\u683C\u5F0F\u3001\u6807\u70B9\u4E0E\u4E8B\u5B9E\uFF0C\u8F93\u51FA\u5B9A\u7A3F\u3002",
      deps: ["polish"],
      tools: [],
      expectedOutput: "\u6700\u7EC8\u7A3F\u4EF6",
      estimatedDifficulty: 25,
      parallelizable: false
    }
  ],
  /* ── data：数据处理/分析 ───────────────────────────────── */
  data: [
    {
      key: "define",
      title: "\u660E\u786E\u5206\u6790\u76EE\u6807",
      description: "\u786E\u5B9A\u8981\u56DE\u7B54\u7684\u95EE\u9898\u3001\u6307\u6807\u5B9A\u4E49\u4E0E\u8BC4\u4EF7\u6807\u51C6\u3002",
      deps: [],
      tools: [],
      expectedOutput: "\u5206\u6790\u76EE\u6807\u4E0E\u6307\u6807\u5B9A\u4E49",
      estimatedDifficulty: 25,
      parallelizable: false
    },
    {
      key: "load",
      title: "\u52A0\u8F7D\u4E0E\u68C0\u67E5\u6570\u636E",
      description: "\u8BFB\u53D6\u6570\u636E\u6E90\uFF0C\u68C0\u67E5\u7ED3\u6784\u3001\u7C7B\u578B\u3001\u7F3A\u5931\u503C\u4E0E\u5F02\u5E38\u503C\u3002",
      deps: ["define"],
      tools: ["read_file", "shell"],
      expectedOutput: "\u6570\u636E\u753B\u50CF\u4E0E\u8D28\u91CF\u62A5\u544A",
      estimatedDifficulty: 40,
      parallelizable: true
    },
    {
      key: "clean",
      title: "\u6570\u636E\u6E05\u6D17",
      description: "\u5904\u7406\u7F3A\u5931\u3001\u53BB\u91CD\u3001\u683C\u5F0F\u7EDF\u4E00\u4E0E\u5F02\u5E38\u503C\uFF0C\u8BB0\u5F55\u6E05\u6D17\u89C4\u5219\u3002",
      deps: ["load"],
      tools: ["shell", "write_file"],
      expectedOutput: "\u6E05\u6D17\u540E\u6570\u636E\u96C6\u4E0E\u89C4\u5219\u8BF4\u660E",
      estimatedDifficulty: 50,
      parallelizable: false
    },
    {
      key: "analyze",
      title: "\u5206\u6790\u4E0E\u5EFA\u6A21",
      description: "\u6267\u884C\u7EDF\u8BA1\u3001\u805A\u5408\u6216\u5EFA\u6A21\u8BA1\u7B97\uFF0C\u63D0\u53D6\u8D8B\u52BF\u4E0E\u76F8\u5173\u6027\u3002",
      deps: ["clean"],
      tools: ["shell", "code_interpreter"],
      expectedOutput: "\u5206\u6790\u7ED3\u679C\u4E0E\u5173\u952E\u6307\u6807",
      estimatedDifficulty: 70,
      parallelizable: true
    },
    {
      key: "visualize",
      title: "\u53EF\u89C6\u5316\u5448\u73B0",
      description: "\u751F\u6210\u56FE\u8868\u6216\u8868\u683C\uFF0C\u4F7F\u7ED3\u8BBA\u76F4\u89C2\u53EF\u8BFB\u3002",
      deps: ["analyze"],
      tools: ["code_interpreter", "write_file"],
      expectedOutput: "\u56FE\u8868/\u62A5\u8868\u6587\u4EF6",
      estimatedDifficulty: 45,
      parallelizable: true
    },
    {
      key: "interpret",
      title: "\u89E3\u8BFB\u4E0E\u7ED3\u8BBA",
      description: "\u89E3\u91CA\u7ED3\u679C\u542B\u4E49\uFF0C\u6307\u51FA\u5C40\u9650\u4E0E\u53EF\u884C\u52A8\u5EFA\u8BAE\u3002",
      deps: ["visualize"],
      tools: [],
      expectedOutput: "\u7ED3\u8BBA\u62A5\u544A",
      estimatedDifficulty: 40,
      parallelizable: false
    }
  ],
  /* ── creative：创作/设计 ───────────────────────────────── */
  creative: [
    {
      key: "inspire",
      title: "\u786E\u5B9A\u521B\u610F\u65B9\u5411",
      description: "\u660E\u786E\u4E3B\u9898\u3001\u98CE\u683C\u3001\u53D7\u4F17\u4E0E\u60C5\u611F\u57FA\u8C03\uFF0C\u6536\u96C6\u7075\u611F\u53C2\u8003\u3002",
      deps: [],
      tools: ["web_search"],
      expectedOutput: "\u521B\u610F\u65B9\u5411\u4E0E\u53C2\u8003",
      estimatedDifficulty: 30,
      parallelizable: true
    },
    {
      key: "brainstorm",
      title: "\u6784\u601D\u591A\u4E2A\u5907\u9009\u65B9\u6848",
      description: "\u53D1\u6563\u4EA7\u751F\u591A\u4E2A\u5019\u9009\u521B\u610F\uFF0C\u8BC4\u4F30\u72EC\u7279\u6027\u4E0E\u53EF\u884C\u6027\u3002",
      deps: ["inspire"],
      tools: [],
      expectedOutput: "\u5019\u9009\u521B\u610F\u6E05\u5355",
      estimatedDifficulty: 45,
      parallelizable: true
    },
    {
      key: "select",
      title: "\u9009\u5B9A\u5E76\u6DF1\u5316\u65B9\u6848",
      description: "\u4ECE\u4E2D\u9009\u62E9\u6700\u4F73\u65B9\u6848\uFF0C\u8865\u5145\u7EC6\u8282\u4E0E\u6267\u884C\u8DEF\u5F84\u3002",
      deps: ["brainstorm"],
      tools: [],
      expectedOutput: "\u6DF1\u5316\u7684\u521B\u610F\u65B9\u6848",
      estimatedDifficulty: 40,
      parallelizable: false
    },
    {
      key: "create",
      title: "\u521B\u4F5C\u521D\u7248\u4F5C\u54C1",
      description: "\u6309\u65B9\u6848\u4EA7\u51FA\u521D\u7248\u6587\u672C/\u56FE\u50CF/\u8BBE\u8BA1\u65B9\u6848\u3002",
      deps: ["select"],
      tools: ["generate_image", "write_file"],
      expectedOutput: "\u521D\u7248\u4F5C\u54C1",
      estimatedDifficulty: 65,
      parallelizable: false
    },
    {
      key: "iterate",
      title: "\u8FED\u4EE3\u6253\u78E8",
      description: "\u6839\u636E\u53CD\u9988\u6216\u81EA\u68C0\u6539\u8FDB\u4F5C\u54C1\uFF0C\u4F18\u5316\u7EC6\u8282\u4E0E\u6574\u4F53\u6548\u679C\u3002",
      deps: ["create"],
      tools: ["generate_image", "edit_file"],
      expectedOutput: "\u6539\u8FDB\u540E\u7684\u4F5C\u54C1",
      estimatedDifficulty: 50,
      parallelizable: false
    },
    {
      key: "deliver",
      title: "\u5B9A\u7A3F\u4E0E\u8BF4\u660E",
      description: "\u8F93\u51FA\u6700\u7EC8\u4F5C\u54C1\u5E76\u9644\u521B\u4F5C\u8BF4\u660E\u4E0E\u4F7F\u7528\u5EFA\u8BAE\u3002",
      deps: ["iterate"],
      tools: [],
      expectedOutput: "\u6700\u7EC8\u4F5C\u54C1\u4E0E\u8BF4\u660E",
      estimatedDifficulty: 20,
      parallelizable: false
    }
  ],
  /* ── planning：规划/架构 ───────────────────────────────── */
  planning: [
    {
      key: "goals",
      title: "\u660E\u786E\u76EE\u6807\u4E0E\u7EA6\u675F",
      description: "\u68B3\u7406\u76EE\u6807\u3001\u6210\u529F\u6807\u51C6\u3001\u8D44\u6E90\u9650\u5236\u4E0E\u65F6\u95F4\u7EA6\u675F\u3002",
      deps: [],
      tools: [],
      expectedOutput: "\u76EE\u6807\u4E0E\u7EA6\u675F\u6E05\u5355",
      estimatedDifficulty: 25,
      parallelizable: false
    },
    {
      key: "current",
      title: "\u76D8\u70B9\u73B0\u72B6",
      description: "\u8C03\u7814\u73B0\u6709\u7CFB\u7EDF/\u6D41\u7A0B\uFF0C\u8BC6\u522B\u75DB\u70B9\u4E0E\u53EF\u590D\u7528\u8D44\u4EA7\u3002",
      deps: ["goals"],
      tools: ["read_file", "list_dir", "web_search"],
      expectedOutput: "\u73B0\u72B6\u76D8\u70B9\u62A5\u544A",
      estimatedDifficulty: 40,
      parallelizable: true
    },
    {
      key: "options",
      title: "\u751F\u6210\u5907\u9009\u65B9\u6848",
      description: "\u63D0\u51FA\u591A\u4E2A\u53EF\u884C\u65B9\u6848\uFF0C\u6807\u6CE8\u5404\u81EA\u4F18\u7F3A\u70B9\u4E0E\u9002\u7528\u573A\u666F\u3002",
      deps: ["current"],
      tools: [],
      expectedOutput: "\u5907\u9009\u65B9\u6848\u5BF9\u6BD4",
      estimatedDifficulty: 55,
      parallelizable: true
    },
    {
      key: "evaluate",
      title: "\u8BC4\u4F30\u4E0E\u51B3\u7B56",
      description: "\u6309\u76EE\u6807\u4E0E\u7EA6\u675F\u5BF9\u65B9\u6848\u6253\u5206\uFF0C\u9009\u5B9A\u63A8\u8350\u65B9\u6848\u3002",
      deps: ["options"],
      tools: [],
      expectedOutput: "\u63A8\u8350\u65B9\u6848\u4E0E\u51B3\u7B56\u4F9D\u636E",
      estimatedDifficulty: 50,
      parallelizable: false
    },
    {
      key: "roadmap",
      title: "\u5236\u5B9A\u5B9E\u65BD\u8DEF\u7EBF\u56FE",
      description: "\u62C6\u5206\u91CC\u7A0B\u7891\u3001\u4EFB\u52A1\u4F9D\u8D56\u4E0E\u4F18\u5148\u7EA7\uFF0C\u4F30\u7B97\u5DE5\u4F5C\u91CF\u3002",
      deps: ["evaluate"],
      tools: [],
      expectedOutput: "\u5206\u9636\u6BB5\u8DEF\u7EBF\u56FE",
      estimatedDifficulty: 60,
      parallelizable: false
    },
    {
      key: "risks",
      title: "\u98CE\u9669\u4E0E\u7F13\u89E3",
      description: "\u8BC6\u522B\u5173\u952E\u98CE\u9669\uFF0C\u5236\u5B9A\u7F13\u89E3\u63AA\u65BD\u4E0E\u5E94\u6025\u9884\u6848\u3002",
      deps: ["roadmap"],
      tools: [],
      expectedOutput: "\u98CE\u9669\u6E05\u5355\u4E0E\u5BF9\u7B56",
      estimatedDifficulty: 40,
      parallelizable: true
    }
  ],
  /* ── qa：测试/验证/审查 ────────────────────────────────── */
  qa: [
    {
      key: "criteria",
      title: "\u5B9A\u4E49\u9A8C\u6536\u6807\u51C6",
      description: "\u660E\u786E\u88AB\u6D4B\u5BF9\u8C61\u3001\u6D4B\u8BD5\u8303\u56F4\u4E0E\u901A\u8FC7/\u5931\u8D25\u5224\u5B9A\u6761\u4EF6\u3002",
      deps: [],
      tools: [],
      expectedOutput: "\u9A8C\u6536\u6807\u51C6\u6E05\u5355",
      estimatedDifficulty: 25,
      parallelizable: false
    },
    {
      key: "cases",
      title: "\u8BBE\u8BA1\u6D4B\u8BD5\u7528\u4F8B",
      description: "\u8986\u76D6\u6B63\u5E38\u3001\u8FB9\u754C\u4E0E\u5F02\u5E38\u573A\u666F\uFF0C\u6807\u6CE8\u4F18\u5148\u7EA7\u3002",
      deps: ["criteria"],
      tools: [],
      expectedOutput: "\u6D4B\u8BD5\u7528\u4F8B\u96C6",
      estimatedDifficulty: 45,
      parallelizable: true
    },
    {
      key: "setup",
      title: "\u51C6\u5907\u6D4B\u8BD5\u73AF\u5883",
      description: "\u642D\u5EFA/\u786E\u8BA4\u8FD0\u884C\u73AF\u5883\u4E0E\u6D4B\u8BD5\u6570\u636E\u3002",
      deps: ["criteria"],
      tools: ["shell", "write_file"],
      expectedOutput: "\u5C31\u7EEA\u7684\u6D4B\u8BD5\u73AF\u5883",
      estimatedDifficulty: 35,
      parallelizable: true
    },
    {
      key: "execute",
      title: "\u6267\u884C\u6D4B\u8BD5",
      description: "\u8FD0\u884C\u7528\u4F8B\uFF0C\u8BB0\u5F55\u5B9E\u9645\u7ED3\u679C\u4E0E\u65E5\u5FD7\u3002",
      deps: ["cases", "setup"],
      tools: ["shell"],
      expectedOutput: "\u6D4B\u8BD5\u6267\u884C\u7ED3\u679C",
      estimatedDifficulty: 50,
      parallelizable: false
    },
    {
      key: "analyze",
      title: "\u7F3A\u9677\u5206\u6790",
      description: "\u5B9A\u4F4D\u5931\u8D25\u539F\u56E0\uFF0C\u533A\u5206\u4EA7\u54C1\u7F3A\u9677\u4E0E\u73AF\u5883\u95EE\u9898\uFF0C\u8BC4\u4F30\u4E25\u91CD\u5EA6\u3002",
      deps: ["execute"],
      tools: ["grep", "read_file"],
      expectedOutput: "\u7F3A\u9677\u62A5\u544A",
      estimatedDifficulty: 60,
      parallelizable: true
    },
    {
      key: "report",
      title: "\u8D28\u91CF\u62A5\u544A",
      description: "\u6C47\u603B\u901A\u8FC7\u7387\u3001\u9057\u7559\u95EE\u9898\u4E0E\u53D1\u5E03\u5EFA\u8BAE\u3002",
      deps: ["analyze"],
      tools: [],
      expectedOutput: "\u8D28\u91CF\u62A5\u544A\u4E0E\u7ED3\u8BBA",
      estimatedDifficulty: 30,
      parallelizable: false
    }
  ],
  /* ── conversation：普通对话（保底模板，短小） ──────────── */
  conversation: [
    {
      key: "understand",
      title: "\u7406\u89E3\u5BF9\u8BDD\u610F\u56FE",
      description: "\u8BC6\u522B\u7528\u6237\u60F3\u83B7\u5F97\u7684\u4FE1\u606F\u3001\u60C5\u7EEA\u4E0E\u671F\u671B\u7684\u56DE\u5E94\u65B9\u5F0F\u3002",
      deps: [],
      tools: [],
      expectedOutput: "\u610F\u56FE\u7406\u89E3",
      estimatedDifficulty: 15,
      parallelizable: false
    },
    {
      key: "respond",
      title: "\u7EC4\u7EC7\u56DE\u7B54",
      description: "\u57FA\u4E8E\u4E0A\u4E0B\u6587\u751F\u6210\u5207\u9898\u3001\u7B80\u6D01\u3001\u53CB\u597D\u7684\u56DE\u7B54\u3002",
      deps: ["understand"],
      tools: [],
      expectedOutput: "\u56DE\u7B54\u8349\u7A3F",
      estimatedDifficulty: 25,
      parallelizable: false
    },
    {
      key: "review",
      title: "\u81EA\u68C0\u56DE\u7B54",
      description: "\u786E\u8BA4\u56DE\u7B54\u51C6\u786E\u3001\u65E0\u5E7B\u89C9\u3001\u7B26\u5408\u8BED\u6C14\u8981\u6C42\u3002",
      deps: ["respond"],
      tools: [],
      expectedOutput: "\u6700\u7EC8\u56DE\u7B54",
      estimatedDifficulty: 15,
      parallelizable: false
    }
  ]
};
function parseUserSteps(rawText, hasMultiStep) {
  if (!rawText || typeof rawText !== "string") return [];
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const numbered = [];
  const numberedPattern = /^(?:[（(]?\d{1,2}[）).、]|[一二三四五六七八九十]{1,3}[、.]|step\s*\d+\s*[:：]?|第[一二三四五六七八九十\d]{1,3}步\s*[:：]?)\s*(.+)$/i;
  for (const line of lines) {
    const m = line.match(numberedPattern);
    if (m && m[1] && m[1].trim().length > 0) {
      numbered.push({ text: m[1].trim(), index: numbered.length + 1 });
    }
  }
  if (numbered.length >= 2) return numbered;
  const inline = rawText.match(/(?:\d{1,2}[).、]|（\d{1,2}）)\s*[^0-9]{2,}/g);
  if (inline && inline.length >= 2) {
    return inline.map((chunk, i) => ({
      text: chunk.replace(/^(?:\d{1,2}[).、]|（\d{1,2}）)\s*/, "").trim(),
      index: i + 1
    })).filter((s) => s.text.length > 0);
  }
  if (hasMultiStep) {
    const pieces = rawText.split(/[\n;；]+/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 200);
    if (pieces.length >= 2) {
      return pieces.map((text, i) => ({ text, index: i + 1 }));
    }
  }
  return [];
}
function shorten(text, max = 24) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "\u2026";
}
function estimateRounds(levels, analysis, steps) {
  if (levels.length === 0) return 1;
  const complexityBonus = {
    trivial: 0,
    simple: 0,
    moderate: 1,
    complex: 2,
    expert: 3
  };
  let rounds = levels.length + (complexityBonus[analysis.complexity.level] ?? 1);
  const hasVerify = steps.some((s) => /verify|test|qa|check|review|validate|lint/i.test(s.id + s.title));
  if (hasVerify && (analysis.risk === "high" || analysis.risk === "critical")) rounds += 1;
  if (analysis.benefitsFromAutonomy) rounds += 1;
  return Math.max(1, Math.round(rounds));
}
function selectTemplates(analysis) {
  const primary = DOMAIN_TEMPLATES[analysis.domain] ?? DOMAIN_TEMPLATES.conversation;
  if (analysis.confidence >= 0.5) return primary;
  const secondary = [...analysis.domains].filter((d) => d.domain !== analysis.domain && d.weight >= 0.3).sort((a, b) => b.weight - a.weight)[0];
  if (!secondary) return primary;
  const extra = DOMAIN_TEMPLATES[secondary.domain] ?? [];
  const merged = [...primary];
  const existingKeys = new Set(primary.map((t) => t.key));
  for (const t of extra) {
    if (existingKeys.has(t.key)) continue;
    if (/prepare|verify|check|test|review|analyze|scan|inspect|report/i.test(t.key)) {
      merged.push(t);
      existingKeys.add(t.key);
    }
  }
  return merged;
}
var TaskPlannerImpl = class {
  /**
   * 主入口：生成执行计划。
   *
   * 流程：
   *   1. 选模板 -> 分配 id -> 把 deps key 映射为真实 id -> 得到 steps；
   *   2. 若解析到显式用户步骤且数量合适，用它们替换/增强步骤；
   *   3. 建图 -> 校验依赖 -> 计算 levels / criticalPath / estimatedRounds；
   *   4. 返回 ExecutionPlan。
   */
  plan(analysis, signals) {
    const steps = this.buildSteps(analysis, signals);
    const graph = buildConcreteDependencyGraph(steps);
    if (!graph.isAcyclic()) {
      let guard = 0;
      while (!graph.isAcyclic() && guard < 10) {
        const removed = graph.applyRecommendedCycleBreak();
        if (removed === 0) break;
        guard += 1;
      }
    }
    this.syncDependsOnFromGraph(steps, graph);
    const levels = graph.topologicalLevels();
    const criticalPath = graph.criticalPath();
    const estimatedRounds = estimateRounds(levels, analysis, steps);
    return {
      goal: this.buildGoal(analysis, signals),
      steps,
      levels,
      estimatedRounds,
      criticalPath
    };
  }
  /**
   * 构建步骤列表（可被子类/测试单独调用）。
   */
  buildSteps(analysis, signals) {
    const templates = selectTemplates(analysis);
    const userSteps = parseUserSteps(signals?.rawText ?? "", Boolean(signals?.hasMultiStep));
    if (userSteps.length >= 2) {
      return this.buildFromUserSteps(templates, userSteps, analysis, signals);
    }
    return this.buildFromTemplates(templates, analysis, signals);
  }
  /* ── 模板 -> 步骤 ──────────────────────────────────────── */
  buildFromTemplates(templates, analysis, signals) {
    const prefix = this.idPrefix(analysis.domain);
    const keyToId = /* @__PURE__ */ new Map();
    templates.forEach((t, i) => keyToId.set(t.key, `${prefix}${i + 1}`));
    const steps = templates.map((t, i) => {
      const deps = t.deps.filter((k) => k !== t.key && keyToId.has(k)).map((k) => keyToId.get(k));
      const difficulty = this.adjustDifficulty(t.estimatedDifficulty, analysis, signals);
      return {
        id: `${prefix}${i + 1}`,
        title: t.title,
        description: t.description,
        dependsOn: deps,
        tools: this.resolveTools(t.tools, analysis),
        expectedOutput: t.expectedOutput,
        parallelizable: t.parallelizable && difficulty < 80,
        estimatedDifficulty: difficulty
      };
    });
    return steps;
  }
  /* ── 用户显式步骤 -> 步骤 ──────────────────────────────── */
  buildFromUserSteps(templates, userSteps, analysis, signals) {
    const prefix = this.idPrefix(analysis.domain);
    const steps = [];
    const understand = templates.find((t) => /understand|scope|brief|goals|criteria|assess|define|inspire|locate/i.test(t.key));
    if (understand) {
      steps.push({
        id: `${prefix}1`,
        title: understand.title,
        description: understand.description,
        dependsOn: [],
        tools: this.resolveTools(understand.tools, analysis),
        expectedOutput: understand.expectedOutput,
        parallelizable: false,
        estimatedDifficulty: this.adjustDifficulty(understand.estimatedDifficulty, analysis, signals)
      });
    }
    const baseIndex = steps.length;
    userSteps.forEach((u, i) => {
      const prevId = i === 0 && baseIndex > 0 ? `${prefix}1` : `${prefix}${baseIndex + i}`;
      steps.push({
        id: `${prefix}${baseIndex + i + 1}`,
        title: `\u6B65\u9AA4 ${u.index}: ${shorten(u.text)}`,
        description: u.text,
        dependsOn: prevId ? [prevId] : [],
        tools: this.inferToolsForText(u.text, analysis),
        expectedOutput: `\u5B8C\u6210\uFF1A${shorten(u.text, 30)}`,
        parallelizable: false,
        estimatedDifficulty: this.adjustDifficulty(
          35 + Math.min(40, Math.floor(u.text.length / 6)),
          analysis,
          signals
        )
      });
    });
    const verify = templates.find((t) => /verify|review|test|report|proofread|summarize|interpret|deliver|risks|cite/i.test(t.key));
    if (verify) {
      const lastId = steps[steps.length - 1]?.id;
      steps.push({
        id: `${prefix}${steps.length + 1}`,
        title: verify.title,
        description: verify.description,
        dependsOn: lastId ? [lastId] : [],
        tools: this.resolveTools(verify.tools, analysis),
        expectedOutput: verify.expectedOutput,
        parallelizable: false,
        estimatedDifficulty: this.adjustDifficulty(verify.estimatedDifficulty, analysis, signals)
      });
    }
    return steps;
  }
  /* ── 工具/难度/目标 辅助 ───────────────────────────────── */
  /**
   * 解析步骤工具：在模板建议之外，若分析器建议的工具未被包含，
   * 追加到第一个"执行类"步骤（而非所有步骤），避免工具建议泛滥。
   */
  resolveTools(templateTools, analysis) {
    const result = [...templateTools];
    if (analysis.needsTools && templateTools.length === 0) {
      for (const tool of analysis.suggestedTools.slice(0, 2)) {
        if (!result.includes(tool)) result.push(tool);
      }
    }
    return result;
  }
  /** 依据文本关键词推断单步工具 */
  inferToolsForText(text, analysis) {
    const tools = [];
    if (/搜索|查找资料|调研|latest|search/i.test(text)) tools.push("web_search");
    if (/读|打开|查看文件|read/i.test(text)) tools.push("read_file");
    if (/写|创建|生成文件|write/i.test(text)) tools.push("write_file");
    if (/运行|执行|命令|shell|bash/i.test(text)) tools.push("shell");
    if (/测试|验证|test/i.test(text)) tools.push("shell");
    if (tools.length === 0 && analysis.needsTools) tools.push(...analysis.suggestedTools.slice(0, 1));
    return [...new Set(tools)];
  }
  /** 难度随复杂度/风险微调，夹逼 0-100 */
  adjustDifficulty(base, analysis, signals) {
    const levelDelta = {
      trivial: -15,
      simple: -5,
      moderate: 0,
      complex: 8,
      expert: 14
    };
    const riskDelta = { low: 0, medium: 2, high: 6, critical: 10 };
    let value = base + (levelDelta[analysis.complexity.level] ?? 0) + (riskDelta[analysis.risk] ?? 0);
    if (signals?.hasHighRisk) value += 5;
    if (signals?.hasAttachment) value += 3;
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  /** 生成步骤 id 前缀（按领域，稳定且可读） */
  idPrefix(domain) {
    return `${domain}-`;
  }
  /** 构造目标描述：优先 intent，否则用原始文本摘要 */
  buildGoal(analysis, signals) {
    const intent = analysis?.intent?.trim();
    if (intent) return shorten(intent, 80);
    const raw = signals?.rawText?.trim();
    if (raw) return shorten(raw, 80);
    return "\u5B8C\u6210\u7528\u6237\u8BF7\u6C42";
  }
  /**
   * 把图的 edges 同步回 step.dependsOn。
   * 原因是环修复发生在图的邻接表上，而 steps 是原始对象；这里以图为准。
   */
  syncDependsOnFromGraph(steps, graph) {
    for (const step of steps) {
      const deps = graph.edges.get(step.id);
      if (deps) step.dependsOn = [...deps];
    }
  }
};
var defaultTaskPlanner = new TaskPlannerImpl();
function planTask(analysis, signals) {
  return defaultTaskPlanner.plan(analysis, signals);
}

// src/shared/super/planning/strategies.ts
var STRATEGY_DIRECT = Object.freeze({
  name: "direct",
  description: "\u5355\u6B21\u76F4\u63A5\u56DE\u7B54\uFF0C\u4E0D\u8C03\u7528\u5DE5\u5177\u3001\u4E0D\u505A\u9010\u8F6E\u9A8C\u8BC1\uFF0C\u9002\u5408\u7B80\u5355\u95EE\u7B54\u4E0E\u95F2\u804A\u3002",
  parallelTools: false,
  maxRounds: 1,
  verifyEachStep: false,
  allowAutonomy: false,
  fallbackOnFailure: null
});
var STRATEGY_SINGLE_TOOL = Object.freeze({
  name: "single_tool",
  description: "\u8C03\u7528\u4E00\u6B21\u6700\u76F8\u5173\u7684\u5DE5\u5177\u83B7\u53D6\u4FE1\u606F\u540E\u4F5C\u7B54\uFF0C\u4E0D\u8FDB\u5165\u591A\u8F6E\u5FAA\u73AF\u3002",
  parallelTools: false,
  maxRounds: 2,
  verifyEachStep: false,
  allowAutonomy: false,
  fallbackOnFailure: "direct"
});
var STRATEGY_ITERATIVE = Object.freeze({
  name: "iterative",
  description: "\u591A\u8F6E\u5DE5\u5177\u5FAA\u73AF\uFF0C\u6309\u8BA1\u5212\u5206\u9636\u6BB5\u6267\u884C\u5E76\u9010\u8F6E\u9A8C\u8BC1\uFF0C\u9002\u5408\u5E38\u89C4\u591A\u6B65\u9AA4\u4EFB\u52A1\u3002",
  parallelTools: true,
  maxRounds: 8,
  verifyEachStep: true,
  allowAutonomy: false,
  fallbackOnFailure: "single_tool"
});
var STRATEGY_AUTONOMOUS = Object.freeze({
  name: "autonomous",
  description: "\u81EA\u4E3B\u76EE\u6807\u95ED\u73AF\uFF0C\u5141\u8BB8\u81EA\u6211\u89C4\u5212\u3001\u91CD\u8BD5\u4E0E\u6536\u655B\u5224\u65AD\uFF0C\u9002\u5408\u76EE\u6807\u660E\u786E\u7684\u591A\u9636\u6BB5\u4EFB\u52A1\u3002",
  parallelTools: true,
  maxRounds: 12,
  verifyEachStep: true,
  allowAutonomy: true,
  fallbackOnFailure: "iterative"
});
var STRATEGY_DEEP = Object.freeze({
  name: "deep",
  description: "\u6DF1\u5EA6\u5DE5\u7A0B\u6A21\u5F0F\uFF0C\u542F\u7528\u5168\u5957\u62A4\u680F\u4E0E\u4E25\u683C\u9010\u6B65\u9A8C\u8BC1\uFF0C\u9002\u5408\u9AD8\u98CE\u9669\u590D\u6742\u4EFB\u52A1\u3002",
  parallelTools: true,
  maxRounds: 16,
  verifyEachStep: true,
  allowAutonomy: true,
  fallbackOnFailure: "autonomous"
});
var STRATEGY_PARALLEL_SWIFT = Object.freeze({
  name: "iterative",
  // 对外仍映射到 iterative 内核，但参数被覆盖
  description: "\u5E76\u884C\u5FEB\u5BA1\uFF1A\u5728\u4F4E\u98CE\u9669\u3001\u9AD8\u5E76\u884C\u5EA6\u573A\u666F\u4E0B\u5173\u95ED\u9010\u8F6E\u9A8C\u8BC1\u4EE5\u63D0\u901F\u3002",
  parallelTools: true,
  maxRounds: 6,
  verifyEachStep: false,
  allowAutonomy: false,
  fallbackOnFailure: "single_tool"
});
var BUILTIN_STRATEGIES = {
  direct: STRATEGY_DIRECT,
  single_tool: STRATEGY_SINGLE_TOOL,
  iterative: STRATEGY_ITERATIVE,
  autonomous: STRATEGY_AUTONOMOUS,
  deep: STRATEGY_DEEP
};
function initialScores() {
  return { direct: 0, single_tool: 0, iterative: 0, autonomous: 0, deep: 0 };
}
var RISK_WEIGHT = { low: 0, medium: 1, high: 2, critical: 3 };
var COMPLEXITY_WEIGHT = {
  trivial: 0,
  simple: 1,
  moderate: 2,
  complex: 3,
  expert: 4
};
function planFeatures(plan) {
  if (!plan) return { stepCount: 0, levelCount: 0, criticalDepth: 0, parallelRatio: 0 };
  const stepCount = plan.steps?.length ?? 0;
  const levelCount = plan.levels?.length ?? 0;
  const criticalDepth = plan.criticalPath?.length ?? 0;
  const parallelSteps = (plan.steps ?? []).filter((s) => s.parallelizable).length;
  const parallelRatio = stepCount > 0 ? parallelSteps / stepCount : 0;
  return { stepCount, levelCount, criticalDepth, parallelRatio };
}
var StrategyPickerImpl = class {
  /** 字面量类型的字段集，便于统一覆盖 */
  editableFields = [
    "name",
    "description",
    "parallelTools",
    "maxRounds",
    "verifyEachStep",
    "allowAutonomy",
    "fallbackOnFailure"
  ];
  /**
   * 契约入口：返回 ExecutionStrategy。
   */
  pick(analysis, plan) {
    return this.pickWithExplanation(analysis, plan).strategy;
  }
  /**
   * 可解释版本：返回策略、全部打分、理由与覆盖记录。
   * 诊断面板可直接展示 scores/reasons。
   */
  pickWithExplanation(analysis, plan) {
    const scores = initialScores();
    const reasons = [];
    const features = planFeatures(plan);
    const complexity = analysis?.complexity?.level ?? "simple";
    const complexityScore = analysis?.complexity?.score ?? 0;
    const risk = analysis?.risk ?? "low";
    const complexityWeight = COMPLEXITY_WEIGHT[complexity] ?? 1;
    const riskWeight = RISK_WEIGHT[risk] ?? 0;
    if (complexity === "trivial" || complexity === "simple") {
      scores.direct += 3;
      reasons.push(`\u590D\u6742\u5EA6\u4E3A ${complexity}\uFF0C\u504F\u5411\u76F4\u63A5\u56DE\u7B54\uFF08direct +3\uFF09\u3002`);
    } else if (complexity === "moderate") {
      scores.iterative += 2;
      scores.single_tool += 1;
      reasons.push("\u590D\u6742\u5EA6\u4E3A moderate\uFF0C\u504F\u5411\u8FED\u4EE3\u5FAA\u73AF\uFF08iterative +2\uFF09\u3002");
    } else if (complexity === "complex") {
      scores.iterative += 2;
      scores.autonomous += 2;
      scores.deep += 2;
      reasons.push("\u590D\u6742\u5EA6\u4E3A complex\uFF0C\u8FED\u4EE3/\u81EA\u4E3B/\u6DF1\u5EA6\u7B56\u7565\u5747\u52A0\u5206\u3002");
    } else {
      scores.deep += 4;
      scores.autonomous += 1;
      reasons.push("\u590D\u6742\u5EA6\u4E3A expert\uFF0C\u5F3A\u70C8\u504F\u5411\u6DF1\u5EA6\u5DE5\u7A0B\uFF08deep +4\uFF09\u3002");
    }
    if (complexityScore >= 75) {
      scores.deep += 1;
      reasons.push(`\u7EFC\u5408\u590D\u6742\u5EA6\u5206 ${complexityScore} >= 75\uFF0Cdeep \u989D\u5916 +1\u3002`);
    }
    if (riskWeight >= 2) {
      scores.deep += riskWeight;
      reasons.push(`\u98CE\u9669\u7B49\u7EA7 ${risk}\uFF08\u6743\u91CD ${riskWeight}\uFF09\uFF0Cdeep \u52A0 ${riskWeight} \u5206\u4EE5\u542F\u7528\u4E25\u683C\u62A4\u680F\u3002`);
    } else if (riskWeight === 1) {
      scores.iterative += 1;
      reasons.push("\u98CE\u9669\u7B49\u7EA7 medium\uFF0Citerative \u52A0 1 \u5206\u4EE5\u4FDD\u7559\u9010\u8F6E\u9A8C\u8BC1\u3002");
    } else {
      scores.direct += 1;
      reasons.push("\u98CE\u9669\u7B49\u7EA7 low\uFF0Cdirect \u52A0 1 \u5206\u3002");
    }
    const toolCount = analysis?.suggestedTools?.length ?? 0;
    if (!analysis?.needsTools) {
      scores.direct += 2;
      reasons.push("\u4EFB\u52A1\u4E0D\u9700\u8981\u5DE5\u5177\uFF0Cdirect \u52A0 2 \u5206\u3002");
    } else if (toolCount <= 1 && complexityWeight <= 2) {
      scores.single_tool += 3;
      reasons.push(`\u4EC5\u9700\u5DE5\u5177\u4E14\u5EFA\u8BAE\u5DE5\u5177\u6570=${toolCount}\uFF0Csingle_tool \u52A0 3 \u5206\u3002`);
    } else {
      scores.iterative += 2;
      reasons.push(`\u9700\u8981\u591A\u5DE5\u5177\u534F\u4F5C\uFF08\u5EFA\u8BAE\u5DE5\u5177\u6570=${toolCount}\uFF09\uFF0Citerative \u52A0 2 \u5206\u3002`);
    }
    if (analysis?.benefitsFromAutonomy) {
      scores.autonomous += 4;
      if (complexityWeight >= 3) {
        scores.autonomous += 2;
        scores.deep += 2;
      }
      reasons.push("\u4EFB\u52A1\u9002\u5408\u81EA\u4E3B\u95ED\u73AF\uFF0Cautonomous \u52A0 4 \u5206" + (complexityWeight >= 3 ? "\uFF08\u590D\u6742\u4EFB\u52A1\u989D\u5916 +2 \u5E76\u63A8\u9AD8 deep +2\uFF09\u3002" : "\u3002"));
    } else {
      scores.direct += 0.5;
      scores.iterative += 0.5;
      reasons.push("\u4EFB\u52A1\u4E0D\u7279\u522B\u53D7\u76CA\u81EA\u4E3B\uFF0C\u8F7B\u5FAE\u504F\u5411\u975E\u81EA\u4E3B\u7B56\u7565\u3002");
    }
    if (features.stepCount <= 1) {
      scores.direct += 1.5;
      reasons.push(`\u8BA1\u5212\u4EC5 ${features.stepCount} \u6B65\uFF0Cdirect \u52A0 1.5 \u5206\u3002`);
    } else if (features.stepCount <= 3) {
      scores.single_tool += 1.5;
      reasons.push(`\u8BA1\u5212 ${features.stepCount} \u6B65\uFF0Csingle_tool \u52A0 1.5 \u5206\u3002`);
    } else {
      scores.iterative += 1.5;
      reasons.push(`\u8BA1\u5212 ${features.stepCount} \u6B65\uFF08\u591A\u6B65\u9AA4\uFF09\uFF0Citerative \u52A0 1.5 \u5206\u3002`);
    }
    if (features.stepCount >= 8 || features.criticalDepth >= 6) {
      scores.deep += 2;
      reasons.push(
        `\u8BA1\u5212\u89C4\u6A21\u8F83\u5927\uFF08steps=${features.stepCount}\uFF0Ccritical=${features.criticalDepth}\uFF09\uFF0Cdeep \u52A0 2 \u5206\u3002`
      );
    }
    if (features.parallelRatio >= 0.5 && riskWeight <= 1) {
      scores.iterative += 1;
      reasons.push(`\u53EF\u5E76\u884C\u6B65\u9AA4\u5360\u6BD4 ${Math.round(features.parallelRatio * 100)}% \u4E14\u98CE\u9669\u4F4E\uFF0Citerative \u52A0 1 \u5206\u3002`);
    }
    const baseKey = this.argmax(scores);
    const overrides = [];
    let strategy = this.copyStrategy(BUILTIN_STRATEGIES[baseKey]);
    if (baseKey === "iterative" && features.parallelRatio >= 0.6 && riskWeight === 0 && complexityWeight <= 2 && features.stepCount >= 3) {
      overrides.push(
        { field: "verifyEachStep", from: strategy.verifyEachStep, to: false, reason: "\u4F4E\u98CE\u9669\u9AD8\u5E76\u884C\uFF0C\u8DF3\u8FC7\u9010\u8F6E\u9A8C\u8BC1\u4EE5\u63D0\u901F" },
        { field: "maxRounds", from: strategy.maxRounds, to: STRATEGY_PARALLEL_SWIFT.maxRounds, reason: "\u4F4E\u98CE\u9669\u9AD8\u5E76\u884C\uFF0C\u6536\u7D27\u8F6E\u6B21\u4E0A\u9650" }
      );
      strategy.verifyEachStep = STRATEGY_PARALLEL_SWIFT.verifyEachStep;
      strategy.maxRounds = STRATEGY_PARALLEL_SWIFT.maxRounds;
      reasons.push("\u5E94\u7528\u7EC4\u5408\u7B56\u7565\u300C\u5E76\u884C\u5FEB\u5BA1\u300D\uFF1A\u5173\u95ED\u9010\u8F6E\u9A8C\u8BC1\u5E76\u6536\u7D27\u8F6E\u6B21\u3002");
    }
    const minRounds = Math.max(1, features.criticalDepth + 1);
    if (strategy.maxRounds < minRounds && baseKey !== "direct") {
      overrides.push({
        field: "maxRounds",
        from: strategy.maxRounds,
        to: minRounds,
        reason: `\u5173\u952E\u8DEF\u5F84\u6DF1\u5EA6 ${features.criticalDepth} \u9700\u8981\u81F3\u5C11 ${minRounds} \u8F6E`
      });
      strategy.maxRounds = minRounds;
      reasons.push(`\u4E0A\u8C03 maxRounds \u81F3 ${minRounds} \u4EE5\u8986\u76D6\u5173\u952E\u8DEF\u5F84\u3002`);
    }
    if (riskWeight >= 2 && !strategy.verifyEachStep) {
      overrides.push({
        field: "verifyEachStep",
        from: strategy.verifyEachStep,
        to: true,
        reason: `\u98CE\u9669\u7B49\u7EA7 ${risk} \u5FC5\u987B\u9010\u8F6E\u9A8C\u8BC1`
      });
      strategy.verifyEachStep = true;
      reasons.push("\u9AD8\u98CE\u9669\u5F3A\u5236\u6253\u5F00 verifyEachStep\u3002");
    }
    if (baseKey === "direct" && features.stepCount >= 2 && this.planHasVerification(plan)) {
      const upgrade = this.copyStrategy(BUILTIN_STRATEGIES.single_tool);
      overrides.push({
        field: "name",
        from: strategy.name,
        to: upgrade.name,
        reason: "\u8BA1\u5212\u542B\u9A8C\u8BC1\u6B65\u9AA4\uFF0Cdirect \u4E0D\u8DB3\u4EE5\u4FDD\u8BC1\u8D28\u91CF\uFF0C\u5347\u7EA7\u4E3A single_tool"
      });
      strategy = upgrade;
      reasons.push("\u8BA1\u5212\u542B\u9A8C\u8BC1\u6B65\u9AA4\uFF0Cdirect \u5347\u7EA7\u4E3A single_tool\u3002");
    }
    this.assertValid(strategy);
    return { strategy, scores, reasons, overrides };
  }
  /**
   * 组合两个策略：以 primary 为底，用 secondary 的非默认字段覆盖。
   * 用于上游需要手动合成策略的场景（例如 AB 测试）。
   */
  combine(primary, secondary) {
    const result = this.copyStrategy(primary);
    for (const field of this.editableFields) {
      const secondaryValue = secondary[field];
      if (field === "maxRounds") {
        const p = primary.maxRounds ?? 0;
        const s = secondary.maxRounds ?? 0;
        result.maxRounds = Math.max(p, s);
      } else if (typeof secondaryValue === "boolean" && secondaryValue === true) {
        ;
        result[field] = true;
      }
    }
    result.description = `${result.description}\uFF08\u7EC4\u5408\u81EA ${secondary.name}\uFF09`;
    return result;
  }
  /**
   * 根据运行时 failure 覆盖策略的 fallback。
   * 返回一个新策略，不修改原对象。
   */
  withFallback(strategy, fallback) {
    const result = this.copyStrategy(strategy);
    result.fallbackOnFailure = fallback;
    return result;
  }
  /* ── 内部工具 ─────────────────────────────────────────── */
  /** 取分数最大者；平局时按固定优先级打破（deep > autonomous > iterative > single_tool > direct） */
  argmax(scores) {
    const priority = ["deep", "autonomous", "iterative", "single_tool", "direct"];
    let best = priority[priority.length - 1];
    for (const key of priority) {
      if (scores[key] > scores[best]) best = key;
    }
    return best;
  }
  /** 浅拷贝策略（常量是 frozen，必须拷贝后才能改） */
  copyStrategy(source) {
    return {
      name: source.name,
      description: source.description,
      parallelTools: source.parallelTools,
      maxRounds: source.maxRounds,
      verifyEachStep: source.verifyEachStep,
      allowAutonomy: source.allowAutonomy,
      fallbackOnFailure: source.fallbackOnFailure
    };
  }
  /**
   * 计划是否包含"需要工具"的验证类步骤。
   * 注意：纯对话模板里的"自检"步骤不带任何工具，属于推理自省，
   * 不应触发 direct -> single_tool 的升级；只有真正要跑工具校验才算。
   */
  planHasVerification(plan) {
    if (!plan?.steps) return false;
    return plan.steps.some(
      (s) => /verify|test|check|qa|lint|validate/i.test(s.id + s.title) && (s.tools?.length ?? 0) > 0
    );
  }
  /** 策略字段合法性自检 */
  assertValid(strategy) {
    if (typeof strategy.name !== "string" || strategy.name.length === 0) {
      throw new Error("\u7B56\u7565 name \u975E\u6CD5");
    }
    if (!Number.isFinite(strategy.maxRounds) || strategy.maxRounds < 1) {
      throw new Error(`\u7B56\u7565 maxRounds \u975E\u6CD5: ${strategy.maxRounds}`);
    }
  }
};
var defaultStrategyPicker = new StrategyPickerImpl();
function pickStrategy(analysis, plan) {
  return defaultStrategyPicker.pick(analysis, plan);
}

// src/shared/super/routing/router.ts
var VOTE_WEIGHT = {
  risk: 3.2,
  complexity: 3,
  tool: 2.2,
  autonomy: 4.5,
  // 自主闭环是强信号：用户明确要求「直到完成/全部」时不应被轻策略拦截
  domain: 1.6,
  plan: 1.4,
  strategy: 0.8,
  constraint: 100
  // 硬约束：数值大到必然压过任何投票
};
var COMPLEXITY_ROUND_DELTA = {
  trivial: -2,
  simple: 0,
  moderate: 2,
  complex: 5,
  expert: 9
};
var COMPLEXITY_TOKEN_BASE = {
  trivial: 4096,
  simple: 8192,
  moderate: 16384,
  complex: 32768,
  expert: 65536
};
var DOMAIN_TEMPERATURE = {
  creative: 1,
  writing: 0.85,
  conversation: 0.75,
  planning: 0.55,
  research: 0.45,
  qa: 0.15,
  code: 0.2,
  file: 0.2,
  shell: 0.1,
  data: 0.25
};
var TOOL_ORIENTED_DOMAINS = /* @__PURE__ */ new Set([
  "code",
  "file",
  "shell",
  "data",
  "qa"
]);
var VERIFICATION_DOMAINS = /* @__PURE__ */ new Set([
  "code",
  "shell",
  "qa",
  "data"
]);
var ELEVATED_RISK = /* @__PURE__ */ new Set(["high", "critical"]);
var STRATEGY_KERNEL = {
  direct: "pro",
  single_tool: "pro",
  iterative: "super",
  autonomous: "auto",
  deep: "ultra"
};
var STRATEGY_BASE_ROUNDS = {
  direct: 1,
  single_tool: 2,
  iterative: 8,
  autonomous: 14,
  deep: 20
};
function clamp2(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
function round3(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function unique(items) {
  return Array.from(new Set(items));
}
function unit(value) {
  return clamp2(value, 0, 1);
}
function buildContext(analysis, plan, strategy) {
  const stepCount = Math.max(0, plan.steps?.length ?? 0);
  const planTools = unique(plan.steps.flatMap((step) => step.tools ?? []));
  const difficulties = (plan.steps ?? []).map((step) => clamp2(step.estimatedDifficulty ?? 0, 0, 100));
  const avgDifficulty = difficulties.length > 0 ? difficulties.reduce((sum, d) => sum + d, 0) / difficulties.length : analysis.complexity.score;
  const criticalLength = Math.max(0, plan.criticalPath?.length ?? 0);
  return {
    analysis,
    plan,
    strategy,
    stepCount,
    planTools,
    avgDifficulty,
    complexityScore: clamp2(analysis.complexity.score, 0, 100),
    criticalLength
  };
}
function riskRules(ctx) {
  const { risk } = ctx.analysis;
  const rules = [];
  if (risk === "critical") {
    rules.push({
      tag: "risk",
      name: "critical-risk-forces-deep",
      evaluate: () => [{
        tag: "risk",
        strategy: "deep",
        kernel: "ultra",
        weight: VOTE_WEIGHT.risk * 1.6,
        reason: "\u98CE\u9669\u7B49\u7EA7\u4E3A critical\uFF1A\u5FC5\u987B\u4F7F\u7528 deep \u7B56\u7565 + ultra \u5185\u6838\uFF0C\u5E76\u5F3A\u5236\u5F00\u542F\u62A4\u680F\u4E0E\u9A8C\u8BC1",
        patch: { enableGuardrails: true, enableVerification: true }
      }]
    });
    return rules;
  }
  if (risk === "high") {
    rules.push({
      tag: "risk",
      name: "high-risk-prefers-deep",
      evaluate: () => [
        {
          tag: "risk",
          strategy: "deep",
          kernel: "ultra",
          weight: VOTE_WEIGHT.risk,
          reason: "\u98CE\u9669\u7B49\u7EA7\u4E3A high\uFF1A\u503E\u5411 deep \u7B56\u7565\u4E0E ultra \u5185\u6838\u4EE5\u83B7\u5F97\u5B8C\u6574\u62A4\u680F",
          patch: { enableGuardrails: true }
        },
        {
          tag: "risk",
          strategy: "iterative",
          weight: VOTE_WEIGHT.risk * 0.45,
          reason: "\u98CE\u9669\u7B49\u7EA7\u4E3A high\uFF1A\u5373\u4FBF\u4E0D\u505A\u6DF1\u5EA6\u5DE5\u7A0B\u4E5F\u5E94\u4FDD\u7559\u591A\u8F6E\u8FED\u4EE3\u4EE5\u4FBF\u9010\u6B65\u6821\u9A8C"
        }
      ]
    });
    return rules;
  }
  if (risk === "medium") {
    rules.push({
      tag: "risk",
      name: "medium-risk-needs-verification",
      evaluate: () => [{
        tag: "risk",
        strategy: "iterative",
        weight: VOTE_WEIGHT.risk * 0.3,
        reason: "\u98CE\u9669\u7B49\u7EA7\u4E3A medium\uFF1A\u5EFA\u8BAE\u5F00\u542F\u6BCF\u6B65\u9A8C\u8BC1\uFF0C\u503E\u5411\u591A\u8F6E\u8FED\u4EE3",
        patch: { enableVerification: true }
      }]
    });
    return rules;
  }
  rules.push({
    tag: "risk",
    name: "low-risk-neutral",
    evaluate: () => [{
      tag: "risk",
      weight: 0,
      reason: "\u98CE\u9669\u7B49\u7EA7\u4E3A low\uFF1A\u4E0D\u65BD\u52A0\u989D\u5916\u7EA6\u675F\uFF0C\u8DEF\u7531\u4E3B\u8981\u7531\u590D\u6742\u5EA6\u4E0E\u9886\u57DF\u51B3\u5B9A"
    }]
  });
  return rules;
}
function complexityRules(ctx) {
  const level = ctx.analysis.complexity.level;
  const score = ctx.complexityScore;
  const rules = [];
  switch (level) {
    case "expert":
      rules.push({
        tag: "complexity",
        name: "expert-complexity-deep",
        evaluate: () => [
          {
            tag: "complexity",
            strategy: "deep",
            kernel: "ultra",
            weight: VOTE_WEIGHT.complexity * 1.5,
            reason: `\u590D\u6742\u5EA6\u4E3A expert\uFF08${score} \u5206\uFF09\uFF1A\u4F7F\u7528 deep \u7B56\u7565 + ultra \u5185\u6838\uFF0C\u653E\u5BBD\u8F6E\u6B21\u4E0E token \u9884\u7B97`,
            patch: { maxRounds: 24, maxTokens: 65536, enableVerification: true }
          },
          {
            tag: "complexity",
            strategy: "autonomous",
            weight: VOTE_WEIGHT.complexity * 0.3,
            reason: "\u590D\u6742\u5EA6\u4E3A expert\uFF1A\u53EF\u80FD\u9700\u8981\u81EA\u4E3B\u62C6\u89E3\u5B50\u76EE\u6807\uFF0Cautonomous \u4F5C\u4E3A\u6B21\u4F18\u5019\u9009"
          }
        ]
      });
      break;
    case "complex":
      rules.push({
        tag: "complexity",
        name: "complex-complexity-deep-iterative",
        evaluate: () => [
          {
            tag: "complexity",
            strategy: "deep",
            weight: VOTE_WEIGHT.complexity,
            reason: `\u590D\u6742\u5EA6\u4E3A complex\uFF08${score} \u5206\uFF09\uFF1A\u4F18\u5148 deep \u7B56\u7565\u4EE5\u83B7\u5F97\u5B8C\u6574\u9A8C\u8BC1\u95ED\u73AF`
          },
          {
            tag: "complexity",
            strategy: "iterative",
            weight: VOTE_WEIGHT.complexity * 0.7,
            reason: "\u590D\u6742\u5EA6\u4E3A complex\uFF1Aiterative \u4F5C\u4E3A\u53EF\u63A5\u53D7\u7684\u6298\u4E2D\u65B9\u6848"
          }
        ]
      });
      break;
    case "moderate":
      rules.push({
        tag: "complexity",
        name: "moderate-complexity-iterative",
        evaluate: () => [{
          tag: "complexity",
          strategy: "iterative",
          kernel: "super",
          weight: VOTE_WEIGHT.complexity,
          reason: `\u590D\u6742\u5EA6\u4E3A moderate\uFF08${score} \u5206\uFF09\uFF1A\u4F7F\u7528 iterative \u7B56\u7565 + super \u5185\u6838`
        }]
      });
      break;
    case "simple":
      rules.push({
        tag: "complexity",
        name: "simple-complexity-light",
        evaluate: () => [
          {
            tag: "complexity",
            strategy: "single_tool",
            weight: VOTE_WEIGHT.complexity * 0.8,
            reason: `\u590D\u6742\u5EA6\u4E3A simple\uFF08${score} \u5206\uFF09\uFF1A\u5355\u5DE5\u5177\u8C03\u7528\u5373\u53EF\uFF0C\u503E\u5411 single_tool`
          },
          {
            tag: "complexity",
            strategy: "direct",
            weight: VOTE_WEIGHT.complexity * 0.35,
            reason: "\u590D\u6742\u5EA6\u4E3A simple\uFF1A\u82E5\u65E0\u9700\u5DE5\u5177\u53EF\u76F4\u63A5\u7B54\u590D\uFF0Cdirect \u4F5C\u4E3A\u5907\u9009"
          }
        ]
      });
      break;
    case "trivial":
      rules.push({
        tag: "complexity",
        name: "trivial-complexity-direct",
        evaluate: () => [{
          tag: "complexity",
          strategy: "direct",
          kernel: "pro",
          weight: VOTE_WEIGHT.complexity * 1.2,
          reason: `\u590D\u6742\u5EA6\u4E3A trivial\uFF08${score} \u5206\uFF09\uFF1A\u76F4\u63A5\u7B54\u590D\uFF0C\u65E0\u9700\u5DE5\u5177\u4E0E\u591A\u8F6E\u5FAA\u73AF`
        }]
      });
      break;
  }
  return rules;
}
function domainRules(ctx) {
  const domain = ctx.analysis.domain;
  const rules = [];
  switch (domain) {
    case "code":
    case "shell":
      rules.push({
        tag: "domain",
        name: "engineering-domain-iterative",
        evaluate: () => [
          {
            tag: "domain",
            strategy: "iterative",
            weight: VOTE_WEIGHT.domain,
            reason: `\u9886\u57DF\u4E3A ${domain}\uFF1A\u9700\u8981\u8FB9\u6267\u884C\u8FB9\u4FEE\u6B63\uFF0C\u503E\u5411 iterative \u7B56\u7565`
          },
          {
            tag: "domain",
            strategy: "deep",
            weight: VOTE_WEIGHT.domain * 0.5,
            reason: `\u9886\u57DF\u4E3A ${domain}\uFF1A\u6D89\u53CA\u53D8\u66F4\u65F6 deep \u7B56\u7565\u53EF\u4FDD\u8BC1\u9A8C\u8BC1\u95ED\u73AF`,
            patch: { enableVerification: true }
          }
        ]
      });
      break;
    case "file":
      rules.push({
        tag: "domain",
        name: "file-domain-tool",
        evaluate: () => [{
          tag: "domain",
          strategy: "single_tool",
          weight: VOTE_WEIGHT.domain,
          reason: "\u9886\u57DF\u4E3A file\uFF1A\u901A\u5E38\u662F\u660E\u786E\u7684\u8BFB\u5199\u64CD\u4F5C\uFF0Csingle_tool \u8DB3\u591F"
        }]
      });
      break;
    case "research":
      rules.push({
        tag: "domain",
        name: "research-domain-iterative",
        evaluate: () => [{
          tag: "domain",
          strategy: "iterative",
          weight: VOTE_WEIGHT.domain * 1.2,
          reason: "\u9886\u57DF\u4E3A research\uFF1A\u9700\u8981\u591A\u8F6E\u68C0\u7D22\u4E0E\u6C47\u603B\uFF0C\u503E\u5411 iterative \u7B56\u7565"
        }]
      });
      break;
    case "data":
      rules.push({
        tag: "domain",
        name: "data-domain-iterative",
        evaluate: () => [{
          tag: "domain",
          strategy: "iterative",
          weight: VOTE_WEIGHT.domain,
          reason: "\u9886\u57DF\u4E3A data\uFF1A\u9700\u8981\u53D6\u6570-\u5206\u6790-\u6821\u9A8C\u7684\u5FAA\u73AF\uFF0C\u503E\u5411 iterative \u7B56\u7565",
          patch: { enableVerification: true }
        }]
      });
      break;
    case "qa":
      rules.push({
        tag: "domain",
        name: "qa-domain-deep",
        evaluate: () => [{
          tag: "domain",
          strategy: "deep",
          weight: VOTE_WEIGHT.domain,
          reason: "\u9886\u57DF\u4E3A qa\uFF1A\u6D4B\u8BD5/\u68C0\u67E5\u7C7B\u4EFB\u52A1\u9A8C\u8BC1\u662F\u6838\u5FC3\uFF0C\u503E\u5411 deep \u7B56\u7565",
          patch: { enableVerification: true }
        }]
      });
      break;
    case "planning":
      rules.push({
        tag: "domain",
        name: "planning-domain-autonomous",
        evaluate: () => [
          {
            tag: "domain",
            strategy: "autonomous",
            weight: VOTE_WEIGHT.domain * 0.8,
            reason: "\u9886\u57DF\u4E3A planning\uFF1A\u89C4\u5212\u7C7B\u4EFB\u52A1\u9002\u5408\u81EA\u4E3B\u62C6\u89E3\uFF0C\u503E\u5411 autonomous"
          },
          {
            tag: "domain",
            strategy: "iterative",
            weight: VOTE_WEIGHT.domain * 0.4,
            reason: "\u9886\u57DF\u4E3A planning\uFF1A\u82E5\u53EA\u9700\u4EA7\u51FA\u65B9\u6848\u6587\u672C\uFF0Citerative \u4EA6\u53EF"
          }
        ]
      });
      break;
    case "creative":
    case "writing":
    case "conversation":
      rules.push({
        tag: "domain",
        name: "expression-domain-direct",
        evaluate: () => [{
          tag: "domain",
          strategy: "direct",
          weight: VOTE_WEIGHT.domain * 0.7,
          reason: `\u9886\u57DF\u4E3A ${domain}\uFF1A\u8868\u8FBE\u7C7B\u4EFB\u52A1\u901A\u5E38\u4E00\u6B21\u6210\u6587\uFF0C\u503E\u5411 direct \u7B56\u7565`
        }]
      });
      break;
  }
  return rules;
}
function toolRules(ctx) {
  const { needsTools, suggestedTools } = ctx.analysis;
  const rules = [];
  if (!needsTools) {
    rules.push({
      tag: "tool",
      name: "no-tools-direct",
      evaluate: () => [{
        tag: "tool",
        strategy: "direct",
        kernel: "pro",
        weight: VOTE_WEIGHT.tool,
        reason: "\u4EFB\u52A1\u4E0D\u9700\u8981\u5DE5\u5177\uFF1A\u65E0\u9700\u8FDB\u5165\u5DE5\u5177\u5FAA\u73AF\uFF0C\u503E\u5411 direct \u7B56\u7565 + pro \u5185\u6838",
        patch: { hermesMode: "off" }
      }]
    });
    return rules;
  }
  const toolCount = (suggestedTools ?? []).length;
  if (toolCount >= 3) {
    rules.push({
      tag: "tool",
      name: "many-tools-iterative",
      evaluate: () => [{
        tag: "tool",
        strategy: "iterative",
        weight: VOTE_WEIGHT.tool * 1.1,
        reason: `\u9700\u8981 ${toolCount} \u7C7B\u5DE5\u5177\u534F\u540C\uFF1A\u503E\u5411 iterative \u7B56\u7565\u4EE5\u7F16\u6392\u591A\u6B21\u5DE5\u5177\u8C03\u7528`,
        patch: { hermesMode: "auto" }
      }]
    });
  } else if (toolCount >= 1) {
    rules.push({
      tag: "tool",
      name: "few-tools-single-or-iterative",
      evaluate: () => [
        {
          tag: "tool",
          strategy: "single_tool",
          weight: VOTE_WEIGHT.tool * 0.9,
          reason: `\u9700\u8981 ${toolCount} \u7C7B\u5DE5\u5177\uFF1Asingle_tool \u7B56\u7565\u8DB3\u4EE5\u8986\u76D6`
        },
        {
          tag: "tool",
          strategy: "iterative",
          weight: VOTE_WEIGHT.tool * 0.5,
          reason: "\u5DE5\u5177\u8C03\u7528\u540E\u53EF\u80FD\u9700\u8981\u6839\u636E\u7ED3\u679C\u7EE7\u7EED\u51B3\u7B56\uFF0Citerative \u4F5C\u4E3A\u5907\u9009"
        }
      ]
    });
  } else {
    rules.push({
      tag: "tool",
      name: "needs-tools-unspecified",
      evaluate: () => [{
        tag: "tool",
        strategy: "iterative",
        weight: VOTE_WEIGHT.tool,
        reason: "\u4EFB\u52A1\u9700\u8981\u5DE5\u5177\u4F46\u672A\u7ED9\u51FA\u5EFA\u8BAE\u5DE5\u5177\u96C6\uFF1A\u4F7F\u7528 iterative \u7B56\u7565\u5728\u8FD0\u884C\u65F6\u6309\u9700\u53D1\u73B0\u5DE5\u5177",
        patch: { hermesMode: "auto" }
      }]
    });
  }
  return rules;
}
function autonomyRules(ctx) {
  if (!ctx.analysis.benefitsFromAutonomy) return [];
  const domain = ctx.analysis.domain;
  const engineering = TOOL_ORIENTED_DOMAINS.has(domain);
  return [{
    tag: "autonomy",
    name: "autonomy-beneficial",
    evaluate: () => {
      const votes = [{
        tag: "autonomy",
        strategy: "autonomous",
        kernel: "auto",
        weight: VOTE_WEIGHT.autonomy * 1.1,
        reason: "\u4EFB\u52A1\u9002\u5408\u81EA\u4E3B\u95ED\u73AF\uFF08\u5B8C\u6210/\u76F4\u5230/\u5168\u90E8\u7B49\u76EE\u6807\u4FE1\u53F7\uFF09\uFF1A\u4F7F\u7528 autonomous \u7B56\u7565 + auto \u5185\u6838",
        patch: { hermesMode: "auto" }
      }];
      if (engineering) {
        votes.push({
          tag: "autonomy",
          strategy: "deep",
          weight: VOTE_WEIGHT.autonomy * 0.4,
          reason: "\u81EA\u4E3B\u4EFB\u52A1\u6D89\u53CA\u5DE5\u7A0B\u53D8\u66F4\uFF1Adeep \u7B56\u7565\u4F5C\u4E3A\u5E26\u62A4\u680F\u7684\u4FDD\u5B88\u5907\u9009"
        });
      }
      return votes;
    }
  }];
}
function planRules(ctx) {
  const rules = [];
  const { stepCount, avgDifficulty, criticalLength } = ctx;
  if (stepCount === 0) {
    rules.push({
      tag: "plan",
      name: "plan-empty",
      evaluate: () => [{
        tag: "plan",
        strategy: "direct",
        weight: VOTE_WEIGHT.plan * 0.5,
        reason: "\u6267\u884C\u8BA1\u5212\u4E3A\u7A7A\uFF1A\u4EFB\u52A1\u65E0\u9700\u7F16\u6392\uFF0C\u503E\u5411 direct/single_tool"
      }]
    });
    return rules;
  }
  if (stepCount >= 8 || ctx.plan.estimatedRounds >= 12) {
    rules.push({
      tag: "plan",
      name: "plan-large",
      evaluate: () => [{
        tag: "plan",
        strategy: "deep",
        // 大计划是强信号：票重要足够高，压过「工具数/复杂度」投出的 iterative 票。
        weight: VOTE_WEIGHT.plan * 3,
        reason: `\u8BA1\u5212\u89C4\u6A21\u8F83\u5927\uFF08${stepCount} \u6B65 / \u9884\u8BA1 ${ctx.plan.estimatedRounds} \u8F6E\uFF09\uFF1A\u4F7F\u7528 deep \u7B56\u7565`,
        patch: { maxRounds: Math.max(ctx.plan.estimatedRounds + 4, 16) }
      }]
    });
  } else if (stepCount >= 4) {
    rules.push({
      tag: "plan",
      name: "plan-medium",
      evaluate: () => [{
        tag: "plan",
        strategy: "iterative",
        weight: VOTE_WEIGHT.plan,
        reason: `\u8BA1\u5212\u542B ${stepCount} \u4E2A\u6B65\u9AA4\uFF1A\u4F7F\u7528 iterative \u7B56\u7565\u9010\u6B65\u63A8\u8FDB`
      }]
    });
  } else {
    rules.push({
      tag: "plan",
      name: "plan-small",
      evaluate: () => [{
        tag: "plan",
        strategy: "single_tool",
        weight: VOTE_WEIGHT.plan * 0.7,
        reason: `\u8BA1\u5212\u4EC5 ${stepCount} \u6B65\uFF1Asingle_tool \u5373\u53EF\u5B8C\u6210`
      }]
    });
  }
  if (criticalLength >= 3) {
    rules.push({
      tag: "plan",
      name: "plan-deep-chain",
      evaluate: () => [{
        tag: "plan",
        strategy: "iterative",
        weight: VOTE_WEIGHT.plan * 0.5,
        reason: `\u5173\u952E\u4F9D\u8D56\u94FE\u8F83\u957F\uFF08${criticalLength} \u5C42\uFF09\uFF1A\u9700\u8981\u591A\u8F6E\u8FED\u4EE3\u6309\u4F9D\u8D56\u987A\u5E8F\u6267\u884C`
      }]
    });
  }
  if (avgDifficulty >= 75) {
    rules.push({
      tag: "plan",
      name: "plan-hard-steps",
      evaluate: () => [{
        tag: "plan",
        strategy: "deep",
        weight: VOTE_WEIGHT.plan * 0.6,
        reason: `\u6B65\u9AA4\u5E73\u5747\u96BE\u5EA6\u9AD8\uFF08${Math.round(avgDifficulty)} \u5206\uFF09\uFF1A\u503E\u5411 deep \u7B56\u7565\u5E76\u5F00\u542F\u9A8C\u8BC1`,
        patch: { enableVerification: true }
      }]
    });
  }
  return rules;
}
function strategyRules(ctx) {
  const s = ctx.strategy;
  const rules = [];
  rules.push({
    tag: "strategy",
    name: "input-strategy-hint",
    evaluate: () => [{
      tag: "strategy",
      strategy: s.name === "autonomous" ? "autonomous" : s.name,
      weight: VOTE_WEIGHT.strategy,
      reason: `\u8F93\u5165\u7B56\u7565\u5EFA\u8BAE\u4E3A ${s.name}\uFF08${s.description || "\u65E0\u63CF\u8FF0"}\uFF09`
    }]
  });
  if (s.verifyEachStep) {
    rules.push({
      tag: "strategy",
      name: "input-verify-each-step",
      evaluate: () => [{
        tag: "strategy",
        strategy: "deep",
        weight: VOTE_WEIGHT.strategy * 0.6,
        reason: "\u8F93\u5165\u7B56\u7565\u8981\u6C42\u6BCF\u6B65\u9A8C\u8BC1\uFF1A\u504F\u5411 deep \u7B56\u7565",
        patch: { enableVerification: true }
      }]
    });
  }
  if (s.fallbackOnFailure && s.maxRounds > 10) {
    rules.push({
      tag: "strategy",
      name: "input-fallback-long-rounds",
      evaluate: () => [{
        tag: "strategy",
        strategy: "iterative",
        weight: VOTE_WEIGHT.strategy * 0.5,
        reason: `\u8F93\u5165\u7B56\u7565\u5141\u8BB8\u5931\u8D25\u56DE\u9000\uFF08${s.fallbackOnFailure}\uFF09\u4E14\u8F6E\u6B21\u4E0A\u9650\u8F83\u9AD8\uFF1A\u503E\u5411 iterative`
      }]
    });
  }
  return rules;
}
function tallyVotes(votes, key) {
  const scores = /* @__PURE__ */ new Map();
  const voters = /* @__PURE__ */ new Map();
  for (const vote of votes) {
    const k = vote[key];
    if (k === void 0 || vote.weight <= 0) continue;
    scores.set(k, (scores.get(k) ?? 0) + vote.weight);
    if (!voters.has(k)) voters.set(k, /* @__PURE__ */ new Set());
    voters.get(k).add(vote.tag);
  }
  if (scores.size === 0) {
    const fallback = "direct";
    scores.set(fallback, 0);
    voters.set(fallback, /* @__PURE__ */ new Set());
  }
  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, v]) => sum + v, 0);
  return {
    scores,
    voters,
    best: sorted[0][0],
    runnerUp: sorted.length > 1 ? sorted[1][0] : void 0,
    bestScore: sorted[0][1],
    runnerScore: sorted.length > 1 ? sorted[1][1] : 0,
    total
  };
}
function conflictPenalty(tally) {
  if (tally.runnerUp === void 0 || tally.total === 0) return 0;
  const bestVoters = tally.voters.get(tally.best) ?? /* @__PURE__ */ new Set();
  const runnerVoters = tally.voters.get(tally.runnerUp) ?? /* @__PURE__ */ new Set();
  let shared = 0;
  for (const tag of bestVoters) {
    if (runnerVoters.has(tag)) shared += 1;
  }
  const unionSize = (/* @__PURE__ */ new Set([...bestVoters, ...runnerVoters])).size || 1;
  const overlap = shared / unionSize;
  const closeness = tally.bestScore === 0 ? 0 : clamp2(tally.runnerScore / tally.bestScore, 0, 1);
  return closeness * (1 - overlap) * 0.35;
}
function mergePatches(votes) {
  const patch = {};
  for (const vote of votes) {
    const p = vote.patch;
    if (!p) continue;
    if (p.maxRounds !== void 0) {
      patch.maxRounds = Math.max(patch.maxRounds ?? 0, p.maxRounds);
    }
    if (p.maxTokens !== void 0) {
      patch.maxTokens = Math.max(patch.maxTokens ?? 0, p.maxTokens);
    }
    if (p.temperature !== void 0) {
      patch.temperature = p.temperature;
    }
    if (p.enableGuardrails !== void 0) {
      patch.enableGuardrails = (patch.enableGuardrails ?? false) || p.enableGuardrails;
    }
    if (p.enableVerification !== void 0) {
      patch.enableVerification = (patch.enableVerification ?? false) || p.enableVerification;
    }
    if (p.hermesMode !== void 0) {
      const rank = { off: 0, on: 1, auto: 2 };
      const current = patch.hermesMode ?? "off";
      patch.hermesMode = rank[p.hermesMode] >= rank[current] ? p.hermesMode : current;
    }
  }
  return patch;
}
function computeOverrides(ctx, chosenStrategy, patch) {
  const { analysis, strategy, plan } = ctx;
  const level = analysis.complexity.level;
  const domain = analysis.domain;
  const inputRounds = Number.isFinite(strategy.maxRounds) && strategy.maxRounds > 0 ? strategy.maxRounds : STRATEGY_BASE_ROUNDS[chosenStrategy];
  const planRounds = Number.isFinite(plan.estimatedRounds) ? plan.estimatedRounds : 0;
  const roundDelta = COMPLEXITY_ROUND_DELTA[level];
  const strategyRounds = STRATEGY_BASE_ROUNDS[chosenStrategy];
  let maxRounds = Math.max(
    inputRounds,
    strategyRounds + roundDelta,
    planRounds > 0 ? planRounds + 2 : 0
  );
  if (patch.maxRounds !== void 0) maxRounds = Math.max(maxRounds, patch.maxRounds);
  if (chosenStrategy === "direct") maxRounds = 1;
  if (chosenStrategy === "single_tool") maxRounds = clamp2(maxRounds, 1, 3);
  maxRounds = clamp2(Math.round(maxRounds), 1, 64);
  let maxTokens = COMPLEXITY_TOKEN_BASE[level];
  maxTokens += ctx.stepCount * 1024;
  if (patch.maxTokens !== void 0) maxTokens = Math.max(maxTokens, patch.maxTokens);
  if (chosenStrategy === "direct") maxTokens = Math.min(maxTokens, 8192);
  maxTokens = clamp2(Math.round(maxTokens / 1024) * 1024, 2048, 131072);
  let temperature = patch.temperature ?? DOMAIN_TEMPERATURE[domain];
  if (domain !== "creative" && domain !== "writing") {
    if (level === "complex" || level === "expert") temperature -= 0.1;
  }
  temperature = round3(clamp2(temperature, 0, 1.2), 2);
  let enableGuardrails = patch.enableGuardrails ?? false;
  if (ELEVATED_RISK.has(analysis.risk)) enableGuardrails = true;
  if (chosenStrategy === "deep") enableGuardrails = true;
  if (TOOL_ORIENTED_DOMAINS.has(domain) && analysis.needsTools) enableGuardrails = true;
  let enableVerification = patch.enableVerification ?? false;
  if (VERIFICATION_DOMAINS.has(domain)) enableVerification = true;
  if (level === "complex" || level === "expert") enableVerification = true;
  if (chosenStrategy === "deep") enableVerification = true;
  if (ctx.verifyEachStepHint) enableVerification = true;
  if (chosenStrategy === "direct" && analysis.risk === "low" && !VERIFICATION_DOMAINS.has(domain)) {
    enableVerification = false;
  }
  let hermesMode = patch.hermesMode ?? "off";
  if (!analysis.needsTools) hermesMode = "off";
  else if (ctx.planTools.length >= 3 || analysis.benefitsFromAutonomy) hermesMode = "auto";
  else if (hermesMode === "off") hermesMode = "on";
  if (chosenStrategy === "direct") hermesMode = "off";
  return {
    maxRounds,
    maxTokens,
    temperature,
    enableGuardrails,
    enableVerification,
    hermesMode
  };
}
function buildAllRules(ctx) {
  return [
    ...riskRules(ctx),
    ...complexityRules(ctx),
    ...domainRules(ctx),
    ...toolRules(ctx),
    ...autonomyRules(ctx),
    ...planRules(ctx),
    ...strategyRules(ctx)
  ];
}
function collectVotes(rules, ctx) {
  const votes = [];
  for (const rule of rules) {
    let evaluated;
    try {
      evaluated = rule.evaluate(ctx);
    } catch (err) {
      evaluated = [{
        tag: "constraint",
        weight: 0,
        reason: `\u89C4\u5219 ${rule.name} \u8BC4\u4F30\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${err instanceof Error ? err.message : String(err)}`
      }];
    }
    for (const vote of evaluated) {
      if (vote.weight === 0 && vote.strategy === void 0 && vote.kernel === void 0) {
        votes.push(vote);
        continue;
      }
      votes.push(vote);
    }
  }
  return votes;
}
function applyHardConstraints(decision, ctx) {
  const notes = [];
  const { analysis } = ctx;
  const level = analysis.complexity.level;
  const risk = analysis.risk;
  if (risk === "critical") {
    decision.overrides.enableGuardrails = true;
    decision.overrides.enableVerification = true;
    if (decision.strategy !== "deep") {
      decision.strategy = "deep";
      notes.push("\u786C\u7EA6\u675F\uFF1Acritical \u98CE\u9669\u5F3A\u5236\u5347\u7EA7\u4E3A deep \u7B56\u7565");
    }
    decision.kernel = "ultra";
  }
  if (level === "expert") {
    decision.strategy = "deep";
    decision.kernel = "ultra";
    decision.overrides.enableVerification = true;
    notes.push("\u786C\u7EA6\u675F\uFF1Aexpert \u590D\u6742\u5EA6\u5F3A\u5236 deep \u7B56\u7565 + ultra \u5185\u6838");
  }
  if (level === "trivial" && !analysis.needsTools) {
    const wasForced = decision.strategy !== "direct";
    decision.strategy = "direct";
    decision.kernel = "pro";
    decision.overrides.maxRounds = 1;
    decision.overrides.hermesMode = "off";
    if (wasForced) notes.push("\u786C\u7EA6\u675F\uFF1Atrivial \u4E14\u65E0\u9700\u5DE5\u5177\uFF0C\u5F3A\u5236\u56DE\u843D\u5230 direct \u7B56\u7565");
  }
  if (analysis.needsTools && decision.strategy === "direct") {
    decision.strategy = (analysis.suggestedTools?.length ?? 0) >= 2 ? "iterative" : "single_tool";
    notes.push("\u786C\u7EA6\u675F\uFF1A\u4EFB\u52A1\u9700\u8981\u5DE5\u5177\uFF0Cdirect \u7B56\u7565\u4E0D\u53EF\u7528\uFF0C\u5DF2\u5347\u7EA7\u4E3A\u5E26\u5DE5\u5177\u7684\u7B56\u7565");
  }
  if (risk === "high") {
    decision.overrides.enableGuardrails = true;
  }
  const expectedKernel = STRATEGY_KERNEL[decision.strategy];
  if (decision.kernel !== expectedKernel && level !== "expert" && risk !== "critical") {
    decision.kernel = expectedKernel;
  }
  return notes;
}
var KernelRouterImpl = class {
  /** 可选：为规则票重做全局缩放（用于 A/B 实验），1 表示默认。 */
  weightScale;
  constructor(options = {}) {
    this.weightScale = options.weightScale && options.weightScale > 0 ? options.weightScale : 1;
  }
  /**
   * 主入口：需求中称 routeTask，契约接口名为 route。
   * 两者行为完全一致，route 在下方直接委托给本方法。
   */
  routeTask(analysis, plan, strategy) {
    const baseCtx = buildContext(analysis, plan, strategy);
    const ctx = {
      ...baseCtx,
      verifyEachStepHint: strategy.verifyEachStep === true
    };
    const rules = buildAllRules(ctx);
    const votes = collectVotes(rules, ctx).map((v) => ({
      ...v,
      weight: v.weight * this.weightScale
    }));
    const strategyTally = tallyVotes(votes, "strategy");
    const kernelTally = tallyVotes(votes, "kernel");
    const chosenStrategy = strategyTally.best;
    let chosenKernel = kernelTally.best;
    if (kernelTally.total < 0.5) {
      chosenKernel = STRATEGY_KERNEL[chosenStrategy];
    }
    const patch = mergePatches(votes);
    const overrides = computeOverrides(ctx, chosenStrategy, patch);
    const decision = { strategy: chosenStrategy, kernel: chosenKernel, overrides };
    const constraintNotes = applyHardConstraints(decision, ctx);
    const confidence = this.computeConfidence(
      strategyTally,
      kernelTally,
      analysis,
      votes,
      decision
    );
    const reasons = this.buildReasons(votes, constraintNotes, strategyTally, decision);
    return {
      strategy: decision.strategy,
      kernel: decision.kernel,
      confidence: round3(confidence, 3),
      reasons,
      overrides: decision.overrides
    };
  }
  /** 契约接口方法：委托给 routeTask。 */
  route(analysis, plan, strategy) {
    return this.routeTask(analysis, plan, strategy);
  }
  /* ── 置信度计算 ── */
  computeConfidence(strategyTally, kernelTally, analysis, votes, decision) {
    const dominance = strategyTally.total > 0 ? strategyTally.bestScore / strategyTally.total : 0.5;
    const bestVoters = strategyTally.voters.get(strategyTally.best) ?? /* @__PURE__ */ new Set();
    const consensus = clamp2(0.6 + bestVoters.size * 0.1, 0.6, 1);
    const strategyConflict = conflictPenalty(strategyTally);
    const kernelConflict = conflictPenalty(kernelTally);
    const kernelMismatch = decision.kernel === STRATEGY_KERNEL[decision.strategy] ? 0 : 0.12;
    const analysisConfidence = unit(analysis.confidence);
    let confidence = dominance * consensus - strategyConflict - kernelConflict - kernelMismatch;
    confidence = confidence * 0.75 + analysisConfidence * 0.25;
    const constraintVotes = votes.filter((v) => v.tag === "constraint" && v.weight > 0);
    if (constraintVotes.length > 0) confidence -= 0.08;
    if (analysis.risk === "critical") confidence -= 0.05;
    return clamp2(confidence, 0.05, 1);
  }
  /* ── 理由汇总 ── */
  buildReasons(votes, constraintNotes, tally, decision) {
    const reasons = [];
    for (const note of constraintNotes) reasons.push(note);
    reasons.push(
      `\u6700\u7EC8\u51B3\u7B56\uFF1Astrategy=${decision.strategy}\uFF0Ckernel=${decision.kernel}\uFF08\u7B56\u7565\u5F97\u7968 ${round3(tally.bestScore, 1)}\uFF0C\u5171 ${round3(tally.total, 1)}\uFF09`
    );
    const seen = /* @__PURE__ */ new Set();
    const informative = votes.filter((v) => v.reason.length > 0).sort((a, b) => b.weight - a.weight);
    for (const vote of informative) {
      if (seen.has(vote.reason)) continue;
      seen.add(vote.reason);
      reasons.push(vote.reason);
    }
    return reasons;
  }
};
function createKernelRouter(options) {
  return new KernelRouterImpl(options);
}

// src/shared/super/routing/modelSelector.ts
var DEFAULT_MODEL_PROFILES = [
  // ── OpenAI GPT 系列 ──
  {
    id: "gpt-4o",
    name: "GPT-4o",
    contextWindow: 128e3,
    strength: ["code", "research", "writing", "data", "planning", "qa", "conversation"],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    contextWindow: 128e3,
    strength: ["code", "writing", "conversation", "qa"],
    costTier: 1,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    contextWindow: 1047576,
    strength: ["code", "research", "data", "planning", "qa", "file"],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    contextWindow: 1047576,
    strength: ["code", "writing", "qa", "data"],
    costTier: 1,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "o3",
    name: "OpenAI o3",
    contextWindow: 2e5,
    strength: ["code", "research", "data", "planning", "qa"],
    costTier: 3,
    speedTier: 3,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "o4-mini",
    name: "OpenAI o4-mini",
    contextWindow: 2e5,
    strength: ["code", "research", "data", "qa"],
    costTier: 2,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  // ── Anthropic Claude 系列 ──
  {
    id: "claude-3.7-sonnet",
    name: "Claude 3.7 Sonnet",
    contextWindow: 2e5,
    strength: ["code", "writing", "research", "planning", "qa", "conversation"],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "claude-3.5-haiku",
    name: "Claude 3.5 Haiku",
    contextWindow: 2e5,
    strength: ["code", "writing", "conversation", "qa", "file"],
    costTier: 1,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "claude-3.7-opus",
    name: "Claude 3.7 Opus",
    contextWindow: 2e5,
    strength: ["code", "research", "planning", "creative", "writing", "qa"],
    costTier: 3,
    speedTier: 3,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  // ── DeepSeek 系列 ──
  {
    id: "deepseek-v3",
    name: "DeepSeek V3",
    contextWindow: 128e3,
    strength: ["code", "research", "data", "qa", "writing", "planning"],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    contextWindow: 128e3,
    strength: ["code", "research", "data", "planning", "qa"],
    costTier: 0,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: "deepseek-coder",
    name: "DeepSeek Coder",
    contextWindow: 128e3,
    strength: ["code", "shell", "file", "qa"],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false
  },
  // ── Kimi（月之暗面）──
  {
    id: "kimi-k2",
    name: "Kimi K2",
    contextWindow: 256e3,
    strength: ["code", "research", "writing", "data", "planning"],
    costTier: 1,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "moonshot-v1-128k",
    name: "Moonshot v1 128K",
    contextWindow: 128e3,
    strength: ["research", "writing", "creative", "conversation"],
    costTier: 1,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false
  },
  // ── Qwen（通义千问）──
  {
    id: "qwen3-235b",
    name: "Qwen3 235B",
    contextWindow: 128e3,
    strength: ["code", "research", "data", "writing", "qa", "planning"],
    costTier: 1,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "qwen3-coder",
    name: "Qwen3 Coder",
    contextWindow: 128e3,
    strength: ["code", "shell", "file", "qa"],
    costTier: 0,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: "qwen2.5-72b",
    name: "Qwen2.5 72B",
    contextWindow: 32768,
    strength: ["code", "research", "writing", "conversation", "data"],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: true
  },
  // ── Google Gemini 系列 ──
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    contextWindow: 1048576,
    strength: ["code", "research", "data", "writing", "planning", "qa", "creative"],
    costTier: 2,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    contextWindow: 1048576,
    strength: ["code", "research", "writing", "qa", "conversation"],
    costTier: 1,
    speedTier: 0,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    contextWindow: 1048576,
    strength: ["writing", "conversation", "qa", "research"],
    costTier: 0,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true
  },
  // ── 国产 / 免费档 / 其它 ──
  {
    id: "glm-4.6",
    name: "GLM-4.6",
    contextWindow: 2e5,
    strength: ["code", "research", "writing", "planning", "qa"],
    costTier: 1,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "minimax-m2",
    name: "MiniMax M2",
    contextWindow: 2e5,
    strength: ["code", "writing", "creative", "conversation"],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: "doubao-seed",
    name: "\u8C46\u5305 Seed",
    contextWindow: 256e3,
    strength: ["writing", "creative", "conversation", "research", "qa"],
    costTier: 0,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    contextWindow: 128e3,
    strength: ["code", "writing", "conversation", "research"],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: "mistral-large",
    name: "Mistral Large",
    contextWindow: 128e3,
    strength: ["code", "research", "writing", "planning"],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "grok-4",
    name: "Grok 4",
    contextWindow: 256e3,
    strength: ["code", "research", "data", "creative", "conversation", "planning"],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: "local-7b",
    name: "\u672C\u5730\u5C0F\u6A21\u578B 7B",
    contextWindow: 8192,
    strength: ["conversation", "writing", "qa"],
    costTier: 0,
    speedTier: 0,
    reasoning: false,
    supportsTools: false,
    supportsVision: false
  }
];
var WEIGHTS = {
  // 质量偏好：推理/领域/窗口优先，能力维度权重最高。
  quality: {
    domain: 0.24,
    reasoning: 0.22,
    tools: 0.12,
    vision: 0.08,
    window: 0.16,
    cost: 0.04,
    speed: 0.04
  },
  // 速度偏好：速度档权重最高，其次是轻量但够用的能力。
  speed: {
    domain: 0.14,
    reasoning: 0.08,
    tools: 0.14,
    vision: 0.06,
    window: 0.1,
    cost: 0.12,
    speed: 0.36
  },
  // 成本偏好：成本档权重最高，其次偏好够用即可的能力。
  cost: {
    domain: 0.16,
    reasoning: 0.08,
    tools: 0.14,
    vision: 0.06,
    window: 0.12,
    cost: 0.36,
    speed: 0.08
  }
};
function clamp3(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
function round4(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function tierToScore(tier, maxTier = 3) {
  return clamp3(1 - clamp3(tier, 0, maxTier) / maxTier, 0, 1);
}
function estimateRequiredTokens(analysis) {
  const complexity = clamp3(analysis.complexity.score, 0, 100);
  let base = 4096;
  base += complexity * 240;
  if (analysis.domain === "code" || analysis.domain === "research" || analysis.domain === "data") {
    base += 8192;
  }
  if (analysis.needsTools) base += 4096;
  return Math.round(base);
}
function domainMatchScore(analysis, model) {
  const strength = new Set(model.strength ?? []);
  let score = strength.has(analysis.domain) ? 1 : 0;
  let weightSum = 0;
  let matchedWeight = 0;
  for (const entry of analysis.domains ?? []) {
    const w = clamp3(entry.weight, 0, 1);
    weightSum += w;
    if (strength.has(entry.domain)) matchedWeight += w;
  }
  if (weightSum > 0) {
    const secondary = matchedWeight / weightSum;
    score = Math.max(score, secondary);
  }
  return clamp3(score, 0, 1);
}
function windowFitScore(required, model) {
  if (required <= 0 || model.contextWindow <= 0) return 0.5;
  const ratio = model.contextWindow / required;
  if (ratio < 1) return clamp3(ratio * 0.5, 0, 0.5);
  return clamp3(0.5 + Math.log2(ratio) * 0.16, 0.5, 1);
}
function hardRejection(analysis, model, requiredTokens) {
  if (analysis.needsTools && !model.supportsTools) {
    return "\u4EFB\u52A1\u9700\u8981\u5DE5\u5177\u8C03\u7528\uFF0C\u4F46\u8BE5\u6A21\u578B\u4E0D\u652F\u6301\u5DE5\u5177";
  }
  const wantsVision = (analysis.suggestedTools ?? []).some(
    (t) => /vision|image|图片|截图|视觉|ocr/i.test(t)
  );
  if (wantsVision && !model.supportsVision) {
    return "\u4EFB\u52A1\u6D89\u53CA\u56FE\u50CF/\u89C6\u89C9\u8F93\u5165\uFF0C\u4F46\u8BE5\u6A21\u578B\u4E0D\u652F\u6301\u89C6\u89C9";
  }
  if (model.contextWindow < requiredTokens) {
    return `\u4E0A\u4E0B\u6587\u7A97\u53E3 ${model.contextWindow} \u5C0F\u4E8E\u4EFB\u52A1\u6240\u9700\u7EA6 ${requiredTokens} token`;
  }
  return null;
}
function scoreModel(analysis, model, preference, requiredTokens) {
  const weights = WEIGHTS[preference];
  const reasons = [];
  const softPenalties = [];
  const domainScore = domainMatchScore(analysis, model);
  const reasoningScore = model.reasoning ? 1 : 0;
  const toolsScore = model.supportsTools ? 1 : 0;
  const visionScore = model.supportsVision ? 1 : 0;
  const windowScore = windowFitScore(requiredTokens, model);
  const costScore = tierToScore(model.costTier);
  const speedScore = tierToScore(model.speedTier);
  let windowPenalty = 0;
  if (model.contextWindow < requiredTokens * 1.2) {
    windowPenalty = 0.08;
    softPenalties.push("\u4E0A\u4E0B\u6587\u7A97\u53E3\u4F59\u91CF\u504F\u7D27\uFF08\u4E0D\u8DB3\u9700\u6C42\u7684 1.2 \u500D\uFF09");
  }
  let domainPenalty = 0;
  if (domainScore < 0.5) {
    domainPenalty = (0.5 - domainScore) * 0.2;
    softPenalties.push(`\u5BF9\u9886\u57DF\u300C${analysis.domain}\u300D\u7684\u5339\u914D\u5EA6\u8F83\u4F4E`);
  }
  const effectiveTools = analysis.needsTools ? toolsScore : 1;
  const effectiveVision = visionScore;
  const raw = weights.domain * domainScore + weights.reasoning * reasoningScore + weights.tools * effectiveTools + weights.vision * effectiveVision + weights.window * windowScore + weights.cost * costScore + weights.speed * speedScore;
  const score = raw - windowPenalty - domainPenalty;
  if (domainScore >= 0.99) reasons.push(`\u64C5\u957F\u4EFB\u52A1\u9886\u57DF\u300C${analysis.domain}\u300D`);
  else if (domainScore > 0) reasons.push(`\u5BF9\u9886\u57DF\u300C${analysis.domain}\u300D\u6709\u4E00\u5B9A\u5339\u914D\u5EA6`);
  if (reasoningScore && preference === "quality") reasons.push("\u5177\u5907\u63A8\u7406\u80FD\u529B\uFF0C\u5951\u5408\u8D28\u91CF\u504F\u597D");
  if (toolsScore && analysis.needsTools) reasons.push("\u652F\u6301\u5DE5\u5177\u8C03\u7528\uFF0C\u6EE1\u8DB3\u4EFB\u52A1\u9700\u6C42");
  if (visionScore) reasons.push("\u652F\u6301\u89C6\u89C9\u8F93\u5165");
  if (costScore >= 0.66) reasons.push(`\u6210\u672C\u6863\u8F83\u4F4E\uFF08${model.costTier}\uFF09\uFF0C\u5951\u5408\u6210\u672C\u504F\u597D`);
  if (speedScore >= 0.66) reasons.push(`\u901F\u5EA6\u6863\u8F83\u5FEB\uFF08${model.speedTier}\uFF09\uFF0C\u5951\u5408\u901F\u5EA6\u504F\u597D`);
  if (windowScore >= 0.9) reasons.push("\u4E0A\u4E0B\u6587\u7A97\u53E3\u5145\u88D5");
  if (softPenalties.length > 0) reasons.push(...softPenalties.map((p) => `\u6CE8\u610F\uFF1A${p}`));
  return {
    model,
    score: round4(clamp3(score, 0, 1), 4),
    reasons,
    softPenalties
  };
}
var ModelSelectorImpl = class {
  /** 备选列表最大长度 */
  maxAlternatives;
  constructor(options = {}) {
    this.maxAlternatives = Math.max(0, options.maxAlternatives ?? 3);
  }
  /**
   * 主入口：需求中称 selectModel，契约接口名为 select。
   * 两者行为完全一致，select 在下方直接委托给本方法。
   */
  selectModel(analysis, available, preference = "quality") {
    const candidates = available && available.length > 0 ? available : DEFAULT_MODEL_PROFILES;
    const requiredTokens = estimateRequiredTokens(analysis);
    const scored = [];
    const rejected = [];
    for (const model of candidates) {
      const rejection = hardRejection(analysis, model, requiredTokens);
      if (rejection !== null) {
        rejected.push({ model, reason: rejection });
        continue;
      }
      scored.push(scoreModel(analysis, model, preference, requiredTokens));
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return candidates.indexOf(a.model) - candidates.indexOf(b.model);
    });
    if (scored.length === 0) {
      return this.fallbackChoice(
        analysis,
        candidates,
        preference,
        requiredTokens,
        rejected
      );
    }
    const best = scored[0];
    const alternatives = scored.slice(1, this.maxAlternatives + 1).map((s) => s.model);
    const reasons = [...best.reasons];
    reasons.unshift(
      `\u5728 ${candidates.length} \u4E2A\u5019\u9009\u4E2D\u9009\u51FA\u300C${best.model.name}\u300D\uFF08\u504F\u597D=${preference}\uFF0C\u5F97\u5206=${best.score}\uFF09`
    );
    reasons.push(
      `\u5DF2\u6DD8\u6C70 ${rejected.length} \u4E2A\u4E0D\u6EE1\u8DB3\u786C\u7EA6\u675F\u7684\u6A21\u578B` + (rejected.length > 0 ? `\uFF1A${rejected.slice(0, 3).map((r) => `${r.model.name}(${r.reason})`).join("\uFF1B")}` : "")
    );
    return {
      model: best.model,
      score: best.score,
      reasons,
      alternatives
    };
  }
  /** 契约接口方法：委托给 selectModel。 */
  select(analysis, available, preference) {
    return this.selectModel(analysis, available, preference);
  }
  /**
   * 降级选择：当所有模型都被窗口硬约束淘汰时，仅保留工具/视觉硬约束，
   * 放开窗口约束重新评分。若仍然为空（例如所有模型都不支持工具），
   * 则选择「违反约束最少」的一个，并在理由中明确标记。
   */
  fallbackChoice(analysis, candidates, preference, requiredTokens, rejected) {
    const viable = [];
    for (const model of candidates) {
      if (analysis.needsTools && !model.supportsTools) continue;
      const wantsVision = (analysis.suggestedTools ?? []).some(
        (t) => /vision|image|图片|截图|视觉|ocr/i.test(t)
      );
      if (wantsVision && !model.supportsVision) continue;
      viable.push(scoreModel(analysis, model, preference, requiredTokens));
    }
    if (viable.length > 0) {
      viable.sort((a, b) => b.score - a.score);
      const best = viable[0];
      return {
        model: best.model,
        score: best.score,
        reasons: [
          `\u8B66\u544A\uFF1A\u6240\u6709 ${candidates.length} \u4E2A\u5019\u9009\u7684\u4E0A\u4E0B\u6587\u7A97\u53E3\u5747\u4E0D\u8DB3 \uFF08\u4EFB\u52A1\u7EA6\u9700 ${requiredTokens} token\uFF09\uFF0C\u5DF2\u653E\u5BBD\u7A97\u53E3\u7EA6\u675F\u964D\u7EA7\u9009\u62E9`,
          `\u6309\u300C${preference}\u300D\u504F\u597D\u9000\u800C\u6C42\u5176\u6B21\u9009\u62E9\u300C${best.model.name}\u300D\uFF08\u5F97\u5206=${best.score}\uFF09`,
          ...best.reasons
        ],
        alternatives: viable.slice(1, this.maxAlternatives + 1).map((s) => s.model)
      };
    }
    const fallback = candidates[0] ?? DEFAULT_MODEL_PROFILES[0];
    return {
      model: fallback,
      score: 0,
      reasons: [
        "\u4E25\u91CD\u8B66\u544A\uFF1A\u6CA1\u6709\u4EFB\u4F55\u5019\u9009\u6EE1\u8DB3\u5DE5\u5177/\u89C6\u89C9\u786C\u7EA6\u675F\uFF0C\u8FD4\u56DE\u515C\u5E95\u6A21\u578B",
        `\u88AB\u6DD8\u6C70\u539F\u56E0\uFF1A${rejected.slice(0, 3).map((r) => `${r.model.name}(${r.reason})`).join("\uFF1B") || "\u65E0"}`,
        "\u8BF7\u8C03\u7528\u65B9\u8865\u5145\u652F\u6301\u6240\u9700\u80FD\u529B\u7684\u6A21\u578B\u540E\u91CD\u8BD5"
      ],
      alternatives: []
    };
  }
};
function createModelSelector(options) {
  return new ModelSelectorImpl(options);
}

// src/shared/super/routing/adaptation.ts
var SERIALIZE_VERSION = 1;
function newBucket() {
  return {
    count: 0,
    successes: 0,
    satisfiedCount: 0,
    satisfiedTotal: 0,
    roundsSum: 0,
    durationSum: 0,
    toolErrorsSum: 0,
    weightedSuccess: 0,
    weightedTotal: 0
  };
}
function clamp4(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
function round5(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function keyFor(strategy, domain) {
  return `${strategy}::${domain}`;
}
var STRATEGY_KERNEL2 = {
  direct: "pro",
  single_tool: "pro",
  iterative: "super",
  autonomous: "auto",
  deep: "ultra"
};
var ALL_STRATEGIES = [
  "direct",
  "single_tool",
  "iterative",
  "autonomous",
  "deep"
];
var AdaptationEngineImpl = class {
  /** 配置 */
  capacity;
  minSamples;
  decay;
  switchThreshold;
  maxConfidenceDelta;
  /** 环形缓冲 */
  buffer;
  /** 环形缓冲写指针（下一个写入位置） */
  writeIndex = 0;
  /** 已写入总数（可能大于 capacity） */
  totalWritten = 0;
  /** 聚合桶：按 (strategy, domain) 组合 */
  byPair = /* @__PURE__ */ new Map();
  /** 聚合桶：按 strategy */
  byStrategy = /* @__PURE__ */ new Map();
  /** 聚合桶：按 domain */
  byDomain = /* @__PURE__ */ new Map();
  /** 全局聚合桶 */
  globalBucket = newBucket();
  /** 最近失败原因（保留最近 20 条） */
  recentFailures = [];
  /** 持久化钩子（可选） */
  persistenceHook = null;
  /** 是否启用自动持久化（record 后自动 save） */
  autoSave = false;
  constructor(options = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 512));
    this.minSamples = Math.max(1, Math.floor(options.minSamples ?? 5));
    this.decay = clamp4(options.decay ?? 0.99, 0.5, 1);
    this.switchThreshold = clamp4(options.switchThreshold ?? 0.12, 0, 1);
    this.maxConfidenceDelta = clamp4(options.maxConfidenceDelta ?? 0.15, 0, 1);
    this.buffer = new Array(this.capacity);
  }
  /* ── 持久化钩子 ── */
  /** 挂载持久化钩子；若 loadImmediately 为真则立即尝试加载历史数据。 */
  attachPersistence(hook, loadImmediately = true) {
    this.persistenceHook = hook;
    if (loadImmediately) {
      void Promise.resolve(hook.load()).then((data) => {
        if (typeof data === "string") this.deserialize(data);
      }).catch(() => {
      });
    }
  }
  /** 设置是否在每次 record 后自动持久化。 */
  setAutoSave(enabled) {
    this.autoSave = enabled;
  }
  /* ── 记录 ── */
  /**
   * 记录一次任务结果。契约接口方法。
   */
  record(outcome) {
    const snapshot = this.toSnapshot(outcome);
    this.buffer[this.writeIndex] = snapshot;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.totalWritten += 1;
    this.updateAggregates(snapshot);
    if (!outcome.success || (outcome.toolErrors ?? 0) > 0) {
      this.recordFailure(snapshot);
    }
    if (this.autoSave && this.persistenceHook) {
      void Promise.resolve(this.persistenceHook.save(this.serialize())).catch(() => {
      });
    }
  }
  /** 把 TaskOutcome 压缩成轻量快照。 */
  toSnapshot(outcome) {
    return {
      strategy: outcome.decision.strategy,
      kernel: outcome.decision.kernel,
      domain: outcome.analysis.domain,
      risk: outcome.analysis.risk,
      success: outcome.success === true,
      rounds: Math.max(0, outcome.rounds ?? 0),
      durationMs: Math.max(0, outcome.durationMs ?? 0),
      toolErrors: Math.max(0, outcome.toolErrors ?? 0),
      userSatisfied: outcome.userSatisfied,
      timestamp: Number.isFinite(outcome.timestamp) ? outcome.timestamp : Date.now(),
      confidence: clamp4(outcome.decision.confidence ?? 0, 0, 1)
    };
  }
  /** 增量更新所有聚合桶。 */
  updateAggregates(s) {
    const successValue = s.success ? 1 : 0;
    const age = (bucket) => {
      bucket.weightedSuccess *= this.decay;
      bucket.weightedTotal *= this.decay;
    };
    for (const bucket of this.byPair.values()) age(bucket);
    for (const bucket of this.byStrategy.values()) age(bucket);
    for (const bucket of this.byDomain.values()) age(bucket);
    age(this.globalBucket);
    const apply = (bucket) => {
      bucket.count += 1;
      bucket.successes += successValue;
      bucket.roundsSum += s.rounds;
      bucket.durationSum += s.durationMs;
      bucket.toolErrorsSum += s.toolErrors;
      bucket.weightedSuccess += successValue;
      bucket.weightedTotal += 1;
      if (s.userSatisfied !== void 0) {
        bucket.satisfiedTotal += 1;
        if (s.userSatisfied) bucket.satisfiedCount += 1;
      }
    };
    const pk = keyFor(s.strategy, s.domain);
    let pairBucket = this.byPair.get(pk);
    if (!pairBucket) {
      pairBucket = newBucket();
      this.byPair.set(pk, pairBucket);
    }
    apply(pairBucket);
    let strategyBucket = this.byStrategy.get(s.strategy);
    if (!strategyBucket) {
      strategyBucket = newBucket();
      this.byStrategy.set(s.strategy, strategyBucket);
    }
    apply(strategyBucket);
    let domainBucket = this.byDomain.get(s.domain);
    if (!domainBucket) {
      domainBucket = newBucket();
      this.byDomain.set(s.domain, domainBucket);
    }
    apply(domainBucket);
    apply(this.globalBucket);
  }
  /** 记录失败原因（用于 stats 的 recentFailureReasons）。 */
  recordFailure(s) {
    let reason;
    if (!s.success && s.toolErrors > 0) {
      reason = `\u5DE5\u5177\u8C03\u7528\u51FA\u9519 ${s.toolErrors} \u6B21\uFF0C\u4EFB\u52A1\u5931\u8D25`;
    } else if (!s.success) {
      reason = "\u4EFB\u52A1\u6267\u884C\u5931\u8D25\uFF08\u672A\u8FBE\u6210\u76EE\u6807\uFF09";
    } else {
      reason = `\u4EFB\u52A1\u6210\u529F\u4F46\u51FA\u73B0 ${s.toolErrors} \u6B21\u5DE5\u5177\u9519\u8BEF`;
    }
    this.recentFailures.push({
      strategy: s.strategy,
      domain: s.domain,
      reason,
      timestamp: s.timestamp
    });
    if (this.recentFailures.length > 20) {
      this.recentFailures = this.recentFailures.slice(-20);
    }
  }
  /* ── 调整决策 ── */
  /**
   * 基于历史成功率调整路由决策。契约接口方法。
   *
   * 调整依据优先级：
   *  1. (strategy, domain) 组合的加权成功率与其他策略在同领域的表现对比。
   *  2. 样本不足（< minSamples）时不调整，原样返回。
   *  3. 表现差时尝试替换策略；表现好时适度上调置信度。
   *  4. 历史工具错误多时加强护栏/验证。
   */
  adjust(base, analysis) {
    const domain = analysis.domain;
    const current = base.strategy;
    const currentBucket = this.byPair.get(keyFor(current, domain));
    if (!currentBucket || currentBucket.count < this.minSamples) {
      return { ...base };
    }
    const currentRate = this.weightedRate(currentBucket);
    let bestStrategy = null;
    let bestRate = currentRate + this.switchThreshold;
    for (const candidate of ALL_STRATEGIES) {
      if (candidate === current) continue;
      const bucket = this.byPair.get(keyFor(candidate, domain));
      if (!bucket || bucket.count < this.minSamples) continue;
      const rate = this.weightedRate(bucket);
      if (rate > bestRate) {
        bestRate = rate;
        bestStrategy = candidate;
      }
    }
    const reasons = [...base.reasons];
    let strategy = current;
    let kernel = base.kernel;
    let confidence = base.confidence;
    const overrides = { ...base.overrides };
    if (bestStrategy !== null) {
      strategy = bestStrategy;
      kernel = STRATEGY_KERNEL2[bestStrategy];
      reasons.push(
        `\u81EA\u9002\u5E94\u8C03\u6574\uFF1A\u7B56\u7565\u300C${current}\u300D\u5728\u9886\u57DF\u300C${domain}\u300D\u7684\u52A0\u6743\u6210\u529F\u7387\u4E3A ${round5(currentRate)}\uFF08${currentBucket.count} \u6837\u672C\uFF09\uFF0C\u800C\u300C${bestStrategy}\u300D\u8FBE ${round5(bestRate)}\uFF0C\u8D85\u8FC7\u663E\u8457\u6027\u9608\u503C ${this.switchThreshold}\uFF0C\u6545\u66FF\u6362\u7B56\u7565`
      );
      confidence = clamp4(confidence - this.maxConfidenceDelta * 0.5, 0.05, 1);
    } else {
      const delta = this.confidenceDelta(currentRate);
      confidence = clamp4(confidence + delta, 0.05, 1);
      if (Math.abs(delta) > 0.01) {
        reasons.push(
          `\u81EA\u9002\u5E94\u8C03\u6574\uFF1A\u7B56\u7565\u300C${current}\u300D\u5728\u9886\u57DF\u300C${domain}\u300D\u7684\u52A0\u6743\u6210\u529F\u7387 ${round5(currentRate)}\uFF08${currentBucket.count} \u6837\u672C\uFF09\uFF0C\u7F6E\u4FE1\u5EA6${delta > 0 ? "\u4E0A\u8C03" : "\u4E0B\u8C03"} ${round5(Math.abs(delta))}`
        );
      }
    }
    const errorRate = currentBucket.toolErrorsSum / Math.max(1, currentBucket.count);
    if (errorRate >= 0.5) {
      overrides.enableGuardrails = true;
      overrides.enableVerification = true;
      reasons.push(
        `\u81EA\u9002\u5E94\u8C03\u6574\uFF1A\u7B56\u7565\u300C${current}\u300D\u5728\u9886\u57DF\u300C${domain}\u300D\u7684\u5386\u53F2\u5E73\u5747\u5DE5\u5177\u9519\u8BEF\u6570 ${round5(errorRate, 2)} \u504F\u9AD8\uFF0C\u5F3A\u5236\u5F00\u542F\u62A4\u680F\u4E0E\u9A8C\u8BC1`
      );
    }
    if (analysis.risk === "critical" || analysis.risk === "high") {
      overrides.enableGuardrails = true;
    }
    return {
      strategy,
      kernel,
      confidence: round5(clamp4(confidence, 0.05, 1), 3),
      reasons,
      overrides
    };
  }
  /** 计算加权成功率。 */
  weightedRate(bucket) {
    if (bucket.weightedTotal <= 0) return 0;
    return bucket.weightedSuccess / bucket.weightedTotal;
  }
  /** 计算置信度调整量：成功率越偏离 0.5，调整幅度越大。 */
  confidenceDelta(rate) {
    const normalized = (rate - 0.5) * 2;
    return round5(clamp4(normalized, -1, 1) * this.maxConfidenceDelta, 4);
  }
  /* ── 统计聚合 ── */
  /**
   * 导出学到的统计。契约接口方法。
   * 返回结构：
   * {
   *   totalOutcomes, windowSize, minSamples, decay,
   *   overall: { successRate, avgRounds, avgDurationMs, avgToolErrors },
   *   byStrategy: Record<strategy, { count, successRate, avgRounds, ... }>,
   *   byDomain: Record<domain, { count, successRate, ... }>,
   *   byPair: Record<'strategy::domain', { count, successRate, weightedSuccessRate }>,
   *   domainDistribution: Record<domain, number>,
   *   recentFailureReasons: string[],
   *   recentOutcomes: OutcomeSnapshot[]
   * }
   */
  stats() {
    const overall = this.describeBucket(this.globalBucket);
    const byStrategy = {};
    for (const [strategy, bucket] of this.byStrategy) {
      byStrategy[strategy] = this.describeBucket(bucket);
    }
    const byDomain = {};
    const domainDistribution = {};
    for (const [domain, bucket] of this.byDomain) {
      byDomain[domain] = this.describeBucket(bucket);
      domainDistribution[domain] = bucket.count;
    }
    const byPair = {};
    for (const [key, bucket] of this.byPair) {
      byPair[key] = {
        ...this.describeBucket(bucket),
        weightedSuccessRate: round5(this.weightedRate(bucket), 4)
      };
    }
    return {
      totalOutcomes: this.totalWritten,
      windowSize: this.activeCount(),
      minSamples: this.minSamples,
      decay: this.decay,
      switchThreshold: this.switchThreshold,
      overall,
      byStrategy,
      byDomain,
      byPair,
      domainDistribution,
      recentFailureReasons: this.recentFailures.slice(-10).reverse().map((f) => `[${f.strategy}/${f.domain}] ${f.reason}`),
      recentOutcomes: this.activeSnapshots().slice(-20)
    };
  }
  /** 把聚合桶转成可读统计对象。 */
  describeBucket(bucket) {
    const count = Math.max(1, bucket.count);
    return {
      count: bucket.count,
      successRate: round5(bucket.successes / count, 4),
      weightedSuccessRate: round5(this.weightedRate(bucket), 4),
      avgRounds: round5(bucket.roundsSum / count, 2),
      avgDurationMs: round5(bucket.durationSum / count, 1),
      avgToolErrors: round5(bucket.toolErrorsSum / count, 2),
      satisfactionRate: bucket.satisfiedTotal > 0 ? round5(bucket.satisfiedCount / bucket.satisfiedTotal, 4) : null
    };
  }
  /** 当前环形缓冲中的有效记录数。 */
  activeCount() {
    return Math.min(this.totalWritten, this.capacity);
  }
  /** 按时间顺序返回环形缓冲中的有效快照。 */
  activeSnapshots() {
    const n = this.activeCount();
    const result = [];
    const start = this.totalWritten <= this.capacity ? 0 : this.writeIndex;
    for (let i = 0; i < n; i++) {
      const snap = this.buffer[(start + i) % this.capacity];
      if (snap) result.push(snap);
    }
    return result;
  }
  /* ── 序列化 / 反序列化 ── */
  /**
   * 序列化为 JSON 字符串（可存入 localStorage / 文件）。
   * 只保存环形缓冲中的有效快照，加载时重放即可重建聚合。
   */
  serialize() {
    const payload = {
      version: SERIALIZE_VERSION,
      config: {
        capacity: this.capacity,
        minSamples: this.minSamples,
        decay: this.decay,
        switchThreshold: this.switchThreshold,
        maxConfidenceDelta: this.maxConfidenceDelta
      },
      outcomes: this.activeSnapshots()
    };
    return JSON.stringify(payload);
  }
  /**
   * 从 JSON 字符串恢复。配置沿用当前实例（payload 中的 config 仅作参考），
   * 数据通过重放 record 的等价逻辑重建。
   */
  deserialize(data) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (!payload || payload.version !== SERIALIZE_VERSION) return;
    if (!Array.isArray(payload.outcomes)) return;
    this.buffer = new Array(this.capacity);
    this.writeIndex = 0;
    this.totalWritten = 0;
    this.byPair.clear();
    this.byStrategy.clear();
    this.byDomain.clear();
    this.globalBucket = newBucket();
    this.recentFailures = [];
    for (const snap of payload.outcomes) {
      if (!snap || typeof snap.strategy !== "string" || typeof snap.domain !== "string") continue;
      const normalized = {
        strategy: snap.strategy,
        kernel: snap.kernel ?? STRATEGY_KERNEL2[snap.strategy] ?? "pro",
        domain: snap.domain,
        risk: snap.risk ?? "low",
        success: snap.success === true,
        rounds: snap.rounds ?? 0,
        durationMs: snap.durationMs ?? 0,
        toolErrors: snap.toolErrors ?? 0,
        userSatisfied: snap.userSatisfied,
        timestamp: snap.timestamp ?? Date.now(),
        confidence: snap.confidence ?? 0
      };
      this.buffer[this.writeIndex] = normalized;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.totalWritten += 1;
      this.updateAggregates(normalized);
      if (!normalized.success || normalized.toolErrors > 0) {
        this.recordFailure(normalized);
      }
    }
  }
  /** 重置所有学习状态。 */
  reset() {
    this.buffer = new Array(this.capacity);
    this.writeIndex = 0;
    this.totalWritten = 0;
    this.byPair.clear();
    this.byStrategy.clear();
    this.byDomain.clear();
    this.globalBucket = newBucket();
    this.recentFailures = [];
  }
};
function createAdaptationEngine(options) {
  return new AdaptationEngineImpl(options);
}

// src/shared/super/context/assembler.ts
function clamp5(value, lo, hi) {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}
function contentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let out = "";
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part;
        if (typeof p.text === "string") out += p.text;
      }
    }
    return out;
  }
  if (typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}
function hasToolCalls(msg) {
  return Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
}
function toolCallName(raw) {
  if (!raw || typeof raw !== "object") return "";
  const obj = raw;
  if (typeof obj.name === "string") return obj.name;
  const fn = obj.function;
  if (fn && typeof fn === "object") {
    const f = fn;
    if (typeof f.name === "string") return f.name;
  }
  return "";
}
function toolCallArgsText(raw) {
  if (!raw || typeof raw !== "object") return "";
  const obj = raw;
  if (typeof obj.arguments === "string") return obj.arguments;
  const fn = obj.function;
  if (fn && typeof fn === "object") {
    const f = fn;
    if (typeof f.arguments === "string") return f.arguments;
    if (f.arguments != null) {
      try {
        return JSON.stringify(f.arguments);
      } catch {
        return String(f.arguments);
      }
    }
  }
  if (obj.arguments != null) {
    try {
      return JSON.stringify(obj.arguments);
    } catch {
      return String(obj.arguments);
    }
  }
  return "";
}
var DEFAULT_TOKEN_PROFILE = {
  cjkChar: 1.4,
  cjkPunct: 1,
  asciiPerChar: 0.26,
  digitPerChar: 0.34,
  other: 1,
  whitespace: 0.2,
  messageOverhead: 4,
  toolCallOverhead: 8
};
var CJK_PUNCT = new Set(Array.from(`\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A\uFF08\uFF09\u300A\u300B\u300C\u300D\u300E\u300F\u3010\u3011\u2014\u2026\xB7\u3000"''`));
function isCjkIdeograph(ch) {
  const c = ch.codePointAt(0) || 0;
  return c >= 19968 && c <= 40959 || c >= 13312 && c <= 19903 || c >= 63744 && c <= 64255 || c >= 131072 && c <= 196607;
}
function estimateTextTokens(text, profile = DEFAULT_TOKEN_PROFILE) {
  if (!text) return 0;
  let total = 0;
  let asciiRun = 0;
  let digitRun = 0;
  const flushAscii = () => {
    if (asciiRun > 0) {
      total += Math.max(1, Math.ceil(asciiRun * profile.asciiPerChar));
      asciiRun = 0;
    }
  };
  const flushDigit = () => {
    if (digitRun > 0) {
      total += Math.max(1, Math.ceil(digitRun * profile.digitPerChar));
      digitRun = 0;
    }
  };
  for (const ch of text) {
    const c = ch.codePointAt(0) || 0;
    if (isCjkIdeograph(ch)) {
      flushAscii();
      flushDigit();
      total += profile.cjkChar;
    } else if (CJK_PUNCT.has(ch)) {
      flushAscii();
      flushDigit();
      total += profile.cjkPunct;
    } else if (c >= 48 && c <= 57) {
      flushAscii();
      digitRun++;
    } else if (c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95 || c === 45) {
      flushDigit();
      asciiRun++;
    } else if (/\s/.test(ch)) {
      flushAscii();
      flushDigit();
      total += profile.whitespace;
    } else {
      flushAscii();
      flushDigit();
      total += profile.other;
    }
  }
  flushAscii();
  flushDigit();
  return Math.max(0, Math.ceil(total));
}
function estimateToolCallTokens(raw, profile) {
  const name = toolCallName(raw);
  const args = toolCallArgsText(raw);
  return profile.toolCallOverhead + estimateTextTokens(name, profile) + estimateTextTokens(args, profile);
}
function estimateMessageTokens(msg, profile = DEFAULT_TOKEN_PROFILE) {
  let tokens = profile.messageOverhead;
  tokens += estimateTextTokens(contentText(msg.content), profile);
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) tokens += estimateToolCallTokens(tc, profile);
  }
  if (typeof msg.tool_call_id === "string") {
    tokens += estimateTextTokens(msg.tool_call_id, profile);
  }
  for (const key of ["name", "tool_name", "changeId"]) {
    const v = msg[key];
    if (typeof v === "string" && v) tokens += estimateTextTokens(v, profile);
  }
  return Math.ceil(tokens);
}
function estimateMessagesTokens(messages, profile = DEFAULT_TOKEN_PROFILE) {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m, profile);
  return total;
}
var BASE_RATIO = {
  system: 0.12,
  history: 0.46,
  tools: 0.18,
  plan: 0.1,
  reserved: 0.14
};
var DOMAIN_WEIGHTS = {
  code: { system: 1, history: 0.9, tools: 1.9, plan: 1.2, reserved: 0.9 },
  file: { system: 1, history: 1, tools: 1.6, plan: 1, reserved: 1 },
  shell: { system: 1.1, history: 0.9, tools: 1.7, plan: 1.1, reserved: 1 },
  research: { system: 1, history: 1.7, tools: 1.2, plan: 0.9, reserved: 1 },
  writing: { system: 1.1, history: 1.6, tools: 0.7, plan: 0.9, reserved: 1.1 },
  data: { system: 1, history: 1.1, tools: 1.2, plan: 1.1, reserved: 1.2 },
  creative: { system: 1.1, history: 1.3, tools: 0.6, plan: 0.8, reserved: 1.2 },
  planning: { system: 1.1, history: 1, tools: 0.9, plan: 2, reserved: 1.1 },
  qa: { system: 1, history: 1.2, tools: 1, plan: 0.9, reserved: 1.3 },
  conversation: { system: 0.9, history: 1.9, tools: 0.3, plan: 0.2, reserved: 1 }
};
var COMPLEXITY_WEIGHTS = {
  trivial: { system: 0.7, history: 1.1, tools: 0.8, plan: 0.4, reserved: 0.8 },
  simple: { system: 0.9, history: 1, tools: 0.9, plan: 0.7, reserved: 0.9 },
  moderate: { system: 1, history: 1, tools: 1, plan: 1, reserved: 1 },
  complex: { system: 1.2, history: 0.9, tools: 1.1, plan: 1.4, reserved: 1.2 },
  expert: { system: 1.4, history: 0.8, tools: 1.2, plan: 1.7, reserved: 1.4 }
};
var MIN_BUDGET = {
  system: 120,
  history: 200,
  tools: 0,
  plan: 0,
  reserved: 64
};
var RISK_RESERVED_BONUS = {
  low: 1,
  medium: 1.05,
  high: 1.15,
  critical: 1.25
};
function normalizeRatios(raw) {
  const sum = raw.system + raw.history + raw.tools + raw.plan + raw.reserved;
  if (sum <= 0) return { ...BASE_RATIO };
  return {
    system: raw.system / sum,
    history: raw.history / sum,
    tools: raw.tools / sum,
    plan: raw.plan / sum,
    reserved: raw.reserved / sum
  };
}
function mulRatios(a, b) {
  return {
    system: a.system * b.system,
    history: a.history * b.history,
    tools: a.tools * b.tools,
    plan: a.plan * b.plan,
    reserved: a.reserved * b.reserved
  };
}
function applyDemandAdjustments(weights, analysis, plan) {
  const w = { ...weights };
  if (!analysis.needsTools) {
    const freed = w.tools * 0.85;
    w.tools -= freed;
    w.history += freed;
  }
  if (plan && plan.steps.length > 0) {
    const stepBoost = clamp5(plan.steps.length / 8, 0, 1);
    w.plan *= 1 + stepBoost * 0.8;
    if (plan.levels.length > 2) w.system *= 1 + clamp5((plan.levels.length - 2) / 6, 0, 0.3);
  } else {
    w.history += w.plan * 0.7;
    w.plan *= 0.3;
  }
  if (analysis.suggestedTools.length > 6) {
    w.tools *= 1 + clamp5((analysis.suggestedTools.length - 6) / 20, 0, 0.4);
  }
  w.reserved *= RISK_RESERVED_BONUS[analysis.risk] || 1;
  return w;
}
function materializeAllocation(total, ratios, tight) {
  const keys = ["system", "history", "tools", "plan", "reserved"];
  const mins = tight ? { system: 16, history: 24, tools: 0, plan: 0, reserved: 8 } : MIN_BUDGET;
  const raw = {
    system: total * ratios.system,
    history: total * ratios.history,
    tools: total * ratios.tools,
    plan: total * ratios.plan,
    reserved: total * ratios.reserved
  };
  const floors = { system: 0, history: 0, tools: 0, plan: 0, reserved: 0 };
  let allocated = 0;
  for (const k of keys) {
    const min = Math.min(mins[k], total);
    floors[k] = Math.max(min, Math.floor(raw[k]));
    allocated += floors[k];
  }
  if (allocated > total) {
    let excess = allocated - total;
    const order = ["history", "tools", "plan", "system", "reserved"];
    for (const k of order) {
      if (excess <= 0) break;
      const reducible = floors[k] - Math.min(mins[k], total);
      const cut = Math.min(reducible, excess);
      floors[k] -= cut;
      excess -= cut;
    }
    allocated = total - excess;
  }
  const remainders = keys.map((k) => ({ k, r: raw[k] - Math.floor(raw[k]) }));
  remainders.sort((a, b) => b.r - a.r);
  let diff = total - allocated;
  let idx = 0;
  while (diff > 0 && remainders.length > 0) {
    floors[remainders[idx % remainders.length].k] += 1;
    diff -= 1;
    idx += 1;
  }
  return {
    system: floors.system,
    history: floors.history,
    tools: floors.tools,
    plan: floors.plan,
    reserved: floors.reserved,
    total
  };
}
function classifyMessage(msg) {
  const role = String(msg.role || "").toLowerCase();
  if (role === "system" || role === "developer") return "system";
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "tool" || role === "function") return "tool";
  return "other";
}
var ERROR_HINT_RE = /(error|exception|traceback|failed|失败|错误|异常|timeout|超时|denied|拒绝)/i;
function messageImportance(msg, index, firstUserIndex, total) {
  const kind = classifyMessage(msg);
  let score = 0;
  if (kind === "system") return Number.POSITIVE_INFINITY;
  if (kind === "user") {
    score += 8;
    if (index === firstUserIndex) score += 18;
  } else if (kind === "assistant") {
    score += hasToolCalls(msg) ? 6 : 3;
  } else if (kind === "tool") {
    score += 1;
    const text = contentText(msg.content);
    if (ERROR_HINT_RE.test(text)) score += 6;
  } else {
    score += 2;
  }
  const recency = total <= 1 ? 0 : index / (total - 1) * 6;
  score += recency;
  score += Math.min(4, contentText(msg.content).length / 500);
  if (msg.attachments || msg.hasAttachment || msg.images) score += 5;
  return score;
}
var TOOL_FOLD_THRESHOLD = 4e3;
var FOLD_HEAD = 900;
var FOLD_TAIL = 700;
function foldToolResult(text, threshold = TOOL_FOLD_THRESHOLD) {
  if (text.length <= threshold) return { text, folded: false, saved: 0 };
  const head = text.slice(0, FOLD_HEAD);
  const tail = text.slice(-FOLD_TAIL);
  const omitted = text.length - FOLD_HEAD - FOLD_TAIL;
  const marker = `

\u2026[\u4E0A\u4E0B\u6587\u5DE5\u7A0B\uFF1A\u5DF2\u6298\u53E0 ${omitted} \u5B57\u7B26\uFF08\u539F\u957F ${text.length}\uFF09\u3002\u4FDD\u7559\u5F00\u5934\u4E0E\u7ED3\u5C3E\u4EE5\u4FBF\u8BCA\u65AD\uFF1B\u5982\u9700\u5B8C\u6574\u5185\u5BB9\u8BF7\u7528\u8303\u56F4\u53C2\u6570\u91CD\u65B0\u8BFB\u53D6\u3002]\u2026

`;
  const folded = head + marker + tail;
  return { text: folded, folded: true, saved: text.length - folded.length };
}
function isFoldableToolMessage(msg) {
  return classifyMessage(msg) === "tool" && typeof msg.content === "string";
}
function buildBlocks(messages, firstUserIndex, importanceOf, profile) {
  const blocks = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const kind = classifyMessage(msg);
    if (kind === "assistant" && hasToolCalls(msg)) {
      const end0 = i + 1;
      let j = end0;
      while (j < messages.length && classifyMessage(messages[j]) === "tool") j++;
      const slice = messages.slice(i, j);
      const imp = Math.max(...slice.map((m, k) => importanceOf(m, i + k)));
      const tok = slice.reduce((s, m) => s + estimateMessageTokens(m, profile), 0);
      blocks.push({ start: i, end: j, messages: slice, importance: imp, tokens: tok });
      i = j;
    } else {
      const imp = importanceOf(msg, i);
      const tok = estimateMessageTokens(msg, profile);
      blocks.push({ start: i, end: i + 1, messages: [msg], importance: imp, tokens: tok });
      i += 1;
    }
  }
  return blocks;
}
function splitTurns(messages) {
  const turns = [];
  let currentStart = -1;
  for (let i = 0; i < messages.length; i++) {
    if (classifyMessage(messages[i]) === "user") {
      if (currentStart >= 0) turns[turns.length - 1].end = i;
      currentStart = i;
      turns.push({ start: i, end: messages.length });
    }
  }
  return turns;
}
var TRIM_STATS_KEY = "__trimStats";
function trimMessages(messages, budget, opts = {}) {
  const profile = opts.profile || DEFAULT_TOKEN_PROFILE;
  const keepRecentTurns = opts.keepRecentTurns ?? 2;
  const foldThreshold = opts.foldThreshold ?? TOOL_FOLD_THRESHOLD;
  if (messages.length === 0) return [];
  const systemMsgs = [];
  let bodyStart = 0;
  while (bodyStart < messages.length && classifyMessage(messages[bodyStart]) === "system") {
    systemMsgs.push(messages[bodyStart]);
    bodyStart++;
  }
  const body = messages.slice(bodyStart);
  const originalTokens = estimateMessagesTokens(messages, profile);
  let foldedCount = 0;
  const prepared = body.map((m) => {
    if ((opts.foldToolResults ?? true) && isFoldableToolMessage(m)) {
      const text = String(m.content);
      if (text.length > foldThreshold) {
        const f = foldToolResult(text, foldThreshold);
        if (f.folded) {
          foldedCount++;
          return { ...m, content: f.text };
        }
      }
    }
    return m;
  });
  const firstUserIndex = prepared.findIndex((m) => classifyMessage(m) === "user");
  const turns = splitTurns(prepared);
  const recentTurnStart = turns.length > keepRecentTurns ? turns[turns.length - keepRecentTurns].start : turns.length > 0 ? turns[0].start : prepared.length;
  const importance = (m, i) => messageImportance(m, i, firstUserIndex, prepared.length);
  const blocks = buildBlocks(prepared, firstUserIndex, importance, profile);
  const protectedBlockIdx = /* @__PURE__ */ new Set();
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    let mustKeep = false;
    for (let k = b.start; k < b.end; k++) {
      if (k === firstUserIndex) mustKeep = true;
      if (k >= recentTurnStart) mustKeep = true;
      if (k === prepared.length - 1) mustKeep = true;
    }
    if (b.messages.some((m) => classifyMessage(m) === "system")) mustKeep = true;
    if (mustKeep) protectedBlockIdx.add(bi);
  }
  const systemTokens = systemMsgs.reduce((s, m) => s + estimateMessageTokens(m, profile), 0);
  const systemSlack = Math.max(0, budget.system - systemTokens);
  const historyBudget = Math.max(0, budget.history + systemSlack);
  const dropReasons = [];
  const keptIdx = /* @__PURE__ */ new Set();
  let keptTokens = systemTokens;
  const lastBlockIdx = blocks.length - 1;
  const isFirstUserBlock = (idx) => {
    const b = blocks[idx];
    return b.start <= firstUserIndex && b.end > firstUserIndex;
  };
  const priorityOf = (idx) => {
    if (idx === lastBlockIdx) return 3;
    if (isFirstUserBlock(idx)) return 2;
    if (blocks[idx].start >= recentTurnStart) return 1;
    return 0;
  };
  const protectedOrder = Array.from(protectedBlockIdx).sort((a, b) => {
    const pa = priorityOf(a);
    const pb = priorityOf(b);
    if (pa !== pb) return pb - pa;
    return blocks[b].importance - blocks[a].importance;
  });
  for (const bi of protectedOrder) {
    const b = blocks[bi];
    if (keptTokens + b.tokens <= historyBudget || keptIdx.size === 0) {
      keptIdx.add(bi);
      keptTokens += b.tokens;
    } else {
      dropReasons.push(`\u5FC5\u4FDD\u5757[${b.start}-${b.end - 1}]\u56E0\u9884\u7B97\u4E0D\u8DB3\u820D\u5F03\uFF08${b.tokens} tokens\uFF09`);
    }
  }
  const optional = blocks.map((b, idx) => ({ b, idx })).filter((x) => !protectedBlockIdx.has(x.idx)).sort((x, y) => {
    if (y.b.importance !== x.b.importance) return y.b.importance - x.b.importance;
    return x.b.start - y.b.start;
  });
  for (const { b, idx } of optional) {
    if (keptTokens + b.tokens <= historyBudget) {
      keptIdx.add(idx);
      keptTokens += b.tokens;
    } else {
      dropReasons.push(`\u5757[${b.start}-${b.end - 1}]\u91CD\u8981\u6027 ${b.importance.toFixed(1)} \u4F4E\u4E8E\u9884\u7B97\u4E0A\u9650\uFF0C\u820D\u5F03`);
    }
  }
  const result = [...systemMsgs];
  const sortedKept = Array.from(keptIdx).sort((a, b) => blocks[a].start - blocks[b].start);
  for (const bi of sortedKept) result.push(...blocks[bi].messages);
  const stats = {
    originalCount: messages.length,
    keptCount: result.length,
    droppedCount: messages.length - result.length,
    foldedCount,
    originalTokens,
    keptTokens: estimateMessagesTokens(result, profile),
    budget: budget.history,
    dropReasons
  };
  Object.defineProperty(result, TRIM_STATS_KEY, { value: stats, enumerable: false, configurable: true });
  return result;
}
var DOMAIN_LABEL = {
  code: "\u4EE3\u7801\u5DE5\u7A0B",
  file: "\u6587\u4EF6\u64CD\u4F5C",
  shell: "\u547D\u4EE4\u884C",
  research: "\u8C03\u7814\u68C0\u7D22",
  writing: "\u5199\u4F5C",
  data: "\u6570\u636E\u5206\u6790",
  creative: "\u521B\u610F\u521B\u4F5C",
  planning: "\u89C4\u5212\u8BBE\u8BA1\u4E2D",
  qa: "\u6D4B\u8BD5\u9A8C\u8BC1",
  conversation: "\u65E5\u5E38\u5BF9\u8BDD"
};
var COMPLEXITY_LABEL = {
  trivial: "\u6781\u7B80",
  simple: "\u7B80\u5355",
  moderate: "\u4E2D\u7B49",
  complex: "\u590D\u6742",
  expert: "\u4E13\u5BB6\u7EA7"
};
var RISK_LABEL = {
  low: "\u4F4E",
  medium: "\u4E2D",
  high: "\u9AD8",
  critical: "\u6781\u9AD8"
};
var STRATEGY_LABEL = {
  direct: "\u76F4\u63A5\u56DE\u7B54",
  single_tool: "\u5355\u5DE5\u5177\u8C03\u7528",
  iterative: "\u591A\u8F6E\u5DE5\u5177\u5FAA\u73AF",
  autonomous: "\u81EA\u4E3B\u76EE\u6807\u95ED\u73AF",
  deep: "\u6DF1\u5EA6\u5DE5\u7A0B\uFF08\u5168\u5957\u62A4\u680F\uFF09"
};
function formatAnalysisSummary(analysis) {
  const lines = [];
  lines.push("\u3010\u4EFB\u52A1\u753B\u50CF\u3011");
  lines.push(`- \u9886\u57DF\uFF1A${DOMAIN_LABEL[analysis.domain] || analysis.domain}\uFF08\u7F6E\u4FE1\u5EA6 ${Math.round(analysis.confidence * 100)}%\uFF09`);
  lines.push(`- \u590D\u6742\u5EA6\uFF1A${COMPLEXITY_LABEL[analysis.complexity.level] || analysis.complexity.level}\uFF08${analysis.complexity.score}/100\uFF09`);
  lines.push(`- \u98CE\u9669\u7B49\u7EA7\uFF1A${RISK_LABEL[analysis.risk] || analysis.risk}`);
  if (analysis.intent) lines.push(`- \u610F\u56FE\uFF1A${analysis.intent}`);
  const alts = analysis.domains.filter((d) => d.domain !== analysis.domain).sort((a, b) => b.weight - a.weight).slice(0, 2);
  if (alts.length > 0) {
    lines.push(`- \u76F8\u5173\u9886\u57DF\uFF1A${alts.map((d) => `${DOMAIN_LABEL[d.domain] || d.domain}(${Math.round(d.weight * 100)}%)`).join("\u3001")}`);
  }
  if (analysis.complexity.reasons.length > 0) {
    lines.push(`- \u8BC4\u5206\u4F9D\u636E\uFF1A${analysis.complexity.reasons.slice(0, 3).join("\uFF1B")}`);
  }
  return lines.join("\n");
}
function formatPlanDigest(plan) {
  if (!plan || plan.steps.length === 0) return "";
  const lines = [];
  lines.push("\u3010\u6267\u884C\u8BA1\u5212\u3011");
  lines.push(`\u76EE\u6807\uFF1A${plan.goal}`);
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  for (let li = 0; li < plan.levels.length; li++) {
    const ids = plan.levels[li];
    if (!ids || ids.length === 0) continue;
    const parts = ids.map((id) => {
      const step = byId.get(id);
      if (!step) return id;
      const dep = step.dependsOn.length ? `\uFF1B\u4F9D\u8D56 ${step.dependsOn.join(",")}` : "";
      const tools = step.tools.length ? `\uFF1B\u5DE5\u5177 ${step.tools.join(",")}` : "";
      return `${id} ${step.title}${dep}${tools}`;
    });
    lines.push(`\u7B2C ${li + 1} \u5C42${ids.length > 1 ? "\uFF08\u53EF\u5E76\u884C\uFF09" : ""}\uFF1A${parts.join(" \uFF5C ")}`);
  }
  if (plan.criticalPath.length > 0) {
    lines.push(`\u5173\u952E\u8DEF\u5F84\uFF1A${plan.criticalPath.join(" \u2192 ")}`);
  }
  lines.push(`\u9884\u8BA1\u8F6E\u6B21\uFF1A${plan.estimatedRounds}`);
  return lines.join("\n");
}
function formatStrategyHint(decision) {
  const lines = [];
  lines.push("\u3010\u6267\u884C\u7B56\u7565\u3011");
  lines.push(`- \u8DEF\u7EBF\uFF1A${STRATEGY_LABEL[decision.strategy] || decision.strategy}\uFF08\u5185\u6838 ${decision.kernel}\uFF0C\u7F6E\u4FE1\u5EA6 ${Math.round(decision.confidence * 100)}%\uFF09`);
  if (decision.reasons.length > 0) {
    lines.push(`- \u9009\u8DEF\u7406\u7531\uFF1A${decision.reasons.slice(0, 3).join("\uFF1B")}`);
  }
  const o = decision.overrides;
  const hints = [];
  if (o.maxRounds != null) hints.push(`\u6700\u591A ${o.maxRounds} \u8F6E`);
  if (o.maxTokens != null) hints.push(`\u5355\u6B21\u8F93\u51FA\u4E0A\u9650 ${o.maxTokens} token`);
  if (o.temperature != null) hints.push(`\u6E29\u5EA6 ${o.temperature}`);
  if (o.enableGuardrails === true) hints.push("\u542F\u7528\u5168\u5957\u62A4\u680F");
  if (o.enableGuardrails === false) hints.push("\u62A4\u680F\u964D\u7EA7\uFF08\u4EC5\u4FDD\u7559\u786C\u963B\u65AD\uFF09");
  if (o.enableVerification === true) hints.push("\u6BCF\u6B65\u5B8C\u6210\u540E\u987B\u9A8C\u8BC1");
  if (o.hermesMode && o.hermesMode !== "auto") hints.push(`\u5DE5\u5177\u534F\u8BAE ${o.hermesMode}`);
  if (hints.length > 0) lines.push(`- \u8FD0\u884C\u53C2\u6570\uFF1A${hints.join("\uFF1B")}`);
  return lines.join("\n");
}
function formatGuardrailRules(analysis) {
  const lines = [];
  lines.push("\u3010\u62A4\u680F\u89C4\u5219\u3011");
  lines.push("- \u5220\u9664\u3001\u8986\u76D6\u7CFB\u7EDF\u6587\u4EF6/\u6570\u636E\u5E93\u3001\u53D1\u9001\u7F51\u7EDC\u8BF7\u6C42\u3001\u4ED8\u8D39\u64CD\u4F5C\u524D\u5FC5\u987B\u83B7\u5F97\u660E\u786E\u786E\u8BA4\u3002");
  lines.push("- \u4E0D\u5F97\u5728\u8F93\u51FA\u4E2D\u590D\u8FF0\u5BC6\u94A5\u3001\u4EE4\u724C\u3001API Key \u7B49\u654F\u611F\u51ED\u636E\u3002");
  lines.push("- \u907F\u514D\u5BF9\u540C\u4E00\u76EE\u6807\u91CD\u590D\u6267\u884C\u76F8\u540C\u53C2\u6570\u7684\u5DE5\u5177\u8C03\u7528\uFF1B\u82E5\u5931\u8D25\u5E94\u6362\u7B56\u7565\u800C\u975E\u76F2\u76EE\u91CD\u8BD5\u3002");
  if (analysis.risk === "high" || analysis.risk === "critical") {
    lines.push("- \u672C\u4EFB\u52A1\u4E3A\u9AD8\u98CE\u9669\uFF1A\u6BCF\u4E00\u6B65\u90FD\u8981\u8BF4\u660E\u5C06\u4EA7\u751F\u7684\u5F71\u54CD\uFF0C\u5E76\u4F18\u5148\u9009\u62E9\u53EF\u9006\u64CD\u4F5C\u3002");
  }
  if (analysis.needsTools) {
    lines.push("- \u8C03\u7528\u5DE5\u5177\u524D\u5148\u7528\u4E00\u53E5\u8BDD\u8BF4\u660E\u76EE\u7684\uFF1B\u62FF\u5230\u7ED3\u679C\u540E\u6838\u5BF9\u662F\u5426\u7B26\u5408\u9884\u671F\u518D\u7EE7\u7EED\u3002");
  }
  return lines.join("\n");
}
function wrapReminder(title, body) {
  if (!body) return "";
  return `<system-reminder title="${title}">
${body}
</system-reminder>`;
}
var ContextAssemblerImpl = class {
  profile;
  keepRecentTurns;
  fold;
  constructor(opts = {}) {
    this.profile = opts.tokenProfile || DEFAULT_TOKEN_PROFILE;
    this.keepRecentTurns = opts.keepRecentTurns ?? 2;
    this.fold = !opts.disableFold;
  }
  /**
   * L1-L4 四级预算分配。totalTokens <= 0 时返回全 0 分配（不抛错，便于降级）。
   */
  allocate(totalTokens, analysis, plan) {
    const total = Math.max(0, Math.floor(Number(totalTokens) || 0));
    if (total === 0) {
      return { system: 0, history: 0, tools: 0, plan: 0, reserved: 0, total: 0 };
    }
    const domainW = DOMAIN_WEIGHTS[analysis.domain] || BASE_RATIO;
    const complexityW = COMPLEXITY_WEIGHTS[analysis.complexity.level] || BASE_RATIO;
    const weighted = mulRatios(mulRatios(BASE_RATIO, domainW), complexityW);
    const adjusted = applyDemandAdjustments(weighted, analysis, plan);
    const ratios = normalizeRatios(adjusted);
    return materializeAllocation(total, ratios, total < 800);
  }
  /**
   * 历史裁剪。委托给 trimMessages，并注入本实例配置。
   */
  trim(messages, budget) {
    return trimMessages(messages, budget, {
      profile: this.profile,
      keepRecentTurns: this.keepRecentTurns,
      foldToolResults: this.fold,
      withStats: true
    });
  }
  /**
   * 系统提示组装：四段各自包 <system-reminder>，最后拼成一个 system 文本。
   * 没有计划时该段留空，不产生空标签。
   */
  buildSystemPrompt(analysis, plan, decision) {
    const blocks = [
      wrapReminder("task-analysis", formatAnalysisSummary(analysis)),
      wrapReminder("execution-plan", formatPlanDigest(plan)),
      wrapReminder("execution-strategy", formatStrategyHint(decision)),
      wrapReminder("guardrails", formatGuardrailRules(analysis))
    ].filter(Boolean);
    return blocks.join("\n");
  }
  /**
   * 用与裁剪完全一致的口径估算任意文本 token（对外暴露，便于调用方做预算决策）。
   */
  estimateTokens(text) {
    return estimateTextTokens(text, this.profile);
  }
  /**
   * 估算一组消息的 token（供调用方在 trim 前后对比，验证裁剪是否达标）。
   */
  estimateMessages(messages) {
    return estimateMessagesTokens(messages, this.profile);
  }
  /**
   * 预算分配的可解释文本：逐类说明"分到多少、为什么"。
   * 诊断面板可直接展示，回答"为什么这次给工具/历史这么多额度"。
   */
  explainAllocation(alloc, analysis, plan) {
    const pct = (n) => alloc.total > 0 ? `${Math.round(n / alloc.total * 100)}%` : "0%";
    const lines = [];
    lines.push(`\u4E0A\u4E0B\u6587\u9884\u7B97 ${alloc.total} token\uFF08\u9886\u57DF ${analysis.domain}\uFF0C\u590D\u6742\u5EA6 ${analysis.complexity.level}\uFF0C\u98CE\u9669 ${analysis.risk}\uFF09\uFF1A`);
    lines.push(`  system   ${alloc.system} (${pct(alloc.system)}) \u2014\u2014 \u5206\u6790\u6458\u8981/\u8BA1\u5212/\u7B56\u7565/\u62A4\u680F\u89C4\u5219`);
    lines.push(`  history  ${alloc.history} (${pct(alloc.history)}) \u2014\u2014 \u5BF9\u8BDD\u5386\u53F2\uFF0C\u6309\u91CD\u8981\u6027\u4E0E\u6700\u8FD1\u8F6E\u88C1\u526A`);
    lines.push(`  tools    ${alloc.tools} (${pct(alloc.tools)}) \u2014\u2014 \u5DE5\u5177 schema${analysis.needsTools ? "" : "\uFF08\u672C\u4EFB\u52A1\u65E0\u9700\u5DE5\u5177\uFF0C\u5DF2\u538B\u7F29\uFF09"}`);
    lines.push(`  plan     ${alloc.plan} (${pct(alloc.plan)}) \u2014\u2014 \u6267\u884C\u8BA1\u5212${plan ? `\uFF08${plan.steps.length} \u6B65\uFF09` : "\uFF08\u65E0\u8BA1\u5212\uFF0C\u5DF2\u538B\u7F29\uFF09"}`);
    lines.push(`  reserved ${alloc.reserved} (${pct(alloc.reserved)}) \u2014\u2014 \u8F93\u51FA\u4E0E\u9519\u8BEF\u6062\u590D\u7F13\u51B2`);
    return lines.join("\n");
  }
  /**
   * 一站式组装：分配预算 → 裁剪历史 → 生成增强 system。
   * 返回的 messages 已把裁剪后的历史与新的 system 提示合并（system 置顶）。
   * 注意：不会修改传入的 messages / analysis / plan / decision。
   */
  assemble(totalTokens, messages, analysis, plan, decision) {
    const budget = this.allocate(totalTokens, analysis, plan);
    const trimmed = this.trim(messages, budget);
    const systemText = this.buildSystemPrompt(analysis, plan, decision);
    const systemMsg = { role: "system", content: systemText };
    const withoutSystem = trimmed.filter((m) => classifyMessage(m) !== "system");
    return {
      messages: [systemMsg, ...withoutSystem],
      budget,
      system: systemText
    };
  }
};
function createAssembler(opts) {
  return new ContextAssemblerImpl(opts);
}

// src/shared/super/guardrails/chain.ts
function normText(s) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
    }
  }
  return {};
}
function flattenArgs(args, depth = 0) {
  if (depth > 5) return "";
  const parts = [];
  for (const [k, v] of Object.entries(args || {})) {
    parts.push(k);
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(String(v));
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") parts.push(item);
        else if (item && typeof item === "object") parts.push(flattenArgs(asRecord(item), depth + 1));
      }
    } else if (v && typeof v === "object") {
      parts.push(flattenArgs(asRecord(v), depth + 1));
    }
  }
  return parts.join(" ");
}
function toolCallArgs(tc) {
  return asRecord(tc.arguments);
}
function toHit(result, rule) {
  if (typeof result === "boolean") {
    return result ? { hit: true, reason: `\u547D\u4E2D\u89C4\u5219 ${rule.id}\uFF1A${rule.description}` } : { hit: false };
  }
  if (result.hit && !result.reason) {
    return { hit: true, reason: `\u547D\u4E2D\u89C4\u5219 ${rule.id}\uFF1A${rule.description}` };
  }
  return result;
}
function patternMatches(text, patterns) {
  const compact = String(text ?? "").replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();
  for (const p of patterns) {
    if (p instanceof RegExp) {
      const safe = new RegExp(p.source, p.flags.replace(/[gy]/g, ""));
      if (safe.test(compact) || safe.test(lower)) return safe.source;
    } else if (lower.includes(normText(p))) {
      return p;
    }
  }
  return null;
}
function makePatternRule(spec) {
  return {
    id: spec.id,
    description: spec.description,
    scope: spec.scope,
    severity: spec.severity,
    test(ctx) {
      let text = "";
      if (spec.field === "toolName") text = ctx.toolName || "";
      else if (spec.field === "argsText") text = ctx.argsText || "";
      else if (spec.field === "text") text = ctx.text || "";
      else text = [ctx.toolName, ctx.argsText, ctx.text].filter(Boolean).join(" ");
      const matched = patternMatches(text, spec.patterns);
      if (matched == null) return { hit: false };
      return {
        hit: true,
        reason: spec.reason || `\u547D\u4E2D\u89C4\u5219 ${spec.id}\uFF08${spec.description}\uFF09\uFF1A\u68C0\u6D4B\u5230\u300C${matched}\u300D`
      };
    }
  };
}
var TOOL_RULES = [
  // ── A 组：危险工具名（直接 block）────────────────────────────────────
  makePatternRule({
    id: "tool.shell_exec",
    description: "\u901A\u7528 shell/\u547D\u4EE4\u6267\u884C\u5DE5\u5177",
    scope: "tool",
    severity: "block",
    field: "toolName",
    patterns: [/^shell$/, /^bash$/, /^sh$/, /^cmd$/, /^powershell$/, /execute_command/, /run_command/, /命令执行/],
    reason: "\u5DE5\u5177\u672C\u8EAB\u53EF\u6267\u884C\u4EFB\u610F\u7CFB\u7EDF\u547D\u4EE4\uFF0C\u9700\u4EBA\u5DE5\u786E\u8BA4\u540E\u653E\u884C"
  }),
  makePatternRule({
    id: "tool.sudo",
    description: "\u63D0\u6743\u6267\u884C\u5DE5\u5177",
    scope: "tool",
    severity: "block",
    field: "toolName",
    patterns: [/sudo/, /root_shell/, /提权/]
  }),
  makePatternRule({
    id: "tool.payment",
    description: "\u652F\u4ED8/\u8F6C\u8D26\u5DE5\u5177",
    scope: "tool",
    severity: "block",
    field: "toolName",
    patterns: [/pay/, /payment/, /purchase/, /transfer/, /转账/, /付款/, /支付/, /购买/],
    reason: "\u6D89\u53CA\u8D44\u91D1\u6D41\u52A8\uFF0C\u5FC5\u987B\u7531\u7528\u6237\u660E\u786E\u786E\u8BA4"
  }),
  makePatternRule({
    id: "tool.email_send",
    description: "\u90AE\u4EF6/\u6D88\u606F\u5916\u53D1\u5DE5\u5177",
    scope: "tool",
    severity: "block",
    field: "toolName",
    patterns: [/send_email/, /send_mail/, /smtp/, /send_message/, /发邮件/, /发送消息/]
  }),
  makePatternRule({
    id: "tool.network",
    description: "\u901A\u7528\u7F51\u7EDC\u8BF7\u6C42\u5DE5\u5177",
    scope: "tool",
    severity: "warn",
    field: "toolName",
    patterns: [/^http/, /^curl/, /^wget/, /webhook/, /网络请求/],
    reason: "\u7F51\u7EDC\u5DE5\u5177\u53EF\u80FD\u5916\u53D1\u6570\u636E\uFF0C\u8BF7\u786E\u8BA4\u76EE\u6807\u53EF\u4FE1"
  }),
  // ── B 组：危险命令内容（block）────────────────────────────────────────
  makePatternRule({
    id: "cmd.rm_rf",
    description: "\u9012\u5F52\u5F3A\u5236\u5220\u9664 rm -rf",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/, /rm\s+-rf/, /del\s+\/f\s+\/s/, /递归强制删除/, /强制删除目录/],
    reason: "\u9012\u5F52\u5F3A\u5236\u5220\u9664\u4E0D\u53EF\u9006\uFF0C block"
  }),
  makePatternRule({
    id: "cmd.rm_root",
    description: "\u5220\u9664\u6839\u76EE\u5F55\u6216\u7CFB\u7EDF\u5173\u952E\u8DEF\u5F84",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/rm\s+.*\s\/\s*$/, /rm\s+-rf\s+\//, /删除根目录/, /删根目录/]
  }),
  makePatternRule({
    id: "cmd.drop_db",
    description: "\u5220\u5E93/\u5220\u8868",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/drop\s+(database|table|schema)/i, /truncate\s+table/, /删库/, /删表/, /删除数据库/, /清空数据库/],
    reason: "\u7834\u574F\u6570\u636E\u5E93\u7ED3\u6784\uFF0C\u51E0\u4E4E\u4E0D\u53EF\u6062\u590D"
  }),
  makePatternRule({
    id: "cmd.format_disk",
    description: "\u683C\u5F0F\u5316\u78C1\u76D8",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/mkfs\./, /format\s+[a-z]:/i, /diskpart/i, /格式化磁盘/, /格式化硬盘/]
  }),
  makePatternRule({
    id: "cmd.dd_disk",
    description: "dd \u8986\u76D6\u78C1\u76D8",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/\bdd\s+if=/, /of=\/dev\//, /写穿磁盘/]
  }),
  makePatternRule({
    id: "cmd.shutdown",
    description: "\u5173\u673A/\u91CD\u542F\u7CFB\u7EDF",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/\bshutdown\b/, /\breboot\b/, /\bhalt\b/, /关机/, /重启系统/, /重新启动计算机/]
  }),
  makePatternRule({
    id: "cmd.kill_all",
    description: "\u6279\u91CF\u6740\u8FDB\u7A0B",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/kill\s+-9\s+-1/, /pkill\s+-9/, /taskkill\s+\/f\s+\/im\s+\*/, /杀掉所有进程/, /结束所有进程/]
  }),
  makePatternRule({
    id: "cmd.chmod_777",
    description: "\u5371\u9669\u6743\u9650\u63D0\u5347",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/chmod\s+-r\s+777/, /chmod\s+777\s+\//, /icacls.*\/grant.*everyone/i, /开放全部权限/]
  }),
  makePatternRule({
    id: "cmd.system_file",
    description: "\u4FEE\u6539\u7CFB\u7EDF\u5173\u952E\u6587\u4EF6",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/\/etc\/(passwd|shadow|hosts|sudoers)/, /c:\\windows\\system32/i, /修改系统文件/, /篡改hosts/]
  }),
  makePatternRule({
    id: "cmd.git_push_force",
    description: "\u5F3A\u5236\u63A8\u9001\u8986\u76D6\u8FDC\u7A0B",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/git\s+push\s+.*--force/, /git\s+push\s+-f\b/, /强推/, /强制推送/],
    reason: "\u5F3A\u5236\u63A8\u9001\u4F1A\u8986\u76D6\u8FDC\u7A0B\u5386\u53F2\uFF0C\u8BF7\u786E\u8BA4"
  }),
  makePatternRule({
    id: "cmd.git_reset_hard",
    description: "\u786C\u91CD\u7F6E\u4E22\u5F03\u6539\u52A8",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/git\s+reset\s+--hard/, /硬重置/, /丢弃所有修改/]
  }),
  makePatternRule({
    id: "cmd.eval_exec",
    description: "\u52A8\u6001\u6267\u884C\u4EFB\u610F\u4EE3\u7801",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/\beval\s*\(/, /\bexec\s*\(/, /os\.system/, /subprocess\.(call|run|Popen)/, /动态执行代码/],
    reason: "\u52A8\u6001\u6267\u884C\u6765\u6E90\u4E0D\u660E\u7684\u4EE3\u7801\u6709\u6CE8\u5165\u98CE\u9669"
  }),
  makePatternRule({
    id: "cmd.curl_pipe_sh",
    description: "\u4E0B\u8F7D\u5373\u6267\u884C\uFF08curl|sh\uFF09",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/curl[^\n]*\|\s*(ba)?sh/, /wget[^\n]*\|\s*(ba)?sh/, /下载并直接执行/],
    reason: "\u8FDC\u7A0B\u811A\u672C\u672A\u7ECF\u5BA1\u67E5\u76F4\u63A5\u6267\u884C\u6781\u5EA6\u5371\u9669"
  }),
  makePatternRule({
    id: "cmd.base64_decode_exec",
    description: "\u6DF7\u6DC6\u89E3\u7801\u540E\u6267\u884C",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/base64[^\n]*-d[^\n]*\|\s*(ba)?sh/, /decode[^\n]*exec/, /解码后执行/]
  }),
  // ── C 组：危险参数组合（block/warn）───────────────────────────────────
  {
    id: "param.recursive_force",
    description: "recursive+force \u7EC4\u5408\u5220\u9664",
    scope: "tool",
    severity: "block",
    test(ctx) {
      const a = ctx.args || {};
      const recursive = a.recursive === true || a.force === true && a.recursive !== false || a.r === true || typeof a.flags === "string" && /r/.test(a.flags) && /f/.test(a.flags);
      const destructive = a.force === true || a.f === true || typeof a.flags === "string" && /f/.test(a.flags);
      if (recursive && destructive) {
        return { hit: true, reason: `\u53C2\u6570\u542B\u9012\u5F52+\u5F3A\u5236\u7EC4\u5408\uFF08recursive/force\uFF09\uFF0C\u53EF\u80FD\u5BFC\u81F4\u4E0D\u53EF\u9006\u5220\u9664\uFF08\u5DE5\u5177 ${ctx.toolName || "?"}\uFF09` };
      }
      return { hit: false };
    }
  },
  {
    id: "param.no_confirm_send",
    description: "\u5916\u53D1\u64CD\u4F5C\u7F3A\u5C11\u786E\u8BA4\u6807\u5FD7",
    scope: "tool",
    severity: "warn",
    test(ctx) {
      const name = normText(ctx.toolName);
      if (!/send|mail|transfer|pay|upload|分享|发送|上传/.test(name)) return { hit: false };
      const a = ctx.args || {};
      const hasConfirm = a.confirmed === true || a.confirm === true || a.dryRun === true || a.dry_run === true;
      if (!hasConfirm) return { hit: true, reason: `\u5916\u53D1\u5DE5\u5177 ${ctx.toolName} \u672A\u663E\u5F0F\u8BBE\u7F6E confirmed/dryRun\uFF0C\u5EFA\u8BAE\u5148\u9884\u89C8\u518D\u53D1\u9001` };
      return { hit: false };
    }
  },
  makePatternRule({
    id: "param.system_path",
    description: "\u5199\u5165\u7CFB\u7EDF\u8DEF\u5F84",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/\/etc\//, /\/usr\/(bin|sbin|lib)/, /c:\\windows\\/i, /system32/i, /写入系统目录/]
  }),
  makePatternRule({
    id: "param.env_secrets",
    description: "\u8BFB\u53D6\u73AF\u5883\u53D8\u91CF\u4E2D\u7684\u51ED\u636E",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/env\.(api_key|secret|token|password)/i, /process\.env\.[a-z_]*(key|secret|token|pass)/i, /读取环境变量密钥/],
    reason: "\u8BFB\u53D6\u73AF\u5883\u53D8\u91CF\u4E2D\u7684\u51ED\u636E\u53EF\u80FD\u6CC4\u9732\u5BC6\u94A5"
  }),
  // ── D 组：网络外发 / 数据外泄（warn）──────────────────────────────────
  makePatternRule({
    id: "net.exfil_domain",
    description: "\u5411\u53EF\u7591\u57DF\u540D\u5916\u53D1\u6570\u636E",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/curl[^\n]*-d\s/, /--data-binary/, /POST[^\n]*http/i, /webhook\.site/, /requestbin/, /外发数据/],
    reason: "\u68C0\u6D4B\u5230\u5411\u5916\u90E8\u7AEF\u70B9\u53D1\u9001\u6570\u636E\uFF0C\u8BF7\u786E\u8BA4\u6570\u636E\u4E0D\u542B\u654F\u611F\u4FE1\u606F"
  }),
  makePatternRule({
    id: "net.dns_exfil",
    description: "DNS \u96A7\u9053\u5916\u6CC4",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/nslookup[^\n]*\$\(/, /dig[^\n]*\$\(/, /dns.*exfil/i, /dns外泄/]
  }),
  // ── E 组：补充危险模式（扩大中英文覆盖面）───────────────────────────────
  makePatternRule({
    id: "cmd.git_clean_fd",
    description: "\u5F3A\u5236\u6E05\u7406\u672A\u8DDF\u8E2A\u6587\u4EF6",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/git\s+clean\s+-(f)?d(f|x)/, /git\s+clean\s+-fd/, /清理未跟踪文件/],
    reason: "git clean -fd \u4F1A\u5220\u9664\u672A\u8DDF\u8E2A\u6587\u4EF6\uFF0C\u53EF\u80FD\u4E22\u5931\u7528\u6237\u6570\u636E"
  }),
  makePatternRule({
    id: "cmd.registry_edit",
    description: "\u4FEE\u6539\u7CFB\u7EDF\u6CE8\u518C\u8868",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/reg\s+delete\s+hklm/i, /reg\s+add\s+hklm/i, /修改注册表/, /删除注册表项/]
  }),
  makePatternRule({
    id: "cmd.cron_modify",
    description: "\u4FEE\u6539\u7CFB\u7EDF\u5B9A\u65F6\u4EFB\u52A1",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/crontab\s+-r/, /\/etc\/cron\./, /删除所有定时任务/, /systemd.*disable/i]
  }),
  makePatternRule({
    id: "cmd.user_modify",
    description: "\u589E\u5220\u7CFB\u7EDF\u7528\u6237",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/userdel\b/, /useradd\b/, /net\s+user\s+\S+\s+\/delete/i, /删除用户账户/, /新建系统用户/]
  }),
  makePatternRule({
    id: "cmd.db_bulk_delete",
    description: "\u6570\u636E\u5E93\u6279\u91CF\u5220\u9664",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/delete\s+from\s+\w+\s+where\s+1\s*=\s*1/i, /delete\s+from\s+\w+\s*;?\s*$/i, /批量删除数据/, /清空表数据/]
  }),
  makePatternRule({
    id: "cmd.privilege_escalate",
    description: "\u6743\u9650\u63D0\u5347/\u7ED5\u8FC7",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/--no-sandbox/, /setuid\(0\)/, /bypass.*permission/i, /绕过权限/, /提权执行/]
  }),
  makePatternRule({
    id: "cmd.overwrite_important",
    description: "\u8986\u76D6\u91CD\u8981\u6587\u4EF6",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/> \/etc\//, /\bcp\b.*\/etc\//, /mv\s+\S+\s+\/etc\//, /覆盖配置文件/],
    reason: "\u8986\u76D6\u7CFB\u7EDF\u914D\u7F6E\u53EF\u80FD\u5BFC\u81F4\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8BF7\u786E\u8BA4\u5DF2\u5907\u4EFD"
  }),
  makePatternRule({
    id: "net.reverse_shell",
    description: "\u53CD\u5F39 Shell",
    scope: "tool",
    severity: "block",
    field: "argsText",
    patterns: [/nc\s+-[elvp]/, /bash\s+-i\s*>&\s*\/dev\/tcp/, /reverse.?shell/i, /反弹.?shell/, /反向连接/],
    reason: "\u68C0\u6D4B\u5230\u53CD\u5F39 Shell \u8FDE\u63A5\u6A21\u5F0F\uFF0C\u5C5E\u4E8E\u9AD8\u5371\u884C\u4E3A"
  }),
  makePatternRule({
    id: "net.upload_secret",
    description: "\u4E0A\u4F20\u654F\u611F\u6587\u4EF6\u5230\u5916\u90E8",
    scope: "tool",
    severity: "warn",
    field: "argsText",
    patterns: [/curl[^\n]*(@|-F)[^\n]*(\.env|credentials|id_rsa|\.ssh)/i, /upload[^\n]*(\.env|\.ssh|private)/i, /上传密钥/]
  })
];
var OUTPUT_RULES = [
  // ── 密钥泄露 ────────────────────────────────────────────────────────────
  makePatternRule({
    id: "secret.openai_key",
    description: "OpenAI \u98CE\u683C\u5BC6\u94A5 sk-\u2026",
    scope: "output",
    severity: "block",
    field: "text",
    patterns: [/\bsk-[a-z0-9]{16,}\b/i, /\bsk-[a-z0-9]{8,}-[a-z0-9-]{8,}/i],
    reason: "\u8F93\u51FA\u5305\u542B sk- \u5F00\u5934\u7684 API \u5BC6\u94A5\uFF0C\u5FC5\u987B\u8131\u654F\u540E\u518D\u5C55\u793A"
  }),
  makePatternRule({
    id: "secret.aws_key",
    description: "AWS Access Key",
    scope: "output",
    severity: "block",
    field: "text",
    patterns: [/\bAKIA[0-9A-Z]{16}\b/, /\bASIA[0-9A-Z]{16}\b/]
  }),
  makePatternRule({
    id: "secret.api_key_assignment",
    description: "api_key/token \u8D4B\u503C",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/api[_-]?key\s*[:=]\s*['"]?[a-z0-9_-]{12,}/i, /secret[_-]?key\s*[:=]/i, /access[_-]?token\s*[:=]/i, /api密钥\s*[:：]/],
    reason: "\u8F93\u51FA\u7591\u4F3C\u5305\u542B key/token \u8D4B\u503C\uFF0C\u5EFA\u8BAE\u8131\u654F"
  }),
  makePatternRule({
    id: "secret.bearer_token",
    description: "Bearer Token",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/bearer\s+[a-z0-9._-]{20,}/i, /authorization\s*[:=]/i, /持有者令牌/]
  }),
  makePatternRule({
    id: "secret.private_key",
    description: "\u79C1\u94A5 PEM \u5934",
    scope: "output",
    severity: "block",
    field: "text",
    patterns: [/-----begin\s+(rsa|ec|dsa|openssh|pgp)?\s*private key-----/i, /私钥内容/]
  }),
  makePatternRule({
    id: "secret.jwt",
    description: "JWT \u4EE4\u724C",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/\beyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i]
  }),
  makePatternRule({
    id: "secret.password",
    description: "\u660E\u6587\u5BC6\u7801",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/password\s*[:=]\s*['"]?[^\s'"]{6,}/i, /密码\s*[:：]\s*\S{6,}/]
  }),
  makePatternRule({
    id: "secret.github_token",
    description: "GitHub Token",
    scope: "output",
    severity: "block",
    field: "text",
    patterns: [/\bghp_[a-z0-9]{30,}\b/i, /\bgho_[a-z0-9]{30,}\b/i, /\bghs_[a-z0-9]{30,}\b/i, /\bgithub_pat_[a-z0-9_]{40,}\b/i]
  }),
  // ── 注入检测 ────────────────────────────────────────────────────────────
  makePatternRule({
    id: "inject.prompt_override",
    description: "\u63D0\u793A\u8BCD\u8986\u76D6\u6CE8\u5165",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/ignore\s+(all\s+)?previous\s+instructions/i, /disregard\s+(all\s+)?(prior|above)/i, /忽略(之前|以上|前面)的?(所有|全部)?指令/],
    reason: "\u8F93\u51FA\u5305\u542B\u63D0\u793A\u8BCD\u8986\u76D6\u8BED\u53E5\uFF0C\u7591\u4F3C\u6CE8\u5165\u653B\u51FB"
  }),
  makePatternRule({
    id: "inject.system_tag",
    description: "\u4F2A\u9020 system \u901A\u9053",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/<\|\s*system\s*\|>/i, /<system\s*>/i, /\[\[system\]\]/i, /伪造系统消息/]
  }),
  makePatternRule({
    id: "inject.role_spoof",
    description: "\u4F2A\u9020\u89D2\u8272\u6807\u7B7E",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/\bassistant\s*[:：]\s*(ignore|system|override)/i, /\bsystem\s*[:：]\s*(you are|new instructions)/i]
  }),
  makePatternRule({
    id: "inject.jailbreak",
    description: "\u8D8A\u72F1\u5F15\u5BFC\u8BCD",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/dan\s+mode/i, /developer\s+mode/i, /越狱模式/, /开发者模式\s*开启/, /假装你是(一个)?没有限制/]
  }),
  // ── 个人信息（PII）泄露 ──────────────────────────────────────────────────
  makePatternRule({
    id: "pii.chinese_id",
    description: "\u4E2D\u56FD\u8EAB\u4EFD\u8BC1\u53F7\u7801",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/\b[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/],
    reason: "\u8F93\u51FA\u7591\u4F3C\u5305\u542B\u8EAB\u4EFD\u8BC1\u53F7\u7801\uFF0C\u5EFA\u8BAE\u8131\u654F"
  }),
  makePatternRule({
    id: "pii.phone_cn",
    description: "\u4E2D\u56FD\u624B\u673A\u53F7",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/(?<!\d)1[3-9]\d{9}(?!\d)/],
    reason: "\u8F93\u51FA\u7591\u4F3C\u5305\u542B\u624B\u673A\u53F7\uFF0C\u5EFA\u8BAE\u8131\u654F"
  }),
  makePatternRule({
    id: "pii.bank_card",
    description: "\u94F6\u884C\u5361\u53F7\uFF0816-19 \u4F4D\uFF09",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/(?<!\d)\d{16,19}(?!\d)/],
    reason: "\u8F93\u51FA\u7591\u4F3C\u5305\u542B\u94F6\u884C\u5361\u53F7\uFF0C\u5EFA\u8BAE\u8131\u654F"
  }),
  makePatternRule({
    id: "pii.email",
    description: "\u90AE\u7BB1\u5730\u5740",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
    reason: "\u8F93\u51FA\u5305\u542B\u90AE\u7BB1\u5730\u5740\uFF0C\u82E5\u975E\u7528\u6237\u8981\u6C42\u8BF7\u786E\u8BA4\u662F\u5426\u8131\u654F"
  }),
  makePatternRule({
    id: "pii.address",
    description: "\u8BE6\u7EC6\u4F4F\u5740",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/住址\s*[:：]\s*\S{6,}/, /详细地址\s*[:：]/, /家庭住址/]
  }),
  // ── 恶意代码/命令输出 ────────────────────────────────────────────────────
  makePatternRule({
    id: "output.malicious_script",
    description: "\u8F93\u51FA\u542B\u5371\u9669\u811A\u672C\u7247\u6BB5",
    scope: "output",
    severity: "warn",
    field: "text",
    patterns: [/rm\s+-rf\s+\//, /curl[^\n]*\|\s*(ba)?sh/, /eval\s*\(\s*(atob|decode)/, /<script[^>]*>\s*alert\(/i],
    reason: "\u8F93\u51FA\u5305\u542B\u53EF\u6267\u884C\u5371\u9669\u7247\u6BB5\uFF0C\u5C55\u793A\u524D\u8BF7\u4EBA\u5DE5\u786E\u8BA4"
  })
  // ── 超长截断建议（由单独规则处理，见 OUTPUT_LENGTH_RULE）─────────────────
];
var OUTPUT_LENGTH_RULE = {
  id: "output.too_long",
  description: "\u8F93\u51FA\u8D85\u957F\u5EFA\u8BAE\u622A\u65AD",
  scope: "output",
  severity: "warn",
  test(ctx) {
    const text = ctx.text || "";
    const max = ctx.config?.outputMaxChars ?? 4e4;
    if (text.length <= max) return { hit: false };
    return {
      hit: true,
      reason: `\u8F93\u51FA ${text.length} \u5B57\u7B26\u8D85\u8FC7\u5EFA\u8BAE\u4E0A\u9650 ${max}\uFF0C\u5EFA\u8BAE\u622A\u65AD/\u6458\u8981\u5316\u6216\u5206\u6BB5\u5C55\u793A\uFF08\u4FDD\u7559\u524D ${Math.floor(max * 0.3)} \u4E0E\u672B\u5C3E ${Math.floor(max * 0.7)} \u5B57\u7B26\uFF09`
    };
  }
};
var LOOP_RULES = [
  {
    id: "loop.identical_calls",
    description: "\u8FDE\u7EED\u76F8\u540C\u5DE5\u5177\u8C03\u7528",
    scope: "loop",
    severity: "warn",
    test(ctx) {
      const calls = ctx.recentCalls || [];
      const threshold = ctx.config?.loopIdenticalThreshold ?? 3;
      if (calls.length < threshold) return { hit: false };
      const tail = calls.slice(-threshold);
      const fps = tail.map(toolFingerprint);
      if (fps.every((f) => f === fps[0])) {
        return {
          hit: true,
          reason: `\u6700\u8FD1 ${threshold} \u6B21\u5DE5\u5177\u8C03\u7528\u5B8C\u5168\u76F8\u540C\uFF08${tail[tail.length - 1].name}\uFF09\uFF0C\u7591\u4F3C\u6B7B\u5FAA\u73AF\uFF1B\u5EFA\u8BAE\u6539\u53D8\u7B56\u7565\u6216\u53C2\u6570`
        };
      }
      return { hit: false };
    }
  },
  {
    id: "loop.same_tool_many",
    description: "\u540C\u4E00\u5DE5\u5177\u9AD8\u9891\u8C03\u7528",
    scope: "loop",
    severity: "warn",
    test(ctx) {
      const calls = ctx.recentCalls || [];
      const threshold = ctx.config?.loopToolFrequencyThreshold ?? 6;
      if (calls.length < threshold) return { hit: false };
      const counts = /* @__PURE__ */ new Map();
      for (const c of calls) counts.set(c.name, (counts.get(c.name) || 0) + 1);
      let topName = "";
      let topCount = 0;
      for (const [name, n] of counts) if (n > topCount) {
        topName = name;
        topCount = n;
      }
      if (topCount >= threshold) {
        return { hit: true, reason: `\u5DE5\u5177 ${topName} \u9AD8\u9891\u8C03\u7528\uFF1A\u5728\u6700\u8FD1 ${calls.length} \u6B21\u8C03\u7528\u4E2D\u5360 ${topCount} \u6B21\uFF0C\u53EF\u80FD\u9677\u5165\u91CD\u590D\u8BD5\u63A2` };
      }
      return { hit: false };
    }
  }
];
var BUDGET_RULES = [
  {
    id: "budget.soft_limit",
    description: "token \u9884\u7B97\u8F6F\u8B66\u544A\uFF0880%\uFF09",
    scope: "budget",
    severity: "warn",
    test(ctx) {
      const cur = ctx.currentTokens || 0;
      const lim = ctx.limit || 0;
      if (lim <= 0) return { hit: false };
      const ratio = cur / lim;
      const soft = ctx.config?.budgetSoftRatio ?? 0.8;
      if (ratio >= soft && ratio < 1) {
        return { hit: true, reason: `token \u7528\u91CF ${cur}/${lim}\uFF08${Math.round(ratio * 100)}%\uFF09\u5DF2\u8FBE\u8F6F\u4E0A\u9650\uFF0C\u5EFA\u8BAE\u5F00\u59CB\u88C1\u526A\u5386\u53F2\u6216\u964D\u4F4E\u8F93\u51FA\u957F\u5EA6` };
      }
      return { hit: false };
    }
  },
  {
    id: "budget.hard_limit",
    description: "token \u9884\u7B97\u786C\u8D85\u9650",
    scope: "budget",
    severity: "block",
    test(ctx) {
      const cur = ctx.currentTokens || 0;
      const lim = ctx.limit || 0;
      if (lim <= 0) return { hit: false };
      if (cur > lim) {
        return { hit: true, reason: `token \u7528\u91CF ${cur} \u5DF2\u8D85\u8FC7\u786C\u4E0A\u9650 ${lim}\uFF0C\u5FC5\u987B\u88C1\u526A\u5386\u53F2\u540E\u624D\u80FD\u7EE7\u7EED` };
      }
      return { hit: false };
    }
  },
  {
    id: "budget.critical",
    description: "token \u9884\u7B97\u4E25\u91CD\u8D85\u9650\uFF08>120%\uFF09",
    scope: "budget",
    severity: "block",
    test(ctx) {
      const cur = ctx.currentTokens || 0;
      const lim = ctx.limit || 0;
      if (lim <= 0) return { hit: false };
      const critical = ctx.config?.budgetCriticalRatio ?? 1.2;
      if (cur / lim >= critical) {
        return { hit: true, reason: `token \u7528\u91CF ${cur} \u8D85\u8FC7\u4E0A\u9650 ${lim} \u7684 ${Math.round(critical * 100)}%\uFF0C\u9700\u7ACB\u5373\u538B\u7F29\u4E0A\u4E0B\u6587` };
      }
      return { hit: false };
    }
  }
];
var FINGERPRINT_IGNORE_KEYS = /* @__PURE__ */ new Set([
  "timestamp",
  "time",
  "requestId",
  "request_id",
  "id",
  "nonce",
  "uuid",
  "traceId",
  "trace_id",
  "started_at",
  "callId",
  "call_id"
]);
function stableStringify(value, depth = 0) {
  if (depth > 8) return '"\u2026"';
  if (value == null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v, depth + 1)).join(",") + "]";
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj).filter((k) => !FINGERPRINT_IGNORE_KEYS.has(k)).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k], depth + 1)).join(",") + "}";
  }
  return JSON.stringify(String(value));
}
function toolFingerprint(tc) {
  const args = toolCallArgs(tc);
  return `${normText(tc.name)}|${stableStringify(args)}`;
}
var DEFAULT_GUARDRAIL_CONFIG = {
  outputMaxChars: 4e4,
  loopIdenticalThreshold: 3,
  loopToolFrequencyThreshold: 6,
  budgetSoftRatio: 0.8,
  budgetCriticalRatio: 1.2
};
function combineResults(hits) {
  if (hits.length === 0) return { allowed: true };
  const blocking = hits.filter((h) => h.rule.severity === "block");
  const severity = blocking.length > 0 ? "block" : "warn";
  const allowed = severity !== "block";
  const reasons = hits.filter((h) => severity === "block" ? h.rule.severity === "block" : h.rule.severity === "warn").map((h) => h.hit.reason).filter(Boolean);
  const reason = reasons.length === 1 ? reasons[0] : reasons.join("\uFF1B");
  return { allowed, reason, severity };
}
var GuardrailChainImpl = class {
  rules = [];
  config;
  constructor(config = {}, opts = {}) {
    this.config = { ...DEFAULT_GUARDRAIL_CONFIG, ...config };
    if (opts.includeBuiltins !== false) {
      this.rules.push(...TOOL_RULES, ...OUTPUT_RULES, OUTPUT_LENGTH_RULE, ...LOOP_RULES, ...BUDGET_RULES);
    }
  }
  /** 注册自定义规则。返回 this 便于链式调用。 */
  addRule(rule) {
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
    return this;
  }
  /** 移除规则（按 id）。返回是否移除成功。 */
  removeRule(id) {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rules.splice(idx, 1);
    return true;
  }
  /** 当前规则数量（诊断用）。 */
  get ruleCount() {
    return this.rules.length;
  }
  /** 当前配置（诊断/测试用，返回副本避免被外部修改）。 */
  getConfig() {
    return { ...this.config };
  }
  /** 导出当前规则清单（id / 说明 / scope / 严重度），供诊断面板展示。 */
  listRules() {
    return this.rules.map((r) => ({ id: r.id, description: r.description, scope: r.scope, severity: r.severity }));
  }
  /** 统计各 scope 的规则数量。 */
  ruleCountByScope() {
    const out = { tool: 0, output: 0, loop: 0, budget: 0, all: 0 };
    for (const r of this.rules) out[r.scope] += 1;
    return out;
  }
  /** 批量检查：依次跑四道检查，汇总所有命中（用于一次性审计一段交互）。 */
  audit(args) {
    const out = [];
    if (args.toolName != null) {
      out.push({ scope: "tool", result: this.checkTool(args.toolName, args.toolArgs || {}) });
    }
    if (args.output != null) {
      out.push({ scope: "output", result: this.checkOutput(args.output) });
    }
    if (args.recentCalls != null) {
      out.push({ scope: "loop", result: this.checkLoop(args.recentCalls) });
    }
    if (args.currentTokens != null && args.limit != null) {
      out.push({ scope: "budget", result: this.checkBudget(args.currentTokens, args.limit) });
    }
    return out;
  }
  /** 运行某一 scope 的规则集。 */
  runScope(scope, ctx) {
    const withConfig = { ...ctx, config: this.config };
    const hits = [];
    for (const rule of this.rules) {
      if (rule.scope !== scope && rule.scope !== "all") continue;
      let result;
      try {
        result = toHit(rule.test(withConfig), rule);
      } catch (err) {
        result = { hit: true, reason: `\u89C4\u5219 ${rule.id} \u6267\u884C\u5F02\u5E38\uFF1A${err instanceof Error ? err.message : String(err)}` };
        hits.push({ rule: { ...rule, severity: "warn" }, hit: result });
        continue;
      }
      if (result.hit) hits.push({ rule, hit: result });
    }
    return combineResults(hits);
  }
  checkTool(name, args) {
    const argsText = flattenArgs(args);
    return this.runScope("tool", { toolName: name, args, argsText });
  }
  checkOutput(text) {
    return this.runScope("output", { text });
  }
  checkLoop(recentCalls) {
    return this.runScope("loop", { recentCalls });
  }
  checkBudget(currentTokens, limit) {
    return this.runScope("budget", { currentTokens, limit });
  }
};
function createGuardrails(config) {
  return new GuardrailChainImpl(config);
}

// src/shared/super/runtime/events.ts
var SUPER_EVENT_TYPES = [
  "phase",
  "analysis",
  "plan",
  "route",
  "model",
  "metric",
  "guardrail",
  "error"
];
function isSuperEvent(value) {
  if (!value || typeof value !== "object") return false;
  const type = value.type;
  return typeof type === "string" && SUPER_EVENT_TYPES.includes(type);
}
var RingBuffer = class {
  constructor(capacity) {
    this.capacity = capacity;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("RingBuffer capacity \u5FC5\u987B\u662F\u6B63\u6574\u6570");
    }
    this.buf = new Array(capacity);
  }
  buf;
  head = 0;
  size = 0;
  push(item) {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }
  get length() {
    return this.size;
  }
  /** 按写入顺序返回快照。 */
  toArray() {
    const out = [];
    for (let k = 0; k < this.size; k++) {
      const idx = (this.head - this.size + k + this.capacity) % this.capacity;
      const v = this.buf[idx];
      if (v !== void 0) out.push(v);
    }
    return out;
  }
  /** 最后一个元素（最新）。 */
  last() {
    if (this.size === 0) return void 0;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buf[idx];
  }
  clear() {
    this.buf.fill(void 0);
    this.head = 0;
    this.size = 0;
  }
};
var SuperEventSinkImpl = class {
  typed = /* @__PURE__ */ new Map();
  counts = /* @__PURE__ */ new Map();
  history;
  opts;
  totalEmitted = 0;
  constructor(opts = {}) {
    this.opts = opts;
    this.history = new RingBuffer(Math.max(1, Math.floor(opts.historyCapacity ?? 200)));
  }
  /** 分发一个事件。 */
  emit(event) {
    if (!isSuperEvent(event)) {
      if (this.opts.logHandlerErrors) console.warn("[SuperEventSink] \u6536\u5230\u975E\u6CD5\u4E8B\u4EF6\uFF1A", event);
    }
    let finalEvent = event;
    if (this.opts.filter && !this.opts.filter(finalEvent)) return;
    if (this.opts.transform) finalEvent = this.opts.transform(finalEvent);
    const index = this.totalEmitted++;
    this.history.push(finalEvent);
    if (isSuperEvent(finalEvent)) {
      this.counts.set(finalEvent.type, (this.counts.get(finalEvent.type) || 0) + 1);
    }
    const dispatch = (handlers) => {
      if (!handlers) return;
      for (const h of Array.from(handlers)) {
        try {
          h(finalEvent, index);
        } catch (err) {
          if (this.opts.onHandlerError) this.opts.onHandlerError(err, finalEvent);
          else if (this.opts.logHandlerErrors) console.warn("[SuperEventSink] handler \u629B\u9519\uFF1A", err);
        }
      }
    };
    if (isSuperEvent(finalEvent)) dispatch(this.typed.get(finalEvent.type));
    dispatch(this.typed.get("any"));
  }
  /** 订阅某类事件；type 传 'any' 表示订阅全部。返回取消订阅函数。 */
  on(type, handler) {
    let set = this.typed.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.typed.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }
  /** 订阅全部事件（语法糖）。 */
  onAny(handler) {
    return this.on("any", handler);
  }
  /** 一次性订阅：命中一次后自动取消。 */
  once(type, handler) {
    let unsub = () => {
    };
    const wrapped = (event, index) => {
      unsub();
      handler(event, index);
    };
    unsub = this.on(type, wrapped);
    return unsub;
  }
  /** 清空所有订阅。 */
  clearHandlers() {
    this.typed.clear();
  }
  /** 历史事件快照（最旧→最新）。 */
  getHistory() {
    return this.history.toArray();
  }
  /** 最近 n 条事件（默认全部历史）。 */
  getRecent(n) {
    const all = this.history.toArray();
    if (n <= 0) return [];
    return all.slice(-Math.min(n, all.length));
  }
  /** 某类事件已分发次数。 */
  countOf(type) {
    return this.counts.get(type) || 0;
  }
  /** 累计分发总数（含非法事件）。 */
  get total() {
    return this.totalEmitted;
  }
  /** 清空历史与计数（不影响订阅）。 */
  reset() {
    this.history.clear();
    this.counts.clear();
    this.totalEmitted = 0;
  }
};
var SuperEventCollector = class {
  sink;
  constructor(opts = {}) {
    this.sink = new SuperEventSinkImpl(opts);
  }
  /** 作为 sink 使用。 */
  emit(event) {
    this.sink.emit(event);
  }
  /** 暴露内部 sink（需要 on/once 等高级订阅时）。 */
  get inner() {
    return this.sink;
  }
  /** 订阅某类事件（代理到内部 sink）。 */
  on(type, handler) {
    return this.sink.on(type, handler);
  }
  /** 全部事件（最旧→最新）。 */
  all() {
    return this.sink.getHistory();
  }
  /** 按类型筛选。 */
  byType(type) {
    return this.sink.getHistory().filter((e) => e.type === type);
  }
  /** 首个/最后一个事件。 */
  first() {
    const a = this.all();
    return a.length > 0 ? a[0] : void 0;
  }
  last() {
    return this.sink.getRecent(1)[0];
  }
  /** 按谓词查找第一个匹配事件。 */
  find(predicate) {
    return this.all().find(predicate);
  }
  /** 事件数量。 */
  get size() {
    return this.sink.getHistory().length;
  }
  /** 清空收集的事件。 */
  clear() {
    this.sink.reset();
  }
  /** 统计摘要：各类型数量。 */
  counts() {
    const out = {};
    for (const t of SUPER_EVENT_TYPES) {
      const n = this.sink.countOf(t);
      if (n > 0) out[t] = n;
    }
    return out;
  }
  /** 人类可读摘要（阶段序列 + 计数 + 错误数）。 */
  summary() {
    const lines = [];
    const events = this.all();
    lines.push(`\u4E8B\u4EF6\u603B\u6570\uFF1A${events.length}`);
    const phases = events.filter((e) => e.type === "phase");
    if (phases.length > 0) {
      lines.push("\u9636\u6BB5\u65F6\u95F4\u7EBF\uFF1A" + phases.map((e) => e.phase).join(" \u2192 "));
    }
    const counts = this.counts();
    const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`);
    lines.push("\u5206\u7C7B\u8BA1\u6570\uFF1A" + (parts.length ? parts.join("\uFF0C") : "\u65E0"));
    const errors = events.filter((e) => e.type === "error");
    lines.push(`\u9519\u8BEF\u6570\uFF1A${errors.length}${errors.length ? "\uFF08" + errors.map((e) => e.error).join("\uFF1B") + "\uFF09" : ""}`);
    return lines.join("\n");
  }
  /** 阶段名序列（按发生顺序）。 */
  phases() {
    return this.byType("phase").map((e) => e.phase);
  }
  /** 聚合同名 metric：返回 name → {count, sum, min, max, last}。 */
  metrics() {
    const out = {};
    for (const e of this.byType("metric")) {
      const cur = out[e.name] || { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, last: 0 };
      cur.count += 1;
      cur.sum += e.value;
      cur.min = Math.min(cur.min, e.value);
      cur.max = Math.max(cur.max, e.value);
      cur.last = e.value;
      out[e.name] = cur;
    }
    return out;
  }
  /** 是否发生过某阶段。 */
  hasPhase(phase) {
    return this.byType("phase").some((e) => e.phase === phase);
  }
  /** 所有可恢复/致命错误。 */
  errors(recoverable) {
    const all = this.byType("error");
    return recoverable === void 0 ? all : all.filter((e) => e.recoverable === recoverable);
  }
  /** 按谓词统计匹配数量。 */
  countWhere(predicate) {
    return this.all().filter(predicate).length;
  }
};

// src/shared/superCore.ts
var assembler = createAssembler();
var guardrails = createGuardrails();
var kernelRouter = createKernelRouter();
var modelSelector = createModelSelector();
function applyOverrides(base, decision) {
  const o = decision.overrides;
  const out = { ...base };
  if (o.maxRounds != null) out.maxAutonomousRounds = o.maxRounds;
  if (o.maxTokens != null) out.maxTokens = o.maxTokens;
  if (o.hermesMode != null) out.hermesMode = o.hermesMode;
  if (o.enableGuardrails === false) out.skipGuardrails = true;
  return out;
}
function selectRunner(deps, kernel) {
  switch (kernel) {
    case "ultra":
      return deps.runUltra;
    case "auto":
      return deps.runAuto;
    case "super":
    case "pro":
    default:
      return deps.runPro;
  }
}
function normalizeResult(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    content: typeof r.content === "string" ? r.content : "",
    thinking: typeof r.thinking === "string" ? r.thinking : "",
    toolCalls: Array.isArray(r.toolCalls) ? r.toolCalls : [],
    stopped: typeof r.stopped === "string" ? r.stopped : void 0,
    error: typeof r.error === "string" ? r.error : void 0
  };
}
function injectContext(messages, analysis, plan, decision) {
  const sys = assembler.buildSystemPrompt(analysis, plan, decision);
  if (!sys) return messages;
  const first = messages[0];
  return first && first.role === "system" ? [{ ...first, content: String(first.content || "") + "\n\n" + sys }, ...messages.slice(1)] : [{ role: "system", content: sys }, ...messages];
}
async function runSuperLoop(messages, deps) {
  const started = Date.now();
  const phases = [];
  const collector = new SuperEventCollector();
  const emit = (e) => {
    collector.emit(e);
    deps.sink?.emit(e);
  };
  const phase = (name, detail) => {
    phases.push(name);
    emit({ type: "phase", phase: name, detail });
  };
  phase("signals");
  const signals = extractSignals(messages);
  emit({ type: "metric", name: "signals.charLength", value: signals.charLength });
  emit({ type: "metric", name: "signals.historyTurns", value: signals.historyTurns });
  phase("complexity");
  const complexity = scoreComplexity(signals);
  emit({ type: "metric", name: "complexity.score", value: complexity.score, tags: { level: complexity.level } });
  phase("analysis");
  const analysis = analyzeTask(signals);
  emit({ type: "analysis", analysis });
  let plan = null;
  if (complexity.score >= 20 || signals.hasMultiStep) {
    phase("planning");
    plan = planTask(analysis, signals);
    const g = buildDependencyGraph(plan.steps);
    const cycle = g.detectCycle();
    if (cycle) emit({ type: "error", error: "\u8BA1\u5212\u4F9D\u8D56\u56FE\u5B58\u5728\u73AF\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u7EBF\u6027\u6267\u884C\uFF1A" + cycle.join("\u2192"), recoverable: true });
    emit({ type: "plan", plan });
  }
  phase("strategy");
  const strategy = pickStrategy(analysis, plan || { goal: signals.rawText, steps: [], levels: [], estimatedRounds: 1, criticalPath: [] });
  emit({ type: "metric", name: "strategy", value: 1, tags: { name: strategy.name } });
  phase("routing");
  const routePlan = plan || { goal: signals.rawText, steps: [], levels: [], estimatedRounds: 1, criticalPath: [] };
  let decision = kernelRouter.route(analysis, routePlan, strategy);
  if (deps.adaptation) decision = deps.adaptation.adjust(decision, analysis);
  emit({ type: "route", decision });
  let modelChoice = null;
  if (deps.models.length) {
    phase("model-selection");
    modelChoice = modelSelector.select(analysis, deps.models, deps.preference);
    emit({ type: "model", choice: modelChoice });
  }
  phase("context");
  const totalTokens = Number(deps.baseDeps.contextWindow) || 128e3;
  const budget = assembler.allocate(totalTokens, analysis, plan);
  emit({ type: "metric", name: "context.total", value: budget.total });
  const working = injectContext(assembler.trim(messages, budget), analysis, plan, decision);
  phase("guardrails");
  const baseRunTool = deps.baseDeps.runTool;
  const guardedDeps = { ...applyOverrides(deps.baseDeps, decision) };
  if (typeof baseRunTool === "function") {
    const original = baseRunTool;
    guardedDeps.runTool = async (name, args, signal) => {
      const check = guardrails.checkTool(name, args);
      if (!check.allowed) {
        emit({ type: "guardrail", result: check });
        return { success: false, error: check.reason || "\u5DE5\u5177\u88AB\u62A4\u680F\u62E6\u622A" };
      }
      const result2 = await original(name, args, signal);
      const outText = result2 && typeof result2 === "object" && "output" in result2 ? String(result2.output || "") : "";
      if (outText) {
        const outCheck = guardrails.checkOutput(outText);
        if (!outCheck.allowed) emit({ type: "guardrail", result: outCheck });
      }
      return result2;
    };
  }
  phase("execution", `kernel=${decision.kernel}`);
  const runner = selectRunner(deps, decision.kernel);
  const execError = void 0;
  const raw = await runner(working, guardedDeps);
  const result = normalizeResult(raw);
  const loopCheck = guardrails.checkLoop(result.toolCalls);
  if (!loopCheck.allowed) emit({ type: "guardrail", result: loopCheck });
  phase("feedback");
  const durationMs = Date.now() - started;
  const outcome = {
    decision,
    analysis,
    success: !result.stopped && !execError,
    rounds: result.toolCalls.length ? Math.max(1, Math.ceil(result.toolCalls.length / 3)) : 1,
    durationMs,
    toolErrors: result.toolCalls.filter((t) => t.status === "error").length,
    timestamp: Date.now()
  };
  deps.adaptation?.record(outcome);
  emit({ type: "metric", name: "super.durationMs", value: durationMs });
  emit({ type: "metric", name: "super.success", value: outcome.success ? 1 : 0 });
  return {
    content: result.content,
    thinking: result.thinking,
    toolCalls: result.toolCalls,
    stopped: result.stopped,
    error: result.error || execError,
    trace: { signals, analysis, plan, decision, model: modelChoice, durationMs, phases }
  };
}
function summarizeTrace(result) {
  const t = result.trace;
  const lines = [
    `\u5185\u6838: ${t.decision.kernel} / \u7B56\u7565: ${t.decision.strategy} (\u7F6E\u4FE1 ${(t.decision.confidence * 100).toFixed(0)}%)`,
    `\u590D\u6742\u5EA6: ${t.analysis.complexity.score}/100 (${t.analysis.complexity.level}) / \u9886\u57DF: ${t.analysis.domain}`,
    `\u8BA1\u5212: ${t.plan ? `${t.plan.steps.length} \u6B65 / ${t.plan.levels.length} \u5C42` : "\u65E0"}`,
    `\u6A21\u578B: ${t.model?.model.name || "\u9ED8\u8BA4"}`,
    `\u8017\u65F6: ${t.durationMs}ms / \u9636\u6BB5: ${t.phases.join(" \u2192 ")}`,
    "\u8DEF\u7531\u7406\u7531: " + t.decision.reasons.join("\uFF1B")
  ];
  return lines.join("\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createAdaptationEngine,
  runSuperLoop,
  summarizeTrace
});
