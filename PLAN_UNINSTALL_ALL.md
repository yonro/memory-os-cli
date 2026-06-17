# Plan: `xmemo uninstall` safe one-click cleanup

## Audit verdict

The feature is feasible, but the original plan needed several safety corrections before implementation:

1. `setup --all` does not currently use the same scan list as the draft plan. The implementation scans only a subset of supported clients, while the draft listed additional clients such as Kiro, Zed, JetBrains, Kimi Code, Claude Code, OpenClaw, and missed Grok/Hermes.
2. `detectClient()` is setup-oriented: it returns detected when a parent directory exists even if the config file does not. Uninstall must not create new empty config files, so it needs file-existence based scan semantics.
3. The existing TOML removal helper is not safe enough for uninstall. It stops at the first next table and can leave `[mcp_servers.XMemo.http_headers]` orphaned. Fix TOML removal first and reuse the fixed helper for `--force` setup overwrite too.
4. Profile cleanup must be marker-scoped. Do not delete profile files. Use the existing `profileUninstallResult()` path and preserve user content around the XMemo marker block.
5. Docker/OCI parameters are not present today. `server.json` advertises remote MCP plus an npm package only. That is acceptable if no Docker image is shipped, but incomplete if XMemo intends to publish an OCI package.
6. Release metadata has drift: `package.json` is `0.4.168`, while `server.json` and `lhm.plugin.json` are `0.4.163`. Sync these before publishing.

## Post-implementation review: must-fix items

Status after the first implementation pass:

- `npm run lint` passed.
- `npm test` passed, 75/75 tests.
- Happy-path uninstall works for Cursor/Continue in the current tests.
- The implementation still misses several safety and CLI-contract requirements below.

### P1: TOML removal still leaves child tables

Current issue:

- `src/mcp/formats/toml.js` still uses `removeTomlServerBlock()` that stops at the first following TOML table.
- Generated Codex/Grok config has:

```toml
[mcp_servers.XMemo]
url = "..."

[mcp_servers.XMemo.http_headers]
X-Memory-OS-Agent-ID = "..."
```

- The current remover deletes `[mcp_servers.XMemo]` but leaves `[mcp_servers.XMemo.http_headers]` orphaned.
- The same bug affects `--force` setup overwrite because `appendTomlServerConfig()` and `appendGrokServerConfig()` reuse the same helper.

Required fix:

- Replace `removeTomlServerBlock(content, serverName)` with a helper that removes the root table and all child tables whose header is exactly `[mcp_servers.<name>]` or starts with `[mcp_servers.<name>.`.
- Preserve unrelated sibling tables such as `[mcp_servers.Other]`.
- Add tests for uninstall and setup `--force` overwrite proving child tables are gone.

### P1: `--json` is not implemented for uninstall

Current issue:

- `src/commands/uninstall.js` never reads `--json`.
- `xmemo uninstall --all --json` currently emits text and can still prompt.

Required behavior:

- `--json` never prompts.
- `--json` without `--yes` returns a dry-run plan.
- `--json --yes` writes and returns a JSON result.
- JSON result should include at least:

```json
{
  "dryRun": true,
  "write": false,
  "profiles": false,
  "removed": [],
  "skipped": [],
  "errors": []
}
```

Required tests:

- `xmemo uninstall --all --json` emits parseable JSON, writes nothing, and does not prompt.
- `xmemo uninstall --all --json --yes` writes and emits parseable JSON.

### P1: Per-client errors abort `--all`

Current issue:

- `buildUninstallPlan()` does not catch parse/write errors from each remover.
- One invalid JSON/TOML/YAML file aborts the entire `--all` command.

Required fix:

- Wrap each target's removal in a `try/catch`.
- Add failing clients to `plan.errors`.
- Continue processing remaining clients.
- Return exit code `1` if any error was encountered after processing all possible clients.

Required tests:

- Invalid Cursor JSON plus valid Continue config: command reports Cursor error, still removes Continue, exits `1`.
- Malformed profile markers with `--profiles`: profile error is reported and file is left untouched.

### P2: `--profiles` only runs when config removal succeeds

Current issue:

- Profile cleanup is nested under `if (result.removed)`.
- If the XMemo config entry is already absent but a marker-scoped profile remains, `xmemo uninstall --all --profiles --yes` does not remove the profile.

Required fix:

- Build profile cleanup plans independently from config removal.
- For `--all --profiles`, attempt profile cleanup for all scanned/profile-supported clients even when config status is `not_found`.
- Report config and profile results separately.

Required test:

- Cursor config has no XMemo entry, but `.cursor/memory-profile.md` contains the XMemo marker block. `xmemo uninstall cursor --profiles --yes` removes the marker block and exits `0`.

### P2: `--target` / `--profile-target` are ignored

Current issue:

- `uninstall cursor --profiles --target <path>` always uses `profileConfig.defaultTarget(io.env)`.

Required fix:

- Parse `--target` and `--profile-target`.
- For single-client uninstall, use the explicit profile target when supplied.
- For `--all`, reject explicit `--target` / `--profile-target` as ambiguous, or document and implement a clear rule.

Required test:

- `xmemo uninstall cursor --profiles --target custom.md --yes` removes the marker block from `custom.md`.

### P2: Setup/uninstall scan lists still drift

Current issue:

- `src/commands/setup.js` still has its own hard-coded `scanIds`.
- `src/commands/uninstall.js` has a different hard-coded `SCAN_IDS`.
- README currently says uninstall scans the same clients as `setup --all`, but this is false.

Required fix:

- Add `src/mcp/clients/scan.js` as described below, or another shared module with the same behavior.
- Both setup and uninstall should import the same auto-scan client list.
- Uninstall scanning must use existing-file semantics and must not create config files.

Required tests:

- Assert setup and uninstall share the same exported scan list.
- Uninstall with only parent directories present reports no config removals and creates no files.

### P2: Copilot/Cline multiple candidate paths are not handled

Current issue:

- `detectClient()` returns only the first detected candidate.
- Copilot CLI and Cline can have multiple possible config paths.
- The plan requires all known existing candidate paths to be considered for uninstall.

Required fix:

- Shared scan helper should return all existing candidate files for uninstall.
- Deduplicate by absolute path plus client/section.

Required test:

- Two existing Copilot candidate config files each containing `XMemo`; `xmemo uninstall copilot --yes` removes both, or the command documents and enforces a single target with `--config`.

### P2: Registry metadata follow-up remains undone

Current issue:

- `package.json` version is `0.4.168`.
- `server.json` and `lhm.plugin.json` still show `0.4.163`.
- `server.json` npm package still does not declare `XMEMO_KEY` and `XMEMO_URL` environment variables used by `bin/mcp-stdio.js`.

Required fix:

- Sync versions before release.
- Add npm package `environmentVariables` for `XMEMO_KEY` and optional `XMEMO_URL`.
- Do not add an OCI package unless a real Docker/OCI image exists.

### P3: Test coverage is still mostly happy-path

Add missing tests from the original plan:

- JSON removes legacy names from `mcpServers`, `mcp`, and `context_servers`.
- Continue/JetBrains experimental entries are removed, including private/custom URLs inferred from removed top-level entries.
- TOML removes root and child tables.
- YAML complex shapes fail closed without writing.
- Copilot removes legacy names and preserves other servers.
- Missing files are not created.
- Non-interactive text-mode writes without `--yes` fail clearly instead of hanging or silently cancelling.

## Background

`xmemo setup --all --write` / `xmemo setup --all --yes` writes the XMemo MCP server entry into detected client configs. Users need a symmetric command that removes XMemo entries without deleting unrelated MCP servers, user credentials, identity files, or client config files.

## Goal

Add an `uninstall` command:

```bash
xmemo uninstall --all              # remove XMemo from every detected existing config after confirmation
xmemo uninstall --client cursor    # remove from one client after confirmation
xmemo uninstall cursor             # shorthand for --client cursor
xmemo uninstall --all --dry-run    # preview only
xmemo uninstall --all --yes        # skip confirmation
xmemo uninstall --all --profiles   # also remove marker-scoped behavior profiles
xmemo uninstall cursor --profiles --target ./AGENTS.md
```

## Non-goals

- Do not delete `~/.config/xmemo`, `%LOCALAPPDATA%\XMemo\CLI`, `~/.xmemo`, `~/.memory-os`, `credentials.json`, saved login credentials, or agent identity files.
- Do not stop or manage running `xmemo mcp proxy` / Copilot proxy processes.
- Do not remove marketplace plugin assets from this repository.
- Do not add a Docker/OCI package unless an actual image, build workflow, and image labels exist.

## Scope

### What gets removed

1. MCP server entries named `XMemo` or legacy names from `LEGACY_MCP_SERVER_NAMES` (`memory_os`, `memory-os`) in supported client config files.
2. Continue/JetBrains `experimental.modelContextProtocolServers` duplicate entries created by the current writer.
3. Optional marker-scoped behavior profiles via `--profiles`.

### What is preserved

- Config files themselves, even if the relevant section becomes empty.
- Other MCP servers in the same config file.
- User credentials and local identity files.
- Any profile text outside the XMemo marker block.

## CLI behavior

```text
xmemo uninstall [client] [options]

Positional:
  client                Client id or setup alias, e.g. cursor, gemini, kimi, copilot

Options:
  --all                 Uninstall from all detected existing client config files
  --client <id>         Uninstall from one client
  --profiles            Also remove marker-scoped behavior profiles
  --target <path>       Profile target for single-client --profiles cleanup
  --profile-target <path>
  --yes, -y             Skip confirmation prompt and write changes
  --dry-run, --preview  Show what would be removed without writing
  --json                Output machine-readable JSON only
  --help                Show help
```

Rules:

- `--all` and a specific client are mutually exclusive.
- At least one of `--all`, `--client <id>`, or positional `client` is required.
- Use `normalizeSetupClientId()` so setup aliases also work for uninstall.
- `--dry-run` / `--preview` never writes.
- `--json` never prompts. With `--json --yes`, write and return the result. With `--json` without `--yes`, return a dry-run plan.
- In text mode without `--yes`, prompt before writing. If stdin is non-interactive, fail with a clear message asking for `--yes` or `--dry-run`.
- `XMemo not found` is a successful skip, not an error.

## Shared scan design

Create `src/mcp/clients/scan.js`:

```js
export const AUTO_SCAN_CLIENT_IDS = [
  ...supportedMcpClientIds(MCP_CLIENTS),
  'copilot-cli'
];

export function clientConfigPathCandidates(clientId, env, mcpClients) { ... }
export async function detectedSetupTargets(clientIds, env, mcpClients) { ... }
export async function existingUninstallTargets(clientIds, env, mcpClients) { ... }
```

Important differences:

- `detectedSetupTargets()` may keep existing setup behavior and consider parent directories.
- `existingUninstallTargets()` must only return existing files.
- Return all known candidate paths, not only the first match. This matters for Copilot CLI and Cline, which have multiple possible config locations.
- Deduplicate by normalized absolute `configPath` plus `configKind` / section so shared files are processed once. Antigravity variants and Continue/JetBrains can point at the same files.
- Update `setup --all` to use the shared scan list so setup and uninstall stop drifting. This intentionally expands `setup --all` to all write-capable clients in `MCP_CLIENTS` plus `copilot-cli`.

## Removal result shape

Each remover should support a dry-run mode and return a structured result:

```js
{
  client: 'cursor',
  label: 'Cursor',
  configPath: '...',
  configKind: 'json',
  status: 'removed' | 'not_found' | 'missing' | 'error',
  changed: true,
  removedNames: ['XMemo'],
  detail: null
}
```

The top-level JSON output:

```json
{
  "dryRun": false,
  "write": true,
  "profiles": true,
  "removed": [],
  "skipped": [],
  "errors": []
}
```

Return exit code `1` if any config parse/write error occurs. Return `0` for success, dry-runs, and "nothing to remove".

## Format removal design

### JSON clients: `src/mcp/formats/json.js`

Add:

```js
removeJsonClientMcpConfig(clientId, configPath, options = {})
removeJsonMcpConfig(configPath, sectionName, options = {})
```

Behavior:

- Do not create missing files.
- Parse JSON with `parseJsonConfig()`. If the root or target section is not an object, report an error for that target.
- Use `knownMcpServerNames()` from `src/mcp/core/names.js`.
- Remove entries from the client definition's section:
  - normal clients: `mcpServers`
  - OpenCode: `mcp`
  - Zed: `context_servers`
- Preserve the section as `{}` if it becomes empty.
- For definitions with `mergeExperimentalModelContextProtocolServers`, remove array entries when:
  - the entry URL equals the URL from a removed top-level XMemo entry, or
  - the entry has XMemo attribution headers (`X-Memory-OS-Agent-ID` / `X-Memory-OS-Agent-Instance-ID`), or
  - the entry shape matches the current XMemo nested transport writer.
- Write with the repository's existing JSON convention: `JSON.stringify(parsed, null, 2) + '\n'`.

### TOML clients: `src/mcp/formats/toml.js`

Add/export:

```js
removeTomlServerConfig(configPath, options = {})
removeTomlServerBlocks(content, names)
```

Behavior:

- Remove `[mcp_servers.XMemo]` and all child tables such as `[mcp_servers.XMemo.http_headers]`.
- Remove legacy names too.
- Do not leave orphan child tables.
- Preserve unrelated TOML tables.
- Reuse the same fixed block removal in `appendTomlServerConfig()` and `appendGrokServerConfig()` when `--force` overwrites an existing entry.

This is a required prerequisite because the current helper can leave stale child tables behind.

### YAML clients: `src/mcp/formats/yaml.js`

Add:

```js
removeHermesMcpConfig(configPath, options = {})
```

MVP behavior:

- Avoid adding a YAML dependency for this change.
- Use a narrow raw-text remover that only targets canonical entries under top-level `mcp_servers:`.
- Remove `XMemo`, `memory_os`, and `memory-os` mapping blocks at the expected indentation.
- Preserve unrelated YAML and other `mcp_servers` entries.
- If the file uses a complex YAML shape that the narrow remover cannot confidently edit, return `manual_edit_required` / `error` instead of guessing.

Follow-up option: migrate Hermes writer/remover to a real YAML parser in a separate change.

### Copilot CLI proxy: `src/mcp/proxy/copilot.js`

Add:

```js
removeCopilotMcpConfig(configPath, options = {})
```

Behavior:

- Remove `mcpServers.XMemo` and legacy names from the Copilot config shape.
- Preserve other `mcpServers`.
- Do not stop proxy processes.
- Scan both VS Code user `mcp.json` candidate paths and `defaultCopilotConfigPath(env)`.

## Behavior profile cleanup

Use existing marker-scoped helpers:

```js
profileUninstallResult(clientId, targetPath, { write })
```

Do not call `profileInstallResult()` for uninstall and do not delete profile files.

Rules:

- For single-client uninstall with `--profiles`, use `--target` / `--profile-target` if supplied, otherwise `defaultProfileTarget(clientId, env)`.
- For `--all --profiles`, attempt profile cleanup for profile-supported scanned clients. The profile result should be reported separately even when the MCP config was already absent.
- If markers are malformed or duplicated, report an error and leave the file untouched.

## Command implementation

Create `src/commands/uninstall.js`:

1. Parse and validate CLI args.
2. Resolve client ids using existing setup aliases.
3. Build an uninstall plan from existing files only.
4. Add optional profile cleanup plans.
5. In dry-run mode, render plan and exit.
6. In write mode, prompt unless `--yes` or JSON mode with `--yes`.
7. Apply removals per target, continuing after per-file errors.
8. Render text summary or JSON result.

Register the command in `src/cli.js`. `bin/memory-os.js` does not need command registration changes because it only delegates to `run()`.

Create `src/ui/uninstall.js` for text output and confirmation helpers.

## Docker/OCI and registry metadata audit

Current state:

- `server.json` has a remote `streamable-http` endpoint and one npm package.
- No Dockerfile, OCI image, `registryType: "oci"` package, `runtimeArguments`, `packageArguments`, or image annotation is present.
- `bin/mcp-stdio.js` reads `XMEMO_KEY` and optional `XMEMO_URL`, but the npm package entry in `server.json` does not declare those `environmentVariables`.
- `server.json` / `lhm.plugin.json` versions are behind `package.json`.

Official MCP registry docs say Docker/OCI images use `registryType: "oci"` with an identifier like `registry/namespace/repository:tag`, and Docker image ownership is verified with the `io.modelcontextprotocol.server.name` image annotation:

- https://modelcontextprotocol.io/registry/package-types
- https://raw.githubusercontent.com/modelcontextprotocol/registry/refs/heads/main/docs/reference/server-json/generic-server-json.md

Recommended metadata follow-up:

1. Sync `server.json`, `lhm.plugin.json`, and `package.json` versions before release.
2. Add npm package `environmentVariables`:

```json
[
  {
    "name": "XMEMO_KEY",
    "description": "Bearer token issued by XMemo for the stdio proxy.",
    "isRequired": true,
    "isSecret": true
  },
  {
    "name": "XMEMO_URL",
    "description": "Optional XMemo service base URL. Defaults to https://xmemo.dev.",
    "isRequired": false,
    "isSecret": false
  }
]
```

3. Only add an OCI package if a real image is published. Minimum OCI package shape:

```json
{
  "registryType": "oci",
  "identifier": "ghcr.io/yonro/xmemo-client:0.4.168",
  "transport": {
    "type": "stdio"
  },
  "environmentVariables": [
    {
      "name": "XMEMO_KEY",
      "description": "Bearer token issued by XMemo for the stdio proxy.",
      "isRequired": true,
      "isSecret": true
    },
    {
      "name": "XMEMO_URL",
      "description": "Optional XMemo service base URL. Defaults to https://xmemo.dev.",
      "isRequired": false,
      "isSecret": false
    }
  ]
}
```

4. The Docker image must include:

```dockerfile
LABEL io.modelcontextprotocol.server.name="io.github.yonro/xmemo"
```

5. Add `runtimeArguments` only when the image truly needs Docker runtime flags such as mounts, network mode, or explicit `-e` mappings. Do not invent Docker parameters for a remote-only/npm-only release.

## Files to change

| File | Change |
|------|--------|
| `src/commands/uninstall.js` | New command implementation |
| `src/cli.js` | Register `uninstall` |
| `src/mcp/clients/scan.js` | Shared setup/uninstall scan list and candidate paths |
| `src/commands/setup.js` | Reuse shared scan list for `setup --all` |
| `src/mcp/clients/registry.js` | Add `removeConfig` methods to client objects |
| `src/mcp/clients.js` | Wire remover dependencies into registry |
| `src/mcp/formats/json.js` | Add JSON dry-run/write removal helpers |
| `src/mcp/formats/toml.js` | Add safe TOML root+child table removal and reuse it for force overwrite |
| `src/mcp/formats/yaml.js` | Add narrow Hermes raw YAML removal helper |
| `src/mcp/proxy/copilot.js` | Add Copilot config removal helper |
| `src/ui/uninstall.js` | Text summary and confirmation helpers |
| `src/ui/help.js` | Document `uninstall` |
| `README.md` | Document command and safety guarantees |
| `server.json` | Metadata follow-up: env vars/version sync; OCI only if image exists |
| `lhm.plugin.json` | Version sync follow-up |
| `test/cli.test.js` | CLI and format behavior tests |

## Testing plan

### Unit/helper tests

- JSON removes `XMemo` / legacy names from `mcpServers`, `mcp`, and `context_servers`.
- JSON preserves other MCP servers and keeps empty sections as `{}`.
- JSON removes Continue/JetBrains experimental entries copied from the XMemo top-level entry.
- JSON missing file returns `missing` and does not create a file.
- TOML removes `[mcp_servers.XMemo]` and `[mcp_servers.XMemo.http_headers]`.
- TOML removes legacy names and preserves unrelated TOML tables.
- TOML `--force` setup overwrite no longer leaves orphan child tables.
- YAML removes canonical Hermes `mcp_servers.XMemo` blocks and preserves other servers.
- YAML complex/unsupported shapes fail safely without writing.
- Copilot removes `mcpServers.XMemo` and preserves other servers.
- Profile uninstall removes only marker blocks and preserves surrounding user text.

### CLI tests

- `xmemo uninstall cursor --dry-run` reports intended removal without writing.
- `xmemo uninstall cursor --yes` removes only Cursor config.
- `xmemo uninstall kimi --yes` resolves aliases correctly.
- `xmemo uninstall --all --dry-run` reports existing config files only.
- `xmemo uninstall --all --yes` removes all detected existing entries.
- `xmemo uninstall --all --profiles --yes` removes config entries plus marker-scoped profiles.
- `xmemo uninstall --all --json` emits a dry-run JSON plan and does not prompt.
- `xmemo uninstall --all --json --yes` writes and emits JSON result.
- `xmemo uninstall --all` with no XMemo present exits `0` with "nothing to remove".
- Invalid JSON/TOML/YAML is reported for that client while other clients continue.
- Non-interactive write without `--yes` fails with a clear safety message.

### Safety tests

- No missing config file is created by uninstall.
- Other MCP servers in the same config file are preserved.
- Shared config paths are not processed repeatedly.
- Credentials and identity files are untouched.
- `--profiles` does not delete profile target files.

## Acceptance criteria

- `xmemo uninstall --all --dry-run` is safe and useful on a real developer machine.
- `xmemo uninstall --all --yes` removes only XMemo MCP entries from existing detected config files.
- `xmemo uninstall <client> --profiles --yes` removes that client's config entry and marker-scoped profile without touching credentials or unrelated text.
- TOML force overwrite and uninstall both remove nested header tables correctly.
- Setup and uninstall share one scan source.
- Docker/OCI metadata is either explicitly deferred because no image exists, or implemented only with a real published image and required MCP registry fields.

## Implementation order

1. Fix TOML root+child table removal first, and reuse it for setup `--force`.
2. Implement uninstall `--json` contract and add JSON output tests.
3. Add per-client error isolation for `--all`, including `plan.errors` and exit code `1` when errors occur.
4. Decouple `--profiles` cleanup from config removal and support explicit `--target` / `--profile-target`.
5. Add shared setup/uninstall scan helpers and remove hard-coded list drift.
6. Extend scan helpers to return all existing uninstall candidate files, especially Copilot/Cline paths.
7. Strengthen JSON, Copilot, and Hermes removal tests for legacy names, experimental entries, missing files, and fail-closed YAML.
8. Update docs/help to match actual behavior after the fixes.
9. Run `npm run lint` and `npm test`.
10. Separately sync registry metadata versions and add npm package env vars; add OCI package only if the Docker image exists.
