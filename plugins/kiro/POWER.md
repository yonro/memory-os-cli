# XMemo for Kiro

XMemo gives Kiro a hosted, user-owned memory layer for durable project context, coding preferences, decisions, TODOs, and reusable agent knowledge.

## Overview

This Kiro Power integrates XMemo's MCP server to provide persistent memory across your Kiro sessions. XMemo helps Kiro remember:

- **Project context**: Repository conventions, architecture decisions, and verified commands
- **Coding preferences**: Your approved preferences for code review, testing, and documentation
- **Decisions**: Important technical decisions that should inform future work
- **TODOs**: Follow-up tasks and reminders for future sessions
- **Knowledge**: Reusable agent knowledge and learnings

## Installation

Install this power through Kiro's Powers panel or manually configure:

```bash
xmemo setup kiro
```

This command:
1. Merges XMemo MCP server configuration into `~/.kiro/settings/mcp.json`
2. Sets up OAuth or environment-variable-based authentication
3. Adds agent identity headers for attribution

## Authentication

### Environment Variable (Required)

Kiro requires the `XMEMO_KEY` environment variable to be set for authentication. 

First, authenticate with XMemo:

```bash
xmemo login
```

Then set the environment variable:

```bash
# PowerShell (User-level, persistent)
$token = xmemo token show --format raw
[Environment]::SetEnvironmentVariable("XMEMO_KEY", $token, "User")

# PowerShell (Session-only)
$env:XMEMO_KEY = xmemo token show --format raw

# Bash/Zsh
export XMEMO_KEY=$(xmemo token show --format raw)
```

**Important**: Restart Kiro after setting the environment variable for the first time.

### Why Environment Variable?

Kiro currently has a known issue with OAuth token persistence. Using an environment variable ensures reliable authentication across all sessions.

## Usage

Once installed, Kiro will automatically use XMemo when appropriate. The steering file instructs Kiro to:

1. **Recall first**: Search XMemo before making assumptions about preferences or past decisions
2. **Save durable information**: Remember important context that should persist across sessions
3. **Keep content useful**: Store concrete facts, decisions, and action items (not chat transcripts)
4. **Confirm destructive actions**: Ask before deleting or overwriting memory

### Example Prompts

- "Search XMemo for coding style preferences for this project"
- "Remember in XMemo: Always use TypeScript strict mode in this project"
- "Recall what I saved about API design patterns"
- "Create a TODO in XMemo to refactor the auth module next week"
- "List my XMemo TODOs"

## What Gets Stored

**Good candidates for XMemo:**
- Repository conventions and verified commands
- Architecture decisions and design patterns
- Release procedures and deployment notes
- User-approved preferences for development practices
- TODOs and follow-up actions

**Never store:**
- Secrets, credentials, API keys, or tokens
- Private customer data or PII
- Temporary debugging output
- Chat transcripts or verbose logs

## Configuration

The power installs:
- **MCP server**: `https://xmemo.dev/mcp`
- **Steering file**: Auto-included guidance for when to use XMemo
- **Agent identity**: Headers for attribution (non-secret)

### Manual Configuration

Advanced users can generate a config snippet:

```bash
xmemo mcp config --client kiro --json
```

Or see the dry-run preview:

```bash
xmemo setup kiro --dry-run
```

## Troubleshooting

### Connection Issues

Check your token status:

```bash
xmemo auth status
xmemo token status --verify
```

### Configuration Issues

View your current MCP config:

```bash
cat ~/.kiro/settings/mcp.json
```

### Reset Configuration

To remove XMemo from Kiro, manually edit `~/.kiro/settings/mcp.json` and remove the `XMemo` entry from `mcpServers`.

## Privacy & Security

- No telemetry or analytics
- Tokens are managed by XMemo CLI and referenced via environment variable
- Agent identity headers are non-secret attribution IDs
- Environment variable approach keeps tokens out of config files
- All memory content is user-owned and controlled through your XMemo account
- **Privacy Policy**: [https://xmemo.dev/privacy](https://xmemo.dev/privacy)

## License

- **License**: Proprietary (All rights reserved). See [LICENSE](file:///h:/repos/memory-os-cli/plugins/kiro/LICENSE) for details.

## Support

- **Documentation**: https://xmemo.dev
- **CLI Help**: `xmemo --help`
- **Issues**: https://github.com/yonro/memory-os-cli/issues
- **Email**: support@xmemo.dev
