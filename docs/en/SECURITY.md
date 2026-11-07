# Security policy

**English** | [简体中文](../../SECURITY.md)

## Supported versions

| Version | Support status |
|---|---|
| 11.x | Receives security fixes |
| 10.x | Receives critical fixes only |
| < 10.0 | No longer maintained; please upgrade |

## Reporting a vulnerability

Please report privately via GitHub **Private vulnerability reporting** (the Security tab of this repository). Do not open a public Issue.

Our commitments:

- Acknowledge receipt within 72 hours
- Credit you publicly after the fix, with your consent
- Disclose details only after the fix has shipped

## Security model (recommended reading before reporting)

- **Local-first**: settings, sessions, and keys all live on the user's machine (`~/.lyclaw/`); the repository and the app bundle no model service or keys
- **Same-host gatekeeper**: the backend accepts only same-host Origins (localhost + LAN from the same IP); cross-site requests get 403, DNS rebinding (Host mismatch) gets 421
- **Key masking**: key-type fields in any GET response are masked automatically; masked values are never written back to storage
- **Phone remote**: non-local requests must carry a pairing code, which appears only in the QR code on the settings page
- **Command blocklist**: the `shell` tool rejects destructive commands such as `rm -rf /`, `mkfs`, and `format`

## Known limitations

- Phone remote uses a LAN trust model: a device on the LAN holding the pairing code is treated as the owner. Do not enable remote access on networks you don't trust
- Tools such as `shell` / `write_file` are inherently authorized execution — review the commands the model produces yourself
