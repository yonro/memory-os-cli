# XMemo Standalone Runtime & Execution Guide

This reference describes standalone CLI runtime execution, command matrix, session management, terminal safety, and deterministic exit codes for the bundled `xmemo` Skill.

For other operations and guides, see:
- [auth-setup.md](auth-setup.md) for full authentication setup, secret stores, vault integration, and token lifecycle.
- [command-details.md](command-details.md) for direct memory operations, REST endpoints, and scope authorization.
- [memory-operations.md](memory-operations.md) for core memory, knowledge, and continuity workflows.
- [ledger-operations.md](ledger-operations.md) for expense tracking, ledger audits, and account diagnostics.
- [troubleshooting.md](troubleshooting.md) for step-by-step diagnosis and repair.

## Command syntax and flags

This command matrix summarizes every command provided by the bundled Skill entrypoint:

| Command | Purpose |
|:---|:---|
| `login` | Start browser-based device sign-in (`--allow-plaintext`) |
| `register` | Create temporary sandbox (`--reason unattended\|declined`) |
| `logout` | Revoke/remove a local credential; externally managed `XMEMO_KEY` requires explicit revocation |
| `auth status` / `auth-status` | Show local auth state; add `--verify` for server validation |
| `auth add` | Store token from stdin (`--from-stdin --allow-plaintext`, capped at 64 KiB) |
| `auth claim-status` / `auth claim-confirm` / `auth claim-deny` | Inspect, approve, or reject the two-phase temporary bind |
| `read` | Read a specific memory by ID with minimal projection and optional character pagination |
| `relationships` | Read owner-scoped Memory links via `GET /v1/memories/{memory_id}/relationships` |
| `update` | Update an existing memory in place via `PATCH /v1/memories/{id}` |
| `forget` | Soft-delete a memory or ledger transaction via `POST /v1/memories/{id}/forget` (requires `--confirm`) |
| `restore` | Restore a soft-deleted memory via `POST /v1/memories/{id}/restore` (requires `--confirm`) |
| `ledger-list` | List financial/expense transactions via `POST /v1/skill/operations` (read-only) |
| `ledger-summary` | Retrieve monthly transaction summary via `POST /v1/skill/operations` (read-only) |
| `overview` | Display account-level memory count, storage, and token consumption (read-only) |
| `activity` | Display recent personal activity and events (read-only) |
| `stats` | Retrieve multidimensional memory statistics and breakdown counts (read-only) |
| `dream-digest` | Review changes and open loops for an existing Dream run (read-only) |
| `remember` | Save a durable memory from text, stdin, or file |
| `recall` | Recall the most relevant memories matching a query |
| `search` | Search memories by keywords |
| `recall-context` | Assemble bounded read-only Memory context, optionally including Knowledge |
| `save-state` / `state-save` | Save current task handoff state |
| `restore-state` / `state-restore` | Restore current task handoff state |
| `restart-snapshot` | Save active state, recent events, TODOs, and pending decisions as one restart snapshot |
| `restart-restore` | Restore the latest or a selected restart snapshot |
| `todo-add` | Create a TODO item |
| `todo-list` | List TODO items |
| `todo-done` | Mark a TODO done |
| `expense-add` | Record a ledger expense (write operation) |
| `expense-delete` / `ledger-delete` | Soft-delete a ledger transaction by transaction ID (requires `--confirm`) |
| `doctor` | Check service health and auth status; add `--anonymous` to omit credentials |
| `profile` | Print recommended agent instructions for project configuration |
| `version` | Check for Skill runtime updates (`--check`) |
| `upgrade` | Print commands to update the XMemo Skill |
| `cloud-skill-list` | List accessible user Cloud Skills (read-only) |
| `cloud-skill-show` | Show Cloud Skill details (read-only) |
| `cloud-skill-render` / `cloud-skill` | Render Cloud Skill prompt into untrusted context (read-only) |

## Session & Authentication Management

For full authentication details, managed secret stores (OpenClaw Secret Egress, Meta Muse Secure Vault), and platform-specific shell snippets, see [auth-setup.md](auth-setup.md).

- **Environment variable (recommended)**: Provide `XMEMO_KEY` via environment variable or secret manager to prevent persisting unencrypted tokens.
- **Local credential fallback**: `printf '%s' "$TOKEN" | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext` stores an existing token locally with explicit user consent.
- **Inspect**: `node scripts/xmemo-skill.mjs auth status [--verify]`.
- **Logout**: `node scripts/xmemo-skill.mjs logout [--revoke-environment-token]`.

## Direct Skill execution details

Use the bundled script or an available XMemo MCP/native integration. Do not improvise REST calls when the Skill artifact is missing; restore the package or use the documented hosted MCP path so authentication, redaction, and argument validation remain intact.

## Output and terminal safety

The script supports JSON output with `--json`, human-readable terminal output with `--terminal`, command-specific usage with `--help`, `--version`, per-request timeouts with `--timeout-ms`, and compact recall/search output with `--compact`. When stdout is piped or redirected to a non-TTY stream and `--json` is not explicitly passed, commands automatically default to JSON output; pass `--terminal` to explicitly preserve human-readable terminal text. Terminal errors include the server `request_id` whenever present in the error response.

`doctor --json` adds a bounded `clientDiagnostics` object: a read-only discovery summary and a `nextAction` command for the next credential check or formal sign-in. The summary includes advertised service version, MCP URL, supported clients, and standalone Skill package version and operations.

For direct operations (`read`, `update`, `forget`, `restore`, `relationships`), see [command-details.md](command-details.md).
For formal `recall` and `search`, requests without time filters use the `POST /v1/skill/operations` envelope. Supplying any time filter (including `--temporal_axis_mode` or `--query_mode`) routes to the direct REST read endpoint (`GET /v1/recall` or `GET /v1/memories/search`); `--json` then prints that endpoint's raw response shape.

## Setup and Repair

If the bundled script reports auth or service errors, use the canonical diagnostic commands: `doctor`, `doctor --anonymous`, and `auth status --verify`.
`doctor` retains authenticated diagnosis when a credential is available. `doctor --anonymous` performs the same service-health check without sending an Authorization header. Both forms use an unauthenticated, read-only discovery request for their JSON capability summary; discovery failure does not block an otherwise successful health check. For step-by-step troubleshooting, see [troubleshooting.md](troubleshooting.md).

## Exit Codes

All CLI operations conform to normalized, deterministic exit codes across all execution modes:

| Exit Code | Classification | Conditions & Semantics | Next Action |
|:---:|:---|:---|:---|
| `0` | Success | Operation succeeded, valid empty state results (e.g. zero transactions or memories found), `--help`, or `--version`. | Proceed with next task. |
| `1` | User Error | Local argument/flag validation failure, mutually exclusive flags (e.g. `--content` with `--file`), content size limit exceeded (> 524,288 bytes), missing mandatory `--confirm`, missing or unreadable input file, or HTTP 4xx client errors (400 Bad Request, 404 Not Found, 428 Precondition Required, 429 Too Many Requests). | Check parameters, correct command arguments, or check resource ID. |
| `2` | Auth Error | Missing credentials (unauthenticated), expired or invalid token, HTTP 401 Unauthorized, HTTP 403 Forbidden / Tenant Forbidden, `auth status --verify` failure, or `doctor` auth invalid. | Run `login --allow-plaintext` or configure `XMEMO_KEY`. |
| `3` | Server / Network Error | HTTP 5xx server errors, connection refused (`ECONNREFUSED`), host unreachable (`ENOTFOUND`), request timeout (`ETIMEDOUT`), or response size exceeding safety limit (> 8 MiB). | Retry with exponential backoff or check network reachability via `doctor --anonymous`. |

## Limitations

- The commands call hosted endpoints on `xmemo.dev`. They require network connection and a valid credential.
- A custom deployment receives credentials only if the operator sets `XMEMO_TRUSTED_ORIGIN` to its exact origin. Plain HTTP is accepted only for loopback development.
- Responses larger than 8 MiB are rejected, and requests default to a 30-second timeout.
- `save-state` / `restore-state` capture and resume server-side active task state.
- `restart-snapshot` / `restart-restore` require a formal credential with memory read/write access. Temporary agent credentials cannot use them.
