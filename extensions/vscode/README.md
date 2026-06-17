# XMemo — Cross-Agent Cloud Memory

Your editor executes. XMemo lets it remember the project.

XMemo is a user-owned, identity-aware cloud memory layer. Save engineering decisions, project conventions, and context once — recall them in Cursor, Claude, Codex, Copilot, your CLI, and back here in VS Code.

## What this extension does

- **One-click install** — no terminal, no manual config. Install from the Marketplace or Open VSX (Cursor / Windsurf / VSCodium).
- **In-editor sign-in** — OAuth 2.0 (PKCE) through the VS Code Accounts UI; token-paste is an automatic fallback.
- **Native commands** — `XMemo: Remember…`, `Recall…`, `Search Memory`, and `Save Selection as Memory` (right-click).
- **Results sidebar** — an XMemo panel showing your latest recall/search results.
- **Agent memory (MCP)** — contributes the XMemo MCP server to your editor's AI agent so the agent itself can recall and save memory. Requires a host with the MCP API (VS Code 1.101+); degrades gracefully where unavailable.
- **Secure by default** — credentials live in the OS keychain (`SecretStorage`), never in settings or files. Attribution via `X-Memory-OS-Agent-ID = vscode`.

## Quick start

1. Install the extension.
2. Run **XMemo: Sign In** → a browser opens for OAuth. (If OAuth is unavailable, you'll be offered token paste.)
3. Run **XMemo: Recall…** / **Search Memory**, or select code → right-click → **Save Selection as Memory**.

> Need an account? Get one at [xmemo.dev](https://xmemo.dev).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `xmemo.apiBaseUrl` | `https://xmemo.dev` | XMemo service base URL; MCP endpoint is `<baseUrl>/mcp`. |
| `xmemo.agentId` | `vscode` | Attribution header value. |
| `xmemo.autoCapture` | `false` | Reserved for v1.1 (not yet implemented). |

## Privacy & security

XMemo is user-owned. This extension sends MCP requests to `<baseUrl>/mcp`, authenticated by your account, and only saves memory when you ask it to. See [privacy](https://xmemo.dev/legal/privacy) and [terms](https://xmemo.dev/legal/tos).

## Links

- Website: https://xmemo.dev
- Product: https://xmemo.dev/product/mcp
- Issues: https://github.com/yonro/memory-os-cli/issues
