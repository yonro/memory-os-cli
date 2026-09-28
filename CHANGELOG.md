# Changelog

All notable changes to the XMemo CLI client will be documented in this file.

## [Unreleased]

### Added
- **Elegant Command Model (CLI-DESIGN v2)**:
  - **Unified Resource Grammar**: Standardized all component operations on `xmemo <resource> <action>` (`mcp`, `plugin`, `skill`, `profile`) with canonical actions `install`, `remove`, `status` (plus `list`/`info` for plugins and `update` for skills).
  - **Unified Target Resolver**: Smart client resolution across commands prioritizing explicit `--client <id>` / `--all`, calling agent environment (`CLAUDECODE` -> `claude-code`, Codex session -> `codex`), and auto-detected locally installed clients.
  - **Plan, Confirm Once, Apply Engine (`PlanRunner`)**: Atomic planning and execution engine displaying full unified plan previews, single confirmation prompt `[y/N]`, stop-on-first-failure, idempotency detection, and full `--dry-run`, `--yes`, and `--json` support.
  - **Declarative Client Registry**: All 24 client profiles declare setup composition (`setup.default`, `setup.optional`, `setupRecipe`) with zero hardcoded client ID string literals in command handlers.
  - **Dynamic Registry Extension**: Support for dynamic runtime client registration (`registerClient`, `unregisterClient`) with automatic index rebuilding and synthetic client testing.

### Changed
- **Backward-Compatible Command Aliases**: Kept `mcp add` (alias for `mcp install`), `profile uninstall` (alias for `profile remove`), and `skill remove` / `uninstall` (alias for `skill remove`) with helpful one-line stderr hints in interactive terminal mode while preserving clean JSON mode output.
- **Relocated Client Diagnostics**: Moved client-specific doctor implementations (`codexDoctor`, `kiroDoctor`) into dedicated `src/diagnostics/` modules, eliminating command-layer couplings.

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
