**English** | [简体中文](../../guide/harness.md)

# LY HARNESS — Plugin Hub

> [← Back to documentation index](../../../README_EN.md#docs)

**Everything is a plugin.** LY HARNESS is the capability hub of Jutian Agent: every built-in tool can be toggled on and off individually, every MCP server is plug-and-play, and every hard-won lesson can be distilled into a Skill.

## Where to find it

Next to the bell in the top bar, open the notification center — the **Plugins (插件)** tab is the LY HARNESS panel. You can also jump there from any tool-call card in a chat.

## Built-in tool toggles

51 built-in tools, each with its own toggle and a one-line description:

| Category | Representative tools |
|---|---|
| Files | `read_file` `write_file` `edit_file` `search_files` `list_dir` `move_file` |
| Terminal | `shell` `process_list` `port_check` `system_info` |
| Network | `web_fetch` `web_search` `http_request` |
| Code | `git_operation` `npm_run` `code_analysis` |
| Utilities | `json_process` `base64_tools` `hash_tools` `uuid_generate` `timestamp_tools` |
| Memory | `remember` `recall` `forget` `save_knowledge` |
| Skills | `list_skills` `load_skill` `install_skill` `create_skill` |

- A disabled tool **never enters the model's field of view** — it consumes no context and cannot be called
- Toggle changes take effect immediately, no restart required
- To narrow the model's capability surface (say, let it only read and write files), just switch the rest off in one go

## MCP servers

MCP (Model Context Protocol) servers are registered and managed here:

- Fill in command / args / env, and the server is launched as a stdio child process
- Enable / disable is supported; when startup fails, the exit reason is displayed
- In the model's eyes, MCP tools are structurally identical to built-in tools, named `mcp__<server>__<tool>`

## Skills

- `create_skill` distills one successful approach into a skill directory with a SKILL.md
- `load_skill` mounts per message, injecting methodology into the current chat turn
- The skill library is shared across the machine: `~/.lyclaw/skills/`

## Single source of truth for tool schemas

Every tool's definition lives in `src/shared/builtin-tools.json`. The desktop app, the phone remote, and the server all read that same file — add a tool once and it is available on all three. Want to add your own? See [Add a new tool](../dev/add-tool.md).
