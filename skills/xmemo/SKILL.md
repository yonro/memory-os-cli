---
name: xmemo-memory
description: Persistent, user-owned memory for AI agents over hosted MCP. Remember decisions, recall project context, manage TODOs, and govern memory lifecycle across sessions and tools.
mcp_endpoint: https://xmemo.dev/mcp
auth: oauth or XMEMO_KEY environment variable
homepage: https://xmemo.dev
---

# XMemo Memory

Give your agent durable memory that survives across sessions, projects, and tools. XMemo is a hosted MCP memory service — no local database, no self-hosting required.

## When to use

- The task depends on prior decisions, preferences, or project context.
- The user asks to remember something for later.
- You need to recall conventions, architecture notes, or past fixes before acting.
- The user wants TODOs, reminders, or follow-ups tracked across sessions.

## Workflow

1. **Recall before assuming.** Search or recall XMemo context before making decisions that prior memory could inform.
2. **Save what matters.** Store durable facts: decisions, conventions, preferences, architecture notes, action items. Skip transient chat.
3. **Keep it concise.** One clear memory per concept. Prefer structured facts over verbose narratives.
4. **Confirm before destroying.** Always confirm the exact target before delete, forget, or overwrite operations.
5. **On auth failure**, tell the user: "Visit https://xmemo.dev to sign in and get your token, or run `xmemo login` if the CLI is installed. Set `XMEMO_KEY` environment variable." Never request raw tokens in chat.

## Available tools

Core memory operations provided by the XMemo MCP server:

| Tool | Purpose |
|------|---------|
| `remember` | Save a new memory |
| `recall` / `recall_context` | Retrieve relevant memories before answering |
| `search_memory` | Search by query |
| `update_memory` | Revise existing memory |
| `forget` / `forget_memory` | Delete a memory |
| `redact_memory` | Remove sensitive content while keeping audit trail |
| `explain_memory` | Show why a memory exists or matched |
| `create_memory_todo` | Create a follow-up task |
| `list_memory_todos` | List pending TODOs |
| `complete_memory_todo` | Mark a TODO done |
| `record_event` | Log a milestone or decision |
| `get_timeline` | Show recent events |
| `add_expense` | Record a ledger entry |

## Good memory candidates

- Repository conventions, build/test/deploy commands.
- Architecture decisions and their rationale.
- Coding style preferences approved by the user.
- Release procedures and deployment notes.
- TODOs and follow-ups for future sessions.
- Bug fix context that might recur.

## Never save

- Secrets, tokens, API keys, OAuth codes, cookies.
- Private customer data or sensitive PII.
- Temporary debugging output.
- Large code blocks (link to files instead).
