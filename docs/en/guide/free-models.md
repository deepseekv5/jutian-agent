# Free models

**English** | [简体中文](../../guide/free-models.md)

> [← Back to documentation index](../../../README_EN.md#docs)

**Technology is not high above — it serves the people.** Jutian Agent ships a free-model panel: no signup, no payment, no keys — one click to switch between **26 free models** (Pollinations 1 + Kilo gateway 19 + OpenCode Zen Free 6, all keyless, rate-limited per IP).

## Open the panel

Sidebar shortcut **"Free AI"** (star icon), or New Tab → Free models.

## Three keyless sources

| Source | Count | Notes |
|---|---|---|
| **Kilo gateway** | 19 free tiers | Default `openrouter/free` auto-router, vision + reasoning; plus alternates like `kilo-auto/free` |
| **OpenCode Zen Free** | 6 verified working | Up to 1M context / 512K output, some with 5-level reasoning and omni-modal input |
| **Pollinations** | 1 | `openai-fast` (GPT-OSS 20B), keyless anonymous tier |

### The six OpenCode Zen Free models

| Model | Context | Output | Notes |
|---|---|---|---|
| Big Pickle | 200K | 32K | Compact text-only, fast |
| MiMo V2.6 Flash | 200K | 32K | Text / image / audio / video |
| Nemotron 3.5 Lightning | 262K | 262K | Very long output |
| Step 5 Preview | 1M | 66K | Three-level adjustable reasoning |
| LongCat 2.5 Preview | 1M | 131K | Long-form with vision |
| Space Bunny | 1M | 524K | Five-level reasoning, all-round flagship |

The list is fetched live from upstream every time you open the panel; models unavailable on your network stay listed with the reason noted.

- "Switch" = auto-writes the gateway address + keyless placeholder + model name; zero configuration
- Free sources rotate with gateway load and **availability can change at any time**; a speed-test button sits next to each Kilo model, and the server auto-retries empty responses (up to 3 times, with an enlarged token budget for reasoning models)
- Quota: free tiers are rate-limited per IP; wait or switch models when you hit the cap
- Note: OpenCode Zen's free lane requires a specific client fingerprint and streaming — the server handles both automatically

## FAQ

**Free model quality fluctuates?**
Free tiers route by gateway load and degrade at peak. For important work, configure your own provider in Settings → Reasoning.

**Quota not enough?**
Free tiers are for light use. For heavy use, bring your own OpenAI-compatible service (address + key + model).

**Does it work offline?**
No — every model (free or your own) is an online service. For local models (Ollama / LM Studio), configure `http://localhost:11434/v1` in Settings → Reasoning and use provider=local.

## Other model sources

Any OpenAI-compatible service can be configured manually in Settings → Reasoning (address + key + model) — see [Model setup](models.md). The free panel and manual configuration don't interfere: the panel switches "which model is active now", manual setup defines "which providers exist".
