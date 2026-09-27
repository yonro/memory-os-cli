# Changelog

All notable changes to the XMemo CLI client will be documented in this file.

## [Unreleased]

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

## 0.4.186

### Added
- Added `client` executable alias in `package.json` `bin` map to enable direct execution via `npx @xmemo/client` without requiring explicit `-p` flag.
- Added `devin-desktop` input alias for `windsurf` in MCP setup and add commands while preserving the client ID `windsurf` and attribution headers.

### Changed
- Updated Devin Desktop (formerly Windsurf) MCP configuration path to `~/.config/devin/mcp_config.json` (or `%APPDATA%\devin\mcp_config.json` on Windows, respecting `$XDG_CONFIG_HOME`), with automatic fallback to the legacy `~/.codeium/windsurf/mcp_config.json` when the legacy directory exists and the new directory does not.
- Updated user-visible client label to "Devin Desktop (formerly Windsurf)".
