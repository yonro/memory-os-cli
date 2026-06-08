import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_INSTANCE_ENV_VAR,
  MCP_SERVER_NAME,
  TOKEN_ENV_VAR
} from '../../core/constants.js';
import { UsageError } from '../../core/errors.js';
import {
  bestEffortChmod,
  readTextIfExists
} from '../../core/runtime.js';
import { envReferenceIdentity } from '../identity/device.js';

export function hermesYamlSnippet(mcpUrl, identity = envReferenceIdentity('hermes')) {
  return `mcp_servers:
  ${MCP_SERVER_NAME}:
    command: npx
    args:
      - -y
      - mcp-remote
      - ${mcpUrl}
      - --header
      - "Authorization:Bearer \${${TOKEN_ENV_VAR}}"
      - --header
      - "X-Memory-OS-Agent-ID:${identity.agentId}"
      - --header
      - "X-Memory-OS-Agent-Instance-ID:\${${AGENT_INSTANCE_ENV_VAR}}"
    env:
      ${TOKEN_ENV_VAR}: "\${env:${TOKEN_ENV_VAR}}"
      ${AGENT_INSTANCE_ENV_VAR}: "${identity.agentInstanceId}"
`;
}

export async function mergeHermesMcpConfig(configPath, mcpUrl, identity) {
  const existing = await readTextIfExists(configPath);

  if (existing.includes(`${MCP_SERVER_NAME}:`) || existing.includes('memory_os:') || existing.includes('memory-os:')) {
    throw new UsageError(`MCP config already contains ${MCP_SERVER_NAME} in mcp_servers. Edit ${configPath} manually to avoid duplicate server definitions.`);
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });

  if (existing.trim().length === 0) {
    await fs.writeFile(configPath, hermesYamlSnippet(mcpUrl, identity), { mode: 0o600 });
  } else if (existing.includes('mcp_servers:')) {
    const replacement = `mcp_servers:
  ${MCP_SERVER_NAME}:
    command: npx
    args:
      - -y
      - mcp-remote
      - ${mcpUrl}
      - --header
      - "Authorization:Bearer \${${TOKEN_ENV_VAR}}"
      - --header
      - "X-Memory-OS-Agent-ID:${identity.agentId}"
      - --header
      - "X-Memory-OS-Agent-Instance-ID:\${${AGENT_INSTANCE_ENV_VAR}}"
    env:
      ${TOKEN_ENV_VAR}: "\${env:${TOKEN_ENV_VAR}}"
      ${AGENT_INSTANCE_ENV_VAR}: "${identity.agentInstanceId}"`;
    const updated = existing.replace('mcp_servers:', replacement);
    await fs.writeFile(configPath, updated, { mode: 0o600 });
  } else {
    const prefix = existing.endsWith('\n') ? '' : '\n';
    await fs.appendFile(configPath, `${prefix}${hermesYamlSnippet(mcpUrl, identity)}`, { mode: 0o600 });
  }
  await bestEffortChmod(configPath, 0o600);
}

