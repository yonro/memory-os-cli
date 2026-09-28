# Changelog

All notable changes to the XMemo CLI client will be documented in this file.

## [Unreleased]

## [0.4.188] - 2026-09-29

### Added
- **Dogfood CLI Enhancements (CLI-DOGFOOD)**:
  - **Schema Unification**: Standardized `data.items` across `xmemo memory search`, `xmemo memory list`, and `xmemo context recall`. Every item includes consistent attributes: `id`, `memory_id`, `path`, `content`, `created_at`, and `score` (similarity score for search, context score for recall, null for list). Preserves existing `id` on list items while ensuring `memory_id` is the stable reference. Full backward compatibility maintained for `data.results` (search), `data.memories` (list/recall), and numeric property access `data[0..n]`.
  - **Path Normalization**: Added robust path normalization (`normalizeMemoryPath`) and prefix matching (`matchesPathPrefix`) for `xmemo memory list`. Automatically handles case-insensitivity, leading/trailing slashes, whitespace around slashes, and `[ROOT]/` stripping. Fast server-side prefix try first, falling back to bounded paging and client-side matching when 0 server results match. Added `--project <name>` shorthand (`projects/<name>`) and `--exact-path` for literal matching.
  - **Memory List Filters & Auto-Paging**: Added `--query`/`--filter <text>` for substring searching over content and path, `--type <memory_type>` for memory type filtering, and `--all` for automatic multi-page retrieval (page size 500, hard cap 10,000 items with warning in `meta.warnings`, and stderr progress in human mode).
  - **Search Boost Reranking**: Added `--keyword <words...>` and `--exact <phrase>` to `xmemo memory search` with deterministic client-side reranking (exact phrase matches first, followed by keyword occurrence count, preserving stable original order on ties).
  - **EPIPE Safety**: Safe handling for `EPIPE` errors on `stdout` and `stderr` in bin entry and line writers, exiting cleanly with status code 0 when downstream readers (e.g. `head`, `less`) close the pipe.
  - **Memory Soft-Delete & Restore**: Added `xmemo memory delete <id> [--reason <text>] [--yes]` calling `POST /v1/memories/<id>/forget` with `[y/N]` confirmation, and `xmemo memory restore <id> [--yes]` calling `POST /v1/memories/<id>/restore` with clear guidance to MCP `restore_memory` if unavailable via REST.
- **Elegant Command Model (CLI-DESIGN v2)**:
  - **Unified Resource Grammar**: Standardized all component operations on `xmemo <resource> <action>` (`mcp`, `plugin`, `skill`, `profile`) with canonical actions `install`, `remove`, `status` (plus `list`/`info` for plugins and `update` for skills).
  - **Unified Target Resolver**: Smart client resolution across commands prioritizing explicit `--client <id>` / `--all`, calling agent environment (`CLAUDECODE` -> `claude-code`, Codex session -> `codex`), and auto-detected locally installed clients.
  - **Plan, Confirm Once, Apply Engine (`PlanRunner`)**: Atomic planning and execution engine displaying full unified plan previews, single confirmation prompt `[y/N]`, stop-on-first-failure, idempotency detection, and full `--dry-run`, `--yes`, and `--json` support.
  - **Declarative Client Registry**: All 24 client profiles declare setup composition (`setup.default`, `setup.optional`, `setupRecipe`) with zero hardcoded client ID string literals in command handlers.
  - **Dynamic Registry Extension**: Support for dynamic runtime client registration (`registerClient`, `unregisterClient`) with automatic index rebuilding and synthetic client testing.
  - **Client Resource Status Inspection (`xmemo status [<client>...|--all]`)**: Extended `xmemo status` to accept client identifiers and `--all` flag. Evaluates each client's resources according to registry declarations (MCP configuration status and path, plugin index status/detail, installed skill version and path, and profile presence and path) following service reachability probes, with structured `--json` output under `clients`.
  - **Document-backed Memory Expansion (`--expand-documents`)**: Added `--expand-documents` support to `xmemo memory search` and `xmemo context recall`. Detects document stubs via `metadata.document_ref`, `document_id`, or content prefix; prioritizes `memory_id` to expand up to 3 documents (up to 20,000 characters per document, per-item error tolerance without command failure) via `/api/v1/memories/<id>/explain`. Human mode guides users with `"Full document: xmemo memory read <id>"` when unexpanded or truncated, and expands `context_text` in recall. In `--json`, every document item retains `next_command` and indicates `document_expanded: true|false`.
  - **Knowledge Scope in Default Device Login**: Added `knowledge:read` to `DEFAULT_DEVICE_LOGIN_SCOPES` so `knowledge search/read` and `context recall --include-knowledge` succeed out-of-the-box after default `xmemo login`. 403 `knowledge_scope_required` provides the exact login command nextAction.

### Changed
- **Concise Human-Mode Command Output**: Replaced raw JSON dumps across `memory list` (one line per memory with path, ID, preview), `memory add` ("Saved memory <id> at <path>"), `state save/restore` (unwrapping nested `data.result` to show key, version, expiry, and content bounded to 2000 chars), `restart snapshot` (snapshot ID, expiry, item counts), and `cloud-skill list` (name, slug, asset_status with publication state). `--json` structure remains unchanged.
- **English Next Action Guidance & Help Schema**: Standardized all `nextAction` strings in error classifiers and client exceptions as well as all command option descriptions in `help-schema.js` to clean English.
- **Top-Level Help Alignment**: Aligned main `xmemo help` with CLI-DESIGN v2 grammar (`<resource> <install|remove|status>`, `status [<client>...|--all]`, `setup [<client>...]`, `uninstall [<client>...]`).
- **Backward-Compatible Command Aliases**: Kept `mcp add` (alias for `mcp install`), `profile uninstall` (alias for `profile remove`), and `skill remove` / `uninstall` (alias for `skill remove`) with helpful one-line stderr hints in interactive terminal mode while preserving clean JSON mode output.
- **Relocated Client Diagnostics**: Moved client-specific doctor implementations (`codexDoctor`, `kiroDoctor`) into dedicated `src/diagnostics/` modules, eliminating command-layer couplings.

### Fixed
- **Recall Document Stub Handling**: Fixed detection, hint, and expansion for recall items where `id != memory_id`, using `memory_id` for document fetching and updating `context_text`. In human mode, rendered the actual expanded document content directly, retaining `"Full document: xmemo memory read <id>"` only when content is truncated.
- **Server Prefix Variants & Literal Matching (`memory list`)**: Optimized `xmemo memory list` path matching to probe fast server-side prefix variants (trimmed outer slashes, collapsed whitespace around slashes, with/without `[ROOT]/`) before falling back to client scanning, matching in <1s. Supported `--exact-path` to execute exactly one literal server query with zero client scanning.
- **State Restore & Restore Scope Polish**: Omitted `version=` from `state restore` human output when version is absent or unknown. Provided the exact login command nextAction hint upon 403 Forbidden with missing `memory:restore` scope.
- **Real-Signal Knowledge Warning**: Keyed `context recall --include-knowledge` skip warning on real signals (credential token lacking `knowledge:read` or response missing knowledge content).
- **Memory Search Guidance**: Corrected empty search hint to suggest query refinement or `--team` instead of unsupported `--path` or `--bucket`.
- **Restart Restore Validation Message**: Updated missing snapshot error to specify `--snapshot-id <id> or --state-key <key>` instead of internal session IDs.
- **Doctor Smoke Validation Message**: Plainly states that smoke checks currently support only `--client codex`.
- **Status MCP and Plugin Accuracy**: Improved `xmemo status` MCP detection to parse structured configs (JSON `mcpServers.XMemo`, TOML, YAML) and formatted MCP-kind plugin entries as `n/a (uses MCP)`.
- **Uninstall Plan Preview Heading (`xmemo uninstall`)**: Corrected preview heading in `xmemo uninstall` to display `Planned changes:` prior to user confirmation or `--yes` execution, reserving `(dry run — no files were modified)` strictly for actual `--dry-run` executions.

## 0.4.187

### Added
- **Guided Onboarding (`xmemo init`)**: Interactive first-run wizard across account sign-in, client detection, agent instruction blocks, MCP server configuration, skills, and plugins, supporting `--dry-run`, non-interactive `--yes`, and structured `--json` envelopes.
- **Agent Plugin Index (`xmemo plugin`)**: Added static plugin registry (`list`, `info`, `install`, `status`) covering official XMemo plugins with pinned versions, tags, and verified Git commit hashes.
- **Client Skill Management (`xmemo skill`)**: Direct installation and management of verified pinned XMemo skills (`install`, `status`, `remove`, `update`) in client skill folders for Claude Code, Codex, OpenClaw, and custom directories.
- **Account Credential Management (`xmemo account`)**: Dedicated command family (`login`, `logout`, `status`, `token`) for secure authentication state inspection, token management, and safe local logout with confirmation and client preservation.
- **Comprehensive Diagnostics (`xmemo doctor`)**: Folded discovery inspection into `doctor --discovery` and client MCP smoke checks into `doctor --client codex --smoke`, maintaining backward-compatible aliases with deprecation notices.
- **Standardized Instruction Profiles (`xmemo profile`)**: Standardized clean markdown agent instruction blocks (`## XMemo memory` through `_End of the XMemo memory section._`) without HTML comments, supporting repository and global targets for Claude Code, Cursor, Codex, and other supported clients.

### Changed
- **Reorganized Command Menu**: Top-level `--help` redesigned into seven clean functional categories: Get started, Connect agents, Skill, Plugins, Memory, Account, and Maintenance.
- **Unified Client Registry**: Standardized client identifiers, detection functions, and metadata across all 24 supported agents for setup, MCP, profile, skill, and diagnostic commands.
- **Safe Profile and Setup Consent**: Setup and profile installations prompt for explicit user consent (`[y/N]`, default No) before writing, display target paths and unified diff previews, support `--dry-run`, and create `.xmemo.bak` backups before modifying existing instruction files.
- **Pinned Supply-Chain Safety**: Third-party plugin installations and Skill packages are pinned to explicit verified release versions by default, and `skill install` verifies downloaded tarball integrity via sha512 checksums before extraction.
- **Consistent `--json` Output Everywhere**: Supported structured JSON output envelopes across every CLI command and subcommand for reliable scripting and agent automation.
- **Codebase Modernization**: Removed obsolete constants, deduplicated repository detection helpers, and streamlined legacy diagnostic commands.

### Fixed
- **Copilot CLI MCP Integration**: Resolved an issue where `xmemo init` and `xmemo mcp add copilot-cli` encountered an error when configuring clients that utilize a local proxy configuration without a dedicated snippet builder.

## 0.4.186

### Added
- Added `client` executable alias in `package.json` `bin` map to enable direct execution via `npx @xmemo/client` without requiring explicit `-p` flag.
- Added `devin-desktop` input alias for `windsurf` in MCP setup and add commands while preserving the client ID `windsurf` and attribution headers.

### Changed
- Updated Devin Desktop (formerly Windsurf) MCP configuration path to `~/.config/devin/mcp_config.json` (or `%APPDATA%\devin\mcp_config.json` on Windows, respecting `$XDG_CONFIG_HOME`), with automatic fallback to the legacy `~/.codeium/windsurf/mcp_config.json` when the legacy directory exists and the new directory does not.
- Updated user-visible client label to "Devin Desktop (formerly Windsurf)".
