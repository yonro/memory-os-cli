import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PRODUCT_NAME = 'XMemo';
const PACKAGE_NAME = '@xmemo/client';
const FALLBACK_PACKAGE_NAME = '@yonro/xmemo-client';
const COMMAND_NAME = 'xmemo';
const LEGACY_COMMAND_NAME = 'memory-os';
const CLI_VERSION = '0.4.129';
const DEFAULT_SERVICE_URL = 'https://xmemo.dev';
const TOKEN_ENV_VAR = 'XMEMO_KEY';
const LEGACY_TOKEN_ENV_VAR = 'MEMORY_OS_MCP_TOKEN';
const AGENT_ID_ENV_VAR = 'XMEMO_AGENT_ID';
const AGENT_INSTANCE_ENV_VAR = 'XMEMO_AGENT_INSTANCE_ID';
const AGENT_ID_HEADER = 'X-Memory-OS-Agent-ID';
const AGENT_INSTANCE_HEADER = 'X-Memory-OS-Agent-Instance-ID';
const MCP_SERVER_NAME = 'memory_os';
const CODEX_PROFILE_TARGET = 'AGENTS.md';
const CODEX_PROFILE_MARKER_START = '<!-- memory-os:codex-profile:start -->';
const CODEX_PROFILE_MARKER_END = '<!-- memory-os:codex-profile:end -->';
const DEVICE_LOGIN_START_PATH = '/api/v1/auth/device/start';
const DEVICE_LOGIN_TOKEN_PATH = '/api/v1/auth/device/token';
const DEFAULT_PROXY_HOST = '127.0.0.1';
const DEFAULT_PROXY_PORT = 8765;

const MCP_CLIENTS = new Map([
  ['codex', {
    label: 'Codex',
    defaultConfigPath: defaultCodexConfigPath,
    buildSnippet: codexTomlSnippet,
    writeConfig: appendTomlServerConfig,
    configKind: 'toml'
  }],
  ['cursor', {
    label: 'Cursor',
    defaultConfigPath: defaultCursorConfigPath,
    buildSnippet: cursorJsonSnippet,
    writeConfig: mergeJsonMcpConfig,
    configKind: 'json'
  }]
]);

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export async function run(args, io = defaultIo()) {
  try {
    const command = args[0] ?? 'help';

    if (command === '--help' || command === '-h' || command === 'help') {
      writeHelp(io);
      return 0;
    }

    if (command === '--version' || command === '-v' || command === 'version') {
      writeLine(io.stdout, CLI_VERSION);
      return 0;
    }

    if (command === 'update' || command === '--update') {
      return await updateCommand(args.slice(1), io);
    }

    if (command === 'doctor') {
      return await doctorCommand(args.slice(1), io);
    }

    if (command === 'discovery') {
      return await discoveryCommand(args.slice(1), io);
    }

    if (command === 'status') {
      return await statusCommand(args.slice(1), io);
    }

    if (command === 'setup') {
      return await setupCommand(args.slice(1), io);
    }

    if (command === 'login') {
      return await loginCommand(args.slice(1), io);
    }

    if (command === 'auth') {
      return await authCommand(args.slice(1), io);
    }

    if (command === 'token') {
      return await tokenCommand(args.slice(1), io);
    }

    if (command === 'mcp') {
      return await mcpCommand(args.slice(1), io);
    }

    if (command === 'profile') {
      return await profileCommand(args.slice(1), io);
    }

    if (command === 'smoke') {
      return await smokeCommand(args.slice(1), io);
    }

    if (command === 'env') {
      return envCommand(args.slice(1), io);
    }

    if (command === 'privacy') {
      writePrivacy(io);
      return 0;
    }

    throw new UsageError(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      writeLine(io.stderr, `Error: ${error.message}`);
      writeLine(io.stderr, `Run \`${COMMAND_NAME} help\` for usage.`);
      return 2;
    }

    writeLine(io.stderr, `Unexpected error: ${error.message}`);
    return 1;
  }
}

function defaultIo() {
  return {
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    spawn
  };
}

function writeHelp(io) {
  writeLine(io.stdout, `${PRODUCT_NAME} CLI (${PACKAGE_NAME})`);
  writeLine(io.stdout, `Fallback npm package: ${FALLBACK_PACKAGE_NAME}; legacy command alias: ${LEGACY_COMMAND_NAME}`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Usage:');
  writeLine(io.stdout, `  ${COMMAND_NAME} update [--dry-run] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor [--base-url <https://api.example.com>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} discovery show [--base-url <https://api.example.com>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} setup [codex|cursor] [--url <https://api.example.com>] [--write|--yes] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} login [--from-stdin] [--base-url <url>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} auth status [--verify] [--base-url <url>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} status [--url <https://api.example.com>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} token status [--verify]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} token add --from-stdin`);
  writeLine(io.stdout, `  ${COMMAND_NAME} token set --from-stdin [--allow-plaintext]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp list`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client <codex|cursor|copilot-cli|generic> [--base-url <url>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp proxy [--port ${DEFAULT_PROXY_PORT}]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp profile codex [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} profile install codex [--target AGENTS.md] [--dry-run|--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} profile uninstall codex [--target AGENTS.md] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <codex|cursor> [--url <https://api.example.com>] [--write] [--config <path>]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} smoke --client codex [--config <path>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} env example [--shell bash|powershell|cmd] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} privacy`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Default service URL: ${DEFAULT_SERVICE_URL}; use --url or XMEMO_URL for private deployments.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Privacy defaults: no telemetry, no token in project files, and no token is sent by `status`, `doctor`, or `discovery`.');
  writeLine(io.stdout, '`login` and `token add` store credentials only in the user-scoped XMemo CLI config directory.');
}

async function updateCommand(args, io) {
  const outputJson = hasFlag(args, '--json');
  const dryRun = hasFlag(args, '--dry-run');
  const npmCommand = npmExecutable();
  const npmArgs = ['install', '-g', `${PACKAGE_NAME}@latest`];
  const report = {
    package: PACKAGE_NAME,
    command: [npmCommand, ...npmArgs],
    dryRun,
    tokenSent: false,
    projectFilesModified: false
  };

  if (dryRun) {
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(report, null, 2));
    } else {
      writeLine(io.stdout, `Update command: ${report.command.join(' ')}`);
      writeLine(io.stdout, 'Dry run only; no changes made.');
    }
    return 0;
  }

  if (!outputJson) {
    writeLine(io.stdout, `Updating ${PACKAGE_NAME} with: ${report.command.join(' ')}`);
  }
  const result = await runProcess(npmCommand, npmArgs, io, { stream: !outputJson });
  report.exitCode = result.code;
  report.completed = result.code === 0;

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new UsageError(`Update failed: ${detail}`);
  }
  if (!outputJson) {
    writeLine(io.stdout, `Update complete. Run \`${COMMAND_NAME} --version\` to confirm.`);
  }
  return 0;
}

async function doctorCommand(args, io) {
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const outputJson = hasFlag(args, '--json');
  const timeoutMs = parsePositiveInteger(optionValue(args, '--timeout-ms') ?? '5000', '--timeout-ms');
  const discoveryUrl = endpointUrl(baseUrl, '/.well-known/agent-discovery.json');
  const discovery = await fetchJson(discoveryUrl, timeoutMs, io);
  ensureDiscoveryService(discovery, discoveryUrl);

  const rootVersion = await bestEffortRootVersion(discovery, timeoutMs, io);
  const mcpUrl = discoveryMcpUrl(discovery, baseUrl);
  const checks = [
    { name: 'node_version', ok: Number.parseInt(process.versions.node.split('.')[0], 10) >= 20, detail: process.versions.node },
    { name: 'discovery_reachable', ok: true, detail: discoveryUrl },
    { name: 'mcp_url_present', ok: Boolean(mcpUrl), detail: mcpUrl ?? 'missing' },
    { name: 'no_remote_code_execution', ok: booleanValue(discovery, ['security', 'no_remote_code_execution']) === true, detail: String(booleanValue(discovery, ['security', 'no_remote_code_execution'])) },
    {
      name: 'token_not_in_discovery',
      ok: booleanValue(discovery, ['security', 'token_in_discovery']) === false && booleanValue(discovery, ['auth', 'token_in_discovery']) === false,
      detail: `security=${booleanValue(discovery, ['security', 'token_in_discovery'])} auth=${booleanValue(discovery, ['auth', 'token_in_discovery'])}`
    },
    {
      name: 'service_version_compatible',
      ok: rootVersion.version ? sameMajorMinor(CLI_VERSION, rootVersion.version) : true,
      detail: rootVersion.version ? `service=${rootVersion.version} cli=${CLI_VERSION}` : `service version unavailable${rootVersion.error ? `: ${rootVersion.error}` : ''}`
    }
  ];
  const report = {
    ok: checks.every((check) => check.ok),
    cli: { package: PACKAGE_NAME, version: CLI_VERSION, node: process.versions.node },
    discovery: {
      url: discoveryUrl,
      schemaVersion: stringValue(discovery, ['schema_version']),
      protocol: stringValue(discovery, ['protocol']),
      service: stringValue(discovery, ['service']),
      serviceVersion: rootVersion.version ?? null,
      mcpUrl,
      supportedClients: agentDiscoveryClientIds(discovery)
    },
    checks
  };

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  writeLine(io.stdout, `${PRODUCT_NAME} CLI ${CLI_VERSION}`);
  writeLine(io.stdout, `Discovery: ${discoveryUrl}`);
  writeLine(io.stdout, `MCP: ${mcpUrl ?? 'missing'}`);
  if (rootVersion.version) {
    writeLine(io.stdout, `Service version: ${rootVersion.version}`);
  }
  writeLine(io.stdout, `Supported clients: ${report.discovery.supportedClients.join(', ') || 'unknown'}`);
  for (const check of checks) {
    writeLine(io.stdout, `${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
  }
  return report.ok ? 0 : 1;
}

async function discoveryCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Discovery commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} discovery show [--base-url <https://api.example.com>] [--json]`);
    return 0;
  }
  if (subcommand !== 'show') {
    throw new UsageError(`Unknown discovery command: ${subcommand}`);
  }

  const baseUrl = normalizeBaseUrl(baseUrlOption(args.slice(1), io.env));
  const outputJson = hasFlag(args, '--json');
  const timeoutMs = parsePositiveInteger(optionValue(args, '--timeout-ms') ?? '5000', '--timeout-ms');
  const discoveryUrl = endpointUrl(baseUrl, '/.well-known/agent-discovery.json');
  const discovery = await fetchJson(discoveryUrl, timeoutMs, io);
  ensureDiscoveryService(discovery, discoveryUrl);

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(discovery, null, 2));
    return 0;
  }

  writeLine(io.stdout, `${stringValue(discovery, ['name']) ?? PRODUCT_NAME} discovery`);
  writeLine(io.stdout, `URL: ${discoveryUrl}`);
  writeLine(io.stdout, `Protocol: ${stringValue(discovery, ['protocol']) ?? 'unknown'}`);
  writeLine(io.stdout, `MCP: ${discoveryMcpUrl(discovery, baseUrl) ?? 'missing'}`);
  writeLine(io.stdout, `Docs: ${stringValue(discovery, ['urls', 'docs']) ?? 'unknown'}`);
  writeLine(io.stdout, `Clients: ${agentDiscoveryClientIds(discovery).join(', ') || 'unknown'}`);
  writeLine(io.stdout, 'Security: read-only discovery; tokens are not returned; remote code execution is not advertised.');
  return 0;
}

async function statusCommand(args, io) {
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const outputJson = hasFlag(args, '--json');
  const timeoutMs = parsePositiveInteger(optionValue(args, '--timeout-ms') ?? '5000', '--timeout-ms');
  const endpoints = [
    endpointUrl(baseUrl, '/.well-known/memory-os.json'),
    endpointUrl(baseUrl, '/health'),
    endpointUrl(baseUrl, '/ready')
  ];

  const probes = [];
  for (const url of endpoints) {
    probes.push(await probe(url, timeoutMs, io));
  }

  const result = {
    ok: probes.some((item) => item.ok),
    baseUrl,
    privacy: {
      telemetry: false,
      tokenSent: false,
      tokenSource: 'not-used-by-status'
    },
    probes
  };

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  writeLine(io.stdout, `${PRODUCT_NAME} status for ${baseUrl}`);
  writeLine(io.stdout, 'Privacy: telemetry disabled; no token sent.');
  for (const item of probes) {
    if (item.ok) {
      writeLine(io.stdout, `  OK   ${item.status} ${item.url}`);
    } else {
      writeLine(io.stdout, `  FAIL ${item.status ?? 'ERR'} ${item.url} ${item.error ?? ''}`.trimEnd());
    }
  }

  return result.ok ? 0 : 1;
}

async function setupCommand(args, io) {
  const positionalClientId = positionalClientArg(args);
  const optionArgs = positionalClientId ? args.slice(1) : args;
  const baseUrl = normalizeBaseUrl(baseUrlOption(optionArgs, io.env));
  const outputJson = hasFlag(optionArgs, '--json');
  const shortClientSetup = Boolean(positionalClientId);
  const writeConfig = hasFlag(optionArgs, '--write') || (shortClientSetup && hasFlag(optionArgs, '--yes'));
  const clientId = positionalClientId ?? optionValue(optionArgs, '--client');
  const timeoutMs = parsePositiveInteger(optionValue(optionArgs, '--timeout-ms') ?? '5000', '--timeout-ms');
  const installProfile = shortClientSetup
    && clientId === 'codex'
    && writeConfig
    && !hasFlag(optionArgs, '--no-profile');

  if (writeConfig && !clientId) {
    throw new UsageError('Setup --write requires --client <codex|cursor> so the CLI never writes broad config implicitly.');
  }

  const discoveryUrl = endpointUrl(baseUrl, '/.well-known/memory-os.json');
  const discovery = await fetchJson(discoveryUrl, timeoutMs, io);
  ensureDiscoveryService(discovery, discoveryUrl);

  const statusUrl = stringValue(discovery, ['urls', 'onboarding_status'])
    ?? stringValue(discovery, ['onboarding_status_url'])
    ?? endpointUrl(baseUrl, '/v1/onboarding/status');
  const status = await fetchJson(statusUrl, timeoutMs, io);
  const setupPlan = buildSetupPlan({ baseUrl, discoveryUrl, statusUrl, discovery, status });

  if (clientId) {
    const client = MCP_CLIENTS.get(clientId);
    if (!client) {
      throw new UsageError(`Unsupported MCP client: ${clientId}. Supported clients: ${supportedMcpClientIds().join(', ')}.`);
    }

    const identity = writeConfig ? await agentIdentity(clientId, io.env) : envReferenceIdentity(clientId);
    setupPlan.selectedClient = clientSetupPlan(clientId, client, setupPlan.mcpUrl, io.env, identity);
    if (writeConfig) {
      await client.writeConfig(setupPlan.selectedClient.configPath, setupPlan.mcpUrl, identity);
      setupPlan.selectedClient.written = true;
    }

    if (clientId === 'codex' && shortClientSetup) {
      const profileTarget = optionValue(optionArgs, '--profile-target')
        ?? optionValue(optionArgs, '--target')
        ?? defaultCodexProfileTarget();
      const profileResult = await codexProfileInstallResult(profileTarget, { write: installProfile });
      setupPlan.selectedClient.codexProfile = profileResult;
    }
  }

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(setupPlan, null, 2));
    return 0;
  }

  writeSetupSummary(setupPlan, io);
  return 0;
}

async function profileCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Profile commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} profile install codex [--target AGENTS.md] [--dry-run|--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} profile status codex [--target AGENTS.md] [--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} profile uninstall codex [--target AGENTS.md] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Profile installs are marker-scoped and never write token values.');
    return 0;
  }

  const clientId = args[1];
  if (clientId !== 'codex') {
    throw new UsageError(`Unsupported profile client: ${clientId ?? 'missing'}. Supported clients: codex.`);
  }

  const optionArgs = args.slice(2);
  const outputJson = hasFlag(optionArgs, '--json');
  const targetPath = optionValue(optionArgs, '--target') ?? defaultCodexProfileTarget();
  let result;

  if (subcommand === 'install') {
    result = await codexProfileInstallResult(targetPath, { write: !hasFlag(optionArgs, '--dry-run') });
  } else if (subcommand === 'status') {
    result = await codexProfileStatusResult(targetPath);
  } else if (subcommand === 'uninstall') {
    result = await codexProfileUninstallResult(targetPath, { write: !hasFlag(optionArgs, '--dry-run') });
  } else {
    throw new UsageError(`Unknown profile command: ${subcommand}`);
  }

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(result, null, 2));
    return 0;
  }

  writeProfileResult(subcommand, result, io);
  return 0;
}

async function loginCommand(args, io) {
  const outputJson = hasFlag(args, '--json');
  const fromStdin = hasFlag(args, '--from-stdin') || hasFlag(args, '--token-stdin');
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const timeoutMs = parsePositiveInteger(optionValue(args, '--timeout-ms') ?? '30000', '--timeout-ms');
  const pollOnce = hasFlag(args, '--poll-once');

  if (fromStdin) {
    const result = await storeTokenFromStdin(io, { source: 'stdin' });
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(result, null, 2));
    } else {
      writeLine(io.stdout, `${PRODUCT_NAME} login complete.`);
      writeLine(io.stdout, `Stored token in user-scoped credential file: ${result.credentialPath}`);
      writeLine(io.stdout, 'Token value was not printed. Project files were not modified.');
    }
    return 0;
  }

  const start = await startDeviceLogin(baseUrl, timeoutMs, io);
  if (!outputJson) {
    writeLine(io.stdout, `${PRODUCT_NAME} device login`);
    writeLine(io.stdout, `Open: ${start.verificationUriComplete ?? start.verificationUri}`);
    if (start.userCode) {
      writeLine(io.stdout, `Code: ${start.userCode}`);
    }
    writeLine(io.stdout, 'Waiting for authorization...');
  }

  const token = await pollDeviceLogin(baseUrl, start, timeoutMs, io, { pollOnce });
  const result = await storeTokenValue(token, { source: 'device-login' }, io.env);
  const payload = {
    ...result,
    baseUrl,
    verificationUri: start.verificationUri,
    deviceLogin: true
  };

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(payload, null, 2));
  } else {
    writeLine(io.stdout, 'Login complete. Token stored securely in the user-scoped XMemo CLI config directory.');
    writeLine(io.stdout, `Credential path: ${result.credentialPath}`);
    writeLine(io.stdout, `Verify with: ${COMMAND_NAME} token status --verify`);
  }
  return 0;
}

async function authCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Auth commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} auth status [--verify] [--base-url <url>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Use \`${COMMAND_NAME} login\` to sign in and \`${COMMAND_NAME} token add --from-stdin\` to store an existing token.`);
    return 0;
  }

  if (subcommand === 'status') {
    return await credentialStatusCommand(args.slice(1), io, { mode: 'auth' });
  }

  throw new UsageError(`Unknown auth command: ${subcommand}`);
}

async function tokenCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Token commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} token status [--verify]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} token add --from-stdin`);
    writeLine(io.stdout, `  ${COMMAND_NAME} token set --from-stdin [--allow-plaintext]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, `${COMMAND_NAME} login is the recommended personal-user path.`);
    writeLine(io.stdout, `${COMMAND_NAME} token add --from-stdin stores a token in the user-scoped XMemo CLI config directory.`);
    return 0;
  }

  if (subcommand === 'status') {
    return await credentialStatusCommand(args.slice(1), io, { mode: 'token' });
  }

  if (subcommand === 'add') {
    if (!hasFlag(args, '--from-stdin')) {
      throw new UsageError('Refusing command-line token input. Pipe the token through stdin with --from-stdin.');
    }
    const result = await storeTokenFromStdin(io, { source: 'token-add' });
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(result, null, 2));
    } else {
      writeLine(io.stdout, `Stored token in user-scoped credential file: ${result.credentialPath}`);
      writeLine(io.stdout, 'Token value was not printed. Project files were not modified.');
    }
    return 0;
  }

  if (subcommand === 'set') {
    if (!hasFlag(args, '--from-stdin')) {
      throw new UsageError('Refusing command-line token input. Pipe the token through stdin with --from-stdin.');
    }
    const token = (await readAll(io.stdin)).trim();
    validateToken(token);
    if (!hasFlag(args, '--allow-plaintext')) {
      writeLine(io.stderr, 'Token was read from stdin but was not stored.');
      writeLine(io.stderr, 'Enterprise default refuses plaintext token storage without --allow-plaintext.');
      writeLine(io.stderr, `Preferred personal-user path: ${COMMAND_NAME} login or ${COMMAND_NAME} token add --from-stdin.`);
      return 2;
    }

    const result = await storeTokenValue(token, { source: 'token-set' }, io.env);
    writeLine(io.stdout, `Stored token in user-scoped credential file: ${result.credentialPath}`);
    writeLine(io.stdout, 'Token value was not printed. Do not commit this file.');
    return 0;
  }

  throw new UsageError(`Unknown token command: ${subcommand}`);
}

async function credentialStatusCommand(args, io, { mode }) {
  const outputJson = hasFlag(args, '--json');
  const verify = hasFlag(args, '--verify');
  const credential = await readStoredCredential(io.env);
  const environmentToken = io.env[TOKEN_ENV_VAR] ?? io.env[LEGACY_TOKEN_ENV_VAR] ?? '';
  const hasEnvironmentToken = Boolean(environmentToken);
  const hasUserCredential = Boolean(credential.token);
  const tokenSource = hasEnvironmentToken ? 'environment' : hasUserCredential ? 'user-credential-file' : 'missing';
  const report = {
    loggedIn: hasEnvironmentToken || hasUserCredential,
    tokenSource,
    environmentToken: {
      present: hasEnvironmentToken,
      variable: hasEnvironmentToken && io.env[TOKEN_ENV_VAR] ? TOKEN_ENV_VAR : hasEnvironmentToken ? LEGACY_TOKEN_ENV_VAR : TOKEN_ENV_VAR
    },
    userCredentialFile: {
      present: hasUserCredential,
      path: credential.path,
      storage: credential.storage ?? null
    },
    privacy: {
      tokenPrinted: false,
      projectFilesModified: false
    }
  };

  if (verify) {
    const token = await resolveCredentialToken(io.env);
    if (!token) {
      if (outputJson) {
        writeLine(io.stdout, JSON.stringify({ ...report, verification: { ok: false, detail: 'no token found' } }, null, 2));
      } else {
        writeCredentialStatus(report, io, { mode });
        writeLine(io.stderr, `No token found. Run \`${COMMAND_NAME} login\` or \`${COMMAND_NAME} token add --from-stdin\`.`);
      }
      return 1;
    }
    const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
    const timeoutMs = parsePositiveInteger(optionValue(args, '--timeout-ms') ?? '10000', '--timeout-ms');
    const verification = await verifyTokenWithMcp(baseUrl, token, timeoutMs, io);
    report.verification = verification;
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(report, null, 2));
      return verification.ok ? 0 : 1;
    }
    writeCredentialStatus(report, io, { mode });
    writeLine(io.stdout, `Remote token verification: ${verification.ok ? 'ok' : 'failed'} (${verification.detail})`);
    return verification.ok ? 0 : 1;
  }

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
  } else {
    writeCredentialStatus(report, io, { mode });
  }
  return report.loggedIn ? 0 : 1;
}

function writeCredentialStatus(report, io, { mode }) {
  if (mode === 'auth') {
    writeLine(io.stdout, `${PRODUCT_NAME} auth status`);
    writeLine(io.stdout, `Logged in: ${report.loggedIn ? 'yes' : 'no'}`);
    writeLine(io.stdout, `Credential source: ${report.tokenSource}`);
  }
  writeLine(io.stdout, `Environment token: ${report.environmentToken.present ? 'present' : 'missing'} (${report.environmentToken.variable})`);
  writeLine(io.stdout, `User credential file: ${report.userCredentialFile.present ? 'present' : 'missing'} (${report.userCredentialFile.path})`);
  writeLine(io.stdout, 'Token values are never printed.');
}

async function mcpCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'MCP commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp list`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client <codex|cursor|copilot-cli|generic> [--base-url <url>] [--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp proxy [--port ${DEFAULT_PROXY_PORT}] [--base-url <url>]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp profile codex [--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <codex|cursor> [--url <https://api.example.com>]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <codex|cursor> [--url <https://api.example.com>] --write [--config <path>]`);
    return 0;
  }

  if (subcommand === 'list') {
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(supportedMcpClients(), null, 2));
      return 0;
    }

    writeLine(io.stdout, 'Supported MCP clients:');
    for (const client of supportedMcpClients()) {
      writeLine(io.stdout, `  ${client.id.padEnd(8)} ${client.label} (${client.configKind})`);
    }
    writeLine(io.stdout, `All generated configs reference ${TOKEN_ENV_VAR}; token values are never embedded.`);
    return 0;
  }

  if (subcommand === 'config') {
    const clientId = optionValue(args, '--client') ?? args[1] ?? 'generic';
    const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
    const mcpUrl = endpointUrl(baseUrl, '/mcp');
    const useLocalProxy = clientId === 'copilot-cli' && !hasFlag(args, '--remote-env');
    const proxyPort = parsePositiveInteger(optionValue(args, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
    const proxyUrl = `http://${DEFAULT_PROXY_HOST}:${proxyPort}/mcp`;
    const template = useLocalProxy
      ? mcpLocalProxyTemplate(clientId, proxyUrl)
      : mcpConfigTemplate(clientId, mcpUrl);

    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(template, null, 2));
      return 0;
    }

    writeLine(io.stdout, `${PRODUCT_NAME} MCP config template for ${clientId}`);
    if (useLocalProxy) {
      writeLine(io.stdout, `Requires credential: ${COMMAND_NAME} login or ${COMMAND_NAME} token add --from-stdin`);
      writeLine(io.stdout, `Run local proxy: ${template.requiresLocalCommand}`);
    } else {
      writeLine(io.stdout, `Requires env: ${TOKEN_ENV_VAR}`);
    }
    if (typeof template.snippet === 'string') {
      writeLine(io.stdout, template.snippet.trimEnd());
    } else {
      writeLine(io.stdout, JSON.stringify(template.snippet, null, 2));
    }
    writeLine(io.stdout, 'Review the template before applying it. Token values are not included.');
    return 0;
  }

  if (subcommand === 'proxy') {
    return await mcpProxyCommand(args.slice(1), io);
  }

  if (subcommand === 'profile') {
    const clientId = args[1] ?? 'codex';
    if (clientId !== 'codex') {
      throw new UsageError('Only the Codex memory behavior profile is available in this MCP-depth release.');
    }

    const profile = codexMemoryProfile();
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(profile, null, 2));
      return 0;
    }

    writeCodexMemoryProfile(profile, io);
    return 0;
  }

  const target = args[1] ?? '';
  const client = MCP_CLIENTS.get(target);

  if (subcommand !== 'add' || !client) {
    throw new UsageError(`Supported MCP setup command: ${COMMAND_NAME} mcp add <${supportedMcpClientIds().join('|')}> [--url <url>]`);
  }

  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const configPath = optionValue(args, '--config') ?? client.defaultConfigPath(io.env);
  const mcpUrl = endpointUrl(baseUrl, '/mcp');

  if (hasFlag(args, '--json')) {
    const identity = envReferenceIdentity(target);
    writeLine(io.stdout, JSON.stringify({
      client: target,
      label: client.label,
      configKind: client.configKind,
      configPath,
      serverName: MCP_SERVER_NAME,
      url: mcpUrl,
      tokenEnvVar: TOKEN_ENV_VAR,
      agentId: identity.agentId,
      agentInstanceId: identity.agentInstanceId,
      agentInstanceIdPath: identity.path,
      writesTokenValue: false
    }, null, 2));
    return 0;
  }

  const identity = hasFlag(args, '--write') ? await agentIdentity(target, io.env) : envReferenceIdentity(target);
  if (hasFlag(args, '--write')) {
    await client.writeConfig(configPath, mcpUrl, identity);
    writeLine(io.stdout, `Updated ${client.label} MCP config: ${configPath}`);
    writeLine(io.stdout, `Token value was not written. ${client.label} will read ${TOKEN_ENV_VAR} from the environment.`);
    writeLine(io.stdout, `Agent instance ID stored outside git: ${identity.path}`);
    return 0;
  }

  const snippet = client.buildSnippet(mcpUrl, identity);
  writeLine(io.stdout, `Add this to your ${client.label} config (${configPath}):`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, snippet.trimEnd());
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Set ${TOKEN_ENV_VAR} in your user environment or secret manager. The token value is not included here.`);
  return 0;
}

async function mcpProxyCommand(args, io) {
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const mcpUrl = endpointUrl(baseUrl, '/mcp');
  const host = optionValue(args, '--host') ?? DEFAULT_PROXY_HOST;
  const port = parsePositiveInteger(optionValue(args, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
  const token = await resolveCredentialToken(io.env);
  if (!token) {
    throw new UsageError(`No token found. Run \`${COMMAND_NAME} login\` or \`${COMMAND_NAME} token add --from-stdin\` first.`);
  }
  validateToken(token);
  const identity = await agentIdentity('copilot-cli', io.env);

  const server = http.createServer(async (request, response) => {
    try {
      await handleMcpProxyRequest({ request, response, mcpUrl, token, identity, io });
    } catch (error) {
      response.statusCode = 502;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'mcp_proxy_error', message: error.message }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  writeLine(io.stdout, `${PRODUCT_NAME} MCP proxy listening on http://${host}:${port}/mcp`);
  writeLine(io.stdout, `Forwarding to ${mcpUrl}`);
  writeLine(io.stdout, `Credential source: ${TOKEN_ENV_VAR} or ${credentialsPath(io.env)}`);
  return 0;
}

async function handleMcpProxyRequest({ request, response, mcpUrl, token, identity, io }) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `${DEFAULT_PROXY_HOST}:${DEFAULT_PROXY_PORT}`}`);
  if (request.method !== 'POST' || requestUrl.pathname !== '/mcp') {
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const body = await readAll(request);
  const upstreamHeaders = {
    accept: String(request.headers.accept || 'application/json, text/event-stream'),
    'content-type': String(request.headers['content-type'] || 'application/json'),
    authorization: `Bearer ${token}`,
    [AGENT_ID_HEADER]: identity.agentId,
    [AGENT_INSTANCE_HEADER]: identity.agentInstanceId,
    'user-agent': `XMemo-CLI-Proxy/${CLI_VERSION} (+https://github.com/yonro/memory-os-cli)`
  };
  const sessionId = request.headers['mcp-session-id'];
  if (sessionId) {
    upstreamHeaders['mcp-session-id'] = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  }

  const upstream = await io.fetch(mcpUrl, {
    method: 'POST',
    headers: upstreamHeaders,
    body
  });

  response.statusCode = upstream.status;
  for (const header of ['content-type', 'mcp-session-id']) {
    const value = upstream.headers.get(header);
    if (value) {
      response.setHeader(header, value);
    }
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  response.end(buffer);
}

async function smokeCommand(args, io) {
  const clientId = optionValue(args, '--client');
  const outputJson = hasFlag(args, '--json');
  if (!clientId) {
    throw new UsageError('Smoke requires --client codex for this MCP-depth release.');
  }
  if (clientId !== 'codex') {
    throw new UsageError('Only Codex smoke checks are available in this MCP-depth release.');
  }

  const configPath = optionValue(args, '--config') ?? defaultCodexConfigPath(io.env);
  const report = await codexSmokeReport(configPath, io.env);

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  writeLine(io.stdout, `${PRODUCT_NAME} Codex MCP smoke: ${report.ok ? 'ok' : 'failed'}`);
  writeLine(io.stdout, `Config: ${report.configPath}`);
  writeLine(io.stdout, `Token env: ${report.tokenEnvVar}`);
  for (const check of report.checks) {
    const status = check.ok ? 'OK' : check.required ? 'FAIL' : 'WARN';
    writeLine(io.stdout, `  ${status} ${check.name}: ${check.detail}`);
  }
  return report.ok ? 0 : 1;
}

function envCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Env commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} env example [--shell bash|powershell|cmd] [--base-url <url>] [--json]`);
    return 0;
  }
  if (subcommand !== 'example') {
    throw new UsageError(`Unknown env command: ${subcommand}`);
  }

  const baseUrl = normalizeBaseUrl(baseUrlOption(args.slice(1), io.env));
  const outputJson = hasFlag(args, '--json');
  const shell = optionValue(args, '--shell') ?? (process.platform === 'win32' ? 'powershell' : 'bash');
  const placeholder = '<paste-token-from-your-secret-store>';
  const payload = {
    XMEMO_URL: baseUrl,
    XMEMO_BASE_URL: baseUrl,
    MEMORY_OS_URL: baseUrl,
    MEMORY_OS_BASE_URL: baseUrl,
    [TOKEN_ENV_VAR]: placeholder,
    [AGENT_ID_ENV_VAR]: '<agent-family>',
    [AGENT_INSTANCE_ENV_VAR]: '<stable-random-id-for-this-local-agent>'
  };

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(payload, null, 2));
    return 0;
  }

  if (shell === 'powershell') {
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('XMEMO_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('XMEMO_BASE_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('MEMORY_OS_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('MEMORY_OS_BASE_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('${TOKEN_ENV_VAR}', '${placeholder}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('${AGENT_ID_ENV_VAR}', '<agent-family>', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('${AGENT_INSTANCE_ENV_VAR}', '<stable-random-id-for-this-local-agent>', 'User')`);
  } else if (shell === 'cmd') {
    writeLine(io.stdout, `setx XMEMO_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx XMEMO_BASE_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx MEMORY_OS_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx MEMORY_OS_BASE_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx ${TOKEN_ENV_VAR} "${placeholder}"`);
    writeLine(io.stdout, `setx ${AGENT_ID_ENV_VAR} "<agent-family>"`);
    writeLine(io.stdout, `setx ${AGENT_INSTANCE_ENV_VAR} "<stable-random-id-for-this-local-agent>"`);
  } else {
    writeLine(io.stdout, `export XMEMO_URL="${baseUrl}"`);
    writeLine(io.stdout, `export XMEMO_BASE_URL="${baseUrl}"`);
    writeLine(io.stdout, `export MEMORY_OS_URL="${baseUrl}"`);
    writeLine(io.stdout, `export MEMORY_OS_BASE_URL="${baseUrl}"`);
    writeLine(io.stdout, `export ${TOKEN_ENV_VAR}="${placeholder}"`);
    writeLine(io.stdout, `export ${AGENT_ID_ENV_VAR}="<agent-family>"`);
    writeLine(io.stdout, `export ${AGENT_INSTANCE_ENV_VAR}="<stable-random-id-for-this-local-agent>"`);
  }
  return 0;
}

function writePrivacy(io) {
  writeLine(io.stdout, `${PRODUCT_NAME} CLI privacy and security defaults:`);
  writeLine(io.stdout, '- No telemetry or analytics.');
  writeLine(io.stdout, '- `status` does not send tokens.');
  writeLine(io.stdout, `- MCP configs reference ${TOKEN_ENV_VAR}; token values are not embedded.`);
  writeLine(io.stdout, `- Agent instance IDs are non-secret and stored in user-scoped config outside git.`);
  writeLine(io.stdout, '- `login` and `token add` store credentials in the user-scoped XMemo CLI config directory.');
  writeLine(io.stdout, '- Legacy `token set` plaintext storage requires explicit --allow-plaintext.');
  writeLine(io.stdout, '- npm publishing is restricted by package.json files whitelist.');
}

async function startDeviceLogin(baseUrl, timeoutMs, io) {
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

async function pollDeviceLogin(baseUrl, start, timeoutMs, io, options = {}) {
  const deadline = Date.now() + Math.min(start.expiresIn * 1000, timeoutMs);
  while (Date.now() <= deadline) {
    const payload = await postJson(endpointUrl(baseUrl, DEVICE_LOGIN_TOKEN_PATH), {
      device_code: start.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    }, timeoutMs, io, { allowDevicePending: true });

    const token = stringValue(payload, ['access_token']) ?? stringValue(payload, ['token']);
    if (token) {
      validateToken(token);
      return token;
    }

    const error = stringValue(payload, ['error']);
    if (error && error !== 'authorization_pending' && error !== 'slow_down') {
      throw new UsageError(`Device login failed: ${error}`);
    }
    if (options.pollOnce) {
      throw new UsageError('Device login is still pending.');
    }
    await sleep((error === 'slow_down' ? start.interval + 5 : start.interval) * 1000);
  }

  throw new UsageError('Device login expired before authorization completed.');
}

async function storeTokenFromStdin(io, metadata = {}) {
  const token = (await readAll(io.stdin)).trim();
  validateToken(token);
  return await storeTokenValue(token, metadata, io.env);
}

async function storeTokenValue(token, metadata, env) {
  validateToken(token);
  const credentialPath = credentialsPath(env);
  await writePlaintextCredential(credentialPath, token, metadata);
  return {
    ok: true,
    credentialPath,
    tokenPresent: true,
    tokenPrinted: false,
    projectFilesModified: false,
    storage: 'user-scoped-credential-file'
  };
}

async function readStoredCredential(env) {
  const credentialPath = credentialsPath(env);
  const content = await readTextIfExists(credentialPath);
  if (!content.trim()) {
    return { path: credentialPath, token: null };
  }

  const parsed = parseJsonConfig(content, credentialPath);
  return {
    path: credentialPath,
    token: stringValue(parsed, ['token']),
    storage: stringValue(parsed, ['storage'])
  };
}

async function resolveCredentialToken(env) {
  const environmentToken = env[TOKEN_ENV_VAR] ?? env[LEGACY_TOKEN_ENV_VAR];
  if (environmentToken) {
    return environmentToken;
  }
  const credential = await readStoredCredential(env);
  return credential.token;
}

async function verifyTokenWithMcp(baseUrl, token, timeoutMs, io) {
  const url = endpointUrl(baseUrl, '/mcp');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await io.fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'user-agent': `XMemo-CLI/${CLI_VERSION} (+https://github.com/yonro/memory-os-cli)`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: COMMAND_NAME, version: CLI_VERSION }
        }
      }),
      signal: controller.signal
    });
    return {
      ok: response.ok,
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      detail: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probe(url, timeoutMs, io) {
  if (typeof io.fetch !== 'function') {
    return { url, ok: false, error: 'fetch unavailable in this Node runtime' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await io.fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    return { url, ok: response.ok, status: response.status };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs, io) {
  if (typeof io.fetch !== 'function') {
    throw new UsageError('This Node runtime does not provide fetch; use Node.js 20 or newer.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await io.fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new UsageError(`Discovery request failed with HTTP ${response.status}: ${url}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    const reason = error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message;
    throw new UsageError(`Discovery request failed: ${url} (${reason})`);
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(url, payload, timeoutMs, io, options = {}) {
  if (typeof io.fetch !== 'function') {
    throw new UsageError('This Node runtime does not provide fetch; use Node.js 20 or newer.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await io.fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const responsePayload = await response.json();
    if (!response.ok) {
      const error = stringValue(responsePayload, ['error']) ?? stringValue(responsePayload, ['detail']) ?? `HTTP ${response.status}`;
      if (options.allowDevicePending && (error === 'authorization_pending' || error === 'slow_down')) {
        return { error };
      }
      throw new UsageError(`Request failed with HTTP ${response.status}: ${url} (${error})`);
    }
    return responsePayload;
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    const reason = error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message;
    throw new UsageError(`Request failed: ${url} (${reason})`);
  } finally {
    clearTimeout(timeout);
  }
}

function ensureDiscoveryService(discovery, discoveryUrl) {
  const service = stringValue(discovery, ['service']);
  if (service && service !== 'memory-os') {
    throw new UsageError(`Discovery document at ${discoveryUrl} is for '${service}', not 'memory-os'.`);
  }
}

function buildSetupPlan({ baseUrl, discoveryUrl, statusUrl, discovery, status }) {
  const apiBase = stringValue(discovery, ['urls', 'api_base'])
    ?? stringValue(discovery, ['api_base_url'])
    ?? baseUrl;
  const mcpUrl = stringValue(discovery, ['urls', 'mcp'])
    ?? stringValue(discovery, ['mcp_url'])
    ?? endpointUrl(apiBase, '/mcp');
  const tokenPortalUrl = stringValue(discovery, ['urls', 'token_portal'])
    ?? stringValue(discovery, ['token_portal_url'])
    ?? stringValue(status, ['requirements', 'token_portal_url']);
  const tokenEnvVar = stringValue(discovery, ['auth', 'token_env_var'])
    ?? stringValue(status, ['requirements', 'token_env_var'])
    ?? TOKEN_ENV_VAR;

  return {
    schemaVersion: '1.0',
    baseUrl,
    discoveryUrl,
    statusUrl,
    apiBase,
    mcpUrl,
    guideUrl: stringValue(discovery, ['urls', 'guide']) ?? endpointUrl(apiBase, '/guide'),
    docsUrl: stringValue(discovery, ['urls', 'docs']),
    tokenPortalUrl,
    tokenEnvVar,
    onboardingReady: booleanValue(status, ['ready']),
    supportedClients: discoveryMcpClients(discovery),
    localClients: supportedMcpClients(),
    privacy: {
      telemetry: false,
      tokenSent: false,
      tokenEmbeddedInConfig: false
    },
    boundaries: {
      clientAllowed: arrayValue(discovery, ['agent_boundary', 'client_allowed'])
        ?? arrayValue(status, ['agent_boundary', 'client_allowed'])
        ?? [],
      adminRequired: arrayValue(discovery, ['agent_boundary', 'admin_required'])
        ?? arrayValue(status, ['agent_boundary', 'admin_required'])
        ?? []
    }
  };
}

async function bestEffortRootVersion(discovery, timeoutMs, io) {
  const rootDiscoveryUrl = stringValue(discovery, ['urls', 'root_discovery']);
  if (!rootDiscoveryUrl) {
    return {};
  }
  try {
    const rootDiscovery = await fetchJson(rootDiscoveryUrl, timeoutMs, io);
    return { version: stringValue(rootDiscovery, ['version']) ?? undefined };
  } catch (error) {
    return { error: error.message };
  }
}

function discoveryMcpUrl(discovery, baseUrl) {
  return stringValue(discovery, ['api', 'mcp', 'url'])
    ?? stringValue(discovery, ['urls', 'mcp'])
    ?? endpointUrl(baseUrl, '/mcp');
}

function agentDiscoveryClientIds(discovery) {
  const clients = Array.isArray(discovery?.clients) ? discovery.clients : [];
  const ids = clients
    .filter((client) => isPlainObject(client) && typeof client.id === 'string')
    .map((client) => client.id);
  if (ids.length > 0) {
    return ids;
  }
  const supported = arrayValue(discovery, ['supported_clients']);
  return supported ?? [];
}

function mcpConfigTemplate(clientId, mcpUrl) {
  if (clientId === 'codex') {
    return {
      client: clientId,
      serverName: MCP_SERVER_NAME,
      snippetFormat: 'toml',
      snippet: codexTomlSnippet(mcpUrl),
      requiresEnv: [TOKEN_ENV_VAR],
      optionalEnv: [AGENT_INSTANCE_ENV_VAR],
      agentIdentity: {
        agentId: 'codex',
        agentIdHeader: AGENT_ID_HEADER,
        agentInstanceEnvVar: AGENT_INSTANCE_ENV_VAR,
        agentInstanceHeader: AGENT_INSTANCE_HEADER
      },
      writesTokenValue: false
    };
  }

  const serverName = clientId === 'cursor' || clientId === 'gemini-cli' ? 'memory_os' : 'memory-os';
  return {
    client: clientId,
    serverName,
    snippetFormat: 'json',
    snippet: {
      mcpServers: {
        [serverName]: {
          type: 'http',
          url: mcpUrl,
          headers: {
            Authorization: `Bearer \${${TOKEN_ENV_VAR}}`,
            [AGENT_ID_HEADER]: clientId,
            [AGENT_INSTANCE_HEADER]: `\${${AGENT_INSTANCE_ENV_VAR}}`
          }
        }
      }
    },
    requiresEnv: [TOKEN_ENV_VAR],
    optionalEnv: [AGENT_INSTANCE_ENV_VAR],
    agentIdentity: {
      agentId: clientId,
      agentIdHeader: AGENT_ID_HEADER,
      agentInstanceEnvVar: AGENT_INSTANCE_ENV_VAR,
      agentInstanceHeader: AGENT_INSTANCE_HEADER
    },
    writesTokenValue: false
  };
}

function mcpLocalProxyTemplate(clientId, proxyUrl) {
  const serverName = clientId === 'cursor' || clientId === 'gemini-cli' ? 'memory_os' : 'memory-os';
  return {
    client: clientId,
    serverName,
    snippetFormat: 'json',
    snippet: {
      mcpServers: {
        [serverName]: {
          type: 'http',
          url: proxyUrl
        }
      }
    },
    requiresCredential: [`${COMMAND_NAME} login`, `${COMMAND_NAME} token add --from-stdin`],
    requiresLocalCommand: `${COMMAND_NAME} mcp proxy --port ${new URL(proxyUrl).port || DEFAULT_PROXY_PORT}`,
    agentIdentity: {
      agentId: clientId,
      agentIdHeader: AGENT_ID_HEADER,
      agentInstanceEnvVar: AGENT_INSTANCE_ENV_VAR,
      agentInstanceHeader: AGENT_INSTANCE_HEADER
    },
    writesTokenValue: false
  };
}

function sameMajorMinor(left, right) {
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  return leftParts[0] === rightParts[0] && leftParts[1] === rightParts[1];
}

function baseUrlOption(args, env) {
  return optionValue(args, '--base-url')
    ?? optionValue(args, '--url')
    ?? env.XMEMO_BASE_URL
    ?? env.XMEMO_URL
    ?? env.MEMORY_OS_BASE_URL
    ?? env.MEMORY_OS_URL
    ?? DEFAULT_SERVICE_URL;
}

function clientSetupPlan(clientId, client, mcpUrl, env, identity) {
  return {
    id: clientId,
    label: client.label,
    configKind: client.configKind,
    configPath: client.defaultConfigPath(env),
    serverName: MCP_SERVER_NAME,
    mcpUrl,
    tokenEnvVar: TOKEN_ENV_VAR,
    agentId: identity.agentId,
    agentInstanceId: identity.agentInstanceId,
    agentInstanceIdPath: identity.path,
    writesTokenValue: false,
    written: false
  };
}

function writeSetupSummary(plan, io) {
  writeLine(io.stdout, `${PRODUCT_NAME} setup discovery: ${plan.baseUrl}`);
  writeLine(io.stdout, `  API: ${plan.apiBase}`);
  writeLine(io.stdout, `  MCP: ${plan.mcpUrl}`);
  writeLine(io.stdout, `  Guide: ${plan.guideUrl}`);
  if (plan.docsUrl) {
    writeLine(io.stdout, `  Docs: ${plan.docsUrl}`);
  }
  if (plan.tokenPortalUrl) {
    writeLine(io.stdout, `  Token portal: ${plan.tokenPortalUrl}`);
  }
  writeLine(io.stdout, `  Token env var: ${plan.tokenEnvVar}`);
  writeLine(io.stdout, `  Onboarding ready: ${plan.onboardingReady === null ? 'unknown' : plan.onboardingReady}`);
  writeLine(io.stdout, 'Privacy: telemetry disabled; no token sent; generated config references env vars only.');

  if (plan.boundaries.adminRequired.length > 0) {
    writeLine(io.stdout, `Admin-only actions: ${plan.boundaries.adminRequired.join(', ')}`);
  }

  if (plan.selectedClient) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Selected client: ${plan.selectedClient.label}`);
    writeLine(io.stdout, `  Config path: ${plan.selectedClient.configPath}`);
    writeLine(io.stdout, `  Written: ${plan.selectedClient.written}`);
    writeLine(io.stdout, `  Token value embedded: ${plan.selectedClient.writesTokenValue}`);
    writeLine(io.stdout, `  Agent ID: ${plan.selectedClient.agentId}`);
    writeLine(io.stdout, `  Agent instance ID stored: ${plan.selectedClient.agentInstanceIdPath}`);
    if (plan.selectedClient.codexProfile) {
      const profile = plan.selectedClient.codexProfile;
      writeLine(io.stdout, `  Codex profile target: ${profile.targetPath}`);
      writeLine(io.stdout, `  Codex profile installed: ${profile.written}`);
      writeLine(io.stdout, `  Codex profile changed: ${profile.changed}`);
      if (!profile.written) {
        writeLine(io.stdout, `  Profile preview: ${COMMAND_NAME} profile install codex --target ${profile.targetPath}`);
      }
    }
    if (!plan.selectedClient.written) {
      writeLine(io.stdout, `  Next: ${COMMAND_NAME} mcp add ${plan.selectedClient.id} --url ${plan.apiBase} --write`);
    }
    return;
  }

  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Next steps:');
  writeLine(io.stdout, `  1. Create a scoped token in the token portal and store it in ${plan.tokenEnvVar}.`);
  writeLine(io.stdout, `  2. Configure a client, for example: ${COMMAND_NAME} setup --url ${plan.baseUrl} --client codex --write`);
  writeLine(io.stdout, `  3. Run ${COMMAND_NAME} status to smoke-test the service without sending the token.`);
}

function discoveryMcpClients(discovery) {
  const clients = discovery?.clients?.mcp;
  if (!Array.isArray(clients)) {
    return [];
  }

  return clients
    .filter((client) => isPlainObject(client) && typeof client.id === 'string')
    .map((client) => ({
      id: client.id,
      configEndpoint: typeof client.config_endpoint === 'string' ? client.config_endpoint : null
    }));
}

function normalizeBaseUrl(input) {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new UsageError('URL must use http or https.');
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    throw new UsageError(`Invalid URL: ${input}`);
  }
}

function endpointUrl(baseUrl, pathname) {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.hash = '';
  url.search = '';
  return url.toString();
}

function codexTomlSnippet(mcpUrl) {
  return `[mcp_servers.${MCP_SERVER_NAME}]
url = "${escapeTomlString(mcpUrl)}"
bearer_token_env_var = "${TOKEN_ENV_VAR}"
`;
}

function codexMemoryProfile() {
  return {
    client: 'codex',
    profileVersion: 'codex-mcp-depth-v1',
    mcpServerName: MCP_SERVER_NAME,
    requiredTokenEnv: TOKEN_ENV_VAR,
    objective: 'Use XMemo deliberately through MCP for project context recall and high-signal write-back.',
    instructions: [
      'At the start of a non-trivial task, call XMemo recall/search for relevant project decisions, conventions, prior fixes, and active context unless the user explicitly asks not to use memory.',
      'Use recalled memories as evidence, not as unquestioned truth. Prefer current repository files when memory conflicts with code.',
      'After meaningful decisions, bug fixes, release steps, or durable conventions, write a concise XMemo memory with scope, source, and no secret values.',
      'Never store tokens, API keys, cookies, private keys, raw credentials, or sensitive customer data in XMemo.',
      'For routine or low-signal output, skip durable writes. Prefer summarized procedural or semantic memories over verbose logs.',
      'Keep XMemo authentication through the XMEMO_KEY environment variable; do not paste token values into prompts, config files, or logs.'
    ],
    setupCommand: `${COMMAND_NAME} setup codex --url "$XMEMO_URL" --yes`,
    smokeCommand: `${COMMAND_NAME} smoke --client codex`
  };
}

function writeCodexMemoryProfile(profile, io) {
  writeLine(io.stdout, `${PRODUCT_NAME} Codex memory behavior profile`);
  writeLine(io.stdout, `Profile: ${profile.profileVersion}`);
  writeLine(io.stdout, `MCP server: ${profile.mcpServerName}`);
  writeLine(io.stdout, `Token env: ${profile.requiredTokenEnv}`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Recommended Codex instructions:');
  for (const instruction of profile.instructions) {
    writeLine(io.stdout, `- ${instruction}`);
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Setup: ${profile.setupCommand}`);
  writeLine(io.stdout, `Smoke test: ${profile.smokeCommand}`);
}

function codexProfileInstructionText() {
  const profile = codexMemoryProfile();
  const lines = [
    '## XMemo Codex profile',
    '',
    `MCP server: \`${profile.mcpServerName}\``,
    `Token env var: \`${profile.requiredTokenEnv}\``,
    '',
    profile.objective,
    '',
    'Recommended Codex behavior:'
  ];
  for (const instruction of profile.instructions) {
    lines.push(`- ${instruction}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function codexProfileMarkerBlock() {
  return `${CODEX_PROFILE_MARKER_START}\n${codexProfileInstructionText()}${CODEX_PROFILE_MARKER_END}\n`;
}

function defaultCodexProfileTarget() {
  return path.resolve(process.cwd(), CODEX_PROFILE_TARGET);
}

async function codexProfileInstallResult(targetPath, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = markerBounds(existing);
  const block = codexProfileMarkerBlock();
  let nextText;

  if (marker.present) {
    nextText = `${existing.slice(0, marker.start)}${block}${existing.slice(marker.end)}`;
  } else if (existing.trim().length === 0) {
    nextText = block;
  } else {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    nextText = `${existing}${separator}${block}`;
  }

  const changed = nextText !== existing;
  const write = Boolean(options.write);
  if (write && changed) {
    await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fs.writeFile(resolvedTarget, nextText);
  }

  return {
    client: 'codex',
    action: 'install',
    targetPath: resolvedTarget,
    markerStart: CODEX_PROFILE_MARKER_START,
    markerEnd: CODEX_PROFILE_MARKER_END,
    installed: marker.present || (write && changed),
    written: write,
    changed,
    markerPresent: marker.present,
    writesTokenValue: false
  };
}

async function codexProfileStatusResult(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = markerBounds(existing);
  return {
    client: 'codex',
    action: 'status',
    targetPath: resolvedTarget,
    installed: marker.present,
    markerPresent: marker.present,
    markerStart: CODEX_PROFILE_MARKER_START,
    markerEnd: CODEX_PROFILE_MARKER_END,
    writesTokenValue: false
  };
}

async function codexProfileUninstallResult(targetPath, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = markerBounds(existing);
  const write = Boolean(options.write);
  let changed = false;

  if (marker.present) {
    let nextText = `${existing.slice(0, marker.start)}${existing.slice(marker.end)}`;
    nextText = nextText.replace(/\n{3,}/g, '\n\n');
    if (nextText.trim().length === 0) {
      nextText = '';
    } else if (!nextText.endsWith('\n')) {
      nextText = `${nextText}\n`;
    }
    changed = nextText !== existing;
    if (write && changed) {
      await fs.writeFile(resolvedTarget, nextText);
    }
  }

  return {
    client: 'codex',
    action: 'uninstall',
    targetPath: resolvedTarget,
    installed: marker.present && !(write && changed),
    written: write,
    changed,
    markerPresent: marker.present,
    markerStart: CODEX_PROFILE_MARKER_START,
    markerEnd: CODEX_PROFILE_MARKER_END,
    writesTokenValue: false
  };
}

function markerBounds(content) {
  const start = content.indexOf(CODEX_PROFILE_MARKER_START);
  const end = content.indexOf(CODEX_PROFILE_MARKER_END);
  if (start === -1 && end === -1) {
    return { present: false, start: -1, end: -1 };
  }

  if (start === -1 || end === -1 || end < start) {
    throw new UsageError('Codex profile markers are incomplete or out of order; edit the target file manually before retrying.');
  }

  if (
    content.indexOf(CODEX_PROFILE_MARKER_START, start + CODEX_PROFILE_MARKER_START.length) !== -1
    || content.indexOf(CODEX_PROFILE_MARKER_END, end + CODEX_PROFILE_MARKER_END.length) !== -1
  ) {
    throw new UsageError('Codex profile markers appear more than once; edit the target file manually before retrying.');
  }

  const afterEnd = end + CODEX_PROFILE_MARKER_END.length;
  const trailingNewlineLength = content.slice(afterEnd, afterEnd + 2) === '\r\n'
    ? 2
    : content.slice(afterEnd, afterEnd + 1) === '\n'
      ? 1
      : 0;

  return {
    present: true,
    start,
    end: afterEnd + trailingNewlineLength
  };
}

function writeProfileResult(action, result, io) {
  writeLine(io.stdout, `${PRODUCT_NAME} Codex profile ${action}`);
  writeLine(io.stdout, `  Target: ${result.targetPath}`);
  writeLine(io.stdout, `  Installed: ${result.installed}`);
  if ('written' in result) {
    writeLine(io.stdout, `  Written: ${result.written}`);
    writeLine(io.stdout, `  Changed: ${result.changed}`);
  }
  writeLine(io.stdout, '  Token value embedded: false');
}

async function codexSmokeReport(configPath, env) {
  const configText = await readTextIfExists(configPath);
  const block = tomlServerBlock(configText, MCP_SERVER_NAME);
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
      detail: block ? `[mcp_servers.${MCP_SERVER_NAME}]` : `missing [mcp_servers.${MCP_SERVER_NAME}]`
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
    serverName: MCP_SERVER_NAME,
    mcpUrl,
    tokenEnvVar: TOKEN_ENV_VAR,
    agentInstanceIdPath: identityPath,
    checks
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

function cursorJsonSnippet(mcpUrl, identity = envReferenceIdentity('cursor')) {
  return `${JSON.stringify(cursorJsonConfig(mcpUrl, identity), null, 2)}\n`;
}

async function appendTomlServerConfig(configPath, mcpUrl) {
  const snippet = codexTomlSnippet(mcpUrl);
  const existing = await readTextIfExists(configPath);
  if (existing.includes(`[mcp_servers.${MCP_SERVER_NAME}]`)) {
    throw new UsageError(`MCP config already contains [mcp_servers.${MCP_SERVER_NAME}]. Edit ${configPath} manually to avoid duplicate server definitions.`);
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const prefix = existing.trim().length === 0 ? '' : '\n\n';
  await fs.appendFile(configPath, `${prefix}${snippet}`, { mode: 0o600 });
  await bestEffortChmod(configPath, 0o600);
}

async function mergeJsonMcpConfig(configPath, mcpUrl, identity) {
  const existing = await readTextIfExists(configPath);
  const parsed = existing.trim().length === 0 ? {} : parseJsonConfig(existing, configPath);

  if (!isPlainObject(parsed)) {
    throw new UsageError(`MCP JSON config must be an object: ${configPath}`);
  }

  if (!isPlainObject(parsed.mcpServers)) {
    parsed.mcpServers = {};
  }

  if (parsed.mcpServers[MCP_SERVER_NAME]) {
    throw new UsageError(`MCP config already contains mcpServers.${MCP_SERVER_NAME}. Edit ${configPath} manually to avoid duplicate server definitions.`);
  }

  parsed.mcpServers[MCP_SERVER_NAME] = cursorJsonServerConfig(mcpUrl, identity);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(configPath, 0o600);
}

function cursorJsonConfig(mcpUrl, identity = envReferenceIdentity('cursor')) {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: cursorJsonServerConfig(mcpUrl, identity)
    }
  };
}

function cursorJsonServerConfig(mcpUrl, identity = envReferenceIdentity('cursor')) {
  return {
    url: mcpUrl,
    headers: {
      Authorization: `Bearer \${env:${TOKEN_ENV_VAR}}`,
      [AGENT_ID_HEADER]: identity.agentId,
      [AGENT_INSTANCE_HEADER]: identity.agentInstanceId
    }
  };
}

async function agentIdentity(clientId, env) {
  const configuredInstanceId = env[AGENT_INSTANCE_ENV_VAR];
  if (configuredInstanceId) {
    return {
      agentId: clientId,
      agentInstanceId: configuredInstanceId,
      path: `${AGENT_INSTANCE_ENV_VAR} environment variable`
    };
  }

  const identityPath = agentInstanceIdentityPath(env, clientId);
  const existing = await readAgentInstanceIdentity(identityPath);
  if (existing) {
    return { agentId: clientId, agentInstanceId: existing, path: identityPath };
  }

  const generated = `xmemo-${clientId}-${randomUUID()}`;
  await fs.mkdir(path.dirname(identityPath), { recursive: true, mode: 0o700 });
  await bestEffortChmod(path.dirname(identityPath), 0o700);
  await fs.writeFile(identityPath, `${JSON.stringify({ version: 1, agentId: clientId, agentInstanceId: generated }, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(identityPath, 0o600);
  return { agentId: clientId, agentInstanceId: generated, path: identityPath };
}

async function readAgentInstanceIdentity(identityPath) {
  const existing = await readTextIfExists(identityPath);
  if (!existing.trim()) {
    return null;
  }
  const parsed = parseJsonConfig(existing, identityPath);
  const value = stringValue(parsed, ['agentInstanceId']);
  return value || null;
}

function agentInstanceIdentityPath(env, clientId) {
  return path.join(configRoot(env), 'agent-instances', `${clientId}.json`);
}

function envReferenceIdentity(clientId) {
  return {
    agentId: clientId,
    agentInstanceId: `\${${AGENT_INSTANCE_ENV_VAR}}`,
    path: `${AGENT_INSTANCE_ENV_VAR} environment variable`
  };
}

function supportedMcpClients() {
  return Array.from(MCP_CLIENTS.entries()).map(([id, client]) => ({
    id,
    label: client.label,
    configKind: client.configKind
  }));
}

function supportedMcpClientIds() {
  return Array.from(MCP_CLIENTS.keys());
}

function credentialsPath(env) {
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

function defaultCodexConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.codex', 'config.toml');
}

function defaultCursorConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.cursor', 'mcp.json');
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

async function bestEffortChmod(filePath, mode) {
  try {
    await fs.chmod(filePath, mode);
  } catch {
    // Windows and managed environments may ignore POSIX chmod.
  }
}

function validateToken(token) {
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

function requiredOption(args, name) {
  const value = optionValue(args, name);
  if (!value) {
    throw new UsageError(`Missing required option ${name}.`);
  }
  return value;
}

function positionalClientArg(args) {
  const candidate = args[0];
  if (!candidate || candidate.startsWith('--')) {
    return null;
  }

  if (!MCP_CLIENTS.has(candidate)) {
    throw new UsageError(`Unsupported setup client: ${candidate}. Supported clients: ${supportedMcpClientIds().join(', ')}.`);
  }

  return candidate;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new UsageError(`Option ${name} requires a value.`);
  }

  return value;
}

function stringValue(source, keys) {
  const value = valueAtPath(source, keys);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function booleanValue(source, keys) {
  const value = valueAtPath(source, keys);
  return typeof value === 'boolean' ? value : null;
}

function arrayValue(source, keys) {
  const value = valueAtPath(source, keys);
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : null;
}

function valueAtPath(source, keys) {
  let current = source;
  for (const key of keys) {
    if (!isPlainObject(current) || !(key in current)) {
      return null;
    }
    current = current[key];
  }
  return current;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`${name} must be a positive integer.`);
  }
  return parsed;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}


function npmExecutable() {
  return os.platform() === 'win32' ? 'npm.cmd' : 'npm';
}


async function runProcess(command, args, io, { stream = true } = {}) {
  const spawnFn = io.spawn ?? spawn;
  return await new Promise((resolve, reject) => {
    const child = spawnFn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (stream) {
        io.stdout.write(text);
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (stream) {
        io.stderr.write(text);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}


async function readAll(stream) {
  let content = '';
  for await (const chunk of stream) {
    content += chunk;
  }
  return content;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function parseJsonConfig(content, configPath) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new UsageError(`Invalid JSON in ${configPath}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeTomlString(value) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeLine(stream, line) {
  stream.write(`${line}\n`);
}
