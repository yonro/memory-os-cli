import fs from 'node:fs/promises';
import path from 'node:path';

import { hasFlag, optionValue } from '../core/args.js';
import { TOKEN_ENV_VAR, LEGACY_TOKEN_ENV_VAR } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import {
  bestEffortChmod,
  readTextIfExists,
  runProcess
} from '../core/runtime.js';
import {
  readStoredCredential,
  resolveCredentialToken,
  storeTokenValue
} from '../network/auth.js';

const HERMES_MCP_NAME = 'XMemo';
const HERMES_PLUGIN_PACKAGE = 'hermes-xmemo';
const DEFAULT_PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';

export function defaultHermesHome(env) {
  if (env.HERMES_HOME) {
    return env.HERMES_HOME;
  }
  const home = env.USERPROFILE || env.HOME;
  if (!home) {
    throw new UsageError('Cannot determine Hermes home. Set HERMES_HOME or HOME.');
  }
  return path.join(home, '.hermes');
}

function parseEnvContent(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const [rawKey, ...rest] = trimmed.split('=');
    const key = rawKey.trim();
    let value = rest.join('=').trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

async function readHermesEnvToken(envPath) {
  const content = await readTextIfExists(envPath);
  if (!content.trim()) {
    return null;
  }
  const values = parseEnvContent(content);
  return values.get(TOKEN_ENV_VAR) || values.get('MEMORY_OS_API_KEY') || values.get(LEGACY_TOKEN_ENV_VAR) || null;
}

async function writeHermesEnvToken(envPath, token) {
  const existing = await readTextIfExists(envPath);
  const lines = existing ? existing.split(/\r?\n/) : [];
  const output = [];
  let wrote = false;

  for (const line of lines) {
    const key = line.includes('=') ? line.split('=', 1)[0].trim() : '';
    if (key === TOKEN_ENV_VAR) {
      output.push(`${TOKEN_ENV_VAR}=${token}`);
      wrote = true;
    } else {
      output.push(line);
    }
  }

  if (!wrote) {
    output.push(`${TOKEN_ENV_VAR}=${token}`);
  }

  const text = `${output.join('\n').replace(/\n*$/, '')}\n`;
  await fs.mkdir(path.dirname(envPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(envPath, text, { mode: 0o600 });
  await bestEffortChmod(path.dirname(envPath), 0o700);
  await bestEffortChmod(envPath, 0o600);
}

async function resolveHermesCredential(io, hermesEnvPath) {
  const envToken = io.env[TOKEN_ENV_VAR] || io.env.MEMORY_OS_API_KEY || io.env[LEGACY_TOKEN_ENV_VAR];
  if (envToken) {
    return { token: envToken, source: 'process-env' };
  }

  const sharedToken = await resolveCredentialToken(io.env);
  if (sharedToken) {
    return { token: sharedToken, source: 'shared-credential' };
  }

  const hermesToken = await readHermesEnvToken(hermesEnvPath);
  if (hermesToken) {
    return { token: hermesToken, source: 'hermes-env' };
  }

  return { token: null, source: 'missing' };
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

async function runHermesCommand(command, args, io) {
  const result = await runProcess(command, args, io, { stream: false });
  if (result.code !== 0) {
    throw new UsageError(
      `Hermes setup command failed (${result.code}): ${commandText(command, args)}\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

export async function hermesSetupPlan({ setupPlan, optionArgs, io, dryRun, identity, client, force }) {
  const hermesHome = optionValue(optionArgs, '--hermes-home') ?? defaultHermesHome(io.env);
  const hermesEnvPath = path.join(hermesHome, '.env');
  const configPath = optionValue(optionArgs, '--config') ?? path.join(hermesHome, 'config.yaml');
  const mcpOnly = hasFlag(optionArgs, '--mcp-only');
  const withMcp = mcpOnly || hasFlag(optionArgs, '--with-mcp');
  const noPlugin = hasFlag(optionArgs, '--no-plugin');
  const noEnvSync = hasFlag(optionArgs, '--no-env-sync');
  const pythonBin = optionValue(optionArgs, '--python') ?? DEFAULT_PYTHON_BIN;
  const hermesXmemoBin = optionValue(optionArgs, '--hermes-xmemo-bin') ?? 'hermes-xmemo';

  const credential = await resolveHermesCredential(io, hermesEnvPath);
  const storedCredential = await readStoredCredential(io.env);
  const shouldBackfillSharedCredential = credential.token
    && credential.source === 'hermes-env'
    && !storedCredential.token;
  const shouldWriteHermesEnv = Boolean(credential.token) && !noEnvSync;

  const selectedClient = {
    id: 'hermes',
    label: 'Hermes',
    configKind: 'hermes-native-and-mcp',
    setupMode: mcpOnly ? 'mcp-only' : withMcp ? 'native-with-mcp' : 'native',
    configPath,
    hermesHome,
    hermesEnvPath,
    written: false,
    writesTokenValue: shouldWriteHermesEnv,
    tokenValueEmbeddedInMcpConfig: false,
    credential: {
      ready: Boolean(credential.token),
      source: credential.source,
      sharedCredentialBackfilled: false,
      hermesEnvSynced: false,
    },
    nativePlugin: {
      package: HERMES_PLUGIN_PACKAGE,
      installCommand: commandText(pythonBin, ['-m', 'pip', 'install', '-U', HERMES_PLUGIN_PACKAGE]),
      activateCommand: commandText(hermesXmemoBin, ['install', '--hermes-home', hermesHome]),
      installed: false,
      skipped: noPlugin || mcpOnly,
      note: noPlugin || mcpOnly
        ? mcpOnly
          ? 'Native Hermes plugin install skipped by --mcp-only.'
          : 'Native Hermes plugin install skipped by --no-plugin.'
        : 'Installs/updates the native Hermes XMemo plugin before syncing credentials.',
    },
    mcp: {
      enabled: withMcp,
      serverName: HERMES_MCP_NAME,
      mcpUrl: setupPlan.mcpUrl,
      written: false,
      only: mcpOnly,
      note: withMcp
        ? mcpOnly
          ? `Hosted MCP references ${TOKEN_ENV_VAR}; native Hermes plugin install and credential sync are skipped by --mcp-only.`
          : `Hosted MCP references ${TOKEN_ENV_VAR} from Hermes .env/process env; token value is not embedded in config.yaml.`
        : 'Hosted MCP is not installed by default; use --with-mcp for an explicit fallback.',
    },
    dryRun,
  };

  if (dryRun) {
    return selectedClient;
  }

  if (!noPlugin && !mcpOnly) {
    await runHermesCommand(pythonBin, ['-m', 'pip', 'install', '-U', HERMES_PLUGIN_PACKAGE], io);
    await runHermesCommand(hermesXmemoBin, ['install', '--hermes-home', hermesHome], io);
    selectedClient.nativePlugin.installed = true;
  }

  if (shouldBackfillSharedCredential && !mcpOnly) {
    await storeTokenValue(credential.token, { source: 'hermes-env-sync' }, io.env);
    selectedClient.credential.sharedCredentialBackfilled = true;
  }

  if (shouldWriteHermesEnv && !mcpOnly) {
    await writeHermesEnvToken(hermesEnvPath, credential.token);
    selectedClient.credential.hermesEnvSynced = true;
  }

  if (withMcp) {
    await client.writeConfig(configPath, setupPlan.mcpUrl, identity, { force });
    selectedClient.mcp.written = true;
  }

  selectedClient.written = selectedClient.nativePlugin.installed
    || selectedClient.credential.hermesEnvSynced
    || selectedClient.mcp.written;
  return selectedClient;
}
