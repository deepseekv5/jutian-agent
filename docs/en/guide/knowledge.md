**English** | [简体中文](../../guide/knowledge.md)

# Knowledge Base and Memory

> [← Back to documentation index](../../../README_EN.md#docs)

Two complementary mechanisms: **Memory** keeps preferences and facts (lightweight, always present), while the **knowledge base** stores documents for retrieval (heavier, on demand).

## Memory (remember / recall / forget)

- During a chat, the model calls `remember` on its own to record anything worth keeping long term (your tech stack, project paths, how you like to be addressed)
- What gets stored is an **index plus summary**; the full original text is fetched on demand, so context never balloons
- You can also just say "remember that I prefer pnpm" — it will be persisted to disk
- The data lives in `~/.lyclaw/data/memories.json`; edit it by hand at any time

## Knowledge base (RAG)

Feed documents to the app, and from then on chats can retrieve and cite them:

1. Add documents (Markdown / plain text) in the **Knowledge Base panel (知识库面板)**
2. Under **Settings → Reasoning (设置 → 推理)**, an embedding model is required (the same provider as your chat model works — just fill in the model name)
3. In a chat, switch on the **📚 Knowledge Base toggle (📚 知识库开关)** (off by default, to avoid irrelevant retrieval); questions asked in that turn come with the retrieved results

The retrieval pipeline: question → embedding → similarity recall → injected as context → the model answers with citations.

## Which one to use

| | Memory | Knowledge base |
|---|---|---|
| What it stores | Facts, preferences, conventions | Documents, manuals, long references |
| Size | Index-level, a few dozen characters per entry | Whole documents |
| Trigger | Present in every turn (lightweight) | Toggle-controlled, retrieved on demand |
| Typical use | "Remember I use zsh" | Import API docs, then ask anything |
