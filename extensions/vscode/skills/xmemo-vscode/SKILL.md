---
name: xmemo-vscode
description: Use XMemo from VS Code (and forks like Cursor/Windsurf) to recall project context, capture engineering decisions, preserve handoff state, and connect to the hosted XMemo MCP endpoint safely.
---

# XMemo for VS Code

Use this skill when an editor task should use XMemo memory: restore project context, save durable decisions, record working state, or prepare a clean handoff.

## Core positioning

Your editor executes development. XMemo lets it remember the project.

XMemo is a user-owned, identity-aware memory layer for multi-agent workflows. It carries useful project context, decisions, preferences, and progress across ChatGPT, Codex, Claude, Cursor, Copilot, Gemini, IDEs, CLIs, and other agents.

## Connection

Hosted MCP endpoint: `https://xmemo.dev/mcp`

The extension authenticates with a token stored in the OS keychain (VS Code `SecretStorage`) and attributes activity with:

- `X-Memory-OS-Agent-ID: vscode`
- `X-Memory-OS-Agent-Instance-ID: <local-instance-id>`

OAuth 2.0 (PKCE) in-editor sign-in is the default; token paste is a documented fallback for power users.

## Memory workflow

At task start: recall focused context for the current repo/subsystem/task; restore a restart snapshot if continuing prior work; fall back to repository evidence if XMemo is unavailable.

During architecture/integration work: capture pending decisions before major tradeoffs; resolve them after implementation or explicit confirmation; save only durable conclusions, not noisy intermediate reasoning.

At handoff: update working state (what changed, what was verified, what remains); create memory TODOs for concrete follow-ups; create a restart snapshot when work is incomplete.

## Safety rules

- Never commit tokens, OAuth codes, cookies, or session secrets.
- Treat `X-Memory-OS-Agent-ID` and instance ID as non-secret attribution metadata, not authentication.
- Keep recall scoped to the user's request.
- Use synthetic memory data for review demos and screenshots.
