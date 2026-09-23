# PR179 memory transfer and ledger deletion

Requires the server contracts in memory-os PR179. No npm release is performed.

```sh
xmemo memory list --path-prefix 'notes/_literal%' --limit 100 --offset 0 --json
xmemo memory export --bucket private --limit 500 --json
xmemo memory import --file memories.jsonl --dry-run --bucket private --json
xmemo memory import --file memories.jsonl --idempotency-key stable-import-key --yes --json
xmemo memory ledger-delete --id TRANSACTION_UUID --yes --json
```

`expense-delete` is an alias under `memory`. Deletion accepts only a transaction
UUID and requires memory:delete plus ledger:read. It is recoverable soft deletion.

List sends a literal prefix, including `%`, `_`, backslashes and Unicode, through
URL query encoding. Offset pagination is live, not a point-in-time snapshot.
Export/import follow increasing cursors until null. Export's JSON envelope contains
the concatenated `data.jsonl`; extract this string into an import file. Export is
memory JSONL, not a full-account, ledger, DSAR or point-in-time backup.

Import defaults to private. Apply requires a stable idempotency key and explicit
confirmation; network-uncertain writes are not automatically replayed. Keep the
same file, key, bucket and scope for a deliberate retry. Per-page skipped/error
details are retained in the result; a response envelope alone does not establish
that every record imported. Malformed JSONL is rejected before network writes.

Validation: 43 command/registry/transfer tests passed and JavaScript lint passed.
Transport fixtures cover exact routes, Unicode, pagination, broken JSONL and
nonadvancing cursors. Deployed server integration and logout acceptance remain
blocked pending a dedicated environment and revocable account.
