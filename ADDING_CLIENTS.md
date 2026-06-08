# Adding New AI Client Support

This guide explains how to add support for a new AI client (IDE/editor) to XMemo CLI.

## Architecture Overview

The codebase supports three types of MCP configuration formats:
- **JSON** - Most modern AI clients (20+ clients)
- **TOML** - Codex
- **YAML** - Hermes

Most new clients use JSON format, so this guide focuses on adding JSON-based clients.

## Steps to Add a New JSON Client

### 1. Add the Config Path Function

**File:** `src/mcp/identity/paths.js`

Add a function that returns the default config file path for the new client:

```javascript
export function defaultYourClientConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.your-client', 'mcp.json');
}
```

**Platform-specific example (Windows/macOS/Linux):**
```javascript
export function defaultYourClientConfigPath(env) {
  if (process.platform === 'win32' && env.APPDATA) {
    return path.join(env.APPDATA, 'YourClient', 'mcp.json');
  }
  const home = env.HOME || os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'YourClient', 'mcp.json');
  }
  return path.join(home, '.config', 'your-client', 'mcp.json');
}
```

### 2. Export the Path Function

**File:** `src/mcp/clients.js`

Add the import and export:

```javascript
import {
  // ... existing imports ...
  defaultYourClientConfigPath
} from './identity/paths.js';

// ... 

export {
  // ... existing exports ...
  defaultYourClientConfigPath
};
```

### 3. Add Client Definition

**File:** `src/mcp/formats/json.js`

Add a new client definition to the `JSON_MCP_CLIENT_DEFINITIONS` array:

```javascript
export const JSON_MCP_CLIENT_DEFINITIONS = Object.freeze([
  // ... existing definitions ...
  httpClientDefinition('your-client', 'Your Client', 'defaultYourClientConfigPath', { 
    urlKey: 'url', 
    authentication: 'env-bearer' 
  }),
]);
```

## Client Definition Types

### HTTP Client (Most Common)

For clients that use HTTP transport:

```javascript
httpClientDefinition('client-id', 'Client Label', 'defaultConfigPathFunction', {
  urlKey: 'url',              // or 'httpUrl', 'serverUrl'
  authentication: 'env-bearer' // or 'oauth'
})
```

**Authentication Options:**
- `'env-bearer'` - Uses environment variable for bearer token (most common)
- `'oauth'` - Uses OAuth flow (no token in config)

**URL Key Options:**
- `'url'` - Standard URL field
- `'httpUrl'` - Alternative URL field name
- `'serverUrl'` - Another alternative

### Command Client (MCP Remote Command)

For clients that use `mcp-remote` command-based transport:

```javascript
commandClientDefinition('client-id', 'Client Label', 'defaultConfigPathFunction')
```

Examples: Claude Desktop, Zed, Trae

### Nested Transport Client

For clients with nested `experimentalModelContextProtocolServers` section:

```javascript
nestedTransportClientDefinition('client-id', 'Client Label', 'defaultConfigPathFunction')
```

Examples: Continue, JetBrains

### Remote Client (OAuth Only)

For clients that only support OAuth without bearer tokens:

```javascript
remoteClientDefinition('client-id', 'Client Label', 'defaultConfigPathFunction')
```

Example: OpenCode

## Advanced Options

### Custom Identity ID

If multiple clients should share the same agent instance identity:

```javascript
httpClientDefinition('antigravity-ide', 'Antigravity IDE', 'defaultAntigravityIdeConfigPath', {
  urlKey: 'url',
  authentication: 'oauth',
  defaultIdentityId: 'antigravity'  // Share identity with 'antigravity' client
})
```

### Extra Config Fields

Add additional fields to the server config:

```javascript
httpClientDefinition('client-id', 'Client Label', 'defaultConfigPath', {
  urlKey: 'url',
  authentication: 'oauth',
  extra: { type: 'http' }  // Adds "type": "http" to server config
})
```

### Custom JSON Section

By default, server config is added to `mcpServers` section. To use a different section:

```javascript
commandClientDefinition('client-id', 'Client Label', 'defaultConfigPath', {
  section: 'context_servers'  // Use 'context_servers' instead of 'mcpServers'
})
```

## Complete Example: Adding "FooBar IDE"

Let's say FooBar IDE stores its config in `~/.foobar/config.json` and uses standard HTTP transport.

### Step 1: Add path function

**File:** `src/mcp/identity/paths.js`

```javascript
export function defaultFoobarConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.foobar', 'config.json');
}
```

### Step 2: Export from clients.js

**File:** `src/mcp/clients.js`

```javascript
import {
  // ... existing imports ...
  defaultFoobarConfigPath
} from './identity/paths.js';

// ...

export {
  // ... existing exports ...
  defaultFoobarConfigPath
};
```

### Step 3: Add definition

**File:** `src/mcp/formats/json.js`

```javascript
export const JSON_MCP_CLIENT_DEFINITIONS = Object.freeze([
  httpClientDefinition('cursor', 'Cursor', 'defaultCursorConfigPath', { urlKey: 'url', authentication: 'env-bearer' }),
  // ... other clients ...
  httpClientDefinition('foobar', 'FooBar IDE', 'defaultFoobarConfigPath', { urlKey: 'url', authentication: 'env-bearer' }),
]);
```

### Step 4: Test

```bash
# Test config generation
xmemo mcp add foobar --dry-run

# Test setup wizard
xmemo setup foobar --dry-run

# Actually configure
xmemo setup foobar
```

## TOML Client (Like Codex)

If you need to add a TOML-based client:

1. Add config path in `src/mcp/identity/paths.js`
2. Add client definition in `src/mcp/clients.js`:

```javascript
clients.set('your-client', {
  label: 'Your Client',
  defaultConfigPath: deps.defaultYourClientConfigPath,
  buildSnippet: deps.yourClientTomlSnippet,  // Create this function
  writeConfig: deps.appendTomlServerConfig,
  configKind: 'toml'
});
```

3. Create TOML generation functions in `src/mcp/formats/toml.js`

## YAML Client (Like Hermes)

If you need to add a YAML-based client, follow similar pattern to TOML but in `src/mcp/formats/yaml.js`.

## Testing

After adding a new client:

1. Run the test suite: `npm test`
2. Test config generation: `xmemo mcp add <client-id> --dry-run`
3. Test setup wizard: `xmemo setup <client-id> --dry-run`
4. Test auto-detection: `xmemo setup --all --dry-run`

## Client ID Naming Convention

- Use lowercase with hyphens: `your-client`, `foo-bar-ide`
- Use descriptive names: `claude-desktop`, `cursor`, `antigravity-cli`
- Avoid version numbers unless needed: `antigravity2` is OK for a major version

## Config File Locations Reference

Common patterns for config file locations:

**Windows:**
- `%APPDATA%\ClientName\config.json`
- `%LOCALAPPDATA%\ClientName\config.json`
- `%USERPROFILE%\.clientname\config.json`

**macOS:**
- `~/Library/Application Support/ClientName/config.json`
- `~/.clientname/config.json`

**Linux:**
- `~/.config/clientname/config.json`
- `~/.clientname/config.json`
- `$XDG_CONFIG_HOME/clientname/config.json`
