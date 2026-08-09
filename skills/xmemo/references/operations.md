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
the returned bind URL only to the intended user; do not publish or log it. The
script reads `/.well-known/xmemo-agent.json` and discloses the current cap and
expiry immediately after registration. The current policy is 100 items, expiry
after 14 days without successful memory activity, and an absolute maximum of
30 days from registration. Formal registration removes these sandbox limits.
After their web claim, complete the
one-time formal-token handoff with:

```text
node scripts/xmemo-skill.mjs auth claim-status
node scripts/xmemo-skill.mjs auth claim-confirm
```

If the user does not approve the pending bind, reject it as the temporary-token
holder and keep the isolated temporary credential:

```text
node scripts/xmemo-skill.mjs auth claim-deny
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
| `restart-snapshot` | Save active state, recent events, TODOs, and pending decisions as one restart snapshot |
| `restart-restore` | Restore the latest or a selected restart snapshot |
| `todo-add` | Create a TODO item |
| `todo-list` | List TODO items |
| `todo-done` | Mark a TODO done |
| `expense-add` | Record a ledger expense |
| `doctor` | Check service health and auth status; add `--anonymous` to omit credentials |
| `auth status` / `auth-status` | Show local auth state; add `--verify` for server validation |
| `auth claim-status` / `auth claim-confirm` / `auth claim-deny` | Inspect, approve, or reject the two-phase temporary bind |
| `logout` | Revoke/remove a local credential; externally managed `XMEMO_KEY` requires explicit revocation |

## Discovery boundary

The public `/.well-known/agent-discovery.json` operation list is a contract for
the generic `POST /v1/skill/operations` dispatcher. It intentionally does not
enumerate every direct standalone endpoint. In particular,
`restart-snapshot` and `restart-restore` use `/v1/restart/snapshot` and
`/v1/restart/restore` directly, so they do not appear in
`standalone_skill.operations`.

This is a routing boundary, not permission evidence. A formal account still
needs authorization for each restart request; an unauthenticated `401` only
proves that the protected route is reachable. Do not create a real snapshot
just to test a deployment. Temporary-agent discovery intentionally exposes no
restart workflow, and temporary credentials remain limited to `remember`,
`recall`, and `search`.

## Examples

### Remember a decision

```text
node scripts/xmemo-skill.mjs remember --content "Use pnpm for package management in this repo" --path "projects/memory-os-cli/conventions"
```

### Recall before acting

```text
node scripts/xmemo-skill.mjs recall --query "package manager convention for memory-os-cli" --compact
```

Structured arguments are parsed before transmission. Pass metadata as a JSON
object and boolean query controls as the literal values `true` or `false`:

```text
node scripts/xmemo-skill.mjs remember --content "Verified decision" --path "projects/demo/decisions" --metadata '{"source":"review"}'
node scripts/xmemo-skill.mjs search --query "active implementation" --explain true --prefer_working false --compact
```

### Save handoff state

```text
node scripts/xmemo-skill.mjs save-state --key active_task
```

`--ttl_seconds` accepts `0` through `604800` (seven days), matching the hosted
state-operation contract. A value of `0` requests the server's non-expiring
state behavior for that item.

### Restore handoff state

```text
node scripts/xmemo-skill.mjs restore-state --key active_task
```

### Preserve full restart continuity

Use a restart snapshot when the next agent/session needs more than the single
active-state slot:

```text
node scripts/xmemo-skill.mjs restart-snapshot
node scripts/xmemo-skill.mjs restart-restore
```

`restart-snapshot` captures the active state plus bounded recent timeline,
TODO, and pending-decision context. `restart-restore` selects the latest
accessible snapshot when no ID is supplied; the service may synthesize one
from current active state when no explicit snapshot exists. Select a specific
snapshot or session only when needed:

```text
node scripts/xmemo-skill.mjs restart-snapshot --session_id handoff-a --timeline_limit 20
node scripts/xmemo-skill.mjs restart-restore --source_session_id handoff-a --target_session_id handoff-b
```

All limits are client-validated against the hosted contract. Snapshot item
limits accept `0..100`; `--ttl_seconds` accepts `0..2592000` (30 days).
The direct REST responses can contain the captured continuity pack, so normal
human output prints only status, ID, and time fields. Use `--json` only when a
trusted caller needs the complete redacted response. Native MCP hosts should
use `create_restart_snapshot` and `restore_restart_snapshot` instead of
spawning the script.

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
- `restart-snapshot` / `restart-restore` call `/v1/restart/snapshot` and
  `/v1/restart/restore` directly and require a formal credential with memory
  read/write access. Temporary agent credentials cannot use them.
- Offline memory storage or local sync is not implemented.
