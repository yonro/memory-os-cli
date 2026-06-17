import os from 'node:os';
import path from 'node:path';

import { fileExists } from '../../core/runtime.js';
import { defaultCopilotConfigPath } from '../identity/paths.js';
import { supportedMcpClientIds } from './registry.js';

export function autoScanClientIds(mcpClients) {
  return [...supportedMcpClientIds(mcpClients), 'copilot-cli'];
}

export function clientConfigPathCandidates(clientId, env, mcpClients) {
  const candidates = [];

  if (clientId === 'copilot-cli' || clientId === 'copilot') {
    if (process.platform === 'win32' && env.APPDATA) {
      candidates.push(path.join(env.APPDATA, 'Code', 'User', 'mcp.json'));
    } else {
      const home = env.HOME || os.homedir();
      if (process.platform === 'darwin') {
        candidates.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
      }
      candidates.push(path.join(home, '.config', 'Code', 'User', 'mcp.json'));
    }
    candidates.push(defaultCopilotConfigPath(env));
    return candidates;
  }

  if (clientId === 'cline') {
    if (process.platform === 'win32' && env.APPDATA) {
      candidates.push(path.join(env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    } else {
      const home = env.HOME || os.homedir();
      if (process.platform === 'darwin') {
        candidates.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
      }
      candidates.push(path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    }
  }

  const client = mcpClients.get(clientId);
  if (client) {
    candidates.push(client.defaultConfigPath(env));
  }

  return candidates;
}

export async function detectedSetupTargets(clientIds, env, mcpClients) {
  const targets = [];
  const seen = new Set();

  for (const clientId of clientIds) {
    const candidates = clientConfigPathCandidates(clientId, env, mcpClients);
    for (const configPath of candidates) {
      const resolved = path.resolve(configPath);
      if (seen.has(resolved)) {
        continue;
      }
      if (await fileExists(configPath) || await fileExists(path.dirname(configPath))) {
        seen.add(resolved);
        targets.push(buildTarget(clientId, resolved, mcpClients));
        break;
      }
    }
  }

  return targets;
}

export async function existingUninstallTargets(clientIds, env, mcpClients) {
  const targets = [];
  const seen = new Set();

  for (const clientId of clientIds) {
    const candidates = clientConfigPathCandidates(clientId, env, mcpClients);
    for (const configPath of candidates) {
      const resolved = path.resolve(configPath);
      if (seen.has(resolved)) {
        continue;
      }
      if (await fileExists(configPath)) {
        seen.add(resolved);
        targets.push(buildTarget(clientId, resolved, mcpClients));
      }
    }
  }

  return targets;
}

function buildTarget(clientId, configPath, mcpClients) {
  if (clientId === 'copilot-cli') {
    return {
      clientId,
      label: 'Copilot CLI',
      configPath,
      configKind: 'local-proxy'
    };
  }

  const client = mcpClients.get(clientId);
  return {
    clientId,
    label: client?.label ?? clientId,
    configPath,
    configKind: client?.configKind ?? 'json'
  };
}
