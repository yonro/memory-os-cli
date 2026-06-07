import {
  LEGACY_MCP_SERVER_NAMES,
  MCP_SERVER_NAME
} from '../constants.js';

export function knownMcpServerNames() {
  return [MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES];
}

export function existingJsonMcpServerName(mcpServers) {
  return knownMcpServerNames().find((name) => mcpServers[name]);
}
