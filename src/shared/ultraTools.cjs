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

// src/shared/ultra/tools.ts
var tools_exports = {};
__export(tools_exports, {
  GEMINI_TOOL_DEFS: () => GEMINI_TOOL_DEFS,
  PARAM: () => PARAM,
  TOOL_ALIASES: () => TOOL_ALIASES,
  getToolSet: () => getToolSet,
  normalizeArgs: () => normalizeArgs,
  ultraToolsForModel: () => ultraToolsForModel
});
module.exports = __toCommonJS(tools_exports);
var PARAM = {
  FILE_PATH: "file_path",
  DIR_PATH: "dir_path",
  PATTERN: "pattern",
  CASE_SENSITIVE: "case_sensitive",
  RESPECT_GIT_IGNORE: "respect_git_ignore",
  RESPECT_GEMINI_IGNORE: "respect_gemini_ignore",
  FILE_FILTERING_OPTIONS: "file_filtering_options",
  DESCRIPTION: "description",
  ADDITIONAL_PERMISSIONS: "additional_permissions",
  GREP_INCLUDE: "include_pattern",
  GREP_EXCLUDE: "exclude_pattern",
  GREP_NAMES_ONLY: "names_only",
  GREP_MAX_PER_FILE: "max_matches_per_file",
  GREP_TOTAL_MAX: "total_max_matches",
  GREP_FIXED_STRINGS: "fixed_strings",
  GREP_CONTEXT: "context",
  GREP_AFTER: "after",
  GREP_BEFORE: "before",
  GREP_NO_IGNORE: "no_ignore",
  LS_IGNORE: "ignore",
  READ_START_LINE: "start_line",
  READ_END_LINE: "end_line",
  SHELL_COMMAND: "command",
  SHELL_IS_BACKGROUND: "is_background",
  WRITE_CONTENT: "content",
  EDIT_INSTRUCTION: "instruction",
  EDIT_OLD: "old_string",
  EDIT_NEW: "new_string",
  EDIT_ALLOW_MULTIPLE: "allow_multiple",
  WEB_SEARCH_QUERY: "query",
  WEB_FETCH_PROMPT: "prompt",
  READ_MANY_INCLUDE: "include",
  READ_MANY_EXCLUDE: "exclude",
  READ_MANY_RECURSIVE: "recursive",
  READ_MANY_USE_DEFAULT_EXCLUDES: "useDefaultExcludes",
  TODOS: "todos",
  TODO_DESCRIPTION: "description",
  TODO_STATUS: "status",
  SKILL_NAME: "name",
  ASK_QUESTIONS: "questions",
  PLAN_REASON: "reason",
  EXIT_PLAN_FILENAME: "plan_filename",
  TOPIC_TITLE: "title",
  TOPIC_SUMMARY: "summary",
  TOPIC_INTENT: "strategic_intent",
  MCP_URI: "uri",
  MCP_SERVER: "serverName"
};
var GEMINI_TOOL_DEFS = [
  {
    name: "glob",
    description: "Efficiently finds files matching specific glob patterns (e.g., `src/**/*.ts`, `**/*.md`), returning absolute paths sorted by modification time (newest first). Respects .gitignore by default.",
    parameters: { type: "object", properties: {
      pattern: { description: "The glob pattern to match against (e.g., '**/*.py', 'docs/*.md').", type: "string" },
      dir_path: { description: "Optional: absolute path to the directory to search within.", type: "string" },
      case_sensitive: { description: "Optional: case-sensitive matching. Defaults to false.", type: "boolean" },
      respect_git_ignore: { description: "Optional: respect .gitignore. Defaults to true.", type: "boolean" },
      respect_gemini_ignore: { description: "Optional: respect .geminiignore. Defaults to true.", type: "boolean" }
    }, required: ["pattern"] }
  },
  {
    name: "grep_search",
    description: "Searches for a regular expression pattern within file contents. Max 100 matches by default. Supports context lines, include/exclude globs, fixed strings and case sensitivity.",
    parameters: { type: "object", properties: {
      pattern: { description: "The regular expression pattern to search for within file contents.", type: "string" },
      dir_path: { description: "Directory or file to search. Relative paths resolve against CWD.", type: "string" },
      include_pattern: { description: "Glob filter (e.g., '*.ts', 'src/**').", type: "string" },
      exclude_pattern: { description: "Regex pattern to exclude from results.", type: "string" },
      names_only: { description: "If true, only file paths are returned.", type: "boolean" },
      case_sensitive: { description: "Case-sensitive search. Defaults to false.", type: "boolean" },
      fixed_strings: { description: "Treat pattern as literal string.", type: "boolean" },
      context: { description: "Lines of context around each match (grep -C).", type: "integer", minimum: 0 },
      after: { description: "Lines after each match (grep -A).", type: "integer", minimum: 0 },
      before: { description: "Lines before each match (grep -B).", type: "integer", minimum: 0 },
      no_ignore: { description: "Include files usually ignored (.gitignore, dist/, node_modules).", type: "boolean" },
      max_matches_per_file: { description: "Max matches per file.", type: "integer", minimum: 1 },
      total_max_matches: { description: "Max total matches. Defaults to 100.", type: "integer", minimum: 1 }
    }, required: ["pattern"] }
  },
  {
    name: "read_file",
    description: "Reads and returns the content of a specified file. Handles text, images, audio and PDF. Supports 1-based line ranges via start_line/end_line; large content is truncated with details on how to read more.",
    parameters: { type: "object", properties: {
      file_path: { description: "Path to the file to read.", type: "string" },
      start_line: { description: "Optional: 1-based line number to start reading from.", type: "integer", minimum: 1 },
      end_line: { description: "Optional: 1-based line number to end reading at (inclusive).", type: "integer", minimum: 1 }
    }, required: ["file_path"] }
  },
  {
    name: "read_many_files",
    description: "Reads content from multiple files specified by glob patterns, with '--- {filePath} ---' separators and '--- End of content ---' terminator.",
    parameters: { type: "object", properties: {
      include: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, description: 'Glob patterns or paths, e.g. ["src/**/*.ts", "README.md"].' },
      exclude: { type: "array", items: { type: "string", minLength: 1 }, description: "Globs to exclude.", default: [] },
      recursive: { type: "boolean", description: "Search recursively. Defaults to true.", default: true },
      useDefaultExcludes: { type: "boolean", description: "Exclude node_modules, .git, binaries. Defaults to true.", default: true }
    }, required: ["include"] }
  },
  {
    name: "list_directory",
    description: "Lists names of files and subdirectories directly within a directory, with optional ignore globs and gitignore filtering.",
    parameters: { type: "object", properties: {
      dir_path: { description: "The path to the directory to list.", type: "string" },
      ignore: { type: "array", items: { type: "string" }, description: "Glob patterns to ignore." },
      file_filtering_options: { type: "object", properties: { respect_git_ignore: { type: "boolean" }, respect_gemini_ignore: { type: "boolean" } } }
    }, required: ["dir_path"] }
  },
  {
    name: "write_file",
    description: "Writes content to a specified file in the local filesystem. The content must be complete literal content \u2014 no omission placeholders.",
    parameters: { type: "object", properties: {
      file_path: { description: "Path to the file to write.", type: "string" },
      content: { description: "Complete literal content. Do not use '(rest of methods ...)', '...', or 'unchanged code'.", type: "string" }
    }, required: ["file_path", "content"] }
  },
  {
    name: "replace",
    description: "Replaces text within a file. Expects exactly ONE occurrence of old_string unless allow_multiple=true. Requires significant context (\u22653 lines before & after) to target precisely. Always read the file first. old_string/new_string must be exact literal text (never escaped), must differ, and instruction must be specific.",
    parameters: { type: "object", properties: {
      file_path: { description: "Path to the file to modify.", type: "string" },
      instruction: { description: 'Detailed, specific instruction of what needs to change (GOOD: "In calculateTotal, update taxRate from 0.05 to 0.075"; BAD: "Fix the bug").', type: "string" },
      old_string: { description: "Exact literal text to replace, including whitespace/indentation/newlines.", type: "string" },
      new_string: { description: "Exact literal replacement text.", type: "string" },
      allow_multiple: { description: "Replace ALL occurrences of old_string. Defaults to false.", type: "boolean" }
    }, required: ["file_path", "instruction", "old_string", "new_string"] }
  },
  {
    name: "run_shell_command",
    description: "Executes a shell command as `bash -c <command>` (PowerShell on Windows). Returns combined stdout/stderr, exit code, signal, background PIDs. Prefer quiet flags (--silent, --no-pager, PAGER=cat). Use is_background=true for long-running processes.",
    parameters: { type: "object", properties: {
      command: { description: "Exact shell command to execute.", type: "string" },
      description: { description: "Brief description for the user (single sentence, no line breaks).", type: "string" },
      dir_path: { description: "Optional directory to run in; must exist within the workspace.", type: "string" },
      is_background: { description: "Run in background (servers, watchers).", type: "boolean" },
      delay_ms: { description: "Delay after starting a background process.", type: "integer" },
      additional_permissions: { description: 'Sandbox permissions; use after "Operation not permitted".', type: "object", properties: { network: { type: "boolean" }, fileSystem: { type: "object", properties: { read: { type: "array", items: { type: "string" } }, write: { type: "array", items: { type: "string" } } } } } }
    }, required: ["command"] }
  },
  {
    name: "google_web_search",
    description: "Performs a web search and returns results with sources.",
    parameters: { type: "object", properties: { query: { type: "string", description: "The search query." } }, required: ["query"] }
  },
  {
    name: "web_fetch",
    description: "Processes content from URL(s) (up to 20) embedded in a prompt, including localhost/private network addresses. URLs must start with http:// or https://.",
    parameters: { type: "object", properties: { prompt: { type: "string", description: "Comprehensive prompt including URL(s) and specific processing instructions." } }, required: ["prompt"] }
  },
  {
    name: "write_todos",
    description: "Lists current subtasks and their state (pending / in_progress / completed / cancelled / blocked). The complete list replaces the existing one. Use for complex multi-step tasks only.",
    parameters: { type: "object", properties: {
      todos: { type: "array", description: "Complete list of todo items (replaces existing list).", items: { type: "object", properties: {
        description: { type: "string", description: "What needs to be done." },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled", "blocked"] }
      }, required: ["description", "status"], additionalProperties: false } }
    }, required: ["todos"], additionalProperties: false }
  },
  {
    name: "ask_user",
    description: "Asks the user 1-4 questions to clarify requirements or make decisions. Each question has a short chip header, a type (choice/text/yesno), and 2-4 options with an automatic Other.",
    parameters: { type: "object", required: ["questions"], properties: {
      questions: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", required: ["question", "header", "type"], properties: {
        question: { type: "string", description: "Complete question, ends with a question mark." },
        header: { type: "string", description: "Very short chip label (\u226412 chars)." },
        type: { type: "string", enum: ["choice", "text", "yesno"], default: "choice" },
        options: { type: "array", items: { type: "object", required: ["label", "description"], properties: { label: { type: "string" }, description: { type: "string" } } } },
        multiSelect: { type: "boolean" },
        placeholder: { type: "string" }
      } } }
    } }
  },
  {
    name: "enter_plan_mode",
    description: "Switches to Plan Mode to safely research, design and plan complex changes using read-only tools.",
    parameters: { type: "object", properties: { reason: { type: "string", description: "Short reason for entering plan mode." } } }
  },
  {
    name: "exit_plan_mode",
    description: "Finalizes the planning phase and presents the plan for formal user approval. MUST reach informal agreement in chat first. MUST be used before any source edits.",
    parameters: { type: "object", required: ["plan_filename"], properties: { plan_filename: { type: "string", description: "Filename of the finalized plan (no absolute path)." } } }
  },
  {
    name: "activate_skill",
    description: "Activates a specialized agent skill by exact name. Returns instructions wrapped in <activated_skill> tags which take priority during the task.",
    parameters: { type: "object", properties: { name: { type: "string", description: "Exact skill name from <available_skills>." } }, required: ["name"] }
  },
  {
    name: "update_topic",
    description: "Manages narrative flow. Include title/summary only when starting a new chapter or shifting strategic intent. For multi-step modifications with \u22653 tool calls.",
    parameters: { type: "object", properties: {
      title: { type: "string", description: "Title of the new topic/chapter." },
      summary: { type: "string", description: "5-10 sentences: work completed + strategic intent (required on transition)." },
      strategic_intent: { type: "string", description: "Mandatory one-sentence immediate intent." }
    }, required: ["strategic_intent"] }
  },
  {
    name: "complete_task",
    description: "Signals that the current task is complete.",
    parameters: { type: "object", properties: { summary: { type: "string", description: "Brief completion summary." } } }
  },
  {
    name: "invoke_agent",
    description: "Delegates a well-scoped subtask to a specialized sub-agent. Never run multiple sub-agents that modify the same file in parallel.",
    parameters: { type: "object", properties: { name: { type: "string", description: "Sub-agent name." }, task: { type: "string", description: "Self-contained task description." } }, required: ["name", "task"] }
  },
  {
    name: "get_internal_docs",
    description: "Returns content of internal documentation files; omit path to list all available docs.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Relative doc path, e.g. 'cli/commands.md'." } } }
  },
  {
    name: "read_mcp_resource",
    description: "Reads a specified MCP resource by URI.",
    parameters: { type: "object", properties: { uri: { type: "string" } }, required: ["uri"] }
  },
  {
    name: "list_mcp_resources",
    description: "Lists resources exposed by connected MCP servers.",
    parameters: { type: "object", properties: { serverName: { type: "string" } }, required: [] }
  }
];
function getToolSet(model) {
  return GEMINI_TOOL_DEFS;
}
var TOOL_ALIASES = {
  glob: "glob",
  grep_search: "grep_search",
  read_file: "read_file",
  read_many_files: "read_many_files",
  list_directory: "list_dir",
  write_file: "write_file",
  replace: "edit_file",
  run_shell_command: "shell",
  google_web_search: "web_search",
  web_fetch: "web_fetch",
  write_todos: "todo_write",
  ask_user: "ask_user",
  enter_plan_mode: "update_plan",
  exit_plan_mode: "update_plan",
  activate_skill: "load_skill",
  update_topic: "update_plan",
  complete_task: "update_plan",
  invoke_agent: "dispatch_subagents",
  get_internal_docs: "consult_guidance",
  read_mcp_resource: "web_fetch",
  list_mcp_resources: "web_fetch"
};
function normalizeArgs(geminiName, args) {
  const a = { ...args };
  const T = { file_path: "path", dir_path: "path", query: "query", prompt: "url", content: "content", pattern: "pattern" };
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === "file_path" || k === "dir_path") out.path = v;
    else if (k === "command") out.command = v;
    else if (k === "old_string") out.oldText = v;
    else if (k === "new_string") out.newText = v;
    else if (k === "allow_multiple") out.replaceAll = v;
    else if (k === "todos") out.todos = v;
    else if (k === "name" && geminiName === "load_skill") out.name = v;
    else if (k === "pattern") out.pattern = v;
    else if (k === "include") out.paths = v;
    else if (k === "workdir") out.workdir = v;
    else if (!["instruction", "description", "case_sensitive", "respect_git_ignore", "start_line", "end_line", "include_pattern", "context", "after", "before", "names_only", "total_max_matches", "fixed_strings", "no_ignore", "is_background", "delay_ms", "additional_permissions", "exclude", "recursive", "useDefaultExcludes", "ignore", "file_filtering_options", "respect_gemini_ignore", "max_matches_per_file", "exclude_pattern"].includes(k)) out[k] = v;
  }
  if (a.start_line !== void 0) out.offset = Number(a.start_line) - 1;
  if (a.end_line !== void 0 && a.start_line !== void 0) out.limit = Number(a.end_line) - Number(a.start_line) + 1;
  if (geminiName === "glob") {
    out.pattern = a.pattern ?? out.pattern;
    out.limit = 200;
  }
  if (geminiName === "grep_search") {
    out.pattern = a.pattern ?? out.pattern;
    if (a.include_pattern) out.include = String(a.include_pattern);
    if (a.context || a.after || a.before) out.context = Number(a.context || a.after || a.before) || 0;
    if (a.total_max_matches) out.maxResults = Number(a.total_max_matches);
  }
  if (geminiName === "read_many_files") {
    out.paths = Array.isArray(a.include) ? a.include : [String(a.include || "")];
    delete out.path;
  }
  return out;
}
function ultraToolsForModel(model) {
  return getToolSet(model);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GEMINI_TOOL_DEFS,
  PARAM,
  TOOL_ALIASES,
  getToolSet,
  normalizeArgs,
  ultraToolsForModel
});
