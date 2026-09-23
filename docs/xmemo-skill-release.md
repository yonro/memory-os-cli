# XMemo Skill Release & Maintainer Workflow

This document contains internal maintainer procedures for testing and releasing the `skills/xmemo` package. These instructions are intentionally decoupled from the published skill payload to ensure the skill directory only contains consumer assets.

---

## 1. Pre-Release Smoke Testing

Before releasing or publishing changes to the XMemo skill, run the automated smoke test script to verify end-to-end command execution, exit code normalization, and `--json` envelope compliance against live or mock endpoints:

```bash
# Run read-only verification against default or target base URL
node scripts/xmemo-skill-smoke-test.mjs --base-url https://xmemo.dev

# Machine-readable output in CI pipelines
node scripts/xmemo-skill-smoke-test.mjs --json

# Execute write-side commands against disposable test accounts or local mocks
node scripts/xmemo-skill-smoke-test.mjs --execute-writes --base-url http://127.0.0.1:8080
```

### Safety & Write Gating
- **Read-Only Commands (Always Executed)**:
  `overview`, `activity`, `stats`, `ledger-list`, `ledger-summary`, `todo-list`, `search`, `recall`, `recall-context`, `read`, `restore-state`, `doctor --anonymous`, `auth status`, `--version`, `--help`.
- **Write Commands (Explicitly Gated)**:
  `remember`, `update`, `forget`, `todo-add`, `todo-done`, `expense-add`, `save-state`, `restart-snapshot`, `restart-restore`.
  Write commands are skipped by default with status `skipped`. They only execute when the `--execute-writes` CLI flag is explicitly passed, protecting production accounts from data pollution or unwanted modifications during smoke testing.

### Validation Semantics
- **Exit Codes**: Asserts that successful commands exit with code 0 (or expected exit code).
- **JSON Envelopes**: Verifies that commands invoked with `--json` produce valid JSON output containing required envelope keys (`ok: true`, or `status`, `context_text`, and structured `error.code` string on failure).
- **Fail-Fast & Failure Inventory**: If any command unexpectedly fails or produces an invalid envelope, the runner terminates with exit code 1 and prints a detailed checklist of failed commands, their exit codes, and error descriptions (or a `{ "ok": false, "failures": [...] }` envelope in JSON mode).

### CLI Options

| Option | Default | Description |
|---|---|---|
| `--base-url <url>` | `https://xmemo.dev` | XMemo backend service URL |
| `--timeout-ms <ms>` | `30000` | Request timeout per command in milliseconds |
| `--execute-writes` | `false` | Enable write command execution (otherwise skipped) |
| `--token <token>` | (env / stored) | Auth token for skill execution (`XMEMO_KEY` fallback) |
| `--script-path <path>` | `skills/xmemo/scripts/xmemo-skill.mjs` | Path to `xmemo-skill.mjs` |
| `--json` | `false` | Output structured JSON summary |
| `--verbose` | `false` | Print detailed sub-process stdout/stderr |
| `--help` | `false` | Display command help and exit |

---

## 2. Publishing to ClawHub

When publishing updates for `skills/xmemo` to ClawHub:

1. **Explicit Publisher Handle**:
   Always pass `--owner xmemo` to target the official organizational publisher namespace:
   ```bash
   clawhub publish skills/xmemo --owner xmemo --version <semver> --slug xmemo --name "XMemo Memory"
   ```
2. **Pre-Publish Namespace Assertion**:
   Before executing the publish command, verify that the active token belongs to or is authorized by the `@xmemo` organization. Do not rely solely on `clawhub whoami` returning success:
   - Verify `clawhub whoami` identity.
   - Assert that the effective publishing namespace matches `ownerHandle=xmemo`.
   - Ensure the token is not a personal account token without `@xmemo` publisher permissions to prevent publishing accidental duplicate skills under personal namespaces.
3. **Dry-Run Validation**:
   Always dry-run the publish command first to inspect the payload file list:
   ```bash
   clawhub publish skills/xmemo --dry-run
   ```
   Ensure no test files or repository-level maintenance scripts are bundled.
4. **Post-Publish Verification**:
   Query the public API to verify the release without ambiguity:
   ```bash
   curl -s "https://clawhub.ai/api/skill?slug=xmemo"
   ```
   Ensure the response returns HTTP 200 with `latestVersion.version` matching the release version and `owner.handle` equals `"xmemo"`. If the endpoint returns HTTP 409 (`AMBIGUOUS_SKILL_SLUG`), verify whether duplicate slugs exist across publishers.

---

## 3. How to Add a Command

The XMemo skill uses a modular architecture separating command-line dispatch from domain implementations. To introduce a new CLI command or subcommand, update the three canonical integration points:

### Step 1: Implement the Command Handler (`scripts/commands/`)
- Add or extend an existing domain module in `skills/xmemo/scripts/commands/` (e.g., `memory.mjs`, `ledger.mjs`, `account.mjs`, `auth-login.mjs`, `auth-manage.mjs`, or `ops.mjs`).
- Export an async function conforming to the standard handler signature:
  ```javascript
  export async function handleMyCommand(ctx) {
    // ctx contains: { command, subcommand, positionals, options, flags, credential, token }
  }
  ```
- Treat `ctx` as read-only.
- Use helpers from `lib/core.mjs`, `lib/api.mjs`, and `lib/auth-state.mjs` for network calls and output formatting.
- Preserve standard CLI exit conventions using `process.exit(EXIT_CODE.OK)` or normalized error exit codes.
- Ensure the module file size remains strictly under 12KB (12,288 bytes) and introduces no circular dependencies.

### Step 2: Register Dispatch in `scripts/xmemo-skill.mjs`
- Import the new handler into `skills/xmemo/scripts/xmemo-skill.mjs`.
- Register the dispatch condition in `main()`, respecting the established precedence sequence:
  1. **Pre-credential commands**: e.g., `login`, `register`, `logout`, `auth status`.
  2. **Anonymous / diagnostic bypasses**: e.g., `doctor --anonymous`.
  3. **Credential assertion**: unauthenticated invocations exit with `EXIT_CODE.AUTH_REQUIRED`.
  4. **Temporary / ephemeral token diversion**: route restricted operations if running under a temporary token.
  5. **Authenticated domain dispatch**: route the command/subcommand to your handler.
- Perform any command name canonicalization (e.g., `cmd === 'save-state' || cmd === 'state-save'`) at the dispatch layer before calling the handler.

### Step 3: Register Usage & Help in `scripts/lib/help.mjs`
- Add the command entry to `COMMAND_USAGE_REGISTRY` in `skills/xmemo/scripts/lib/help.mjs`:
  - Define `usage`: CLI syntax string (e.g., `xmemo-skill.mjs my-command <arg> [options]`).
  - Define `description`: concise explanation of command purpose.
  - Define `category`: grouping key (e.g., `memory`, `ledger`, `account`, `auth`, `ops`).
- If the command accepts recognized flags or options, declare them in `COMMAND_FLAGS` within `skills/xmemo/scripts/lib/core.mjs` to ensure argument parsing and validation recognize them properly.

### Verification Checklist
After adding a command, verify the full test and packaging suite:
```bash
npm run lint
node --test test/xmemo-skill-snapshot.test.js
npm test
node scripts/verify-release-packaging.mjs
```
