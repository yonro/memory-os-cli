import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { stringValue } from './args.js';
import {
  CLI_VERSION,
  DEVICE_LOGIN_START_PATH,
  DEVICE_LOGIN_TOKEN_PATH,
  LEGACY_TOKEN_ENV_VAR,
  PACKAGE_NAME,
  TOKEN_ENV_VAR
} from './constants.js';
import { endpointUrl, postJson } from './http.js';
import { UsageError } from './errors.js';
import {
  bestEffortChmod,
  parseJsonConfig,
  readAll,
  readTextIfExists,
  sleep
} from './runtime.js';

export async function startDeviceLogin(baseUrl, timeoutMs, io) {
  const payload = await postJson(endpointUrl(baseUrl, DEVICE_LOGIN_START_PATH), {
    client_id: PACKAGE_NAME,
    cli_version: CLI_VERSION,
    token_type: 'mcp_token',
    scopes: ['memory:read', 'memory:write']
  }, timeoutMs, io);

  const deviceCode = stringValue(payload, ['device_code']);
  const verificationUri = stringValue(payload, ['verification_uri']);
  if (!deviceCode || !verificationUri) {
    throw new UsageError(`Device login did not return device_code and verification_uri from ${baseUrl}.`);
  }

  return {
    deviceCode,
    userCode: stringValue(payload, ['user_code']),
    verificationUri,
    verificationUriComplete: stringValue(payload, ['verification_uri_complete']),
    expiresIn: Number.isFinite(Number(payload.expires_in)) ? Number(payload.expires_in) : 600,
    interval: Number.isFinite(Number(payload.interval)) ? Math.max(1, Number(payload.interval)) : 5
  };
}

export async function pollDeviceLogin(baseUrl, start, loginTimeoutMs, httpTimeoutMs, io, options = {}) {
  const deadline = Date.now() + Math.min(start.expiresIn * 1000, loginTimeoutMs);
  const sleepFn = io.sleep ?? sleep;
  let intervalSeconds = start.interval;
  while (Date.now() <= deadline) {
    const payload = await postJson(endpointUrl(baseUrl, DEVICE_LOGIN_TOKEN_PATH), {
      device_code: start.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    }, httpTimeoutMs, io, { allowDevicePending: true });

    const accessToken = stringValue(payload, ['access_token']) ?? stringValue(payload, ['token']);
    if (accessToken) {
      validateToken(accessToken);
      return {
        accessToken,
        account: accountFromPayload(payload)
      };
    }

    const error = stringValue(payload, ['error']);
    if (error && error !== 'authorization_pending' && error !== 'slow_down') {
      throw new UsageError(`Device login failed: ${error}`);
    }
    if (options.pollOnce) {
      throw new UsageError('Device login is still pending.');
    }
    if (error === 'slow_down') {
      intervalSeconds += 5;
    }
    await sleepFn(intervalSeconds * 1000);
  }

  throw new UsageError('Device login expired before authorization completed.');
}

export async function storeTokenFromStdin(io, metadata = {}) {
  const token = (await readAll(io.stdin)).trim();
  validateToken(token);
  return await storeTokenValue(token, metadata, io.env);
}

export async function storeTokenValue(token, metadata, env) {
  validateToken(token);
  const credentialPath = credentialsPath(env);
  await writePlaintextCredential(credentialPath, token, metadata);
  return {
    credentialPath,
    tokenPresent: true,
    tokenPrinted: false,
    projectFilesModified: false,
    storage: 'user-scoped-credential-file'
  };
}

export async function readStoredCredential(env) {
  const credentialPath = credentialsPath(env);
  const content = await readTextIfExists(credentialPath);
  if (!content.trim()) {
    return { path: credentialPath, token: null };
  }
  const parsed = parseJsonConfig(content, credentialPath);
  return {
    path: credentialPath,
    token: stringValue(parsed, ['token']),
    storage: stringValue(parsed, ['storage']),
    account: accountFromPayload(parsed.metadata)
  };
}

function accountFromPayload(payload) {
  const account = payload && typeof payload === 'object'
    ? (payload.user && typeof payload.user === 'object' ? payload.user : payload.account)
    : null;
  if (!account || typeof account !== 'object') {
    return null;
  }
  const userId = stringValue(account, ['user_id']) ?? stringValue(account, ['id']) ?? stringValue(account, ['userId']);
  const email = stringValue(account, ['email']);
  const displayName = stringValue(account, ['display_name']) ?? stringValue(account, ['name']) ?? stringValue(account, ['displayName']);
  if (!userId && !email && !displayName) {
    return null;
  }
  return {
    userId: userId ?? null,
    email: email ?? null,
    displayName: displayName ?? null
  };
}

export function formatAccount(account) {
  const label = account.displayName || account.email || account.userId || 'XMemo account';
  return account.email && account.displayName ? `${account.displayName} <${account.email}>` : label;
}

export async function resolveCredentialToken(env) {
  const environmentToken = env[TOKEN_ENV_VAR] ?? env[LEGACY_TOKEN_ENV_VAR];
  if (environmentToken) {
    return environmentToken;
  }
  const credential = await readStoredCredential(env);
  return credential.token;
}

export function credentialsPath(env) {
  return path.join(configRoot(env), 'credentials.json');
}

function configRoot(env) {
  if (env.XMEMO_CONFIG_HOME) {
    return env.XMEMO_CONFIG_HOME;
  }
  if (env.MEMORY_OS_CONFIG_HOME) {
    return env.MEMORY_OS_CONFIG_HOME;
  }
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'XMemo', 'CLI');
  }
  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, 'xmemo');
  }
  const home = env.HOME || os.homedir();
  return path.join(home, '.config', 'xmemo');
}

async function writePlaintextCredential(credentialPath, token, metadata = {}) {
  await fs.mkdir(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  await bestEffortChmod(path.dirname(credentialPath), 0o700);
  const payload = {
    version: 1,
    tokenEnvVar: TOKEN_ENV_VAR,
    storage: 'user-scoped-credential-file',
    createdAt: new Date().toISOString(),
    metadata,
    token
  };
  await fs.writeFile(credentialPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(credentialPath, 0o600);
}

export function validateToken(token) {
  if (!token) {
    throw new UsageError('Token from stdin is empty.');
  }

  if (/\s/.test(token)) {
    throw new UsageError('Token must not contain whitespace.');
  }

  if (token.length < 16) {
    throw new UsageError('Token is too short to be a production credential.');
  }
}
