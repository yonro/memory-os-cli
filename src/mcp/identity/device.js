import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AGENT_INSTANCE_ENV_VAR } from '../../core/constants.js';
import { bestEffortChmod, parseJsonConfig, readTextIfExists } from '../../core/runtime.js';
import { stringValue } from '../../core/args.js';
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

  const identityPath = deviceInstanceIdentityPath(env);
  const existing = await readDeviceInstanceIdentity(identityPath);
  if (existing) {
    return { agentId: targetClientId, agentInstanceId: existing, path: identityPath };
  }

  const hostname = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 32);
  const generated = `xmemo-${hostname}`;
  
  await fs.mkdir(path.dirname(identityPath), { recursive: true, mode: 0o700 });
  await bestEffortChmod(path.dirname(identityPath), 0o700);
  await fs.writeFile(identityPath, `${JSON.stringify({ 
    version: 1, 
    deviceInstanceId: generated,
    hostname: os.hostname(),
    createdAt: new Date().toISOString()
  }, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(identityPath, 0o600);
  return { agentId: targetClientId, agentInstanceId: generated, path: identityPath };
}

export async function readDeviceInstanceIdentity(identityPath) {
  const existing = await readTextIfExists(identityPath);
  if (!existing.trim()) {
    return null;
  }
  const parsed = parseJsonConfig(existing, identityPath);
  const value = stringValue(parsed, ['deviceInstanceId']) || stringValue(parsed, ['agentInstanceId']);
  return value || null;
}

export function deviceInstanceIdentityPath(env) {
  return path.join(configRoot(env), 'device-instance.json');
}

export async function readAgentInstanceIdentity(identityPath) {
  return readDeviceInstanceIdentity(identityPath);
}

export function agentInstanceIdentityPath(env) {
  return deviceInstanceIdentityPath(env);
}

export function envReferenceIdentity(clientId) {
  const targetClientId = identityClientId(clientId);
  return {
    agentId: targetClientId,
    agentInstanceId: `\${${AGENT_INSTANCE_ENV_VAR}}`,
    path: `${AGENT_INSTANCE_ENV_VAR} environment variable`
  };
}

