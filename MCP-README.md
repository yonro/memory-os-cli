# XMemo MCP Server

> **User-owned Memory OS for AI agents: persistent, governed memory via the Model Context Protocol.**

[![MCP Badge](https://lobehub.com/badge/mcp-full/yonro-memory-os-cli?theme=light)](https://lobehub.com/mcp/yonro-memory-os-cli)

[English](MCP-README.md) · [简体中文](MCP-README_CN.md) | [Documentation](https://docs.xmemo.dev/) · [Hosted MCP](https://xmemo.dev/mcp)

---

## Overview

XMemo is a **user-owned Memory OS for AI agents**. Its MCP interface gives compatible clients access to persistent, governed memory and project context across sessions and tools.

Whether using Claude, Cursor, Copilot, Gemini, Kimi, Grok, Antigravity, or other MCP-compatible clients, XMemo provides durable, cross-session memory—enabling agents to retain architectural decisions, preferences, project facts, and working state across restarts.

### Core Values

- **Persistent Memory**: Decisions, preferences, and operational facts endure across sessions and process boundaries.
- **Governed Access**: Scoped tokens, client OAuth support, soft and hard deletion, and sensitive memory protection ([governance details](https://docs.xmemo.dev/docs/concepts/governance-retention)).
- **Cross-Client Continuity**: Record once, access across AI tools (Copilot, Claude, Cursor, Gemini, IDEs, and CLI).
- **Privacy First**: User-owned data, zero telemetry, no plaintext tokens written to configuration files.
- **Hosted Streamable HTTP & Local Stdio**: Connect directly to hosted Streamable HTTP (`https://xmemo.dev/mcp`) or run the local `xmemo-mcp` stdio proxy.

---

## Use Cases

| Scenario | Example |
|---|---|
| **Project Context & Architecture** | "Remember our architecture decision: use PostgreSQL with Prisma, avoid MongoDB." |
| **Coding Preferences** | "Remember that I prefer 2-space indentation and no semicolons." |
| **Cross-Session TODO Tracking** | "Create a TODO: refactor auth module next week." |
| **Durable Decisions** | "Record today's decision to migrate CI from GitHub Actions to GitLab CI." |
| **Knowledge Retrieval & Recall** | "Search my saved memories for Docker network configuration." |

---

## Supported MCP Tools

The XMemo MCP server provides a comprehensive tool suite (the exact active tool set adapts to client capabilities and granted scopes; see [XMemo Tools Documentation](https://docs.xmemo.dev/docs/tools/remember) for full details):

| Tool Name | Description | Documentation |
|---|---|---|
| `get_mcp_identity` | Verify connection status, account identity, and active agent | [Agent Identity](https://docs.xmemo.dev/docs/concepts/agent-identity) |
| `remember` | Store a durable memory (facts, preferences, decisions) | [`/docs/tools/remember`](https://docs.xmemo.dev/docs/tools/remember) |
| `recall` | Retrieve the most relevant memories for the current query | [`/docs/tools/recall`](https://docs.xmemo.dev/docs/tools/recall) |
| `recall_context` | Build structured memory context packs bounded by token budget | [`/docs/tools/recall-context`](https://docs.xmemo.dev/docs/tools/recall-context) |
| `memory_stats` | Inspect aggregate memory statistics | [Memory Model](https://docs.xmemo.dev/docs/concepts/memory-model) |
| `update_memory` | Modify contents or metadata of an existing memory | [`/docs/tools/remember`](https://docs.xmemo.dev/docs/tools/remember) |
| `explain_memory` | Explain why a memory was matched or recalled | [`/docs/tools/recall`](https://docs.xmemo.dev/docs/tools/recall) |
| `restore_memory` | Restore previously soft-deleted memories | [Governance](https://docs.xmemo.dev/docs/concepts/governance-retention) |
| `forget` | Soft-delete or permanently remove a specified memory | [`/docs/tools/forget`](https://docs.xmemo.dev/docs/tools/forget) |
| `create_memory_todo` | Create memory-linked TODO items and follow-ups | [`/docs/tools/todos`](https://docs.xmemo.dev/docs/tools/todos) |
| `list_memory_todos` | List active TODO items | [`/docs/tools/todos`](https://docs.xmemo.dev/docs/tools/todos) |
| `complete_memory_todo` | Mark a TODO item as completed | [`/docs/tools/todos`](https://docs.xmemo.dev/docs/tools/todos) |
| `add_expense` | Record operational expenses and ledger entries | [`/docs/tools/ledger`](https://docs.xmemo.dev/docs/tools/ledger) |
| `list_ledger_transactions` | List ledger entries and transactions | [`/docs/tools/ledger`](https://docs.xmemo.dev/docs/tools/ledger) |
| `get_monthly_ledger_summary` | Aggregate monthly expense summaries by currency | [`/docs/tools/ledger`](https://docs.xmemo.dev/docs/tools/ledger) |
| `update_state` | Save working state across long-running tasks | [Handoff Guide](https://docs.xmemo.dev/docs/guides/resume-and-handoff) |
| `get_project_context` | Build project-scoped durable memory context | [Projects](https://docs.xmemo.dev/docs/concepts/projects) |

### Prompts & Resources

The local stdio server additionally exposes standard MCP prompts (`remember`, `recall`, `project-context`) and two safe, unauthenticated documentation resources:
- `xmemo://docs/getting-started`: quick start guide for setup, login, and connection
- `xmemo://docs/security`: credential handling, privacy boundaries, and destructive action safety

---

## Connection Configuration

### Mode 1: Hosted Streamable HTTP (Recommended)

In clients supporting Streamable HTTP, add:

```json
{
  "mcpServers": {
    "XMemo": {
      "type": "streamable-http",
      "url": "https://xmemo.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${XMEMO_KEY}",
        "X-Memory-OS-Agent-ID": "${XMEMO_AGENT_ID}",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

**Environment Variables**:
- `XMEMO_KEY` (**Required**): Bearer token from [https://xmemo.dev](https://xmemo.dev).
- `XMEMO_AGENT_ID` (Optional): Agent family identifier, e.g. `claude-code`, `cursor`, `copilot-cli`.
- `XMEMO_AGENT_INSTANCE_ID` (Optional): Unique device instance identifier for audit and provenance attribution.

### Mode 2: MCP OAuth Clients

Clients such as Gemini CLI, Antigravity, OpenCode, and Qwen support native MCP OAuth without requiring `XMEMO_KEY`:

```json
{
  "mcpServers": {
    "XMemo": {
      "type": "streamable-http",
      "url": "https://xmemo.dev/mcp"
    }
  }
}
```

When first invoking an XMemo tool, the client prompts for browser authorization automatically.

### Mode 3: Local stdio (via CLI Proxy)

For clients requiring stdio transport, install the CLI to act as a local proxy:

```bash
npm install -g @xmemo/client
xmemo login
xmemo setup <client>
xmemo-mcp
```

`xmemo-mcp` is the dedicated stdio entry point (equivalent to `xmemo mcp serve`). Tool discovery requires no token; execution uses authenticated credentials.

---

## Usage Examples

### Scenario 1: Preserving Architectural Decisions

> **User**: "Remember that we decided to use PostgreSQL instead of MongoDB because we need ACID transactions and relational joins."

**Agent calls `remember`**:
```json
{
  "tool": "remember",
  "content": "Architecture decision: This project uses PostgreSQL instead of MongoDB. Reason: ACID transactions, relational joins, and strong consistency requirements."
}
```

> **Agent**: "Saved. In future database discussions, I will align recommendations with this decision."

---

### Scenario 2: Cross-Session Recall

> **User**: "Find the CI/CD configurations I saved earlier."

**Agent calls `recall`**:
```json
{
  "tool": "recall",
  "query": "CI/CD configuration"
}
```

---

### Scenario 3: Cross-Session TODO Tracking

> **User**: "Remind me next week to refactor the auth module and replace JWT with session cookies."

**Agent calls `create_memory_todo`**:
```json
{
  "tool": "create_memory_todo",
  "content": "Refactor auth module: replace JWT with session cookies",
  "due_at": "2026-10-06T09:00:00Z"
}
```

---

## Client Compatibility & Dedicated Guides

Detailed setup instructions and client-specific options are documented at:

| Client | Supported Mode | CLI Setup Command | Official Guide |
|---|---|---|---|
| **Cursor** | Streamable HTTP + Bearer Token | `xmemo setup cursor` | [Cursor Guide](https://docs.xmemo.dev/docs/mcp/cursor) |
| **Copilot CLI** | Local Proxy + Bearer Token | `xmemo setup copilot` | [Copilot CLI Guide](https://docs.xmemo.dev/docs/mcp/copilot-cli) |
| **Gemini CLI** | Streamable HTTP + MCP OAuth | `xmemo setup gemini` | [Gemini CLI Guide](https://docs.xmemo.dev/docs/mcp/gemini) |
| **Kiro** | Native HTTP OAuth / Key auth | `xmemo setup kiro` | [Kiro Guide](https://docs.xmemo.dev/docs/mcp/kiro) |
| **Devin Desktop (Windsurf)** | Streamable HTTP + Bearer Token | `xmemo setup windsurf` | [Windsurf Guide](https://docs.xmemo.dev/docs/mcp/windsurf) |
| **Claude Desktop** | `mcp-remote` + Bearer Token | `xmemo setup claude-desktop` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |
| **Kimi Code** | Streamable HTTP + Bearer Token | `xmemo setup kimi-code` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |
| **Antigravity Series** | Streamable HTTP + MCP OAuth | `xmemo setup antigravity` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |
| **OpenCode** | Remote MCP + MCP OAuth | `xmemo setup opencode` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |
| **Qwen CLI** | Streamable HTTP + MCP OAuth | `xmemo setup qwen` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |
| **Trae / Trae Solo** | `mcp-remote` + Bearer Token | `xmemo setup trae` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |
| **Cline** | Streamable HTTP + Bearer Token | `xmemo setup cline` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |
| **Zed** | `mcp-remote` + Bearer Token | `xmemo setup zed` | [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview) |

---

## Privacy & Security

- **Zero Telemetry**: Neither the CLI nor the MCP service collects analytics or telemetry.
- **Credential Protection**: Configuration files refer to environment variables (e.g. `${XMEMO_KEY}`) rather than plaintext secrets.
- **Specification-Accurate Authentication**: Only clients marked as MCP OAuth use browser flows; other clients read Bearer tokens from environment variables.
- **Device Attribution**: `XMEMO_AGENT_INSTANCE_ID` is a non-sensitive device UUID used for origin attribution without exposing personal data.
- **User Ownership**: Memory data belongs entirely to the user, with soft-deletion, hard-purge, and data export support.

---

## Resources & Links

- 🏠 **Website**: [https://xmemo.dev](https://xmemo.dev)
- 📖 **Documentation**: [https://docs.xmemo.dev/](https://docs.xmemo.dev/)
- 📖 **MCP Product Page**: [https://xmemo.dev/product/mcp](https://xmemo.dev/product/mcp)
- 🔧 **GitHub Repository**: [https://github.com/yonro/memory-os-cli](https://github.com/yonro/memory-os-cli)
- 📝 **XMemo Skill**: [`skills/xmemo/SKILL.md`](skills/xmemo/SKILL.md)
- 📋 **Setup Guide**: [`MCP-SETUP-GUIDE.md`](MCP-SETUP-GUIDE.md)

---

## License

[MIT](LICENSE)
