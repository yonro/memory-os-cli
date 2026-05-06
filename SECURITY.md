# Security Policy

Memory OS CLI is designed to minimize local secret exposure.

## Defaults

- No telemetry or analytics are collected.
- Token values are never printed by CLI commands.
- Generated MCP config references `MEMORY_OS_MCP_TOKEN` instead of embedding a
  token value.
- Plaintext token storage requires explicit `--allow-plaintext`.
- npm publish is constrained by the package `files` whitelist.

## Reporting vulnerabilities

Report security issues privately to the Yonro maintainers. Do not open a public
issue for secrets, token handling bugs, authentication bypasses, or sensitive
deployment details.

## Secret handling rules

Do not include real tokens in:

- Git commits
- GitHub Issues or Discussions
- npm package contents
- MCP config files
- logs
- screenshots
- chat transcripts

Use the Memory OS website or enterprise console to create, rotate, and revoke
tokens.
