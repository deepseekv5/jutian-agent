# Build and release

**English** | [简体中文](../../dev/build.md)

> [← Back to docs index](../../../README_EN.md#docs)

## Command reference

| Command | What it does |
|---|---|
| `npm run dev` | Starts backend :3211 and Vite :5173 together (development) |
| `npm run lint` | ESLint (CI gate: **zero errors**) |
| `npm run check` | Full TypeScript type check |
| `npm run build:server` | Bundles `src/server/serve.ts` → `serve.cjs` (esbuild) |
| `npm run build` | build:server + Vite frontend build → `dist/` |
| `npm run electron:build` | macOS packaging (dmg + zip, arm64) |
| `npm run electron:build:win` | Windows packaging (NSIS installer, x64) |
| `npm run patch` / `patch:fast` | Patch update for the installed app (see below) |

## Build artifacts

| Path | Nature |
|---|---|
| `serve.cjs` | **Build artifact, do not edit by hand** — rebuild after changing `src/server/serve.ts` |
| `dist/` | Vite frontend build output |
| `release/` | electron-builder packaging output |
| `python-runtime/`, `tools/` | Local directories, gitignored, not in the repository |

## macOS packaging

```bash
npm run electron:build
```

Script chain: Vite build → better-sqlite3 rebuilt against the Electron ABI → electron-builder. Voice features depend on the edge-tts runtime, which is injected from a source directory via the `EDGE_TTS_DIR` environment variable (it probes the Desktop path by default; you can override it explicitly).

## Windows packaging

`npm run electron:build:win`. Note that `better-sqlite3` must be swapped for the win32 prebuilt binary matching the Electron ABI before packaging — the script handles this automatically.

## Patch updates (installed app)

When you have only changed a few files and don't want to reinstall:

```bash
npm run patch         # Build first, then patch the incremental changes into the app in /Applications
npm run patch:fast    # Skip the build and patch directly
```

What gets patched: `dist`, `electron`, `serve.cjs`, `src/shared`. Useful for quickly verifying packaged-app behavior during development.

## CI policy

`.github/workflows/ci.yml` runs on push/PR: **ESLint (zero-error gate) → backend build → frontend build**. Artifacts are retained for 3 days.

**CI does not publish Electron builds.** A full installer needs the 326 MB python-runtime plus the edge-tts runtime injected, and the CI environment has neither — packaging anyway would silently produce builds with degraded voice features. Releases stay local builds.

## Release checklist

1. Bump the version in `package.json` (single source of truth: brand / electron / CLI follow automatically)
2. Add a `CHANGELOG.md` entry
3. `npm run build && npm run lint` all green
4. `npm run electron:build` (on Windows, also run `electron:build:win`)
5. GitHub Release: tag + artifacts (dmg / zip / setup.exe) + a CHANGELOG excerpt
