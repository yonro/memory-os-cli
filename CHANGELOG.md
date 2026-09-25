# Changelog

All notable changes to the XMemo CLI client will be documented in this file.

## [Unreleased]

### Changed
- Updated Devin Desktop (formerly Windsurf) MCP configuration path to `~/.config/devin/mcp_config.json` (or `%APPDATA%\devin\mcp_config.json` on Windows, respecting `$XDG_CONFIG_HOME`), with automatic fallback to the legacy `~/.codeium/windsurf/mcp_config.json` when the legacy directory exists and the new directory does not.
- Added `devin-desktop` input alias for `windsurf` in MCP setup and add commands while preserving the client ID `windsurf` and attribution headers.
- Updated user-visible client label to "Devin Desktop (formerly Windsurf)".
