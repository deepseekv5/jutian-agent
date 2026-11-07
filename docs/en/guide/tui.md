**English** | [简体中文](tui.md)

# Terminal (TUI)

> [← Back to documentation index](../../../README_EN.md#docs)

Talk to Jutian from your terminal — Claude Code style. Same 51 tools, same security shield, same permission prompts, same sessions as the desktop app.

## Two entry points

| Entry | Install | Notes |
|---|---|---|
| `jtcode` | One-click install from the desktop app (Settings → About) | Single file, zero dependencies |
| `npm run tui` | Run inside the repo checkout | Rich ink UI (tool cards, markdown), `npm link` gives you a global `jt` |

## Key semantics

- **Working directory = where you launched it.** Launch in a project folder and that folder is the workspace — files created land there, shell commands run there. The desktop app's own workspace is untouched.
- **Cold start**: if Jutian isn't running, the CLI starts it for you (installed app, or the repo's `serve.cjs` for the TUI) and waits until it's ready.
- **Permission prompts**: write/delete/sensitive operations ask `[y] allow · [n] deny · [a] always for this session` — the same gate as the desktop app.
- **Sessions persist**: conversations are saved and visible in the desktop app's session list.

## Commands

| Command | Effect |
|---|---|
| `/new` | Fresh conversation |
| `/resume [n]` | List / restore recent sessions (TUI) |
| `/model [n]` | Show / switch model |
| `/tools` | List all 51 tools |
| `/security` | Show the three shield toggles |
| `/pack` | Update the malicious-command pack |
| `/status` | Backend version, model, workspace |
| `/exit` | Quit |

## Tips

- While the agent is busy you can keep typing — messages are queued and sent in order.
- `Esc` (TUI) interrupts the current stream; `Ctrl+C` aborts, second press quits.
- Shell commands accept `{{KEY}}` / `{{BASE}}` placeholders for the configured API key/base URL — the real values are substituted at execution time and never echo back.
