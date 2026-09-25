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

## 2. Creating the GitHub Release

After the skill release PR is merged into `main`, create the corresponding GitHub Release to trigger asset packaging (`.github/workflows/release-xmemo-skill.yml`):

```bash
gh release create skill-v<version> \
  --title "XMemo Skill v<version>" \
  --latest \
  --generate-notes
```

### Critical: Explicit `--latest`
Always include `--latest` when creating a Skill release.

**Why this matters**:
The XMemo backend server (`memory-os`) falls back to downloading the skill archive directly from:
`https://github.com/yonro/memory-os-cli/releases/latest/download/xmemo-skill.tar.gz`
whenever the internal skill package cache is empty or cold (`routes/skill_package.py`). The GitHub `Latest` release pointer must strictly belong to the newest Skill release (`skill-v*`).

In contrast, CLI releases (`.github/workflows/release.yml`) are explicitly configured with `--latest=false` so they never hijack the `Latest` release pointer.

---

## 3. Publishing to ClawHub

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

## 4. How to Add a Command

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

---

## 5. Standalone `@xmemo/skill` npm Package

The `@xmemo/skill` package provides a standalone, zero-dependency npm distribution of the XMemo agent skill. It decouples skill distribution from the CLI (`@xmemo/client`) releases and provides independent npm registry verification with Sigstore provenance.

### Local Package Builder

To build the standalone package artifact locally from `skills/xmemo`:

```bash
node scripts/build-skill-npm-package.mjs --out <output_directory>
```

The build script enforces release packaging invariants:
1. **Empty Output Directory**: Refuses to overwrite non-empty directories.
2. **Version Derivation**: Derives package version strictly from `SKILL_VERSION` in `skills/xmemo/scripts/xmemo-skill.mjs`.
3. **C3 & Symlink Invariants**: Recursively checks for symlinks and sensitive naming patterns (`.env*`, `*secret*`, `*token*`, `*key*`, `*credential*`), rejecting offending files immediately.
4. **Sorted Manifest Match**: Asserts that staged skill files in `<out>/skill/` match `skills/xmemo/` byte-for-byte.
5. **Standalone Installer**: Copies `packages/skill-installer/install.mjs` to `<out>/bin/install.mjs` with executable permissions.

To preview tarball contents:
```bash
cd <output_directory>
npm pack --dry-run
```

### Automated Release Workflow (`release-xmemo-skill.yml`)

The Skill release workflow contains a dedicated `npm` job that runs after archive packaging:
- Verifies the built package version exactly matches the `skill-v<version>` release tag.
- Checks if the target version is already published on npm (idempotent rerun).
- Publishes with `--access public --provenance` from the built directory.

### Publish Gating (`vars.XMEMO_SKILL_NPM_PUBLISH`)

Real publishing to npm is **gated off** by default:
- The publish step checks `vars.XMEMO_SKILL_NPM_PUBLISH == 'true'`.
- If the repository variable is not set or not `'true'`, the workflow logs a notice and skips publishing without error.

### Provenance Verification

When published with `--provenance`, npm records a Sigstore-signed attestation linking the published artifact directly to the GitHub Actions workflow run in this repository:
- Run `npm audit signatures` to verify package signature and transparency log status.
- Inspect the provenance badge on `https://www.npmjs.com/package/@xmemo/skill`.

### Human Prerequisite (Before First Real Publish)

Because `@xmemo/skill` is a new package:
1. The first publish requires an npm authentication token authorized to create packages under the `@xmemo` scope (configured via `NPM_TOKEN` secret in the `npm` GitHub Actions environment), or an initial manual publish by an organization owner.
2. After initial creation, configure npm **Trusted Publishing** for `yonro/memory-os-cli`, workflow `.github/workflows/release-xmemo-skill.yml`, environment `npm`.
3. Set GitHub repository variable `XMEMO_SKILL_NPM_PUBLISH=true` to enable automated publishing on subsequent releases.
