# Changelog

## 0.1.0 (unreleased)

- Native commands: Sign In/Out, Remember, Recall, **Search Memory**, Save Selection as Memory.
- Results sidebar (latest recall/search) + status bar.
- Thin MCP JSON-RPC client over Streamable HTTP (pattern from `memory-os-cli/src/network/http.js`); tool argument shapes confirmed against the live server (`remember` needs `content`+`path`).
- Real VS Code **AuthenticationProvider** (`vscode.authentication`), OAuth 2.0 (PKCE) primary with token-paste fallback; tokens in OS keychain.
- MCP server contribution to VS Code's native MCP/agent-mode surface (requires VS Code 1.101+; feature-detected), with eager token-free discovery and runtime-only auth header injection during server resolution.
- Declared the `xmemo` AuthenticationProvider in `package.json` so VS Code Accounts UI integration works without warnings.
- Production VSIX excludes source maps; dev builds still generate them for local debugging.
- Language Model Tools for VS Code-native agent mode: `xmemo_recall`, `xmemo_search_memory`, `xmemo_context_pack`, `xmemo_remember`, `xmemo_explain_memory`.
- `@xmemo` chat participant with `/status`, `/recall`, `/remember`, `/explain`, and `/agents` commands.
- Agent Integrations panel to detect and connect adjacent agents (VS Code User MCP, Codex, Claude Code, Cursor, Windsurf, Cline, Continue) via their own MCP configs.
- Fixed OAuth dynamic client registration against current XMemo servers by using a VSCode-compatible client name, preserving callback query parameters like `windowId`, and surfacing server error details in sign-in failures.

### Deferred to v1.1
- Recent/pinned memories source in the sidebar (needs a public list tool).
- Opt-in auto-capture on save/test/diagnostics (`xmemo.autoCapture` placeholder only).
