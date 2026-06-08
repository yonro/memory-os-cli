# XMemo Kiro Power

XMemo gives Kiro a hosted, user-owned memory layer for durable project context, coding preferences, decisions, TODOs, and reusable agent knowledge.

## What it installs

- `mcp.json` adds the hosted XMemo MCP server at `https://xmemo.dev/mcp`.
- `assets/logo.svg` reuses the canonical XMemo marketplace icon source used by the existing ChatGPT/Claude listing assets.
- `steering/AGENTS.md` tells Kiro when to use XMemo memory.

## Authentication

The Kiro Power uses environment variable authentication due to a known Kiro IDE OAuth token persistence issue. The power metadata stores only the hosted MCP URL plus the `XMEMO_KEY` environment variable reference.

Users should authenticate with:

```bash
xmemo login
```

Then set the environment variable:

```bash
# PowerShell (persistent)
$token = xmemo token show --format raw
[Environment]::SetEnvironmentVariable("XMEMO_KEY", $token, "User")
```

Then restart Kiro for the environment variable to take effect.

Manual configuration is available through:

```bash
xmemo mcp config --client kiro --json
```

## Reviewer smoke prompts

1. "List the XMemo tools you can use in Kiro."
2. "Search XMemo for coding style preferences for this project."
3. "Remember in XMemo: For Kiro review, prefer small PRs with validation evidence."
4. "Recall what I saved about Kiro review PR preferences."
5. "Create a XMemo memory TODO to capture Kiro review screenshots tomorrow, then list my TODOs."

Use a dedicated reviewer workspace with synthetic data only. Redact emails, OAuth codes, cookies, bearer tokens, trace IDs, internal account IDs, real memory content, and private local paths from evidence.
