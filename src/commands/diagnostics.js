import {
  booleanValue,
  hasFlag,
  optionValue,
  parsePositiveInteger,
  sameMajorMinor,
  stringValue
} from '../core/args.js';
import { baseUrlOption } from '../network/base-url.js';
import {
  CLI_VERSION,
  COMMAND_NAME,
  PACKAGE_NAME,
  PRODUCT_NAME
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import {
  agentDiscoveryClientIds,
  bestEffortRootVersion,
  discoveryMcpUrl,
  ensureDiscoveryService
} from '../network/discovery.js';
import {
  endpointUrl,
  fetchJson,
  normalizeBaseUrl,
  probe
} from '../network/http.js';
import { writeLine } from '../core/io.js';
import { codexSmokeReport } from '../mcp/formats/toml.js';
import { defaultCodexConfigPath } from '../config/paths.js';

export async function doctorCommand(args, io) {
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const outputJson = hasFlag(args, '--json');
  const timeoutMs = parsePositiveInteger(optionValue(args, '--timeout-ms') ?? '5000', '--timeout-ms');
  const nodeVersion = io.nodeVersion ?? process.versions.node;
  const discoveryUrl = endpointUrl(baseUrl, '/.well-known/agent-discovery.json');
  const discovery = await fetchJson(discoveryUrl, timeoutMs, io);
  ensureDiscoveryService(discovery, discoveryUrl);

  const rootVersion = await bestEffortRootVersion(discovery, timeoutMs, io);
  const mcpUrl = discoveryMcpUrl(discovery, baseUrl);
  const checks = [
    { name: 'node_version', ok: Number.parseInt(nodeVersion.split('.')[0], 10) >= 20, detail: nodeVersion },
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
    cli: { package: PACKAGE_NAME, version: CLI_VERSION, node: nodeVersion },
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

export async function discoveryCommand(args, io) {
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

export async function statusCommand(args, io) {
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

export async function smokeCommand(args, io) {
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

