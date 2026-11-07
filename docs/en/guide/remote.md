# Phone remote

**English** | [简体中文](../../guide/remote.md)

> [← Back to documentation index](../../../README_EN.md#docs)

The whole workbench in your pocket: send messages from the phone, the desktop does the work, progress streams back in real time.

## Enable it

1. Desktop: **Settings → Remote access (设置 → 远程访问)** — once the QR code appears, you're ready
2. Phone: on the same LAN, scan the code; a browser opens `http://<desktop-ip>:3211/remote.html?t=<pairing-code>`
3. The page pairs automatically — no app to install

## Capabilities

| Capability | Notes |
|---|---|
| Chat | Full Markdown rendering and code highlighting, same source as desktop |
| Tool calls | All 51 tools + MCP — anything the desktop can do |
| Screenshot Q&A | Send a screenshot; the model answers looking at it |
| Sub-agent progress | Parallel sub-agents dispatched on the desktop sync as live progress cards |
| Notifications | Task completion pushed into the phone's message stream |

## Security model

Remote access is **closed by default**:

- Non-local requests must carry the **pairing code** (the `t=` URL parameter or a request header), otherwise every API returns 401
- Without the pairing code, even the page itself 404s — strangers on the LAN can't perceive the entrance
- The code is generated on the desktop; "re-pair" invalidates old codes immediately
- Cross-site protection is active throughout: a malicious web page can't touch these endpoints through your browser

> Phone remote is a **LAN trust model**: whoever holds the pairing code is effectively the owner. Don't enable it on untrusted networks like coffee-shop Wi-Fi; the app intentionally offers no public tunnel.

## FAQ

**The page won't open on the phone?**
Confirm phone and desktop are on the same Wi-Fi; confirm the desktop QR code is showing (service started); allow port 3211 through the firewall.

**"Invalid pairing code" after scanning?**
Someone clicked "re-pair" on the desktop — old codes are dead. Scan again.

**Is it the same session as desktop?**
Yes. Remote shows the desktop's data; disconnecting and reconnecting from the same phone keeps the context.
