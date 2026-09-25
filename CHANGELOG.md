# Changelog

All notable changes to the XMemo CLI client will be documented in this file.

## 0.4.186

### Added
- Added `client` executable alias in `package.json` `bin` map to enable direct execution via `npx @xmemo/client` without requiring explicit `-p` flag.
- Added `devin-desktop` input alias for `windsurf` in MCP setup and add commands while preserving the client ID `windsurf` and attribution headers.

### Changed
- Updated Devin Desktop (formerly Windsurf) MCP configuration path to `~/.config/devin/mcp_config.json` (or `%APPDATA%\devin\mcp_config.json` on Windows, respecting `$XDG_CONFIG_HOME`), with automatic fallback to the legacy `~/.codeium/windsurf/mcp_config.json` when the legacy directory exists and the new directory does not.
- Updated user-visible client label to "Devin Desktop (formerly Windsurf)".
