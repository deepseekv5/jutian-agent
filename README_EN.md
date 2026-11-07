<div align="center">

# Jutian Agent · 巨天agent

**Desktop AI Workbench — Chat · Code · Swarm · Free Models · Extensions**

One sentence in, finished work out.

**English** | [简体中文](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/deepseekv5/jutian-agent/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/deepseekv5/jutian-agent?style=for-the-badge&labelColor=0a0a0b&color=10a37f)](https://github.com/deepseekv5/jutian-agent/releases)
[![Platform](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux%20·%20Android-3b82f6?style=for-the-badge&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/releases)
[![License](https://img.shields.io/badge/MIT-10a37f?style=for-the-badge&labelColor=0a0a0b)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/deepseekv5/jutian-agent?style=for-the-badge&labelColor=0a0a0b&color=f5b301)](https://github.com/deepseekv5/jutian-agent/stargazers)

[Download](https://github.com/deepseekv5/jutian-agent/releases) · [Website](https://deepseekv5.github.io/jutian-agent/) · [Quick Start](#quick-start) · [Docs](#docs) · [Architecture](#architecture) · [FAQ](#faq)

</div>

---

<br>

> The desktop is the best place for AI.
>
> Technology is not high above — it serves the people.
>
> Browser AI makes you come to it. Desktop AI lives where the work already is: your files, your terminal, your workflow.

<br>

## 📖 Table of contents

| | | |
|---|---|---|
| [Six things, done right](#highlights) | [User extension layer](#uxl) | [Free models](#free-models) |
| [Sub-agents](#swarm) | [Phone remote](#remote) | [Standalone on Android](#standalone) |
| [Skills market](#skills) | [Rich rendering](#rich) | [Three principles](#principles) |
| [Docs](#docs) | [Quick start](#quick-start) | [Architecture](#architecture) |
| [By the numbers](#stats) | [Roadmap](#roadmap) | [FAQ](#faq) |

<br>

<a id="highlights"></a>

## ✦ Six things, done right

**01 — Talk, it executes.**

51 built-in tools wired to a real terminal and filesystem. You state the goal; it breaks it down, calls tools, verifies, and delivers results. Not suggestions — actions.

**02 — Code mode.**

A full dev environment without leaving the window: file tree, multi-tab editor, syntax highlighting, built-in terminal. Auto snapshot before every turn; revert an entire round with one click.

**03 — Swarm command room.**

One goal, one team. A lead agent splits the task, digital employees @-hand work to each other, results auto-aggregate. Employees are customizable, groupable, and can be assigned a boss.

**04 — Terminal-first.**

The `jtcode` CLI invokes the agent from any shell, script, or CI. No window switching.

**05 — Everything is a plugin.**

The LY HARNESS center: toggle each of the 51 tools individually, hot-plug MCP servers (HTTP/SSE/stdio), mount Skills per message. One tool-schema source, synced across desktop / phone / server.

**06 — Learns you.**

Long-term memory stores only indexes — details fetched on demand. Knowledge base with RAG retrieval. It remembers your preferences, your projects, how you talk.

<br>

<a id="uxl"></a>

## ✦ User extension layer — AI edits its own UI

Ask it for "a pomodoro panel" or "a calendar widget" and it builds one: the `create_extension` tool generates a standalone HTML panel plus manifest into `~/.lyclaw/extensions/`. Approve it in the Extensions page and it appears as a first-class tab — sandboxed in an iframe with no same-origin access, talking to the host only through a whitelisted read-only bridge.

- **Survives updates** — official releases only replace `app.asar`; the extension layer lives outside it
- **Reversible** — approve / disable / delete per extension; an incompatible `apiVersion` auto-disables on upgrade instead of breaking
- **Manifest contract** — tested, versioned, shared between server and renderer

Related: the **Agent engine** switch in Settings includes an option to embed the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) WebUI as an external kernel (standalone app, embedded as a view).

<br>

<a id="swarm"></a>

## ✦ Sub-agents — AI dispatches AI

The main agent spawns 1–5 parallel sub-agents (worker pool, concurrency 3), each with full tool access. Live progress in the sidebar; stop anytime.

```
  dispatch ──▶ ┌─ Researcher ──▶ gather, output notes
               ├─ Developer  ──▶ implement + self-test
               └─ Reviewer   ──▶ aggregate & deliver
```

Phone remote supports dispatch too, with live progress cards.

<br>

<a id="free-models"></a>

## ✦ Free models — no gatekeeping

Built-in **free model panel**: OpenRouter Free Router by default (`openrouter/free`, aggregating 20+ free models with automatic routing), 21 keyless free tiers one click away — no signup, no payment, 200 req/h per IP, empty-response auto-retry. Add a Kilo account key to unlock all 378 paid tiers. Technology is not high above — it serves the people.

```
  Free tiers ──▶ kilo-auto router · Nemotron 3 Ultra 550B · Step 3.7 Flash …
  Paid tiers ──▶ add a Kilo key, same one-click switching
```

<br>

<a id="remote"></a>

## ✦ Phone remote — the workbench in your pocket

LAN QR-code pairing; a pairing code guards every endpoint.

```
  Phone sends ──▶ Desktop works ──▶ Progress back to phone
```

Full Markdown rendering, complete tool-call display, live sub-agent progress.

<br>

<a id="standalone"></a>

## ✦ Standalone on Android — no computer needed

Two APKs, pick one:

| APK | Size | What it is |
|---|---|---|
| **jutian-local-\<abi\>.apk** | ~55MB | **Local**: bundles a Node runtime + the full frontend. The whole agent runs on the phone, data stays on the phone. Per-ABI builds: arm64-v8a (mainstream), armeabi-v7a (older devices), x86_64 (emulator) |
| jutian-remote-*.apk | ~60KB | Remote: a thin shell that connects to your desktop or a Termux-hosted service |

The local build runs the exact same backend as desktop: chat, 51 tools, skill market, memory, voice. A Termux deployment package (`jutian-mobile-*.zip`) is also available — on Node 22+ it uses built-in SQLite (real SQL, knowledge base included); older Node versions fall back to JSON storage with full data persistence.

<br>

<a id="skills"></a>

## ✦ Skills market — real sources, one-click install

Integrates Anthropic's official Agent Skills repo and the Superpowers community collection — 30+ professional skills: PDF/PPT processing, frontend design, brand guidelines, MCP building, algorithmic art, systematic debugging…

Preview the full SKILL.md before installing. Installation pulls real files recursively from whitelisted repos — no git needed, works on phones too. Safety boundaries: directory whitelist, extension whitelist (no binary payloads), per-file and total size caps.

<br>

<a id="rich"></a>

## ✦ Rich rendering — charts · math · live preview

- **Mermaid**: ` ```mermaid ` blocks render as flowcharts / sequence diagrams / Gantt charts; one-click switch between diagram and source
- **Math**: KaTeX, supporting both `$..$` and `\(..\)` delimiters
- **HTML Artifacts**: complete web pages the agent generates — one-click Preview from the code block header, sandboxed iframe

All lazy-loaded: sessions without charts or math pay nothing; the main bundle grows by 0.4 KB.

<br>

<a id="principles"></a>

## ✦ Three principles, no exceptions

**Local-first** — data stays on this machine. Works offline.

**Deliver, don't suggest** — never "you could try…"; hand over the result.

**Restraint** — the interface does one thing: stay out of the way.

<br>

<a id="docs"></a>

## ✦ 📖 Documentation

> User-facing docs are written in Chinese; code, identifiers, and commands are universal.

### User guide

| Doc | In one line |
|---|---|
| [📥 Install & run](docs/guide/install.md) | Installer / source / manual paths, first-run config, troubleshooting |
| [🧠 Model setup](docs/guide/models.md) | Any OpenAI-compatible endpoint, model fetch, thinking levels |
| [🧩 Swarm](docs/guide/swarm.md) | Command room vs parallel pool, team templates, @-relay, notification digest |
| [🎁 Free models](docs/guide/free-models.md) | Kilo keyless tiers, account key, unlocking paid tiers |
| [📱 Phone remote](docs/guide/remote.md) | QR pairing, capabilities, LAN trust model, FAQ |
| [🔌 LY HARNESS](docs/guide/harness.md) | Per-tool toggles, MCP management, Skills mounting |
| [📚 Knowledge & memory](docs/guide/knowledge.md) | RAG retrieval, embedding config, memory vs knowledge |
| [🔒 Data & privacy](docs/guide/privacy.md) | Data directory map, what goes online, key masking, backup, deletion |

### Developer

| Doc | In one line |
|---|---|
| [🏗 Architecture](docs/dev/architecture.md) | Three layers, one chat turn's data flow, port conventions, directory tour |
| [📦 Build & release](docs/dev/build.md) | Command table, mac/win packaging, patch updates, CI strategy, release checklist |
| [🛠 Add a tool](docs/dev/add-tool.md) | From implementation to schema to all three ends — complete walkthrough |

### Engineering

| Doc | In one line |
|---|---|
| [🤝 Contributing](CONTRIBUTING.md) | Environment, commit conventions, red lines |
| [🔐 Security](SECURITY.md) | Private vulnerability reporting, security model, supported versions |
| [📜 Changelog](CHANGELOG.md) | What changed in every version |
| [⚖️ Copyright](COPYRIGHT.md) | MIT + third-party components |

<br>

<a id="quick-start"></a>

## ✦ Quick start

```bash
git clone https://github.com/deepseekv5/jutian-agent.git
cd jutian-agent
./run.sh                  # macOS/Linux: installs deps + starts
run.bat                   # Windows: double-click or run from terminal
npm run electron:build    # package macOS (dmg + zip)
npm run electron:build:win  # package Windows (setup.exe)
```

> Or manually: `npm install && npm start`. `run.sh` / `run.bat` auto-install missing dependencies.

First run: **Settings → Reasoning**, fill in any OpenAI-compatible endpoint, key, and model name.
No model service or key is bundled — your configuration belongs to you.

<details>
<summary><b>📥 Download installers</b></summary>

Grab from [Releases](https://github.com/deepseekv5/jutian-agent/releases):

| File | For |
|---|---|
| jutian-agent-x.x.x-arm64.dmg | macOS Apple Silicon |
| jutian-agent-x.x.x-x64.dmg | macOS Intel |
| jutian-agent-x.x.x-x64-setup.exe | Windows |
| jutian-agent-x.x.x-x86_64.AppImage / .deb | Linux |
| jutian-local-\<abi\>.apk | Android standalone |

> First launch on macOS: right-click → Open, or `xattr -cr /Applications/巨天agent.app`

</details>

<br>

<a id="architecture"></a>

## ✦ Architecture

```
┌──────────────────────────────────────────────────┐
│                Electron main process              │
│  ┌─────────────┐  ┌────────────────────────────┐ │
│  │  serve.cjs  │  │  Window / Tray / State      │ │
│  │  51 tools   │  └────────────────────────────┘ │
│  │  llm-proxy  │                                  │
│  │  MCP client │    ┌─────────────────────┐     │
│  │  Cron jobs  │────│  Phone remote (pair) │     │
│  │  UXL host   │    └─────────────────────┘     │
│  └─────────────┘                                  │
└──────────────────────────────────────────────────┘
        │ tools/execute         │ remote/file
        ▼                       ▼
  Real terminal · filesystem   Phone browser (LAN)
```

<details>
<summary><b>📁 Full directory structure</b></summary>

```
├── index.html                 Entry page
├── serve.cjs                  Backend (built; source: src/server/serve.ts)
├── electron/                  Main process
├── src/
│   ├── renderer/
│   │   ├── app/               Shell (TabBar / Sidebar / notifications / UXL)
│   │   ├── chat/              Main chat
│   │   ├── code/              Code mode
│   │   ├── agents/            Swarm
│   │   ├── panels/            Panels (free models / KB / PPT / extensions)
│   │   ├── media/             Media
│   │   ├── settings/          Settings
│   │   ├── engine/            Streaming engines / sub-agents / loops
│   │   └── hooks/ store/ types/ utils/
│   ├── server/serve.ts        The single backend source file
│   └── shared/                Tool schemas / MCP / guidance / extension contracts
├── docs/                      Website (Pages) + all documentation
├── public/                    Phone single-page
└── scripts/                   Build & patch tooling
```

</details>

<br>

<a id="stats"></a>

## ✦ By the numbers

| **51** | **5+** | **6** | **0** | **4** |
|:---:|:---:|:---:|:---:|:---:|
| Built-in tools | Digital employees | Core surfaces | Bytes phoned home | Platforms |

<br>

<a id="roadmap"></a>

## ✦ Roadmap

- [x] Swarm command room (employees / group chat / boss assignment)
- [x] Parallel sub-agent pool (concurrency 3)
- [x] Editable diff (chat + code mode)
- [x] Phone remote (pairing + sub-agents + screenshots)
- [x] LY HARNESS plugin center
- [x] Android standalone (single APK with Node runtime, offline)
- [x] MCP SSE / streamable-http + per-service permissions + marketplace
- [x] Scheduled tasks × tool execution (agent mode) + standard cron
- [x] Chat export to HTML / PDF
- [x] User extension layer (UXL) — AI builds its own panels
- [x] Live activity for the local OpenAI-compatible API
- [x] Harness WebUI embedding as an external kernel option
- [ ] Scheduled tasks × swarm orchestration
- [ ] Extension marketplace

<br>

<a id="faq"></a>

## ✦ FAQ

**macOS says "cannot verify developer"?**
The app is not notarized. Right-click → Open, or `xattr -cr /Applications/巨天agent.app`.

**How do I configure a model?**
Settings → Reasoning; fill in any OpenAI-compatible endpoint. Nothing is bundled — see [Model setup](docs/guide/models.md).

**Where is my data? Does uninstalling leave traces?**
Everything lives in one directory: `~/.lyclaw/`. Deleting it is a complete wipe. See [Data & privacy](docs/guide/privacy.md).

**Is phone remote safe?**
LAN trust model + pairing code — strangers can't even load the page. You must trust the network you're on. See [Phone remote](docs/guide/remote.md).

**Can I use it commercially?**
Yes. MIT allows any use including commercial, keeping only the copyright notice.

**How is this different from web AI?**
Web AI makes you come to it. Desktop AI lives where the work already is.

<br>

<a id="contributing"></a>

## ✦ Contributing

Issues and PRs welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md). Security vulnerabilities go through the private channel in [SECURITY.md](./SECURITY.md). Changelog in [CHANGELOG.md](./CHANGELOG.md); third-party components in [COPYRIGHT.md](./COPYRIGHT.md).

Want to add a tool? It starts at eleven lines: [Add a tool](docs/dev/add-tool.md).

<br>

---

<div align="center">

**Jutian Agent · 巨天agent**

The desktop is the best place for AI.

[![License: MIT](https://img.shields.io/badge/License-MIT-10a37f?style=flat-square)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/deepseekv5/jutian-agent?style=flat-square&color=10a37f)](https://github.com/deepseekv5/jutian-agent/releases)
[![Stars](https://img.shields.io/github/stars/deepseekv5/jutian-agent?style=flat-square&color=f5b301)](https://github.com/deepseekv5/jutian-agent/stargazers)
[![Platform](https://img.shields.io/badge/platform-macOS%20·%20Windows%20·%20Linux%20·%20Android-3b82f6?style=flat-square)]()

**Jutian Studio** · Local-first · Your data, your machine

</div>
