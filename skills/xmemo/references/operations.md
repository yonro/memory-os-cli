# XMemo Skill Operations

This reference describes the standalone operational commands provided by the
bundled `xmemo` Skill. This is the primary standalone runtime for direct REST access.

## Contents

- Runtime selection
- Account policy and temporary fallback
- Command matrix
- Examples
- Direct execution details
- Output and terminal safety
- Limitations

## Runtime Selection

XMemo supports two parallel integration paths:

1. **Bundled Skill script** (`node scripts/xmemo-skill.mjs <command>`), which directly integrates with the XMemo REST API using stored credentials. Run commands from the Skill root with Node.js 20 or newer.
2. **XMemo MCP tools** (when running in environments that natively host the XMemo MCP server).

Credential resolution is `XMEMO_KEY` first, then the user-scoped credential
file. An environment token is never copied into that file. If no credential is
available, the script reports the formal login or token-add repair path. Never
paste a raw token into chat.

The zero-dependency runtime cannot provide one portable operating-system
keychain implementation. Commands that create or replace a local credential
therefore require `--allow-plaintext`. This flag explicitly permits an
unencrypted user-file credential; the script prints a warning and applies
private POSIX permissions where supported. Prefer `XMEMO_KEY` or a managed
secret store when this local trust boundary is not acceptable.

## Account policy and temporary fallback

Use `login` or `auth add` by default. They provide a formal, account-backed
credential and the full command set. Do not automatically choose a temporary
token just because it is convenient.

Only use the fallback after the human explicitly declines formal registration,
or in unattended automation with no human available:

```text
node scripts/xmemo-skill.mjs register --reason declined --allow-plaintext
node scripts/xmemo-skill.mjs register --reason unattended --allow-plaintext
```

The fallback stores its token in the explicitly approved user credential file and can use only
`remember`, `recall`, and `search` in an isolated temporary memory space. Show
the returned bind URL only to the intended user; do not publish or log it. After
their web claim, complete the
one-time formal-token handoff with:

```text
node scripts/xmemo-skill.mjs auth claim-status
node scripts/xmemo-skill.mjs auth claim-confirm
```

For a legacy temporary credential that predates recorded consent, append
`--allow-plaintext` to the claim command once. Successful handoff overwrites the
temporary credential and removes pending confirmation data.

## Command matrix

| Skill script | Purpose |
|--------------|---------|
| `remember` | Save a durable memory |
| `recall` | Recall the most relevant memories |
| `search` | Search memories by query |
| `save-state` | Save current task handoff state |
| `restore-state` | Restore current task handoff state |
| `todo-add` | Create a TODO item |
| `todo-list` | List TODO items |
| `todo-done` | Mark a TODO done |
| `expense-add` | Record a ledger expense |
| `doctor` | Check service health and auth status; add `--anonymous` to omit credentials |
| `logout` | Revoke/remove a local credential; externally managed `XMEMO_KEY` requires explicit revocation |

## Examples

### Remember a decision

```text
node scripts/xmemo-skill.mjs remember --content "Use pnpm for package management in this repo" --path "projects/memory-os-cli/conventions"
```

### Recall before acting

```text
node scripts/xmemo-skill.mjs recall --query "package manager convention for memory-os-cli" --compact
```

### Save handoff state

```text
node scripts/xmemo-skill.mjs save-state --key active_task
```

### Restore handoff state

```text
node scripts/xmemo-skill.mjs restore-state --key active_task
```

### Add a TODO

```text
node scripts/xmemo-skill.mjs todo-add --content "Add unit tests for ledger expense command"
```

### Record an expense

```text
node scripts/xmemo-skill.mjs expense-add --item "team lunch" --amount 42.5 --currency USD
```

### Add an existing token without command-line exposure

POSIX shell:

```text
printf '%s' "$XMEMO_KEY" | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

PowerShell:

```powershell
$env:XMEMO_KEY | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

## Direct Skill execution details

Use the bundled script or an available XMemo MCP/native integration. Do not
improvise REST calls when the Skill artifact is missing; restore the package or
use the documented hosted MCP path so authentication, redaction, and argument
validation remain intact.

## Output and terminal safety

`remember` and `expense-add` print the server-returned memory or ledger ID.
`recall` and `search` accept `--compact` to render each memory on one shortened
line; use `--json` when a caller needs the complete redacted response payload.
Human-readable output removes terminal control sequences. For the exact accepted
parameters of any command, run
`node scripts/xmemo-skill.mjs <command> --help`; use `--version` to identify the
runtime and `--timeout-ms <ms>` to bound each network request.

## Limitations

- The commands call the hosted endpoints on `xmemo.dev`. They require a network connection and a valid credential.
- Custom HTTPS origins are supported and receive the credential used by
  authenticated commands. Use only trusted origins. Plain HTTP is accepted only
  for localhost/loopback development.
- Responses larger than 8 MiB are rejected, and requests default to a 30-second
  timeout.
- `save-state` / `restore-state` map to `update_state` / `_get_active_state_item` under the hood; they capture/resume server-side active task state.
- Offline memory storage or local sync is not implemented.
