# XMemo Skill Operations

This reference describes the standalone operational commands provided by the
bundled `xmemo` Skill. This is the primary standalone runtime for direct REST access.

## Runtime Selection

XMemo supports two parallel integration paths:

1. **Bundled Skill script** (`node scripts/xmemo-skill.mjs <command>`), which directly integrates with the XMemo REST API using stored credentials. Run commands from the Skill root.
2. **XMemo MCP tools** (when running in environments that natively host the XMemo MCP server).

If no credential is stored, the script reports the login or token add command as the repair path. Never paste a raw token into chat.

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
| `doctor` | Check service health and auth status |

## Examples

### Remember a decision

```text
node scripts/xmemo-skill.mjs remember \
  --content "Use pnpm for package management in this repo" \
  --path "projects/memory-os-cli/conventions"
```

### Recall before acting

```text
node scripts/xmemo-skill.mjs recall \
  --query "package manager convention for memory-os-cli" --compact
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
node scripts/xmemo-skill.mjs todo-add \
  --content "Add unit tests for ledger expense command"
```

### Record an expense

```text
node scripts/xmemo-skill.mjs expense-add \
  --item "team lunch" --amount 42.5 --currency USD
```

## Direct Skill execution details

If the Skill file itself is not available, you can still run direct operations by calling the XMemo REST API using tools like curl or any HTTP client.

## Output and terminal safety

`remember` and `expense-add` print the server-returned memory or ledger ID. `recall` and `search` accept `--compact` to render each memory on one shortened line; use `--json` when a caller needs the complete response payload. For the exact accepted parameters of any command, run `node scripts/xmemo-skill.mjs <command> --help`.

## Limitations

- The commands call the hosted endpoints on `xmemo.dev`. They require a network connection and a valid credential.
- `save-state` / `restore-state` map to `update_state` / `_get_active_state_item` under the hood; they capture/resume server-side active task state.
- Offline memory storage or local sync is not implemented.
