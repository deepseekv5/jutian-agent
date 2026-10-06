<div align="center">

# 巨天agent

**Desktop AI Workbench — Chat · Code · Swarm · Computer Use**

One sentence in, finished work out.

**English** | [简体中文](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/deepseekv5/jutian-agent/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/v7.0.0-10a37f?style=for-the-badge&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/releases)
[![Platform](https://img.shields.io/badge/macOS%20·%20Windows-3b82f6?style=for-the-badge&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/releases)
[![License](https://img.shields.io/badge/MIT-10a37f?style=for-the-badge&labelColor=0a0a0b)](./LICENSE)

[Download](https://github.com/deepseekv5/jutian-agent/releases) · [Documentation](#docs) · [Quick Start](#quick-start) · [FAQ](#faq)

</div>

---

The browser makes you come to AI. The desktop puts AI where the work already is — your files, your terminal, your workflow.

## Highlights

**01 — Talk, it executes.** 38 built-in tools wired to a real terminal and filesystem. Not suggestions — actions.

**02 — Code mode.** File tree, multi-tab editor, syntax highlighting, built-in terminal; auto snapshot before every turn, one-click revert of a whole round.

**03 — Swarm command room.** Custom digital employees that @-hand work to each other and auto-deliver.

**04 — Terminal-first.** `jtcode` CLI invokes the agent from any shell, script, or CI.

**05 — Everything is a plugin.** LY HARNESS: toggle each of the 38 tools, hot-plug MCP servers, mount Skills per message. One tool-schema source, synced across desktop / phone / server.

**06 — Learns you.** Long-term memory keeps indexes, details fetched on demand; knowledge base RAG on demand.

## Sub-agents

The main agent can dispatch 1–5 parallel sub-agents (worker pool, concurrency 3), each with full tool access. Live progress in the sidebar; stop anytime.

## Computer Use

Give a goal; it screenshots, decides, clicks, types, and verifies in a loop. Every step visible and interruptible — "confirm each step" mode gates every action.

## Phone Remote

Pair by scanning a QR code on the LAN; chat, tool calls, screenshots, and sub-agent progress sync to your phone. Pairing-gated; no page without the code.

## <a id="docs"></a> Documentation

| Doc | About |
|---|---|
| [Install & Run](docs/guide/install.md) | Three install paths, first-run config, troubleshooting |
| [Model Setup](docs/guide/models.md) | Any OpenAI-compatible endpoint, model fetch, thinking levels |
| [Swarm](docs/guide/swarm.md) | Employees, group chats, parallel pool, team templates |
| [Computer Use](docs/guide/computer-use.md) | The loop, step confirmation, permissions |
| [Phone Remote](docs/guide/remote.md) | Pairing, capabilities, LAN trust model |
| [LY HARNESS](docs/guide/harness.md) | Per-tool toggles, MCP, Skills |
| [Knowledge & Memory](docs/guide/knowledge.md) | RAG, embeddings, memory vs knowledge |
| [Data & Privacy](docs/guide/privacy.md) | Where data lives, backups, masking, deletion |
| [Architecture](docs/dev/architecture.md) | Layers, data flow, ports, security gate |
| [Build & Release](docs/dev/build.md) | All build commands, packaging, patching, CI policy |
| [Add a Tool](docs/dev/add-tool.md) | From schema to usable on all three ends |

User-facing docs are written in Chinese; code, identifiers, and commands are universal.

## <a id="quick-start"></a> Quick Start

```bash
git clone https://github.com/deepseekv5/jutian-agent.git
cd jutian-agent
./run.sh            # auto-installs deps and starts (Windows: double-click run.bat)
```

Then **Settings → Inference**: point it at any OpenAI-compatible endpoint with your key and model. The app ships with no model service and no keys — your config stays yours.

## FAQ

**"Unidentified developer" on first launch (macOS)?**
The app is not notarized. Right-click → Open, or `xattr -cr /Applications/巨天agent.app`.

**Where does my data live?**
Everything in one directory: `~/.lyclaw/`. Delete it and nothing remains. See [Data & Privacy](docs/guide/privacy.md).

**Commercial use?**
Yes — MIT.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: private disclosure via [SECURITY.md](./SECURITY.md). Changelog: [CHANGELOG.md](./CHANGELOG.md).

---

<div align="center">

**巨天工作室** · Local-first · Your data stays yours · MIT

</div>
