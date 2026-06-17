import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_INSTANCE_ENV_VAR,
  LEGACY_MCP_SERVER_NAMES,
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

export async function removeHermesMcpConfig(configPath, options = {}) {
  const existing = await readTextIfExists(configPath);
  if (existing.trim().length === 0) {
    return { removed: false, reason: 'missing' };
  }

  const names = [MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES];
  const lines = existing.split(/\r?\n/);
  const mcpIndex = lines.findIndex((line) => line.trim().startsWith('mcp_servers:'));
  if (mcpIndex === -1) {
    return { removed: false, reason: 'not-found' };
  }

  const serverBaseIndent = indentOf(lines[mcpIndex + 1]);
  if (serverBaseIndent === null) {
    return { removed: false, reason: 'not-found' };
  }

  let removed = false;
  let index = mcpIndex + 1;
  while (index < lines.length) {
    const line = lines[index];
    const lineIndent = indentOf(line);
    if (lineIndent === null) {
      index += 1;
      continue;
    }
    if (lineIndent < serverBaseIndent) {
      break;
    }
    if (lineIndent === serverBaseIndent) {
      const match = names.find((name) => line.trim() === `${name}:` || line.trim().startsWith(`${name}:`));
      if (match) {
        const start = index;
        let end = index + 1;
        for (; end < lines.length; end += 1) {
          const nextIndent = indentOf(lines[end]);
          if (nextIndent === null) {
            continue;
          }
          if (nextIndent <= serverBaseIndent) {
            break;
          }
        }
        lines.splice(start, end - start);
        removed = true;
        index = start;
        continue;
      }
    }
    index += 1;
  }

  if (!removed) {
    return { removed: false, reason: 'not-found' };
  }

  if (!options.preview) {
    const updated = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    await fs.writeFile(configPath, updated ? `${updated}\n` : '', { mode: 0o600 });
    await bestEffortChmod(configPath, 0o600);
  }
  return { removed: true };
}

function indentOf(line) {
  const match = line.match(/^(\s*)\S/);
  if (!match) {
    return null;
  }
  return match[1].length;
}

export async function mergeHermesMcpConfig(configPath, mcpUrl, identity, force = false) {
  const existing = await readTextIfExists(configPath);

  if (existing.includes(`${MCP_SERVER_NAME}:`) || existing.includes('memory_os:') || existing.includes('memory-os:')) {
    if (!force) {
      throw new UsageError(`MCP config already contains ${MCP_SERVER_NAME} in mcp_servers. Edit ${configPath} manually to avoid duplicate server definitions, or use --force to overwrite.`);
    }
    throw new UsageError(`--force overwrite is not yet supported for Hermes YAML configs. Edit ${configPath} manually.`);
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

