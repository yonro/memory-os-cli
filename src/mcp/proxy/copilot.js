import fs from 'node:fs/promises';
import path from 'node:path';

import { MCP_SERVER_NAME } from '../../core/constants.js';
import { UsageError } from '../../core/errors.js';
import {
  bestEffortChmod,
  isPlainObject,
  parseJsonConfig,
  readTextIfExists
} from '../../core/runtime.js';
import { existingJsonMcpServerName, knownMcpServerNames } from '../core/names.js';
export { mcpProxyCommand } from './server.js';

export async function removeCopilotMcpConfig(configPath, options = {}) {
  const existing = await readTextIfExists(configPath);
  if (existing.trim().length === 0) {
    return { removed: false, reason: 'missing' };
  }

  const parsed = parseJsonConfig(existing, configPath);
  if (!isPlainObject(parsed)) {
    throw new UsageError(`Copilot MCP JSON config must be an object: ${configPath}`);
  }

  if (!isPlainObject(parsed.mcpServers)) {
    return { removed: false, reason: 'not-found' };
  }

  let removed = false;
  for (const name of knownMcpServerNames()) {
    if (name in parsed.mcpServers) {
      delete parsed.mcpServers[name];
      removed = true;
    }
  }

  if (!removed) {
    return { removed: false, reason: 'not-found' };
  }

  if (!options.preview) {
    await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await bestEffortChmod(configPath, 0o600);
  }
  return { removed: true };
}

export async function mergeCopilotMcpConfig(configPath, proxyUrl, force = false) {
  const existing = await readTextIfExists(configPath);
  const parsed = existing.trim().length === 0 ? {} : parseJsonConfig(existing, configPath);

  if (!isPlainObject(parsed)) {
    throw new UsageError(`Copilot MCP JSON config must be an object: ${configPath}`);
  }

  if (!isPlainObject(parsed.mcpServers)) {
    parsed.mcpServers = {};
  }

  const existingName = existingJsonMcpServerName(parsed.mcpServers);
  if (existingName && !force) {
    throw new UsageError(`MCP config already contains mcpServers.${existingName}. Edit ${configPath} manually to avoid duplicate server definitions, or use --force to overwrite.`);
  }

  parsed.mcpServers[MCP_SERVER_NAME] = copilotLocalProxyServerConfig(proxyUrl);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(configPath, 0o600);
}

export function copilotLocalProxyServerConfig(proxyUrl) {
  return {
    type: 'http',
    url: proxyUrl
  };
}

