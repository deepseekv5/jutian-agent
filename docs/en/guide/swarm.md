# Swarm

**English** | [简体中文](../../guide/swarm.md)

> [← Back to documentation index](../../../README_EN.md#docs)

Jutian Agent's multi-agent capability comes in two forms: the **Swarm command room** (a persistent team of digital employees) and the **sub-agent parallel pool** (temporary workers the main chat dispatches on demand).

## Swarm command room

In the **Swarm** tab you can:

- Create custom employees (name, role, system prompt), or use the built-in Product / Dev / Test / Delivery team
- **@**-relay between employees: Dev finishes and @-mentions Test; Test verifies and @-mentions Delivery
- Open a **group chat**: multiple employees plus you in one session, everyone speaking in turn
- Assign a **boss**: who signs off on the final delivery in a group

Team templates work out of the box: **Auto** (the model arranges the roster) / **Writing** / **Dev** / **Research**.

## Sub-agent parallel pool

When the task fits, the main model calls the `dispatch_subagents` tool and spawns **1–5 sub-agents** itself, each with full tool access (terminal, files, network…).

```
  dispatch ──▶ ┌─ Researcher ──▶ gather, output notes
               ├─ Developer  ──▶ implement + self-test
               └─ Reviewer   ──▶ aggregate & deliver
```

- **Parallel execution**: worker pool with concurrency 3; first done, first done
- **Live progress**: the sidebar SubAgentTracker shows each sub-agent's stage and output; phone remote mirrors the progress cards
- **Stoppable anytime**: aborting the main task cancels in-flight sub-agents; completed output is kept
- **Result feedback**: all sub-agent outputs are aggregated and handed back to the main chat for the final delivery

## Which one when

| Scenario | Pick |
|---|---|
| A task splits into independent chunks | Sub-agent parallel pool |
| A long-term fixed division of labor (e.g. "writer + reviewer") | Swarm employees |
| You need a "sign-off" role | Swarm group chat + assigned boss |
| You're out and want the desktop to work | Send the task from your phone; progress syncs back |

## Notifications

Swarm completion, sub-agent batch endings, and scheduled-task triggers all land in the **notification center** (bell icon) without interrupting your current work.
