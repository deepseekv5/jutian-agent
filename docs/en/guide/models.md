# Model setup

**English** | [简体中文](../../guide/models.md)

> [← Back to documentation index](../../../README_EN.md#docs)

## Basic configuration

**Settings → Reasoning (设置 → 推理)**, three fields:

| Field | Notes |
|---|---|
| API address | Any OpenAI-compatible service, e.g. `https://api.openai.com/v1`, `https://api.deepseek.com/v1`, or local Ollama at `http://localhost:11434/v1` |
| API key | The provider's key; local services can leave it empty |
| Model | Type it, or click "fetch model list" to pick from `/v1/models` |

"Test connection" verifies the setup; on failure it shows the **upstream's real status code and reason**, not a generic "connection failed".

## Compatibility notes

- Speaks the OpenAI Chat Completions protocol (`POST /v1/chat/completions`, SSE streaming supported)
- Keys are tried both as a `Bearer` header and as a bare key, for gateways that only accept the bare form
- Any non-200 upstream response (400/401/429/500) is **passed through verbatim** — status code and body — for easy debugging

## Thinking levels

The `⚡` button in the composer picks how hard the model thinks: **off / low / medium / high / max**.

- The level is injected into the system prompt, steering the model to spend its "thinking budget" on hard problems
- Your choice persists across restarts
- Noticeable on reasoning models (DeepSeek-R1 class); on plain models it mostly shifts prompt emphasis

## Mode toggles (single message)

The row of toggles under the composer applies to the **next message only**, then resets:

| Toggle | Effect |
|---|---|
| Plan | Produce a task breakdown and plan before acting |
| Web search | Allow web search / fetch for this turn |
| Draw | Allow image generation |
| Create skill | Let this round be distilled into a reusable Skill |
| Swarm | Switch to multi-employee collaboration with a team template (Auto / Writing / Dev / Research) |

## Voice

- Input: browser-native speech recognition first (offline, zero config); falls back to server-side Whisper automatically
- Output: auto read-aloud is toggleable; packaged builds bundle an edge-tts service, voice selectable in Settings

## Privacy boundary

- Keys live only in local `~/.lyclaw/data.db`; every UI echo is masked (`sk-6****9Ylc`)
- Chat content goes only to the model service **you configured**; the app itself has no telemetry and no built-in provider
