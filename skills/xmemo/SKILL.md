---
name: xmemo-memory
description: Persistent user-owned memory for agents with standalone runtime execution. Use when an agent should remember, recall, search, update, delete, save handoff state, manage TODOs, record expenses, diagnose XMemo auth, or operate XMemo even when MCP tools are not configured.
---

# XMemo Memory

Give your agent durable memory that survives across sessions, projects, and tools.

## Runtime Selection

XMemo supports two parallel integration paths:

1. **Bundled Skill script** at `skills/xmemo/scripts/xmemo-skill.mjs` (Primary standalone direct REST API integration, fully self-contained and zero-dependency).
2. **XMemo MCP tools** (when running in environments that natively host the XMemo MCP server).

If no credential is available, run:

```text
node skills/xmemo/scripts/xmemo-skill.mjs login
```

or, if you already have a token:

```text
echo "TOKEN_VALUE" | node skills/xmemo/scripts/xmemo-skill.mjs auth add --from-stdin
```

Never ask the user to paste a raw token into chat, logs, or project files.

## Core Workflows

- **Recall before non-trivial work.** Call `recall` or `search` with the repo,
  project, task, and subsystem before making decisions.
- **Remember durable facts.** Store decisions, conventions, preferences,
  architecture notes, release procedures, and verified troubleshooting steps.
- **Preserve handoffs.** Use `save-state` and `restore-state` at milestones or
  before stopping.
- **Record concrete expenses.** Use `expense-add` when the user states a concrete
  purchase or income.
- **Confirm destructive actions.** Always confirm the exact target before
  `forget`, overwrite, or broad cleanup operations.
- **Read provenance correctly.** `agent_id`, `agent_instance_id`, and
  `agent_boundary` are attribution signals, not authorization boundaries.

## Bundled Script Commands

```text
node skills/xmemo/scripts/xmemo-skill.mjs remember --content "..." --path "..."
node skills/xmemo/scripts/xmemo-skill.mjs recall --query "..."
node skills/xmemo/scripts/xmemo-skill.mjs search --query "..." --limit 5
node skills/xmemo/scripts/xmemo-skill.mjs save-state --key active_task
node skills/xmemo/scripts/xmemo-skill.mjs restore-state --key active_task
node skills/xmemo/scripts/xmemo-skill.mjs todo-add --content "..."
node skills/xmemo/scripts/xmemo-skill.mjs todo-list
node skills/xmemo/scripts/xmemo-skill.mjs todo-done --id <todo_id>
node skills/xmemo/scripts/xmemo-skill.mjs expense-add --item "..." --amount 12.5 --currency USD
node skills/xmemo/scripts/xmemo-skill.mjs doctor
```

The script supports JSON output with --json. It never prints token values.

## Direct CLI Commands

The Skill script handles all operations directly, including status checks and token management:

```text
node skills/xmemo/scripts/xmemo-skill.mjs auth status [--verify]
node skills/xmemo/scripts/xmemo-skill.mjs auth add --from-stdin
node skills/xmemo/scripts/xmemo-skill.mjs logout
node skills/xmemo/scripts/xmemo-skill.mjs doctor
```

## Setup And Repair

If the bundled script reports auth or service errors, use the Skill diagnostics command:

```text
node skills/xmemo/scripts/xmemo-skill.mjs doctor
node skills/xmemo/scripts/xmemo-skill.mjs auth status --verify
```

For detailed examples, read `references/operations.md`. For auth, network, and service diagnosis, read `references/troubleshooting.md`.

## Good Memory Candidates

- Repository conventions, build/test/deploy commands, and verified troubleshooting steps.
- Architecture decisions, product decisions, release procedures, and their rationale.
- User-approved preferences for code review, testing, documentation, or UX.
- Project TODOs, blockers, risks, and handoff summaries for future sessions.
- Bug fix context that might recur.

## Never Save

- Secrets, tokens, API keys, OAuth codes, cookies, session IDs, or private keys.
- Private customer data or sensitive personal data unless the user explicitly asks
  and the memory tool supports the required privacy policy.
- Temporary debugging output that will not help future work.
- Large code blocks; link to files, commits, or concise summaries instead.

## Safety

- Keep XMemo credentials private. Do not paste them into public prompts,
  screenshots, repositories, issue comments, marketplace metadata, or shared logs.
- Use synthetic data for marketplace demos and screenshots.
- Do not claim a marketplace integration is certified unless there is explicit
  approval evidence for that marketplace.
- Do not simulate a successful memory read or write when no runtime path is
  available. Report the exact failing check and the next repair command.
