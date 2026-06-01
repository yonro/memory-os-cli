---
name: xmemo-memory
description: Use XMemo's hosted MCP memory tools for durable context, project preferences, decisions, reminders, and cross-session recall in Cursor.
---

# XMemo Memory

Use this skill when the task may depend on prior memory, durable project context, coding preferences, decisions, or follow-up actions.

## Workflow

1. Recall first when prior context could change the answer. Use XMemo search/recall/context tools before making assumptions about preferences or past decisions.
2. Save only durable information that the user asks to remember or that is clearly useful across future Cursor sessions.
3. Keep memory content concise, scoped, and useful. Prefer concrete facts, decisions, links to public docs, and action items over chat transcripts.
4. For destructive memory actions, confirm the exact target before deleting, forgetting, or overwriting.
5. If authorization is missing or expired, ask the user to reconnect XMemo through Cursor's OAuth flow. Do not request raw bearer tokens in chat.

## Good memory candidates

- Repository conventions and verified commands.
- Architecture decisions, release procedures, and deployment notes.
- User-approved preferences for code review, testing, documentation, or UX.
- TODOs and follow-ups that should be visible to future agents.

## Avoid saving

- Secrets, credentials, OAuth codes, cookies, API keys, or token prefixes.
- Private customer data or sensitive personal data.
- Temporary debugging output that will not help future work.
