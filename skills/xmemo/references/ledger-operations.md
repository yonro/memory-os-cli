# XMemo Ledger & Diagnostics Operations

This reference describes financial bookkeeping and account diagnostics commands provided by the bundled `xmemo` Skill.

For other operations and guides, see:
- [memory-operations.md](memory-operations.md) for core memory, knowledge, and continuity workflows.
- [runtime-operations.md](runtime-operations.md) for the command matrix, execution details, output safety, and exit codes.
- [troubleshooting.md](troubleshooting.md) for step-by-step diagnosis and repair.

## Ledger Commands

### Record an expense

```text
node scripts/xmemo-skill.mjs expense-add --item "team lunch" --amount 42.5 --currency USD
```

`expense-add` records a ledger transaction in XMemo and prints the server-assigned transaction ID.

### Query ledger transactions (read-only)

```text
node scripts/xmemo-skill.mjs ledger-list
node scripts/xmemo-skill.mjs ledger-list --month 2026-09
node scripts/xmemo-skill.mjs ledger-list --from 2026-09-01 --to 2026-09-30 --currency CNY
node scripts/xmemo-skill.mjs ledger-list --category "Dining" --type expense --limit 20
node scripts/xmemo-skill.mjs ledger-list --month 2026-09 --json
```

`ledger-list` queries personal financial transactions via `POST /v1/skill/operations` (`operation: "ledger-list"`, requiring `ledger:read` scope).
This command is strictly read-only and possesses zero write or deletion capabilities; `ledger-list` only reads and lists recorded transactions. Deleting or voiding a ledger entry is a separate operation that requires explicit confirmation (`forget --id <id> --confirm`) and a delete-capable scope (for example `memory:delete`; see the forget section for the full list).
Allowed server arguments:
- `--limit <n>`: Page limit (default 30, max 100).
- `--offset <n>`: Pagination offset (default 0).
- `--currency <code>`: Filter by 3-letter currency code (e.g. `CNY`, `USD`).
- `--from <date>`: Filter transactions from start date (`date_from`).
- `--to <date>`: Filter transactions up to end date (`date_to`).
- `--category <name>`: Filter by expense/income category.
- `--min-amount <n>` / `--max-amount <n>`: Filter by amount range.
- `--type <type>`: Filter by transaction type (`transaction_type`, e.g. `expense`, `income`, `refund`).
- `--month <YYYY-MM>`: Convenience flag. Resolved locally to start-of-month (`YYYY-MM-01`) and end-of-month dates (`date_from` and `date_to`) before dispatching, avoiding passing unsupported query parameters.

Behavior and error classification:
- Zero matching transactions return `{ ok: true, transactions: [], total: 0 }` (or clean terminal notice) with exit code 0.
- Missing resources report 404 `not_found`.
- Authentication (401) and authorization (403) errors are preserved without downgrade (403 clearly prompts for re-authorization).
- Unexpected 400 responses default to `invalid_request`.
- Terminal output always formats amounts with explicit currency units without loss of precision.

### Query monthly ledger summary (read-only)

```text
node scripts/xmemo-skill.mjs ledger-summary
node scripts/xmemo-skill.mjs ledger-summary --months 6
node scripts/xmemo-skill.mjs ledger-summary --months 3 --currency USD
node scripts/xmemo-skill.mjs ledger-summary --months 12 --type expense --json
```

`ledger-summary` aggregates monthly financial transaction figures via `POST /v1/skill/operations` (`operation: "ledger-summary"`, requiring `ledger:read` scope).
This command is strictly read-only and possesses zero write or deletion capabilities.
Allowed server arguments:
- `--months <n>`: Integer count of preceding months to aggregate (default 6, range 1..24).
- `--currency <code>`: Filter aggregation by currency code.
- `--type <type>`: Filter aggregation by transaction type (`transaction_type`).

Behavior and error classification:
- Empty aggregations return `{ ok: true, summary: [], months: ... }` with exit code 0.
- Missing endpoints report 404 `not_found`.
- Authentication (401) and authorization (403) errors are preserved without downgrade (403 clearly prompts for re-authorization).
- Unexpected 400 responses default to `invalid_request`.
- Terminal output renders structured monthly periods and breakdown totals with explicit currency labels.

## Diagnostics & Statistics Commands

### Inspect account overview (read-only)

```text
node scripts/xmemo-skill.mjs overview
node scripts/xmemo-skill.mjs overview --json
```

`overview` queries account-level memory and storage metrics via `POST /v1/skill/operations` (`operation: "overview"`, requiring `memory:read` scope).
This command is strictly read-only, takes zero parameters, and possesses zero write or deletion capabilities.
It reports:
- Total, active, archived, and forgotten memory counts
- Active registered agent count
- Total storage usage in MB
- 30-day token consumption

Behavior and error classification:
- Zero memories exit cleanly with code 0.
- Missing resources report 404 `not_found`.
- Authentication (401) and authorization (403) errors are preserved without downgrade (403 clearly prompts for re-authorization).
- Unexpected 400 responses default to `invalid_request`.
- Terminal output renders exact counts and metrics without precision loss.

### Inspect recent account activity (read-only)

```text
node scripts/xmemo-skill.mjs activity
node scripts/xmemo-skill.mjs activity --limit 10
node scripts/xmemo-skill.mjs activity --limit 20 --json
```

`activity` queries recent account events and activity items via `POST /v1/skill/operations` (`operation: "activity"`, requiring `memory:read` scope).
This command is strictly read-only and possesses zero write or deletion capabilities.
Allowed server arguments:
- `--limit <n>`: Count of recent activities to retrieve (default 20, positive integer up to 100).

Behavior and error classification:
- Zero activity items return `{ ok: true, activity: [], total: 0 }` (or clean terminal notice) with exit code 0.
- Missing resources report 404 `not_found`.
- Authentication (401) and authorization (403) errors are preserved without downgrade (403 clearly prompts for re-authorization).
- Unexpected 400 responses default to `invalid_request`.
- Terminal output renders sequential timestamped records with type and summary fields.

### Inspect memory statistics and breakdown (read-only)

```text
node scripts/xmemo-skill.mjs stats
node scripts/xmemo-skill.mjs stats --path "projects/%" --bucket main
node scripts/xmemo-skill.mjs stats --group-by "type,status" --top-n 10
node scripts/xmemo-skill.mjs stats --memory-type episodic --status active --json
```

`stats` queries aggregated memory metrics and dimensional counts via `GET /v1/memories/stats`.
This command is strictly read-only and possesses zero write or deletion capabilities.
Allowed server parameters:
- `--scope <scope>`: Filter by scope.
- `--path <path>`: Filter by path (supports wildcards, default `%`).
- `--bucket <bucket>`: Filter by bucket (default `%`).
- `--memory-type <type>`: Filter by memory type (`memory_type`, default `%`).
- `--status <status>`: Filter by status (default `%`).
- `--source <source>`: Filter by memory source.
- `--since <iso>`: Filter memories created/updated after ISO 8601 timestamp.
- `--until <iso>`: Filter memories created/updated before ISO 8601 timestamp.
- `--group-by <dims>`: Comma-separated grouping dimensions (`path,type,status,source,bucket,day,metadata:<key>`).
- `--top-n <n>`: Limit top grouped entries (1..200, strictly enforced locally before sending requests).
- `--team-id <id>`: Filter by team ID.

Behavior and error classification:
- Zero memories exit cleanly with code 0.
- Values of `--top-n` outside 1..200 or unrecognized options are rejected locally without issuing network requests.
- Missing resources report 404 `not_found`.
- Authentication (401) and authorization (403) errors are preserved without downgrade.
- Unexpected 400 responses default to `invalid_request`.
- Terminal output renders total/filtered counts, timestamps, type/status/bucket distributions, and group aggregates.
