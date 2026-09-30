# XMemo Client Integrations

XMemo integrates with AI agents, developer IDEs, autonomous runtimes, and command-line environments across four primary integration patterns.

The canonical and complete setup instructions for all supported clients are maintained at [https://docs.xmemo.dev/](https://docs.xmemo.dev/). For troubleshooting and common connection recipes, see [Troubleshooting](https://docs.xmemo.dev/docs/troubleshooting).

---

## Integration Patterns

### 1. Hosted MCP Clients
Compatible Model Context Protocol clients connect directly to XMemo's hosted Streamable HTTP endpoint (`https://xmemo.dev/mcp`). Depending on the client's supported authentication methods, connections use either Bearer tokens or browser-based MCP OAuth.

Clients with dedicated documentation guides include:
- **Cursor**: [Cursor Setup Guide](https://docs.xmemo.dev/docs/mcp/cursor)
- **Copilot CLI**: [Copilot CLI Setup Guide](https://docs.xmemo.dev/docs/mcp/copilot-cli)
- **Gemini CLI**: [Gemini CLI Setup Guide](https://docs.xmemo.dev/docs/mcp/gemini)
- **Kiro**: [Kiro Setup Guide](https://docs.xmemo.dev/docs/mcp/kiro)
- **Windsurf**: [Windsurf Setup Guide](https://docs.xmemo.dev/docs/mcp/windsurf)
- **Other MCP Environments** (Claude, Antigravity, OpenCode, Qwen CLI, Trae, Cline, Zed): see [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview)

### 2. Local Stdio MCP Proxy (`xmemo-mcp`)
For clients requiring local process stdio communication rather than direct remote HTTP connections, the `@xmemo/client` package bundles `xmemo-mcp`. This proxy exposes a standard stdio interface locally while securely forwarding requests to the hosted service, referencing environment variables rather than embedding plaintext credentials in client configuration files.

See the [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) for details on configuring the stdio proxy.

### 3. Native Host Plugins
Native host plugins provide deep integration directly inside host agent environments:
- **OpenClaw Plugin (`@xmemo/openclaw-memory`)**: Native memory plugin providing slot-based memory handling and remote context synchronization. Detailed in [OpenClaw Integration](https://docs.xmemo.dev/docs/connect/openclaw).
- **Hermes Provider (`xmemo`)**: Native context memory provider integration for Hermes agent runtimes. Detailed in [Hermes Integration](https://docs.xmemo.dev/docs/connect/hermes).
- **DeepSeek DSH (`dsh-xmemo`)**: Integration for DeepSeek Harness environments (available, released, and pilot-tested; integration maturity remains Preview). Detailed in [DeepSeek Harness Integration](https://docs.xmemo.dev/docs/connect/deepseek-harness).

### 4. Agent Skills
- **XMemo Skill (`@xmemo/skill`)**: A standardized, self-contained agent skill providing procedural instructions, tool wrappers, and document-backed memory operations for autonomous agent runtimes.
- Supported in skill-enabled agent environments (such as Claude Code, Codex, ClawHub, SkillHub, and compatible registries).
- Detailed in [Skills Quickstart](https://docs.xmemo.dev/docs/skills/quickstart) and [Skill Operations](https://docs.xmemo.dev/docs/skills/operations).

---

## Automated Setup & Diagnostics

The official XMemo CLI (`@xmemo/client`) provides interactive and unattended setup recipes across supported clients:
- `xmemo setup <client>`: Inspects existing client configuration, previews modifications, and installs connection snippets.
- `xmemo doctor`: Probes connectivity, checks credentials, and verifies remote discovery.
- `xmemo status`: Displays active connection parameters, detected clients, and telemetry status.
