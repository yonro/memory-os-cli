# XMemo Kiro Power Setup Guide

This guide walks you through setting up XMemo for Kiro.

## Quick Start

Install and configure XMemo for Kiro in one command:

```bash
xmemo setup kiro
```

This will:
1. Merge XMemo MCP server config into `~/.kiro/settings/mcp.json`
2. Configure authentication via `XMEMO_KEY` environment variable
3. Set up agent identity headers for attribution

**Note**: Kiro uses environment variable authentication (`XMEMO_KEY`) as the recommended method. Make sure to set the environment variable before using XMemo.

## Step-by-Step Setup

### 1. Install XMemo CLI

```bash
npm install -g @xmemo/client
```

### 2. Authenticate with XMemo

Kiro requires the `XMEMO_KEY` environment variable to be set. Choose one of these methods:

#### Option A: OAuth Login (Recommended)

```bash
xmemo login
```

This opens your browser for secure OAuth authentication and automatically stores your token.

#### Option B: Direct Token

If you already have a token, add it to the token store:

```bash
printf '%s\n' 'your-token' | xmemo token add --from-stdin
```

After authentication, export your token to the environment variable:

**PowerShell (User-level, persistent):**
```powershell
$token = xmemo token show --format raw
[Environment]::SetEnvironmentVariable("XMEMO_KEY", $token, "User")
```

**PowerShell (Session-only):**
```powershell
$env:XMEMO_KEY = xmemo token show --format raw
```

**Bash/Zsh:**
```bash
export XMEMO_KEY=$(xmemo token show --format raw)
```

**Note**: The environment variable must be set before starting Kiro for the MCP server to authenticate successfully.

### 3. Configure Kiro

Preview the configuration first:

```bash
xmemo setup kiro --dry-run
```

Then write the configuration:

```bash
xmemo setup kiro
```

### 4. Verify Installation

Check your MCP configuration:

```bash
cat ~/.kiro/settings/mcp.json
```

You should see an `XMemo` entry in `mcpServers`.

Verify token status:

```bash
xmemo auth status
xmemo token status --verify
```

### 5. Restart Kiro

After configuration, restart Kiro or reload MCP servers for changes to take effect.

## Using XMemo in Kiro

Once installed, you can use XMemo through natural language:

### Search Memory
```
Search XMemo for coding style preferences for this project
```

### Save Information
```
Remember in XMemo: Always use TypeScript strict mode in this project
```

### Recall Decisions
```
Recall what I saved about API design patterns
```

### Manage TODOs
```
Create a TODO in XMemo to refactor the auth module next week
List my XMemo TODOs
```

## Configuration Details

The setup command creates this configuration:

```json
{
  "mcpServers": {
    "XMemo": {
      "url": "https://xmemo.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${env:XMEMO_KEY}",
        "X-Memory-OS-Agent-ID": "kiro",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

### Configuration Components

- **url**: XMemo MCP server endpoint
- **Authorization**: Bearer token from `XMEMO_KEY` environment variable
- **X-Memory-OS-Agent-ID**: Identifies the agent as Kiro
- **X-Memory-OS-Agent-Instance-ID**: Unique identifier for this installation

## Troubleshooting

### XMemo tools not available

**Check MCP configuration:**
```bash
cat ~/.kiro/settings/mcp.json
```

**Verify the `XMemo` entry exists in `mcpServers`.**

**Restart Kiro** or reload MCP servers.

### Authentication errors

**Check token status:**
```bash
xmemo auth status
xmemo token status --verify
```

**Verify environment variable is set:**

PowerShell:
```powershell
$env:XMEMO_KEY
```

Bash/Zsh:
```bash
echo $XMEMO_KEY
```

**If the environment variable is not set, set it:**

PowerShell (User-level, persistent):
```powershell
$token = xmemo token show --format raw
[Environment]::SetEnvironmentVariable("XMEMO_KEY", $token, "User")
```

**Then restart Kiro** for the environment variable to be loaded.

**Re-authenticate if needed:**
```bash
xmemo login
```

### Duplicate server entries

If you see an error about duplicate entries:

```
MCP config already contains mcpServers.XMemo
```

Edit `~/.kiro/settings/mcp.json` manually to remove or update the existing entry.

## Advanced Configuration

### Custom Service URL

For self-hosted or enterprise XMemo:

```bash
xmemo setup kiro --url https://your-xmemo-instance.example.com
```

### Manual Configuration

Generate config without writing:

```bash
xmemo mcp config --client kiro --json
```

Copy the output and manually merge into your Kiro config.

## Uninstalling

To remove XMemo from Kiro:

1. Edit `~/.kiro/settings/mcp.json`
2. Remove the `XMemo` entry from `mcpServers`
3. Restart Kiro or reload MCP servers

## Getting Help

- **Documentation**: https://xmemo.dev
- **CLI Help**: `xmemo --help`
- **Setup Help**: `xmemo setup --help`
- **Issues**: https://github.com/yonro/memory-os-cli/issues
- **Email**: support@xmemo.dev

## Privacy & Security

- Configuration does not embed token values
- Tokens are stored securely outside project files
- Agent identity headers are non-secret attribution IDs
- No telemetry or analytics
- All memory content is user-owned
