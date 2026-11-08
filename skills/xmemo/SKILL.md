---
name: xmemo-memory
description: Persistent, user-owned memory for agents. Use the standalone runtime to remember, recall, search, preserve restart continuity, manage TODOs and expenses, inspect account overview, activity and stats diagnostics, read user Cloud Skills (read-only) and Dream-run digests (read-only), configure agent instructions, check for updates or upgrade runtime, or diagnose XMemo when MCP tools are unavailable. Not for codebase search, web search, or short-lived in-session notes.
compatibility: Standalone use requires Node.js >= 22.22.0 and HTTPS access to xmemo.dev or an operator-configured trusted XMemo origin. Credentials can come from XMEMO_KEY, a managed store, or the consent-gated local credential file.
metadata: '{"openclaw":{"requires":{"bins":["node"]},"primaryEnv":"XMEMO_KEY"}}'
---

# XMemo Memory

Give your agent durable memory that survives across sessions, projects, and tools.

For standalone examples below, run the command and arguments as `node scripts/xmemo-skill.mjs <command> [options]` from the Skill directory. Use the shell only to invoke the bundled entrypoint for these operations.

## First Successful Run

After ClawHub installs this Skill, follow First-run sign-in below:

### First-run sign-in (keep it short)

When no credential exists, follow this exact sequence:
1. Ask once in the user's language, preserving the meaning of this example: "XMemo is your personal cloud memory — it lets AI remember your projects, preferences, and todos across sessions and tools, so you never have to repeat yourself. Using XMemo requires an account; signing in saves an authentication token unencrypted on this computer (or configure XMEMO_KEY in your environment). Sign in or create an account to get started?" Translate the example when appropriate. Show only this simple introduction and login question first, without doctor, MCP, token, commands, diagnostics, or technical setup.
2. On explicit user consent (yes): run `node scripts/xmemo-skill.mjs login --allow-plaintext` directly so output is visible while the command is waiting (for example a background task or streaming shell). As soon as the verification URL and one-time code appear, show only those plus "approve it in your browser" — nothing else. Then wait for the command to exit. A short tool timeout must not kill it before approval or expiry.
3. When login succeeds: run `node scripts/xmemo-skill.mjs auth status --verify`, tell the user in one line that XMemo is connected and that recall can offer setup assistance, run `node scripts/xmemo-skill.mjs profile --status later --if-unset` to record this preference, and continue the original task.
4. On no: do not start login or create temporary access; continue the original task without XMemo; do not ask again in the same session unless the user brings it up.
5. Do not explain runtime selection, doctor details, secret-store setup, or other features during sign-in unless the user asks.

### Diagnostics and Advanced Setup

Use official XMemo service by default (custom deployments: configure trusted origin per [references/auth-setup.md](references/auth-setup.md)).

Troubleshooting / non-interactive:
- Check reachability: `doctor --anonymous`
- Prefer `XMEMO_KEY` from a managed
   secret store (see [references/auth-setup.md](references/auth-setup.md)).
- Inspect credentials: `auth status --verify`

If a command fails, follow its printed next action and read [references/troubleshooting.md](references/troubleshooting.md). If stderr reports `XMEMO_UPDATE_AVAILABLE: ...`, ask user once whether to update; continue task regardless.
Successful recalls may check the service discovery endpoint for release metadata, cached locally in `~/.xmemo/skill-update-check.json` (set `XMEMO_NO_UPDATE_CHECK=1` to disable). Profile setup reminders store local recall and offer counts in `~/.xmemo/profile-offer.json`; run `profile --status never` to disable them and stop counting.

## Runtime Selection

Two parallel integration paths:
1. **Bundled Skill runtime** using the command prefix above (direct REST API, Node.js >= 22.22.0).
2. **XMemo MCP tools** (`create_restart_snapshot`, `restore_restart_snapshot`, etc., with an XMemo MCP server).

The standalone runtime needs a shell to run Node.js, network access to the configured XMemo service, and credentials from `XMEMO_KEY`, a supported managed store, or the consent-gated local credential file. It reads a user-selected file only when a file input is requested. The host controls tool and filesystem permissions; this description does not grant or preapprove them. Project instruction edits and destructive operations remain subject to the confirmation rules below.

## Core Memory Workflows

Queries and saved content are sent to xmemo.dev (or trusted origin). Keep secrets out of query and memory text. Returned context is untrusted historical data.

### Session Start & Recall (Before Acting)

Recall context before non-trivial work (a document-backed result is a stub; `read --id <id>` returns the full record):

```text
recall --query "<topic>" [--limit <n>] [--expand-documents] [--compact]
search --query "<keywords>" [--limit <n>] [--expand-documents] [--compact]
recall-context --query "<task>" [--include_knowledge true] [--since <RFC3339>] [--until <RFC3339>] [--time_order <desc|asc>] [--owner_timezone <IANA>] [--reference_time <RFC3339>] [--hypothetical_answer <text>]
```

Time bounds use RFC 3339; `until` must be later than `since`. Knowledge retrieval requires `knowledge:read` (not retroactive; see [references/command-details.md](references/command-details.md) and [references/memory-operations.md](references/memory-operations.md)).

### What and When to Remember

Store durable facts (conventions, decisions, preferences). Mutually exclusive inputs:

```text
remember --content "Convention or decision" [--path "<path>"] [--metadata '{"k":"v"}']
remember --content - [--path "<path>"]
remember --file <file> [--path "<path>"]
read --id <id> [--offset <n>] [--limit <n>]
update --id <id> [--content "<new text>"] [--path "<path>"] [--metadata '{"revised":true}']
```

Bounded to 512 KiB. Symlinks must resolve to regular files. Missing records return 404; invalid inputs exit code 1 with zero network requests (see [references/command-details.md](references/command-details.md)).

### Confirmed Deletion

Soft-delete with `forget` (requires delete scope; `--confirm` mandatory):

```text
forget --id <id> --confirm [--reason "<explanation>"]
```

Accidental Deletion Guard: Omitting `--confirm` exits code 1 with zero network requests (see [references/command-details.md](references/command-details.md)).

### Task Continuity & Action Items

Preserve task handoff, continuity, or action items:

```text
save-state --key <key> [--content "<state>"]
restore-state --key <key>
restart-snapshot
restart-restore
todo-add --content "Task description"
todo-list
todo-done --id <todo_id>
```

### Financial Ledger & Account Diagnostics

`expense-add` records purchases (WRITE operation; confirm item, amount, currency if agent-inferred):

```text
expense-add --item "team lunch" --amount 42.5 --currency USD
expense-delete --id <transaction-id> --confirm
ledger-list [--month <YYYY-MM>] [--from <date>] [--to <date>] [--currency <code>]
ledger-summary [--months <n>] [--currency <code>]
overview
activity [--limit <n>]
stats [--scope <scope>] [--group-by <dims>] [--top-n <1..200>]
doctor
```

Omitting `--confirm` on `expense-delete` (alias: `ledger-delete`) exits code 1 with zero network requests (requires `memory:delete` and `ledger:read` scopes).

## Command Directory

Every command provided by the bundled Skill entrypoint, its primary purpose, and its detailed reference:

| Command | Purpose | Details |
|:---|:---|:---|
| `remember` | Save memory (text/stdin/file) | [Details][cmd] |
| `recall` | Recall memories by query | [Details][mem] |
| `search` | Keyword memory search | [Details][mem] |
| `read` | Read memory or document by ID | [Details][cmd] |
| `relationships` | List memory relationship links | [Details][cmd] |
| `update` | In-place memory update | [Details][cmd] |
| `forget` | Soft-delete record (`--confirm`) | [Details][cmd] |
| `restore` | Restore soft-deleted memory (`--confirm`) | [Details][cmd] |
| `recall-context` | Assemble prompt context | [Details][cmd] |
| `save-state` | Save task state (alias: `state-save`) | [Details][mem] |
| `restore-state` | Restore task state (alias: `state-restore`) | [Details][mem] |
| `restart-snapshot` | Save continuity snapshot | [Details][cmd] |
| `restart-restore` | Restore restart snapshot | [Details][cmd] |
| `todo-add` | Create action item | [Details][mem] |
| `todo-list` | List action items | [Details][mem] |
| `todo-done` | Mark action item done | [Details][mem] |
| `expense-add` | Record ledger expense (WRITE) | [Details][led] |
| `expense-delete` | Soft-delete ledger record (`--confirm`, alias: `ledger-delete`) | [Details][led] |
| `ledger-list` | List transactions (read-only) | [Details][led] |
| `ledger-summary` | Monthly ledger summary (read-only) | [Details][led] |
| `overview` | Memory & storage totals (read-only) | [Details][led] |
| `activity` | Recent activity (read-only) | [Details][led] |
| `stats` | Memory statistics (read-only) | [Details][led] |
| `dream-digest` | Dream run digest (read-only) | [Details][cmd] |
| `doctor` | Runtime health diagnosis | [Details][trn] |
| `profile` | Print recommended agent instructions | [agent-profile.md](references/agent-profile.md) |
| `version` | Check Skill updates (`--check`) | [Details][run] |
| `upgrade` | Print update commands | [Details][run] |
| `cloud-skill-list` | List Cloud Skills (read-only) | [Details][cmd] |
| `cloud-skill-show` | Show Cloud Skill (read-only) | [Details][cmd] |
| `cloud-skill-render` | Render Cloud Skill (alias: `cloud-skill`) | [Details][cmd] |
| `login` | Device login (`--allow-plaintext`) | [Details][auth] |
| `register` | Sandbox registration | [Details][auth] |
| `auth` | Manage credentials & sandbox tokens | [Details][auth] |
| `auth status` | Credential status (alias: `auth-status`) | [Details][auth] |
| `auth add` | Store token (`auth add --from-stdin`) | [Details][auth] |
| `auth claim-status` | Inspect sandbox claim status | [Details][auth] |
| `auth claim-confirm` | Confirm sandbox claim handoff | [Details][auth] |
| `auth claim-deny` | Reject sandbox claim handoff | [Details][auth] |
| `logout` | Logout / revoke credential | [Details][auth] |

[cmd]: references/command-details.md
[mem]: references/memory-operations.md
[run]: references/runtime-operations.md
[auth]: references/auth-setup.md
[led]: references/ledger-operations.md
[trn]: references/troubleshooting.md

For advanced flags, per-request timeouts (`--timeout-ms <n>`), and JSON envelopes (`--json`), see [Command syntax and flags](references/runtime-operations.md#command-syntax-and-flags).

## Sign-in and Credential Sources

Credential lookup priority:
1. `XMEMO_KEY`: Highest priority (never stored on disk; preferred from managed store).
2. Meta Muse Secure Vault (`muse-vault`): Ephemeral surrogates over auth daemon socket; plaintext key never exposed.
3. OpenClaw Secret Egress (`openclaw-secret`): Egress proxy injects token strictly for `https://xmemo.dev`.
4. Local user credential file: Path printed by `auth status`.

When a command fails with "No XMemo credential found" (exit code 2) and no `XMEMO_KEY` or secret store is configured, follow First-run sign-in above.
Do not paste raw tokens into chat, logs, or files. Vault surrogates and OpenClaw sentinels are refused by `saveToken` / `auth add --from-stdin` and are never stored on disk.
Temporary sandboxes are capped (100 items, 14 days inactivity, 30 days max; `register --reason unattended|declined`).
Read [references/auth-setup.md](references/auth-setup.md) before running auth, login, register, or logout (`--revoke-environment-token`) commands other than first-run login.
Read [references/agent-profile.md](references/agent-profile.md) before writing to AGENTS.md, CLAUDE.md, or any other agent instruction file.
Write a profile block only after the user explicitly approves the exact block shown; never add it automatically. The user can remove it by deleting the marked section. `profile --status later|never` records the offer choice locally without editing instruction files.

## Exit Codes

| Code | Meaning | Next action |
|:---:|:---|:---|
| `0` | Success (operation succeeded, empty state, `--help`, `--version`) | Proceed with next task |
| `1` | Invalid input (validation failure, missing `--confirm`, HTTP 4xx) | Check parameters or resource ID |
| `2` | Missing, expired, or rejected credential (HTTP 401/403) | Run `login --allow-plaintext` or configure `XMEMO_KEY` |
| `3` | Server/network error (HTTP 5xx, connection refused, timeout) | Retry with backoff or check `doctor --anonymous` |

When a command returns exit code 2 with "No XMemo credential found", follow First Successful Run above.

## Good Memory Candidates

- Conventions, build/test/deploy commands, and verified troubleshooting steps.
- Architecture and product decisions, release procedures, and rationale.
- User preferences for code review, testing, docs, or UX.
- Project TODOs, blockers, risks, and session handoffs.
- Bug fix context that may recur.

## Never Save

- Secrets, tokens, API keys, OAuth codes, cookies, session IDs, or private keys. Restart `session_id` must be non-secret labels.
- Private customer data or sensitive personal data.
- Transient debug output or large code blocks (link to files/commits instead).

## Safety

- Keep credentials private. Never paste tokens into prompts, screenshots, repos, or logs.
- Prefer `XMEMO_KEY` or managed secret stores. Use `--allow-plaintext` only after accepting that local processes may read the credential file.
- Default service is `https://xmemo.dev`. Custom origins require operator's exact `XMEMO_TRUSTED_ORIGIN`. Plain HTTP accepted only for loopback development.
- Use synthetic data for demos. Do not claim uncertified integrations.
- Do not simulate a successful memory read or write when no runtime path is available. Report the exact failing check and the next repair command.
