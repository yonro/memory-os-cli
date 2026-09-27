import path from 'node:path';

import { fileExists } from '../../core/runtime.js';
import {
  getClient,
  supportedMcpClientIds
} from '../../clients/registry.js';

export function autoScanClientIds(_mcpClients) {
  return supportedMcpClientIds();
}

export function clientConfigPathCandidates(clientId, env, _mcpClients) {
  const client = getClient(clientId);
  if (client?.mcp?.configPathCandidates) {
    return client.mcp.configPathCandidates(env);
  }
  return [];
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

function buildTarget(clientId, configPath, _mcpClients) {
  const client = getClient(clientId);
  return {
    clientId,
    label: client?.label ?? clientId,
    configPath,
    configKind: client?.mcp?.configKind ?? 'json'
  };
}
