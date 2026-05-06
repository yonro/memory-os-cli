import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PACKAGE_NAME = '@yonro/memory-os';
const TOKEN_ENV_VAR = 'MEMORY_OS_MCP_TOKEN';
const MCP_SERVER_NAME = 'memory_os';

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
      writeLine(io.stdout, '0.1.0');
      return 0;
    }

    if (command === 'status') {
      return await statusCommand(args.slice(1), io);
    }

    if (command === 'token') {
      return await tokenCommand(args.slice(1), io);
    }

    if (command === 'mcp') {
      return await mcpCommand(args.slice(1), io);
    }

    if (command === 'privacy') {
      writePrivacy(io);
      return 0;
    }

    throw new UsageError(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      writeLine(io.stderr, `Error: ${error.message}`);
      writeLine(io.stderr, 'Run `memory-os help` for usage.');
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
    fetch: globalThis.fetch
  };
}

function writeHelp(io) {
  writeLine(io.stdout, `Memory OS CLI (${PACKAGE_NAME})`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Usage:');
  writeLine(io.stdout, '  memory-os status --url <https://api.example.com> [--json]');
  writeLine(io.stdout, '  memory-os token status');
  writeLine(io.stdout, '  memory-os token set --from-stdin [--allow-plaintext]');
  writeLine(io.stdout, '  memory-os mcp list');
  writeLine(io.stdout, '  memory-os mcp add <codex|cursor> --url <https://api.example.com> [--write] [--config <path>]');
  writeLine(io.stdout, '  memory-os privacy');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Privacy defaults: no telemetry, no token in project files, and no token is sent by `status`.');
}

async function statusCommand(args, io) {
  const baseUrl = normalizeBaseUrl(requiredOption(args, '--url'));
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

  writeLine(io.stdout, `Memory OS status for ${baseUrl}`);
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

async function tokenCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Token commands:');
    writeLine(io.stdout, '  memory-os token status');
    writeLine(io.stdout, '  memory-os token set --from-stdin [--allow-plaintext]');
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Preferred enterprise path: set ${TOKEN_ENV_VAR} in your user or secret manager environment.`);
    return 0;
  }

  if (subcommand === 'status') {
    const credentialPath = credentialsPath(io.env);
    const hasEnvironmentToken = Boolean(io.env[TOKEN_ENV_VAR]);
    const hasPlaintextCredential = await fileExists(credentialPath);
    writeLine(io.stdout, `Environment token: ${hasEnvironmentToken ? 'present' : 'missing'} (${TOKEN_ENV_VAR})`);
    writeLine(io.stdout, `User credential file: ${hasPlaintextCredential ? 'present' : 'missing'} (${credentialPath})`);
    writeLine(io.stdout, 'Token values are never printed.');
    return hasEnvironmentToken || hasPlaintextCredential ? 0 : 1;
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
      writeLine(io.stderr, `Preferred: store the token in ${TOKEN_ENV_VAR} via your OS, shell profile, CI secret, or enterprise secret manager.`);
      return 2;
    }

    const credentialPath = credentialsPath(io.env);
    await writePlaintextCredential(credentialPath, token);
    writeLine(io.stdout, `Stored token in user-scoped credential file: ${credentialPath}`);
    writeLine(io.stdout, 'Token value was not printed. Do not commit this file.');
    return 0;
  }

  throw new UsageError(`Unknown token command: ${subcommand}`);
}

async function mcpCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'MCP commands:');
    writeLine(io.stdout, '  memory-os mcp list');
    writeLine(io.stdout, '  memory-os mcp add <codex|cursor> --url <https://api.example.com>');
    writeLine(io.stdout, '  memory-os mcp add <codex|cursor> --url <https://api.example.com> --write [--config <path>]');
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

  const target = args[1] ?? '';
  const client = MCP_CLIENTS.get(target);

  if (subcommand !== 'add' || !client) {
    throw new UsageError(`Supported MCP setup command: memory-os mcp add <${supportedMcpClientIds().join('|')}> --url <url>`);
  }

  const baseUrl = normalizeBaseUrl(requiredOption(args, '--url'));
  const configPath = optionValue(args, '--config') ?? client.defaultConfigPath(io.env);
  const mcpUrl = endpointUrl(baseUrl, '/mcp');
  const snippet = client.buildSnippet(mcpUrl);

  if (hasFlag(args, '--json')) {
    writeLine(io.stdout, JSON.stringify({
      client: target,
      label: client.label,
      configKind: client.configKind,
      configPath,
      serverName: MCP_SERVER_NAME,
      url: mcpUrl,
      tokenEnvVar: TOKEN_ENV_VAR,
      writesTokenValue: false
    }, null, 2));
    return 0;
  }

  if (hasFlag(args, '--write')) {
    await client.writeConfig(configPath, mcpUrl);
    writeLine(io.stdout, `Updated ${client.label} MCP config: ${configPath}`);
    writeLine(io.stdout, `Token value was not written. ${client.label} will read ${TOKEN_ENV_VAR} from the environment.`);
    return 0;
  }

  writeLine(io.stdout, `Add this to your ${client.label} config (${configPath}):`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, snippet.trimEnd());
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Set ${TOKEN_ENV_VAR} in your user environment or secret manager. The token value is not included here.`);
  return 0;
}

function writePrivacy(io) {
  writeLine(io.stdout, 'Memory OS CLI privacy and security defaults:');
  writeLine(io.stdout, '- No telemetry or analytics.');
  writeLine(io.stdout, '- `status` does not send tokens.');
  writeLine(io.stdout, `- MCP configs reference ${TOKEN_ENV_VAR}; token values are not embedded.`);
  writeLine(io.stdout, '- Plaintext token storage requires explicit --allow-plaintext.');
  writeLine(io.stdout, '- npm publishing is restricted by package.json files whitelist.');
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

function cursorJsonSnippet(mcpUrl) {
  return `${JSON.stringify(cursorJsonConfig(mcpUrl), null, 2)}\n`;
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

async function mergeJsonMcpConfig(configPath, mcpUrl) {
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

  parsed.mcpServers[MCP_SERVER_NAME] = cursorJsonServerConfig(mcpUrl);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(configPath, 0o600);
}

function cursorJsonConfig(mcpUrl) {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: cursorJsonServerConfig(mcpUrl)
    }
  };
}

function cursorJsonServerConfig(mcpUrl) {
  return {
    url: mcpUrl,
    headers: {
      Authorization: `Bearer \${env:${TOKEN_ENV_VAR}}`
    }
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
  if (env.MEMORY_OS_CONFIG_HOME) {
    return env.MEMORY_OS_CONFIG_HOME;
  }

  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'MemoryOS', 'CLI');
  }

  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, 'memory-os');
  }

  const home = env.HOME || os.homedir();
  return path.join(home, '.config', 'memory-os');
}

function defaultCodexConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.codex', 'config.toml');
}

function defaultCursorConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.cursor', 'mcp.json');
}

async function writePlaintextCredential(credentialPath, token) {
  await fs.mkdir(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  await bestEffortChmod(path.dirname(credentialPath), 0o700);
  const payload = {
    version: 1,
    tokenEnvVar: TOKEN_ENV_VAR,
    storage: 'plaintext-user-config',
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

function writeLine(stream, line) {
  stream.write(`${line}\n`);
}
