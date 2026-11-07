# Adding a tool

**English** | [简体中文](../../dev/add-tool.md)

> [← Back to docs index](../../../README_EN.md#docs)

Adding a model-callable tool to Jutian Agent takes two steps: **write the implementation in serve.ts + write the schema in builtin-tools.json**. No frontend code changes needed.

## Step 1: Implementation (src/server/serve.ts)

Register an async function in the `TOOLS` object:

```ts
async function my_tool(a: any) {
  const name = String(a.name || "world");
  try {
    const out = `hello, ${name}`;
    return { success: true, output: out };        // ← the only valid return shape
  } catch (e: any) {
    return { success: false, error: String(e.message || e) };
  }
}

// Register it in the TOOLS table
TOOLS.my_tool = my_tool;
```

**Iron rule: the return value must have the `{ success, output }` shape.** The renderer, phone remote, and sub-agents all parse this shape; returning a bare string means no client displays the result.

Conventions:

- Read arguments from `a`, and always apply `String()` / fallback defaults — model-provided arguments are untrusted
- Report failures with `success: false` + an `error` field; don't let exceptions escape to the top level
- For destructive operations (delete / overwrite), run an existence check first. The `shell` tool already has a command blocklist — don't let new tools allow commands like `rm -rf /` either

## Step 2: Schema (src/shared/builtin-tools.json)

Append an entry in OpenAI function calling format:

```json
{
  "type": "function",
  "function": {
    "name": "my_tool",
    "description": "One sentence that says clearly what it does and when to use it",
    "parameters": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "Who to greet" }
      },
      "required": ["name"]
    }
  }
}
```

This file is the **single source of truth**: the desktop app, phone remote, and sub-agents all read the same copy. The schema description directly decides when the model calls the tool — writing a clear description of what it does, when to use it, and what each parameter means matters more than writing more code.

## Step 3: Verification

```bash
npm run build:server && npm run lint
```

Then test all three paths for real:

1. **Desktop**: restart the backend, ask for the tool in a chat, and check the tool-call card and result rendering
2. **LY HARNESS**: the new tool shows up in the plugin center panel and can be toggled on and off
3. **Phone remote**: send a triggering message from the remote page and confirm the result syncs

## Checklist

- [ ] Returns the `{ success, output }` shape
- [ ] Arguments have fallbacks; model input is never trusted
- [ ] The schema description states when to use it
- [ ] `npm run lint` passes with zero errors
- [ ] All three paths (desktop / panel / phone) verified in practice
