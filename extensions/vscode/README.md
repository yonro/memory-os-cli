# XMemo — Cross-Agent Cloud Memory

Your editor executes. XMemo lets it remember the project.

XMemo is a user-owned, identity-aware cloud memory layer. Save engineering decisions, project conventions, and context once — recall them in VS Code, Copilot, Cursor, Claude, Codex, your CLI, and any other agent that is connected to the XMemo MCP server.

## What this extension does

- **One-click VS Code install** — no terminal for the native extension. Marketplace and Open VSX distribution make the extension available in VS Code-compatible hosts.
- **In-editor sign-in** — OAuth 2.0 (PKCE) through the VS Code Accounts UI; token-paste is an automatic fallback.
- **Native commands** — `XMemo: Remember…`, `Recall…`, `Search Memory`, and `Save Selection as Memory` (right-click).
- **Results sidebar** — an XMemo panel showing your latest recall/search results.
- **VS Code agent memory (MCP)** — contributes the XMemo MCP server to VS Code's native MCP/agent-mode surface. Requires a host with the MCP API (VS Code 1.101+); degrades gracefully where unavailable.
- **Language Model Tools** — VS Code agent mode can invoke `xmemo_recall`, `xmemo_search_memory`, `xmemo_context_pack`, `xmemo_remember`, and `xmemo_explain_memory`.
- **@xmemo chat participant** — quick diagnostics and commands inside VS Code Chat (`/status`, `/recall`, `/remember`, `/explain`, `/agents`).
- **Agent Integrations panel** — detect adjacent agents (Claude Code, Codex, Cursor, Windsurf, Cline, Continue) and connect them to XMemo via their own MCP configs with preview and approval.
- **Secure by default** — credentials live in the OS keychain (`SecretStorage`), never in settings or files. Attribution via `X-Memory-OS-Agent-ID = vscode`.

## Quick start

1. Install the extension.
2. Run **XMemo: Sign In** → a browser opens for OAuth. (If OAuth is unavailable, you'll be offered token paste.)
3. Run **XMemo: Recall…** / **Search Memory**, or select code → right-click → **Save Selection as Memory**.
4. Open the **XMemo: Agent Integrations** panel to detect and connect Claude Code, Codex, Cursor, Windsurf, Cline, and Continue via their own MCP configs.
5. In VS Code Chat / agent mode, invoke XMemo tools directly or type `@xmemo /status`.

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
