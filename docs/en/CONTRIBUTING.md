# Contributing

**English** | [简体中文](../../CONTRIBUTING.md)

Thanks for your interest in Jutian Agent. This repository accepts Issues and PRs; the guidelines below make collaboration smoother.

## Environment setup

- Node.js 18+ (20 recommended)
- After cloning, run `./run.sh` (on Windows, double-click `run.bat`); the script installs dependencies and starts the dev environment automatically
- Backend on :3211, frontend (Vite) on :5173 — open http://localhost:5173 in a browser or use the Electron shell directly

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts backend + frontend with hot reload together |
| `npm run lint` | ESLint check (must be zero errors before committing) |
| `npm run check` | Full TypeScript type check |
| `npm run verify` | Contract validation (tool schemas / guidance knowledge base / key-free constants / compliance terms) |
| `npm test` | Unit and security regression tests (vitest) |
| `npm run test:watch` | Test watch mode |
| `npm run build` | Build backend (serve.cjs) + frontend (dist/) |
| `npm run electron:build` | Package macOS dmg + zip |
| `npm run electron:build:win` | Package Windows installer |

## Testing

Tests live in `tests/` and use vitest. Run them before every submission:

```bash
npm run check && npm run lint && npm test && npm run build
```

All four gates must pass. CI runs the same commands automatically on PRs.

**The two kinds of tests**

- **Pure-function unit tests** (the majority): import the module under test directly. Suited to decision logic, formatting, and policy calculations — `tests/sensitiveOps.test.ts` (sensitive-operation detection), `tests/contextCompress.test.ts` (context compression policy), `tests/toolLoopGuard.test.ts` (tool loop guards). When writing these, prioritize **boundary and false-positive cases**: hitting the threshold exactly, different arguments that must not be wrongly blocked, invalid input that must not throw.
- **Integration tests** (`tests/security.test.ts`): `spawn` the real `serve.cjs` and hit HTTP endpoints. Used to verify protections such as path traversal, SSRF, and the cross-site gatekeeper, which require the full request path. **Prerequisite**: run `npm run build:server` first (CI already orders this before the tests).

**When to add tests**

Whenever you change decision, policy, or parsing logic. Bugs in such code tend to show up as "intermittent" and "hard to reproduce"; without tests you depend on user reports. When adding a new protection, also add a **false-positive** case — criteria that are too broad are harder to debug than missed detections (users will think the feature is broken).

## Commit conventions

- Commit messages use the `type: description` format: `feat` / `fix` / `refactor` / `docs` / `chore` / `security`
- One commit per change; the message explains the "why", not which files were touched
- One topic per PR; describe the motivation and how you verified it

## Red lines

- **Never commit keys, tokens, or `.env` files** — all settings live in the user's local SQLite (`~/.lyclaw/data.db`); no real credentials belong in the repository
- `python-runtime/`, `tools/`, `archive/`, and `serve.cjs` (a build artifact) are not committed
- After changing `src/server/serve.ts`, you must run `npm run build:server` and verify it works; before changing cross-site/security logic, read the gatekeeper semantics in the comment block at the top of the file

## Notes on Windows packaging

`better-sqlite3` needs the prebuilt binary matching the Electron ABI. See the comments in `scripts/buildarmdmg.sh` and `scripts/rebuild-for-electron.sh` for the cross-packaging flow; for local Windows packaging, just run `npm run electron:build:win`.

## Code of conduct

By contributing you agree to abide by the [CODE_OF_CONDUCT.md (中文)](../../CODE_OF_CONDUCT.md).
