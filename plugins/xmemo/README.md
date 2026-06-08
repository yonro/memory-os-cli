# XMemo Cursor Plugin

XMemo gives Cursor a hosted, user-owned memory layer for durable project context, coding preferences, decisions, TODOs, and reusable agent knowledge.

## What it installs

- `mcp.json` adds the hosted XMemo MCP server at `https://xmemo.dev/mcp`.
- `assets/logo.svg` reuses the canonical XMemo marketplace icon source used by the existing ChatGPT/Claude listing assets.
- `rules/AGENTS.mdc` tells Cursor when to use XMemo memory.
- `skills/agents/SKILL.md` gives Cursor a safe workflow for recall, writes, TODOs, and destructive memory actions.

## Authentication

The marketplace plugin is OAuth-first. The plugin metadata stores only the hosted MCP URL; the first XMemo tool use should open the browser-based OAuth flow. Do not add `Authorization`, `Bearer`, or `XMEMO_KEY` to the marketplace `mcp.json`.

Manual direct-key fallback remains available through:

```bash
xmemo mcp config --client cursor --json
```

Use that fallback only for local/manual installs where Cursor OAuth is unavailable.

## Reviewer smoke prompts

1. "List the XMemo tools you can use in Cursor."
2. "Search XMemo for coding style preferences for this project."
3. "Remember in XMemo: For Cursor review, prefer small PRs with validation evidence."
4. "Recall what I saved about Cursor review PR preferences."
5. "Create a XMemo memory TODO to capture Cursor review screenshots tomorrow, then list my TODOs."

Use a dedicated reviewer workspace with synthetic data only. Redact emails, OAuth codes, cookies, bearer tokens, trace IDs, internal account IDs, real memory content, and private local paths from evidence.
