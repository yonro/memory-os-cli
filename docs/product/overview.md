# XMemo Product Overview

> **User-owned Memory OS for AI agents: persistent memory, project context and session continuity with agent identity, provenance and governed access, shared across AI clients through MCP, the CLI and a public REST API surface.**

---

## What is XMemo?

XMemo is a **user-owned Memory OS for AI agents**. It provides a durable, governed context layer that spans sessions, models, and tools.

Modern AI agents typically operate within stateless conversation windows. When a session ends or the context window compacts, architectural decisions, developer preferences, project facts, and working state are lost. XMemo solves this by providing an external, persistent memory layer where agents can record, retrieve, and govern memory across their lifecycle.

The canonical and complete documentation for XMemo is maintained at [https://docs.xmemo.dev/](https://docs.xmemo.dev/). For an architectural walkthrough of the core system, see [How XMemo Works](https://docs.xmemo.dev/docs/concepts/how-xmemo-works).

---

## Access Surfaces & System Architecture

MCP is one access surface of XMemo, not the product boundary. Agents and developers interact with XMemo through multiple complementary surfaces:

```
                  +----------------------------------------------+
                  |         User-Owned Memory OS (XMemo)         |
                  +----------------------------------------------+
                         ^             ^             ^
                         |             |             |
        +----------------+             |             +-----------------+
        |                              |                               |
        v                              v                               v
+------------------+         +--------------------+         +--------------------+
|   MCP Surface    |         |     XMemo CLI      |         |  Public REST API   |
| (Streamable HTTP |         |  (@xmemo/client)   |         |      Surface       |
| & xmemo-mcp)     |         |                    |         |       (/v1)        |
+------------------+         +--------------------+         +--------------------+
        ^                              ^                               ^
        |                              |                               |
+------------------+         +--------------------+         +--------------------+
|  Agent Clients   |         | Skills & Plugins   |         | Custom Services &  |
| (Claude, Cursor, |         | (OpenClaw, Hermes, |         | Backend Handlers   |
| Copilot, Gemini) |         | DSH, XMemo Skill)  |         |                    |
+------------------+         +--------------------+         +--------------------+
```

### 1. Model Context Protocol (MCP) Interface
The MCP interface provides standard Model Context Protocol access for compatible clients (including Claude, Cursor, Copilot CLI, Gemini, Kiro, Windsurf, Antigravity, and others). Clients can connect via:
- **Hosted Streamable HTTP**: Direct cloud connection to `https://xmemo.dev/mcp` with Bearer token authentication or browser-based MCP OAuth.
- **Local Stdio Proxy (`xmemo-mcp`)**: A local proxy server bundled in `@xmemo/client` that exposes standard stdio MCP while forwarding calls to the hosted service without embedding plaintext tokens in client configuration.

For complete connection guides and configuration recipes, see the [MCP Overview](https://docs.xmemo.dev/docs/mcp/overview).

### 2. XMemo CLI (`@xmemo/client`)
The official command-line interface provides setup recipes, configuration management, connectivity diagnostics (`doctor`, `status`), and direct memory commands (such as `remember`, `recall`, `context recall`, and `state`).

### 3. Public REST API Surface
A public REST API surface (`/v1`) allows programmatic access for custom applications, background orchestrators, and automated pipelines. Details on authentication and endpoints are documented at [REST API Authentication](https://docs.xmemo.dev/docs/api/authentication).

### 4. Agent Skills & Native Plugins
- **XMemo Skill (`@xmemo/skill`)**: A specialized agent skill for autonomous runtimes (e.g. ClawHub, SkillHub, Claude Code, and Codex).
- **Native Host Plugins**: Dedicated integrations for platforms such as OpenClaw, Hermes, and DeepSeek DSH.

### 5. Hosted Service vs. Local Distribution
This repository contains XMemo's public client (`@xmemo/client`), MCP distribution, skills, plugins, client integration logic, and marketplace metadata. The hosted XMemo service implementation is private.

---

## Primary Use Cases

1. **Project Context & Architecture**: Retaining persistent architectural decisions, coding standards, and repository conventions across sessions.
2. **Coding Preferences**: Preserving developer-specific workflows, style preferences, and tool configurations without re-prompting.
3. **Cross-Session TODO Tracking**: Maintaining actionable task items and follow-ups linked to project memories across agent restarts.
4. **Durable Decisions**: Recording why technical choices were adopted to avoid repeated debates and regressions.
5. **Knowledge Retrieval & Recall**: Querying relevant operational facts and retrieving structured, token-bounded context packs.

---

## Identity & Provenance

XMemo treats agent identity and provenance as first-class primitives:
- **Agent Identity**: Distinguishes between different agents and tools through structured identity headers. Learn more at [Agent Identity](https://docs.xmemo.dev/docs/concepts/agent-identity).
- **Instance Attribution**: Non-sensitive device UUIDs (`XMEMO_AGENT_INSTANCE_ID`) attribute operations to specific local workstations without exposing personal credentials.
- **Memory Provenance**: Memories record origin attribution, creation timestamps, and contextual sources. See [Provenance & Attribution](https://docs.xmemo.dev/docs/concepts/provenance-attribution).

---

## Security, Privacy & Governance

- **Privacy by Default**: The CLI and `xmemo-mcp` stdio proxy send no telemetry or usage analytics. Generated client configurations reference environment variables rather than embedding plaintext credentials.
- **Governed Access**: Granular token scopes restrict capabilities to authorized operations. Soft-deletion and permanent purge mechanisms give users full ownership of their data.
- **Data Boundary**: Specifications for cloud storage, data handling, and encryption are documented at [Data Boundary & Security](https://docs.xmemo.dev/docs/security/data-boundary).
- **Retention Policies**: Administrative retention rules and governance procedures are documented at [Governance & Retention](https://docs.xmemo.dev/docs/concepts/governance-retention).
