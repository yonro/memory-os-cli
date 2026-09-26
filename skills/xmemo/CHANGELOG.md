# XMemo Skill Change Log

## [Unreleased]

### Fixed

- Prevent empty error messages (such as `Get activity failed: ` or `Login polling error: `) when Node throws `AggregateError` with an empty message string or network connection failures occur; introduce `describeError` helper in `error-text.mjs` to unpack nested errors, preserve error codes, and sanitize output against terminal control codes and credential leakage.
- Enhance `doctor` discovery diagnostics: include `errorDetail` (bounded to 200 characters) in `clientDiagnostics.discovery` when discovery is unavailable while preserving `status: "unavailable"` and `errorCode`, and add a single 500ms retry on non-HTTP discovery network failures before marking discovery unavailable.
- Ensure API error extractors (`apiErrorMessage`, `outputRestError`, `outputJsonFailure`) never emit blank error text.

### Documentation

- Restructure `SKILL.md` to prioritize core memory workflows (expanded session recall, what/when to remember, update vs. new memory, forget guards, restart continuity, TODOs, expenses, and diagnostics) while compacting the command reference table into a single unified syntax summary and moving detailed authentication setup to `references/auth-setup.md` and direct memory operations / REST details to `references/command-details.md` without dropping any facts.
- Update `SKILL.md` First Successful Run and credential sections with Option B guidance: run `node scripts/xmemo-skill.mjs login --allow-plaintext` immediately upon exit code 2 ("No XMemo credential found") without separate chat confirmation; inform the user that browser approval authorizes unencrypted token storage in `~/.xmemo` (0600) or they may configure `XMEMO_KEY` from a secret store; browser approval constitutes consent; forbid silent token pasting and enforce that `register` remains strictly restricted to unattended or declined scenarios.
- Document `expense-add` in `SKILL.md`, `references/ledger-operations.md`, and `references/runtime-operations.md` as a WRITE operation requiring `ledger:write` scope that creates a persistent ledger entry on the XMemo service, requiring explicit confirmation when agent-inferred (SQP-2 Medium).

## 1.1.27

### Fixed

- Trim whitespace from `XMEMO_KEY` in `getStoredCredential` and treat empty/whitespace-only values as unset, allowing fallback to Meta Muse Secure Vault or user credential files.
- Refine `exitCodeForErrorCode` in `core.mjs` using `/^http 40[13](?!\d)/` regex matching to avoid misclassifying non-standard error codes starting with 401/403 (such as `http 4010`).
- Ensure consistent terminal output sanitization across `ledger-list`, `ledger-summary`, `overview`, `activity`, and `stats` commands.
- Map non-2xx status codes in `auth status --verify` via `exitCodeForHttpStatus(res.statusCode)` rather than classifying all non-5xx errors as authentication errors (e.g., 429/404 exit 1, 503 exits 3).
- Sanitize error messages in catch blocks across `auth-login.mjs`, `memory.mjs`, and `ops.mjs` before printing to terminal output.
- Merge duplicate `console.error` branches in Meta Muse vault resolution and silently fall through on expected `unavailable` or `missing` keys.
- Write back parsed integer for `--ttl_seconds` across `save-state` and `state-save` commands, ensuring consistent numeric representation in serialized payloads.
- Fail closed on OpenClaw secret sentinel look-alikes (`oc-sent-*`) that do not match exact v2 syntax, exiting with code 1 (`USER_ERROR`) and zero network requests while refusing persistence in `saveToken` and `auth add` and redacting look-alike sentinels in output sanitization.
- Print credential source hint on stderr when commands fail with `AUTH_ERROR` (HTTP 401/403 or authentication error codes) in terminal mode, while keeping `--json` envelopes unchanged.

### Added

- Add missing one-line descriptions to `COMMAND_USAGE_REGISTRY` in `help.mjs` for `read`, `update`, `forget`, `ledger-list`, `ledger-summary`, `remember`, `recall`, `search`, `todo-add`, `todo-list`, `todo-done`, `expense-add`, and `doctor`.

### Documentation

- Document in `SKILL.md` that `remember --file` follows symbolic links and requires the resolved target to be a regular file.
- Document 64 KiB input size limit for `auth add --from-stdin` in `SKILL.md` and `references/troubleshooting.md`.
- Document LF-clean ClawHub publishing instructions using GitHub Release tarball extractions in `docs/xmemo-skill-release.md`.
- Document credential lifetime characteristics and symptom/repair steps for file-backed credentials in `SKILL.md` and `references/troubleshooting.md`, clarifying that local credential files store no access-token expiry.

## 1.1.26

### Fixed

- Classify HTTP 401 and 403 status codes using whole-number word boundaries, avoiding false-positive authentication error classifications on port numbers and identifiers.
- Clarified documentation for `ledger-list` in `references/ledger-operations.md` and `SKILL.md` to consistently describe it as a strictly read-only query command, explicitly noting that deleting or voiding a ledger entry is a separate operation requiring explicit confirmation (`forget --id <id> --confirm`) and a delete-capable scope (for example `memory:delete`; see the forget section for the full list).
- Structured reference links in `SKILL.md` as direct Markdown links with one-line descriptions.

### Changed

- Modularized stdin and file input reading into a dedicated helper module (`scripts/lib/bounded-read.mjs`) with explicit streaming byte counting: capped at `MAX_MEMORY_CONTENT_BYTES` (512 KiB) for memory content and `MAX_STDIN_INPUT_BYTES` (64 KiB) for single-value stdin inputs (`auth add`), with early rejection on stream overflow.

## 1.1.25

### Added

- Support Meta Muse Secure Vault credentials (credential resolution order: `XMEMO_KEY` → `muse-vault` surrogate token via local socket → user credential file; surrogate tokens are restricted strictly to `https://xmemo.dev` and are never stored to disk or printed).
- Support OpenClaw secret egress proxying: `XMEMO_KEY` holding an OpenClaw sentinel token is reported as `openclaw-secret`; outbound requests fail closed unless the egress proxy environment (`HTTPS_PROXY` or `https_proxy`, and truthy `NODE_USE_ENV_PROXY`) is active, and sentinels are only sent to `https://xmemo.dev`.

## 1.1.24

### Changed

- Enforce a 512 KiB input size limit on `remember` via stdin and `--file` (matching the server single-item limit), using bounded reads that reject non-regular files and prevent unbounded buffering.
- Standardize `restart-snapshot` and `restart-restore` failure output under `--json` mode into the unified `{ok: false, error: {code, message, request_id}}` envelope, preserving HTTP exit code mapping.
- Split monolithic operations reference into scoped `memory-operations.md`, `ledger-operations.md`, and `runtime-operations.md` guides (each under 12 KB), updating cross-document links and security documentation phrasing.

## 1.1.23

### Changed

- Split the runtime into a small entrypoint plus `scripts/lib/` and `scripts/commands/` modules (12 files, each under 12 KB). Commands, options, terminal and `--json` output, exit codes, and installation are unchanged.

## 1.1.22

### Changed

- Lean skill package: removed maintainer smoke test script (`smoke-test.mjs`) and release workflow documentation, keeping only consumer skill assets; maintainer workflows migrated to repository-level `scripts/` and `docs/`.

## 1.1.21

### Fixed

- Wrap `restart-snapshot` and `restart-restore` successful `--json` output in standard `{"ok": true}` envelope matching other skill commands.

## 1.1.20

### Added

- Add pre-release smoke-test script (`scripts/smoke-test.mjs`) to validate exit codes, `--json` envelope keys (`ok: true`, error `error.code`), and command safety across all read-only commands by default, gating write commands behind `--execute-writes` and outputting structured failure checklists.
- Support stdin (`--content -`) and file import (`--file <path>`) for `remember`, mutually exclusive with `--content <text>`, with byte-identical payload validation and transmission.

### Changed

- Append server `request_id` to terminal error output when returned in server error responses.
- Display remaining authorization validity countdown while waiting for authorization in `login` (e.g. `Waiting for authorization... (valid for 9m32s)`).
- Automatically default to JSON output when stdout is not a TTY (e.g. piped or redirected) unless explicit `--terminal` (`--no-json`, `--plain`) is provided.
- Merge duplicate usage blocks into a single source of truth, aligning command arguments and eliminating drift between `--help` and command-specific help.
- Normalize process exit codes across all commands: `0` for success/help/version/valid empty states, `1` for user argument/flag/file validation and 4xx client errors, `2` for missing credentials and 401/403 authentication/authorization errors, and `3` for 5xx server errors, connection refusal, timeouts, and oversize response limits.

## 1.1.19

### Changed

- Route `overview`, `activity`, `ledger-list`, and `ledger-summary` commands to key-authenticated `POST /v1/skill/operations` instead of session-backed `/v1/me/*`.
- Enforce strict parameter allow-listing and client-side argument mapping for `overview`, `activity`, `ledger-list`, and `ledger-summary` without sending `owner_id` or `user_id`.
- Preserve 403 authorization rejections without downgrade and clearly prompt for re-authorization to explicitly grant required scopes (`memory:read` / `ledger:read`).
- Consolidate `SKILL.md` middle section into unified Bundled Command Reference with organized subsections for Direct Memory, Ledger, Diagnostics, Knowledge, and Auth.

### Fixed

- Support `reminders` array in `extractList` for `todo-list` terminal rendering when server returns `{ reminders: [...] }`.

## 1.1.18

### Added

- Add read-only `read` command to retrieve a single memory by ID via `GET /v1/memories/{id}/explain?include_embedding=false` with character-window pagination (`--offset`, `--limit`) and minimal projection.
- Add write-side `update` command to modify an existing memory via `PATCH /v1/memories/{id}` with `--content`, `--path`, `--metadata`, `--bucket`, and `--scope`.
- Add write-side `forget` command for soft deletion via `POST /v1/memories/{id}/forget` with mode `soft_delete` and mandatory `--confirm` protection against accidental deletion.
- Add strictly read-only `ledger-list` command to retrieve personal financial transactions via `GET /v1/me/ledger/transactions` with filtering and local `--month` date-range resolution.
- Add strictly read-only `ledger-summary` command to aggregate monthly financial totals via `GET /v1/me/ledger/monthly-summary`.
- Add strictly read-only `overview` command to view personal account metrics (memory counts, storage usage, active agents, tokens) via `GET /v1/me/overview`.
- Add strictly read-only `activity` command to inspect recent account activity via `GET /v1/me/activity` with optional `--limit`.
- Add strictly read-only `stats` command to inspect memory statistics and dimensional aggregations via `GET /v1/memories/stats` with strict query filtering and `--top-n` bounds.

### Fixed

- Harmonize `read --json` output envelope with `ok: true`.
- Replace fallback literal `'v1'` version string in `read` projection with `null` (rendered as `(unknown)` in terminal mode).
- Pass through server 400 `invalid_memory_id` responses on `update` and default unexpected 400s to `invalid_request`.
- Display `(unknown)` instead of `0` in `ledger-list` terminal rendering when transaction amount is missing.
- Preserve all existing command contracts, requests, authentication, scopes, and runtime behavior.

## 1.1.17

- Clarify TODO completion and creation terminal feedback by extracting and
  displaying confirmed resource IDs on `todo-add` and `todo-done`.
- Improve `restart-restore` terminal reporting when no active restart snapshot
  exists to restore.
- Preserve existing requests, authentication, scopes, service APIs, and all
  runtime command behavior.

## 1.1.16

- Preserve the read-only `doctor --json` discovery summary when a service omits
  top-level `service_version`: expose the separately advertised standalone Skill
  package version without inferring it is a service version.
- Preserve existing requests, authentication, scopes, service APIs, and all
  runtime command behavior.

## 1.1.15

- Add explicit read-only Knowledge support to `recall-context` through the
  opt-in `--include_knowledge true` flag; the default request remains
  Memory-only for backward compatibility.
- Request the least-privilege `knowledge:read` scope during new formal Skill
  device login. Existing credentials are never expanded automatically; use
  verified reauthorization when Knowledge access is needed.
- Include `recall-context` in top-level help and document the Knowledge scope,
  service feature, temporary-token, and untrusted-context boundaries.
- Tests cover the opt-in request field, strict boolean parsing, login scope,
  top-level help, and Knowledge authorization documentation.

## 1.1.14

- Align the documented standalone Skill runtime with the MemoryOS Node.js
  baseline: Node.js 22.22.0 or newer.
- Keep the runtime behavior, authentication, scopes, service APIs, and package
  metadata unchanged.

## 1.1.13

- Add the read-only `recall-context` command for the service's bounded,
  prompt-ready `/v1/recall/context` response, with client-side budget validation.
- Preserve existing authentication, scopes, temporary-sandbox limits, and all
  other runtime commands.

## 1.1.12

- Add a short first-successful-run path: anonymous service health check,
  deliberate credential choice, and credential verification before memory work.
- Preserve runtime commands, network requests, authentication, scopes,
  credential behavior, service APIs, and MCP fallback behavior.

## 1.1.11

- Simplify the standalone Skill description so agents can discover its core
  memory, continuity, TODO, expense, and diagnostics workflows without an
  exhaustive command list.
- Preserve the existing runtime commands, authentication, scopes, service
  requests, and MCP fallback behavior.

## 1.1.10

- Clarify plain-text `doctor` output: an explicit `--anonymous` health check
  now says authentication was not checked, while a normal no-credential check
  prints the formal-login next command.
- Preserve the existing read-only health request, JSON diagnostics, credential
  lookup, authentication, scope, and degraded-discovery behavior.

## 1.1.9

- Expand the bounded, read-only `doctor --json` discovery summary with the
  advertised service version, MCP URL, and supported clients so agents can
  diagnose compatibility without parsing the raw discovery document.
- Preserve existing anonymous, credential, health-check, and degraded-discovery
  behavior; the new fields come only from the public discovery response.

## 1.1.8

- Consolidate repeated command examples in `SKILL.md`: document each canonical
  command once, while retaining `auth-status` as a runtime compatibility alias.

## 1.1.7

- Stop shipping `install.sh` and `install.ps1` inside the published Skill. Their
  only job is to download this archive, so packaging them within it was circular
  and left two unused scripts in every install destination. They now live beside
  the Skill in the source repository and remain available from the published
  installer endpoints.
- Skill runtime, commands, credential handling, and network behaviour are
  unchanged; this release only removes two files that no runtime path used.

## 1.1.6

- Remove repeated standalone-installation links from `SKILL.md`; installation
  distribution remains owned by the package and release surfaces, while this
  Skill starts at runtime selection and explicit credential setup.

## 1.1.5

- Add zero-dependency POSIX and PowerShell installers for the published
  standalone Skill archive. Both enforce HTTPS-only download paths, reject
  non-HTTPS redirects, verify the bundled runtime entrypoint, and never accept
  or send XMemo credentials.
- Document the installer commands and their destination/origin boundaries;
  installation remains separate from explicit login and credential setup.
- Regression coverage pins the HTTPS, redirect, entrypoint, and no-token
  guarantees for both installer scripts.

## 1.1.4

- `scripts/xmemo-skill.mjs`: add a bounded, token-free `clientDiagnostics`
  block to `doctor --json`, including read-only discovery service/capability
  summary and a concrete next credential-check or sign-in command.
- Diagnostics: when discovery is unavailable, report a stable degraded status
  without failing an otherwise healthy doctor operation or changing any auth,
  write, or restart-continuity behavior.
- Tests and Skill documentation: cover authenticated, anonymous, and degraded
  discovery output while preserving the no-Authorization-header guarantee for
  `doctor --anonymous`.

## 1.1.3

- `scripts/xmemo-skill.mjs`: report a clear empty-state result when a successful
  `restore-state` response contains no saved state, while preserving the
  requested key and an explicit empty-content marker for valid state objects.
- Tests: cover empty and partially populated state-restore responses so the
  standalone command does not print `undefined` to users.

## 1.1.2

- `SKILL.md` and references: distinguish the public generic
  `/v1/skill/operations` discovery list from the formal-account-only direct
  restart-continuity routes. This prevents a missing restart entry in
  `standalone_skill.operations` from being misread as an unavailable command.
- Documentation and tests: clarify that temporary agents never receive restart
  continuity, that discovery alone is not authorization, and that an
  unauthenticated `401` is route reachability rather than a write-capability
  proof.

## 1.1.1

- `scripts/xmemo-skill.mjs`: add formal-account `restart-snapshot` and
  `restart-restore` commands for the Memory OS v0.4.335 full-continuity
  contract, without replacing the lightweight `save-state` / `restore-state`
  workflow or widening temporary-agent permissions.
- `scripts/xmemo-skill.mjs`: validate restart snapshot limits, TTLs, metadata,
  and restore booleans; keep normal output bounded to IDs/timestamps while
  retaining redacted `--json` output for trusted callers.
- `SKILL.md` and references: explain when to use single-state handoff,
  full restart continuity, or native MCP restart tools.
- Tests: pin the advertised runtime version to the newest change-log heading so
  a released section is never reopened for new work.

## 1.1.0

- `scripts/xmemo-skill.mjs`: align the advertised and runtime version at `1.1.0` while preserving the `XMemo Memory` package identity and formal-account-first login policy.
- `scripts/xmemo-skill.mjs`: add the discovery-compatible `auth-status` alias and `auth claim-deny` for the server's two-phase temporary-account bind flow.
- `scripts/xmemo-skill.mjs`: read temporary item/expiry limits from `/.well-known/xmemo-agent.json`, disclose them immediately after registration, and use the documented production limits as a non-blocking fallback when discovery is unavailable.
- `scripts/xmemo-skill.mjs`: route temporary `search` to `/v1/memories/search`, keep `recall` on `/v1/recall`, and retain temporary access only for `remember`, `recall`, and `search`.
- `scripts/xmemo-skill.mjs`: parse `--metadata` as a JSON object, parse `--explain` and `--prefer_working` as strict booleans, and validate state `--ttl_seconds` against the hosted `0..604800` contract.
- `scripts/xmemo-skill.mjs`: retain the established formal device-login scopes, including `ledger:read`; no server API contract or destructive memory command was added.
- `SKILL.md` and references: document the formal-account default, temporary limits, status alias, bind-denial flow, and typed argument examples without exposing credential values.
- Tests: cover dynamic temporary limits, temporary search routing, bind denial and pending-token cleanup, typed arguments, the `auth-status` alias, version output, and documentation invariants.

## 1.0.9

- Removed the non-runtime `skill-card.md` file. No user-facing, documentation, or runtime behavior changed in this marketplace release.

## 1.0.8

- `scripts/xmemo-skill.mjs`: advance the standalone runtime to `1.0.8` while preserving the existing REST operations, formal-login flow, temporary sandbox, and explicit plaintext fallback.
- `scripts/xmemo-skill.mjs`: stop displaying token prefixes and prevent `logout` from revoking an externally managed `XMEMO_KEY` unless `--revoke-environment-token` is explicitly supplied.
- `scripts/xmemo-skill.mjs`: add `doctor --anonymous`, command-specific login/register/logout help, `--version`, strict command parameter allowlists, required-argument validation, and sensitive command-line option rejection.
- `scripts/xmemo-skill.mjs`: require HTTPS for remote custom origins while retaining loopback HTTP for local development, warn before authenticated custom-origin requests, and add bounded request timeouts plus an 8 MiB response limit.
- `scripts/xmemo-skill.mjs`: honor device-login expiry, preserve the established formal-account memory and ledger scope set, redact sensitive fields from every JSON operation response, and sanitize human-readable server content for terminal safety.
- `SKILL.md` and references: document the compatible logout/anonymous-doctor behavior, timeout and origin boundaries, Node.js requirement, and copyable POSIX/PowerShell token-input examples.
- Tests: cover anonymous diagnostics, external environment-token logout, token-prefix suppression, unsafe origin and secret-option rejection, timeout/response limits, JSON redaction, the established formal-login scope set, device-login expiry, command help, and version output.

- `scripts/xmemo-skill.mjs`: keep `XMEMO_KEY` as the highest-priority credential source and never copy an environment token into local storage.
- `scripts/xmemo-skill.mjs`: require explicit `--allow-plaintext` consent before `login`, `auth add`, or temporary registration writes any bearer credential; replace the inaccurate “stored securely” claim with the exact storage path and an unencrypted-storage warning.
- `scripts/xmemo-skill.mjs`: restrict the XMemo credential directory/file to `0700`/`0600` where POSIX permissions are supported, record consent metadata, and warn when reading a legacy unmarked plaintext credential.
- `scripts/xmemo-skill.mjs`: minimize temporary credential metadata, redact token-shaped fields from JSON claim/error output, and clear pending confirmation data after handoff.
- `SKILL.md` and references: document credential precedence, explicit plaintext consent, temporary bind-URL handling, and migration guidance while keeping formal account login recommended.

- `scripts/xmemo-skill.mjs`: add an explicit, policy-gated `register --reason unattended|declined` fallback for the server's unauthenticated agent registration. Formal `login` remains the primary path.
- `scripts/xmemo-skill.mjs`: persist temporary credentials locally, route their allowed `remember`/`recall`/`search` requests to the temporary REST sandbox, reject unsupported commands clearly, and support claim-status/claim-confirm formal-token handoff.
- `SKILL.md` and references: document the temporary sandbox limits, required user disclosure, bind URL, and formal-account upgrade path.

- `scripts/xmemo-skill.mjs`: normalize successful list payloads (`result.results`, `result.todos`, or a bare array), so `recall`, `search`, and `todo-list` never call `forEach` on an API wrapper object.
- `scripts/xmemo-skill.mjs`: extract IDs from object or string results for `remember` and `expense-add`, preventing `[object Object]` output.
- `scripts/xmemo-skill.mjs`: parse every REST response through one guarded JSON helper. Empty or non-JSON gateway responses now include the HTTP status and a bounded server-response preview.
- `scripts/xmemo-skill.mjs`: add global and command-level `--help`, clear unknown-command errors, and `--compact` rendering for recall/search.
- `SKILL.md` and `references/*.md`: make every command relative to the Skill root (`node scripts/xmemo-skill.mjs ...`) and document compact output and help.
- `test/xmemo-standalone-skill.test.js`: add regression coverage for wrapped list payloads, object IDs, help output, and non-JSON responses.
