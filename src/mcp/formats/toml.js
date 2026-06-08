import fs from 'node:fs/promises';
import path from 'node:path';

import {
  COMMAND_NAME,
  LEGACY_MCP_SERVER_NAMES,
  MCP_SERVER_NAME,
  TOKEN_ENV_VAR
} from '../../core/constants.js';
import { UsageError } from '../../core/errors.js';
import {
  bestEffortChmod,
  escapeRegExp,
  escapeTomlString,
  fileExists,
  readTextIfExists,
  unescapeTomlString
} from '../../core/runtime.js';
import { agentInstanceIdentityPath } from '../identity/device.js';

export function codexTomlSnippet(mcpUrl) {
  return `[mcp_servers.${MCP_SERVER_NAME}]
url = "${escapeTomlString(mcpUrl)}"
bearer_token_env_var = "${TOKEN_ENV_VAR}"
`;
}

export async function codexSmokeReport(configPath, env) {
  const configText = await readTextIfExists(configPath);
  const serverBlock = findTomlServerBlock(configText);
  const block = serverBlock.block;
  const mcpUrl = block ? tomlStringValue(block, 'url') : null;
  const bearerTokenEnvVar = block ? tomlStringValue(block, 'bearer_token_env_var') : null;
  const tokenValue = env[TOKEN_ENV_VAR] ?? '';
  const identityPath = agentInstanceIdentityPath(env, 'codex');
  const identityPresent = await fileExists(identityPath);
  const checks = [
    {
      name: 'config_present',
      ok: configText.trim().length > 0,
      required: true,
      detail: configText.trim().length > 0 ? 'found' : 'missing'
    },
    {
      name: 'memory_os_server_present',
      ok: Boolean(block),
      required: true,
      detail: block ? `[mcp_servers.${serverBlock.name}]` : `missing [mcp_servers.${MCP_SERVER_NAME}]`
    },
    {
      name: 'mcp_url_present',
      ok: Boolean(mcpUrl),
      required: true,
      detail: mcpUrl ?? 'missing url'
    },
    {
      name: 'bearer_token_env_var',
      ok: bearerTokenEnvVar === TOKEN_ENV_VAR,
      required: true,
      detail: bearerTokenEnvVar ?? 'missing bearer_token_env_var'
    },
    {
      name: 'token_env_present',
      ok: Boolean(env[TOKEN_ENV_VAR]),
      required: true,
      detail: env[TOKEN_ENV_VAR] ? 'present' : `missing ${TOKEN_ENV_VAR}`
    },
    {
      name: 'token_not_embedded_in_config',
      ok: !tokenValue || !configText.includes(tokenValue),
      required: true,
      detail: 'token value not printed or embedded'
    },
    {
      name: 'agent_instance_identity_file',
      ok: identityPresent,
      required: false,
      detail: identityPresent ? identityPath : `optional; create with ${COMMAND_NAME} mcp add codex --write (${identityPath})`
    }
  ];

  return {
    ok: checks.every((check) => !check.required || check.ok),
    client: 'codex',
    configPath,
    serverName: serverBlock.name ?? MCP_SERVER_NAME,
    mcpUrl,
    tokenEnvVar: TOKEN_ENV_VAR,
    agentInstanceIdPath: identityPath,
    checks
  };
}

export async function appendTomlServerConfig(configPath, mcpUrl) {
  const snippet = codexTomlSnippet(mcpUrl);
  const existing = await readTextIfExists(configPath);
  const existingName = existingTomlMcpServerName(existing);
  if (existingName) {
    throw new UsageError(`MCP config already contains [mcp_servers.${existingName}]. Edit ${configPath} manually to avoid duplicate server definitions.`);
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const prefix = existing.trim().length === 0 ? '' : '\n\n';
  await fs.appendFile(configPath, `${prefix}${snippet}`, { mode: 0o600 });
  await bestEffortChmod(configPath, 0o600);
}

function knownMcpServerNames() {
  return [MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES];
}

function existingTomlMcpServerName(content) {
  return knownMcpServerNames().find((name) => content.includes(`[mcp_servers.${name}]`));
}

function findTomlServerBlock(content) {
  const name = existingTomlMcpServerName(content);
  return {
    name: name ?? null,
    block: name ? tomlServerBlock(content, name) : ''
  };
}

function tomlServerBlock(content, serverName) {
  const header = `[mcp_servers.${serverName}]`;
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return '';
  }

  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*\[/.test(line)) {
      break;
    }
    block.push(line);
  }
  return block.join('\n');
}

function tomlStringValue(block, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"\\s*$`, 'm');
  const match = block.match(pattern);
  return match ? unescapeTomlString(match[1]) : null;
}

