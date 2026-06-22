---
name: xmemo-memory
description: Persistent, user-owned memory for AI agents over hosted MCP. Use when an agent should remember decisions, recall project context, manage TODOs, preserve handoff state, or govern memory lifecycle across sessions and tools.
---

# XMemo Memory

Give your agent durable memory that survives across sessions, projects, and tools. XMemo is a hosted MCP memory service; no local database or self-hosting is required.

A Skill alone teaches the agent when and how to use memory. Real memory read/write requires the XMemo MCP server and user authorization.

## Required connection

For full functionality, connect the XMemo MCP server:

```text
https://xmemo.dev/mcp
```

Use one of these auth paths:

- OAuth, when the MCP client or marketplace supports browser authorization.
- Bearer token, when the client asks for an API key or request header.

To get a bearer token:

1. Visit https://xmemo.dev and sign in.
2. Open the Memory Console.
3. Go to API Keys: https://xmemo.dev/me#api-keys
4. Create a scoped API key.
5. When the MCP client asks for authorization, use the full header value:

```text
Authorization: Bearer <XMEMO_KEY>
```

If the client has a dedicated "Bearer Token" or "API Key" field and automatically adds the `Bearer` prefix, paste only the raw `XMEMO_KEY`. If the client asks for a request header value, paste the full `Bearer <XMEMO_KEY>` value.

Optional attribution headers can help XMemo show where a memory came from:

```text
X-Memory-OS-Agent-ID: <client-or-agent-name>
X-Memory-OS-Agent-Instance-ID: <stable-non-secret-instance-id>
```

These attribution headers are not credentials. They are optional, non-secret labels for audit and provenance. Do not put API keys, email addresses, phone numbers, real names, OAuth codes, or other sensitive values in them.

## When to use

Use XMemo when:

- The task depends on prior decisions, preferences, project context, or handoff state.
- The user asks to remember something for later.
- The agent is about to make an architecture, product, release, or security decision that prior memory could affect.
- The user wants TODOs, reminders, milestones, or follow-ups tracked across sessions.
- Multiple agents or clients need a shared but governed project memory trail.

## Workflow

1. **Recall before assuming.** For non-trivial work, call `recall_context`, `recall`, or `search_memory` with the current repo, project, task, and subsystem before making decisions.
2. **Use the result carefully.** Treat recalled memories as context, not as proof that current files, production state, or external services are unchanged. Verify drift-prone facts when correctness matters.
3. **Save what matters.** Store durable facts: decisions, conventions, preferences, architecture notes, release procedures, action items, and handoff state. Skip transient chat and noisy debugging output.
4. **Preserve handoffs.** At milestones or before stopping, use timeline/TODO/snapshot tools such as `record_event`, `create_memory_todo`, or `create_restart_snapshot` when available.
5. **Govern changes.** Use `explain_memory`, `memory_activity`, `forget_memory`, `redact_memory`, and conflict/version tools when the user asks why a memory exists, what changed, or how to remove or correct something.
6. **Confirm destructive actions.** Always confirm the exact target before delete, forget, redact, overwrite, or broad cleanup operations.
7. **On auth failure**, tell the user to reconnect XMemo with OAuth or create an API key at https://xmemo.dev/me#api-keys. Never request raw tokens in chat.

## Available tools

Core memory operations provided by the XMemo MCP server:

| Tool | Purpose |
|------|---------|
| `remember` | Save a new durable memory |
| `recall` / `recall_context` | Retrieve relevant memories before answering or acting |
| `search_memory` | Search memories by query |
| `update_memory` | Revise existing memory content or metadata |
| `forget` / `forget_memory` | Delete or hide a memory |
| `redact_memory` | Remove sensitive content while keeping an audit trail |
| `explain_memory` | Show why a memory exists or matched a query |
| `memory_activity` | Inspect recent writes, reads, deletions, and changes |
| `create_memory_todo` | Create a follow-up task |
| `list_memory_todos` | List pending TODOs |
| `complete_memory_todo` | Mark a TODO done |
| `record_event` | Log a milestone, decision, or handoff event |
| `get_timeline` | Show recent events |
| `create_restart_snapshot` | Save active work state for future sessions |
| `restore_restart_snapshot` | Resume from saved work state |
| `add_expense` | Record a ledger entry when the user states a concrete expense |

Some deployments expose only a subset of tools depending on OAuth scopes, marketplace policy, or client capability. If a tool is missing, use the closest available safe workflow and explain the limitation briefly.

## Good memory candidates

- Repository conventions, build/test/deploy commands, and verified troubleshooting steps.
- Architecture decisions, product decisions, release procedures, and their rationale.
- User-approved preferences for code review, testing, documentation, or UX.
- Project TODOs, blockers, risks, and handoff summaries for future sessions.
- Bug fix context that might recur.

## Never save

- Secrets, tokens, API keys, OAuth codes, cookies, session IDs, or private keys.
- Private customer data or sensitive personal data unless the user explicitly asks and the memory tool supports the required privacy policy.
- Temporary debugging output that will not help future work.
- Large code blocks; link to files, commits, or concise summaries instead.

## Safety

- Keep `XMEMO_KEY` private. Do not paste it into public prompts, screenshots, repositories, issue comments, marketplace metadata, or shared logs.
- Use synthetic data for marketplace demos and screenshots.
- Treat `X-Memory-OS-Agent-ID` and `X-Memory-OS-Agent-Instance-ID` as attribution only, not authorization proof.
- Do not claim a marketplace integration is certified unless there is explicit approval evidence for that marketplace.
