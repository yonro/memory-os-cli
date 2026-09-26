# XMemo Ledger & Diagnostics Operations

This reference describes financial bookkeeping and account diagnostics commands provided by the bundled `xmemo` Skill.

For other operations and guides, see:
- [auth-setup.md](auth-setup.md) for full authentication setup, secret stores, vault integration, and token lifecycle.
- [command-details.md](command-details.md) for direct memory operations, REST endpoints, and scope authorization.
- [memory-operations.md](memory-operations.md) for core memory, knowledge, and continuity workflows.
- [runtime-operations.md](runtime-operations.md) for the command matrix, execution details, output safety, and exit codes.
- [troubleshooting.md](troubleshooting.md) for step-by-step diagnosis and repair.

## Ledger Bookkeeping (`ledger-list`, `ledger-summary`, `expense-add`)

- `expense-add` is a **WRITE** operation backed by `POST /v1/skill/operations`
  (`operation: "expense-add"`, requiring `ledger:write` scope). It sends transaction
  details to the XMemo service to create a persistent ledger record and prints the
  server-assigned transaction ID. If the user explicitly requested recording the
  transaction, run it directly; if the agent suggested or inferred it, confirm
  item, amount, and currency with the user before execution.
- `ledger-list` is a strictly read-only query backed by
  `POST /v1/skill/operations` (`operation: "ledger-list"`, requiring
  `ledger:read` scope). It retrieves financial and expense transactions without
  any write or delete capabilities; `ledger-list` only reads and lists records.
  Deleting or voiding a transaction is a separate operation that requires
  explicit confirmation (`forget --id <id> --confirm`) and a delete-capable
  scope (for example `memory:delete`; see the forget section for the full list).
  It accepts `--limit <n>`, `--offset <n>`,
  `--currency <code>`, `--from <date>` (`date_from`), `--to <date>` (`date_to`),
  `--category <name>`, `--min-amount <n>`, `--max-amount <n>`, and `--type <type>`
  (`transaction_type`). As a convenience, `--month <YYYY-MM>` can be specified to
  query an entire month; it is resolved locally into exact first-day and last-day
  dates (`date_from` and `date_to`) before transmission, ensuring compatibility
  without transmitting unsupported parameters. Empty result sets (`[]`) represent
  valid empty states and terminate cleanly with exit code 0 rather than an error
  or `not_found`. Terminal output renders line items with currency units and exact
  amounts (rendering `(unknown)` when amount is missing), avoiding precision loss.
  `--json` returns `{ ok: true, transactions: [...], total: ... }`. Missing
  endpoints return 404 `not_found`, and 401/403 errors are preserved without
  downgrade (403 clearly prompts for re-authorization).
- `ledger-summary` is a strictly read-only query backed by
  `POST /v1/skill/operations` (`operation: "ledger-summary"`, requiring
  `ledger:read` scope). It aggregates transaction activity over preceding
  months without any write or modification options. It accepts `--months <n>`
  (integer count of preceding months to summarize, default 6, range 1..24),
  `--currency <code>`, and `--type <type>` (`transaction_type`). Empty monthly
  aggregates terminate cleanly with exit code 0. Terminal output formats each
  monthly period and category with explicit currency designations. `--json`
  returns `{ ok: true, summary: [...], months: ... }`. Missing endpoints return
  404 `not_found`, and 401/403 errors are preserved without downgrade (403
  clearly prompts for re-authorization).

## Account Diagnostics & Statistics (`overview`, `activity`, `stats`)

- `overview` is a strictly read-only command backed by
  `POST /v1/skill/operations` (`operation: "overview"`, requiring `memory:read`
  scope). It retrieves account-level memory and resource metrics (total
  memories, active/archived/forgotten counts, active agent count, storage usage
  in MB, and 30-day token consumption). It accepts zero arguments or parameters
  and possesses zero write or delete capabilities. Terminal mode formats exact
  counts and measurements without precision loss; empty data (0 memories) exits
  cleanly with code 0. `--json` returns
  `{ ok: true, memories_total: ..., memories_active: ..., ... }`. 404 returns
  `not_found`, and 401/403 errors are preserved without downgrade (403 clearly
  prompts for re-authorization).
- `activity` is a strictly read-only command backed by
  `POST /v1/skill/operations` (`operation: "activity"`, requiring `memory:read`
  scope). It inspects recent account-level events and memory activities without
  write or delete capabilities. It accepts only `--limit <n>` (positive integer
  up to 100, default 20). Zero activity entries exit cleanly with exit code 0.
  Terminal mode displays sequential timestamped activity entries with type tags
  and summaries. `--json` returns `{ ok: true, activity: [...], total: ... }`.
  404 returns `not_found`, and 401/403 errors are preserved without downgrade
  (403 clearly prompts for re-authorization).
- `stats` is a strictly read-only command backed by `GET /v1/memories/stats`. It
  retrieves comprehensive multidimensional memory statistics and breakdown counts
  without write or delete capabilities. It maps command-line flags directly to
  server query parameters: `--scope`, `--path`, `--bucket`, `--memory-type`
  (`memory_type`), `--status`, `--source`, `--since`, `--until`, `--group-by`
  (`group_by`), `--top-n` (`top_n`, range 1..200 enforced locally before network
  dispatch), and `--team-id` (`team_id`). Parameters outside the accepted
  signature or `--top-n` values outside 1..200 are rejected locally before
  issuing any network request. Empty data sets exit cleanly with code 0 without
  being disguised as errors or `not_found`. Terminal mode renders total/filtered
  counts, latest/oldest dates, category breakdowns, and grouped dimensions.
  `--json` returns `{ ok: true, total_count: ..., filtered_count: ..., ... }`.
  404 returns `not_found`, and 401/403 errors are preserved without downgrade.
