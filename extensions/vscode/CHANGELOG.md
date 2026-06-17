# Changelog

## 0.1.0 (unreleased)

- Native commands: Sign In/Out, Remember, Recall, **Search Memory**, Save Selection as Memory.
- Results sidebar (latest recall/search) + status bar.
- Thin MCP JSON-RPC client over Streamable HTTP (pattern from `memory-os-cli/src/network/http.js`); tool argument shapes confirmed against the live server (`remember` needs `content`+`path`).
- Real VS Code **AuthenticationProvider** (`vscode.authentication`), OAuth 2.0 (PKCE) primary with token-paste fallback; tokens in OS keychain.
- MCP server contribution to the editor agent (requires VS Code 1.101+; feature-detected), with agent-id + instance-id attribution headers supplied at runtime (never persisted).
- Declared the `xmemo` AuthenticationProvider in `package.json` so VS Code Accounts UI integration works without warnings.
- Production VSIX excludes source maps; dev builds still generate them for local debugging.

### Deferred to v1.1
- Recent/pinned memories source in the sidebar (needs a public list tool).
- Opt-in auto-capture on save/test/diagnostics (`xmemo.autoCapture` placeholder only).
