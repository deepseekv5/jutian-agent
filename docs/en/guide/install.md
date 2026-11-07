# Install & Run

**English** | [简体中文](../../guide/install.md)

> [← Back to documentation index](../../../README_EN.md#docs)

## System requirements

| Item | Requirement |
|---|---|
| macOS | 12 Monterey or later, Apple Silicon native |
| Windows | 10 / 11, x64 |
| Node.js | 18+ (only for running from source; not needed for installers) |
| Network | Only if you configure a cloud model service; local models work offline |

## Option 1: Download an installer (recommended)

Grab from [Releases](https://github.com/deepseekv5/jutian-agent/releases):

| File | Notes |
|---|---|
| `jutian-agent-x.x.x-arm64.dmg` | macOS Apple Silicon, drag into Applications |
| `jutian-agent-x.x.x-x64.dmg` | macOS Intel |
| `jutian-agent-x.x.x-x64-setup.exe` | Windows |

On macOS, if first launch says "cannot verify the developer" (the app is not notarized):

```bash
xattr -cr /Applications/巨天agent.app
# or right-click → Open
```

## Option 2: Run from source

```bash
git clone https://github.com/deepseekv5/jutian-agent.git
cd jutian-agent
./run.sh          # Windows: double-click run.bat
```

`run.sh` / `run.bat` detect missing dependencies and run `npm install` automatically, then start:

- Backend on `:3211` (tool API + llm-proxy)
- Vite frontend on `:5173` (hot reload) — open http://localhost:5173

## Option 3: Manual

```bash
npm install
npm start         # equivalent to run.sh
```

## First-run configuration

1. Open **Settings → Reasoning (设置 → 推理)**
2. Fill in the address, key, and model name of any **OpenAI-compatible service** (OpenAI / DeepSeek / Zhipu / Ollama / LM Studio all work)
3. Click "fetch model list" to pick a model instead of typing it
4. Done — the app bundles no model service; your key is stored only in the local SQLite database

See [Model setup](models.md).

## Installation troubleshooting

**Port 3211 is occupied**
The backend listens on 3211 by default. Find the process with `lsof -i :3211`, kill it, or set the `PORT` environment variable to change the port.

**better-sqlite3 ABI errors on Windows**
The native module needs a prebuilt binary matching Electron. `npm run electron:build:win` runs the correct rebuild flow automatically; plain dev mode (`npm run dev`) uses your system Node's ABI and usually needs nothing.

**Voice features unavailable**
Desktop voice depends on the edge-tts runtime injected at packaging time. Official downloads from Releases include it; when packaging from source yourself, set the `EDGE_TTS_DIR` environment variable to your openai-edge-tts checkout — see [Build & release](../dev/build.md).

## Upgrade & uninstall

- **Upgrade**: download the new installer and overwrite, or from source `git pull && ./run.sh`
- **Complete uninstall**: after removing the app, all data lives in `~/.lyclaw/` — delete it to leave zero traces. Every session, key, and memory is in that one directory.
