import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { AGENT_INSTANCE_ENV_VAR } from '../constants.js';
import { bestEffortChmod, parseJsonConfig, readTextIfExists } from '../runtime.js';
import { stringValue } from '../args.js';
import { configRoot } from './paths.js';

function identityClientId(clientId) {
  return (clientId === 'antigravity-ide' || clientId === 'antigravity2' || clientId === 'antigravity-cli')
    ? 'antigravity'
    : clientId;
}

export async function agentIdentity(clientId, env) {
  const targetClientId = identityClientId(clientId);
  const configuredInstanceId = env[AGENT_INSTANCE_ENV_VAR];
  if (configuredInstanceId) {
    return {
      agentId: targetClientId,
      agentInstanceId: configuredInstanceId,
      path: `${AGENT_INSTANCE_ENV_VAR} environment variable`
    };
  }

  const identityPath = agentInstanceIdentityPath(env, targetClientId);
  const existing = await readAgentInstanceIdentity(identityPath);
  if (existing) {
    return { agentId: targetClientId, agentInstanceId: existing, path: identityPath };
  }

  const generated = `xmemo-${targetClientId}-${randomUUID()}`;
  await fs.mkdir(path.dirname(identityPath), { recursive: true, mode: 0o700 });
  await bestEffortChmod(path.dirname(identityPath), 0o700);
  await fs.writeFile(identityPath, `${JSON.stringify({ version: 1, agentId: targetClientId, agentInstanceId: generated }, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(identityPath, 0o600);
  return { agentId: targetClientId, agentInstanceId: generated, path: identityPath };
}

export async function readAgentInstanceIdentity(identityPath) {
  const existing = await readTextIfExists(identityPath);
  if (!existing.trim()) {
    return null;
  }
  const parsed = parseJsonConfig(existing, identityPath);
  const value = stringValue(parsed, ['agentInstanceId']);
  return value || null;
}

export function agentInstanceIdentityPath(env, clientId) {
  return path.join(configRoot(env), 'agent-instances', `${clientId}.json`);
}

export function envReferenceIdentity(clientId) {
  const targetClientId = identityClientId(clientId);
  return {
    agentId: targetClientId,
    agentInstanceId: `\${${AGENT_INSTANCE_ENV_VAR}}`,
    path: `${AGENT_INSTANCE_ENV_VAR} environment variable`
  };
}
