---
name: xmemo-memory
description: Persistent user-owned memory for agents with standalone runtime execution. Use when an agent should remember, recall, search memory, save or restore handoff state, manage TODOs, record expenses, diagnose XMemo auth, or operate XMemo even when MCP tools are not configured.
---

# XMemo Memory

Give your agent durable memory that survives across sessions, projects, and tools.

## Runtime Selection

XMemo supports two parallel integration paths:

1. **Bundled Skill script** at `scripts/xmemo-skill.mjs` (primary standalone direct REST API integration, fully self-contained and zero-dependency).
2. **XMemo MCP tools** (when running in environments that natively host the XMemo MCP server).

Credential lookup always prefers the `XMEMO_KEY` environment variable. When it
is present, the script does not copy its value into a local credential file.

If no credential is available, use formal account login (recommended):

```text
node scripts/xmemo-skill.mjs login --allow-plaintext
```

New users should create or sign in to an XMemo account at `https://xmemo.dev`.
The `login` command opens the hosted device-login page and shows a one-time
code; approve that code in the browser account session to issue the Skill's
scoped `skill_token`.

The standalone zero-dependency script has no cross-platform operating-system
keychain integration. `--allow-plaintext` is therefore an explicit decision to
store the issued token unencrypted in the current user's XMemo directory so
later commands can use it. The script prints the exact path, restricts POSIX
permissions where supported, never prints the token, and never writes it into
the project. Prefer `XMEMO_KEY` or a managed secret store when plaintext local
storage is not acceptable.

Formal registration/login is the default and recommended path. It gives the
user account-backed memory and the full command set.

Only when no human can complete login (`unattended`) or the human explicitly
declines registration for now (`declined`), use the explicit temporary fallback:

```text
node scripts/xmemo-skill.mjs register --reason unattended --allow-plaintext
```

Temporary access is an isolated, limited memory sandbox. It only supports
`remember`, `recall`, and `search`; show the returned bind URL to the user and
do not share that URL publicly. Run
`node scripts/xmemo-skill.mjs auth claim-confirm` after they claim it. Temporary
and pending-confirmation values inherit the same explicit plaintext-storage
consent and are replaced or cleared during formal-token handoff.

or, if you already have a token:

```text
echo "TOKEN_VALUE" | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
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
node scripts/xmemo-skill.mjs remember --content "..." --path "..."
node scripts/xmemo-skill.mjs recall --query "..." --compact
node scripts/xmemo-skill.mjs search --query "..." --limit 5 --compact
node scripts/xmemo-skill.mjs save-state --key active_task
node scripts/xmemo-skill.mjs restore-state --key active_task
node scripts/xmemo-skill.mjs todo-add --content "..."
node scripts/xmemo-skill.mjs todo-list
node scripts/xmemo-skill.mjs todo-done --id <todo_id>
node scripts/xmemo-skill.mjs expense-add --item "..." --amount 12.5 --currency USD
node scripts/xmemo-skill.mjs doctor
node scripts/xmemo-skill.mjs register --reason <unattended|declined> --allow-plaintext
```

The script supports JSON output with `--json`, command-specific usage with `--help`, and compact recall/search output with `--compact`. It never prints token values.

## Direct CLI Commands

The Skill script handles all operations directly, including status checks and token management:

```text
node scripts/xmemo-skill.mjs auth status [--verify]
node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
node scripts/xmemo-skill.mjs auth claim-status [--allow-plaintext]
node scripts/xmemo-skill.mjs auth claim-confirm [--allow-plaintext]
node scripts/xmemo-skill.mjs logout
node scripts/xmemo-skill.mjs doctor
```

## Setup And Repair

If the bundled script reports auth or service errors, use the Skill diagnostics command:

```text
node scripts/xmemo-skill.mjs doctor
node scripts/xmemo-skill.mjs auth status --verify
node scripts/xmemo-skill.mjs auth claim-status
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
- Prefer `XMEMO_KEY` or a managed secret store. Use `--allow-plaintext` only
  after accepting that processes running as the same operating-system user may
  read the local credential file.
- Use synthetic data for marketplace demos and screenshots.
- Do not claim a marketplace integration is certified unless there is explicit
  approval evidence for that marketplace.
- Do not simulate a successful memory read or write when no runtime path is
  available. Report the exact failing check and the next repair command.
