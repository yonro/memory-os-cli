// Mirrors memory-os-cli/src/core/constants.js so the extension stays consistent
// with the CLI and every other XMemo agent integration.

export const PRODUCT_NAME = 'XMemo';
export const DEFAULT_SERVICE_URL = 'https://xmemo.dev';

export const TOKEN_SECRET_KEY = 'xmemo.token';

export const AGENT_ID_HEADER = 'X-Memory-OS-Agent-ID';
export const AGENT_INSTANCE_HEADER = 'X-Memory-OS-Agent-Instance-ID';

export const DEFAULT_AGENT_ID = 'vscode';

// Public MCP tool names (frozen public layer -- call only, never redefine).
// Argument shapes confirmed against the live XMemo MCP server:
//   remember         -> { content: string, path: string }   (both required)
//   recall           -> { query: string, limit?: number }
//   search_memory    -> { query: string, limit?: number }
//   get_mcp_identity -> {}  (no args)
export const TOOL_REMEMBER = 'remember';
export const TOOL_RECALL = 'recall';
export const TOOL_SEARCH = 'search_memory';
export const TOOL_IDENTITY = 'get_mcp_identity';

export const EXTENSION_VERSION = '0.1.0';
