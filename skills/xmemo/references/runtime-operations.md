# XMemo Standalone Runtime & Execution Guide

This reference describes standalone CLI runtime execution, command matrix, session management, terminal safety, and deterministic exit codes for the bundled `xmemo` Skill.

For other operations and guides, see:
- [memory-operations.md](memory-operations.md) for core memory, knowledge, and continuity workflows.
- [ledger-operations.md](ledger-operations.md) for expense tracking, ledger audits, and account diagnostics.
- [troubleshooting.md](troubleshooting.md) for step-by-step diagnosis and repair.

## Command matrix

| Skill script | Purpose |
|--------------|---------|
| `read` | Read a specific memory by ID with minimal projection and optional character pagination |
| `update` | Update an existing memory in place via `PATCH /v1/memories/{id}` |
| `forget` | Soft-delete a memory or ledger transaction via `POST /v1/memories/{id}/forget` (requires delete scope and explicit `--confirm`) |
| `ledger-list` | List financial/expense transactions via `POST /v1/skill/operations` (operation: `ledger-list`, requires `ledger:read` scope) |
| `ledger-summary` | Retrieve monthly transaction summary via `POST /v1/skill/operations` (operation: `ledger-summary`, requires `ledger:read` scope) |
| `overview` | Display account-level memory count, storage, and token consumption via `POST /v1/skill/operations` (operation: `overview`, requires `memory:read` scope) |
| `activity` | Display recent personal activity and events via `POST /v1/skill/operations` (operation: `activity`, requires `memory:read` scope) |
| `stats` | Retrieve multidimensional memory statistics and breakdown counts via `GET /v1/memories/stats` (strictly read-only) |
| `remember` | Save a durable memory |
| `recall` | Recall the most relevant memories |
| `search` | Search memories by query |
| `recall-context` | Assemble bounded read-only Memory context, optionally including Knowledge |
| `save-state` | Save current task handoff state |
| `restore-state` | Restore current task handoff state |
| `restart-snapshot` | Save active state, recent events, TODOs, and pending decisions as one restart snapshot |
| `restart-restore` | Restore the latest or a selected restart snapshot |
| `todo-add` | Create a TODO item |
| `todo-list` | List TODO items |
| `todo-done` | Mark a TODO done |
| `expense-add` | Record a ledger expense (write operation, requires `ledger:write` scope; confirm with user when agent-inferred) |
| `doctor` | Check service health and auth status; add `--anonymous` to omit credentials |
| `auth status` / `auth-status` | Show local auth state; add `--verify` for server validation |
| `auth claim-status` / `auth claim-confirm` / `auth claim-deny` | Inspect, approve, or reject the two-phase temporary bind |
| `logout` | Revoke/remove a local credential; externally managed `XMEMO_KEY` requires explicit revocation |

## Session & Authentication Management

### Add an existing token without command-line exposure

POSIX shell:

```text
printf '%s' "$XMEMO_KEY" | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

PowerShell:

```powershell
$env:XMEMO_KEY | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

### Inspect and verify credentials

```text
node scripts/xmemo-skill.mjs auth status
node scripts/xmemo-skill.mjs auth status --verify
```

### Logout

```text
node scripts/xmemo-skill.mjs logout
# To revoke external environment token remotely:
node scripts/xmemo-skill.mjs logout --revoke-environment-token
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
When stdout is connected to a non-TTY stream (e.g. piped or redirected) and
neither `--json` nor `--terminal` was explicitly specified, commands automatically
default to JSON output. Pass `--terminal` (or `--no-json`) to force human-readable
terminal formatting even when piping. Terminal error messages display the server
`request_id` whenever provided in the service response body.
Human-readable output removes terminal control sequences. For the exact accepted
parameters of any command, run
`node scripts/xmemo-skill.mjs <command> --help`; use `--version` to identify the
runtime and `--timeout-ms <ms>` to bound each network request.

## Exit Codes

All CLI operations conform to normalized, deterministic exit codes across all execution modes:

| Exit Code | Classification | Conditions & Semantics | Next Action |
|:---:|:---|:---|:---|
| `0` | Success | Operation succeeded, valid empty state results (e.g. zero transactions or memories found), `--help`, or `--version`. | Proceed with next task. |
| `1` | User Error | Local argument/flag validation failure, mutually exclusive flags (e.g. `--content` with `--file`), content size limit exceeded (> 524,288 bytes), missing mandatory `--confirm`, missing or unreadable input file, or HTTP 4xx client errors (400 Bad Request, 404 Not Found, 428 Precondition Required, 429 Too Many Requests). | Check parameters, correct command arguments, or check resource ID. |
| `2` | Auth Error | Missing credentials (unauthenticated), expired or invalid token, HTTP 401 Unauthorized, HTTP 403 Forbidden / Tenant Forbidden, `auth status --verify` failure, or `doctor` auth invalid. | Run `login --allow-plaintext` or configure `XMEMO_KEY`. |
| `3` | Server / Network Error | HTTP 5xx server errors, connection refused (`ECONNREFUSED`), host unreachable (`ENOTFOUND`), request timeout (`ETIMEDOUT`), or response size exceeding safety limit (> 8 MiB). | Retry with exponential backoff or check network reachability via `doctor --anonymous`. |

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
- `recall-context` calls `/v1/recall/context`. Its default is Memory-only;
  `--include_knowledge true` requests the bounded mixed context only when the
  service feature and `knowledge:read` authorization are both present.
- Offline memory storage or local sync is not implemented.
