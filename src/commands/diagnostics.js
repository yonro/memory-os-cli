import fs from 'node:fs/promises';
import path from 'node:path';

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
  MCP_SERVER_NAME,
  PACKAGE_NAME,
  PRODUCT_NAME
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { fileExists } from '../core/runtime.js';
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
import { serviceContext } from '../api/service-context.js';
import { assertKnownOptions } from '../api/input.js';
import { ServiceClientError, errorToExitCode } from '../api/errors.js';
import { writeFailure, writeSuccess } from '../api/envelope.js';
import {
  getClient,
  resolveClientId,
  supportedDoctorClientIds
} from '../clients/registry.js';
import { resolveTargetClients } from '../core/target-resolver.js';
import { getPlugin } from '../plugins/registry.js';
import { checkPluginStatus } from './plugin.js';
import { profileStatusResult } from '../config/profile.js';
import {
  executeSubprocess,
  extractSkillVersionFromDirectory,
  sanitizeEnv
} from './skill.js';
import {
  PINNED_OPENCLAW_SKILL_NAME,
  PINNED_OPENCLAW_SKILL_VERSION
} from '../core/pins.js';
import { knownMcpServerNames } from '../mcp/core/names.js';
import { jsonMcpClientDefinition } from '../mcp/formats/json.js';

export function writeDoctorHelp(io) {
  writeLine(io.stdout, 'Doctor commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor [--services [memory,dream,knowledge,cloud-skill]] [--base-url <url>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor --discovery [--base-url <url>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor --client <${supportedDoctorClientIds().join('|')}> [--config <path>] [--smoke] [--auth oauth|key] [--fix] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Validate runtime environment, service reachability, and client configuration.');
  return 0;
}

export async function doctorCommand(args, io) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args[0] === 'help') {
    writeDoctorHelp(io);
    return 0;
  }

  if (hasFlag(args, '--discovery')) {
    return await doctorDiscovery(args, io);
  }

  const client = optionValue(args, '--client');
  if (client) {
    const resolved = resolveClientId(client);
    const doctorClient = getClient(resolved);
    if (!doctorClient || !doctorClient.doctor) {
      throw new UsageError(`Unsupported doctor client: ${client}. Supported clients: ${supportedDoctorClientIds().join(', ')}.`);
    }
    if (hasFlag(args, '--services')) throw new UsageError(`--client ${resolved} cannot be combined with --services.`);
    return await doctorClient.doctor(args, io);
  }
  if (hasFlag(args, '--smoke')) {
    throw new UsageError('Smoke currently supports only --client codex.');
  }
  if (hasFlag(args, '--fix')) throw new UsageError(`Local config repair requires --client <${supportedDoctorClientIds().join('|')}>.`);
  if (hasFlag(args, '--services')) return await serviceDoctor(args, io);
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
  writeLine(io.stdout, `Supported clients (server): ${report.discovery.supportedClients.join(', ') || 'unknown'}`);
  for (const check of checks) {
    writeLine(io.stdout, `${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
  }
  return report.ok ? 0 : 1;
}

async function serviceDoctor(args, io) {
  try {
    assertKnownOptions(args, ['--services', '--team', '--json', '--base-url', '--url', '--timeout-ms', '--allow-legacy-credential']);
    const requested = requestedServices(args);
    const context = await serviceContext(args, io);
    const teamId = optionValue(args, '--team');
    const checks = [];
    for (const [name, endpoint, query] of [
      ['memory', '/api/v1/recall', { query: '__xmemo_cli_doctor_read_probe__', limit: 1 }],
      ['knowledge', '/api/v1/knowledge-bases', { limit: 1, include_archived: false }],
      ['dream', '/api/v1/me/dream/settings', {}],
      ['cloud-skill', '/v1/skills', {}]
    ]) {
      if (!requested.has(name)) continue;
      try {
        const response = await context.client.request({ method: 'GET', path: endpoint, query: { ...query, team_id: teamId }, retry: 'bounded' });
        checks.push({ name, readable: true, ...(name === 'dream' ? { enabled: response.data?.enabled ?? null, mode: response.data?.mode ?? null, canPreview: response.data?.entitlement?.can_preview ?? null, canApply: response.data?.entitlement?.can_apply ?? null } : {}) });
      } catch (error) {
        checks.push({ name, readable: false, code: error.code, httpStatus: error.httpStatus, nextAction: error.nextAction, exitCode: errorToExitCode(error) });
      }
    }
    const report = { baseUrl: context.baseUrl, requestedServices: [...requested], checks, writeReadiness: 'unknown (not tested)', cloudSkillWriteContract: 'unknown (MOS-01 deployment not verified)', notes: ['Read-only checks do not prove write permission, queue health, sandbox readiness, or production availability.'] };
    const failed = checks.find((check) => !check.readable);
    if (failed) throw new ServiceClientError('One or more service read checks failed.', { code: failed.code, httpStatus: failed.httpStatus, data: report, nextAction: failed.nextAction });
    if (hasFlag(args, '--json')) writeSuccess(io, 'doctor.services', report);
    else writeLine(io.stdout, JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    if (hasFlag(args, '--json')) writeFailure(io, 'doctor.services', error);
    else writeLine(io.stderr, `Error: ${error.message}`);
    return errorToExitCode(error);
  }
}

function requestedServices(args) {
  const supported = new Set(['memory', 'knowledge', 'dream', 'cloud-skill']);
  const index = args.indexOf('--services');
  const selector = index === -1 ? null : args[index + 1];
  if (selector && !selector.startsWith('-')) {
    const names = selector.split(',').map((name) => name.trim()).filter(Boolean);
    if (names.length === 0 || names.some((name) => !supported.has(name))) {
      throw new UsageError(`--services accepts a comma-separated subset of: ${[...supported].join(', ')}.`);
    }
    for (let position = 0; position < args.length; position += 1) {
      if (!args[position].startsWith('-') && position !== index + 1) throw new UsageError(`Unexpected positional argument: ${args[position]}.`);
    }
    return new Set(names);
  }
  return supported;
}

export function writeDiscoveryHelp(io) {
  writeLine(io.stdout, 'Discovery commands (deprecated, use "xmemo doctor --discovery"):');
  writeLine(io.stdout, `  ${COMMAND_NAME} discovery show [--base-url <https://api.example.com>] [--json]`);
  return 0;
}

export async function doctorDiscovery(args, io) {
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
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

export async function discoveryCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    return writeDiscoveryHelp(io);
  }
  if (subcommand !== 'show') {
    throw new UsageError(`Unknown discovery command: ${subcommand}`);
  }

  return await doctorDiscovery(args.slice(1), io);
}

export function writeStatusHelp(io) {
  writeLine(io.stdout, 'Status command:');
  writeLine(io.stdout, `  ${COMMAND_NAME} status [<client>...|--all] [--url <url>] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Probe hosted service endpoints and inspect client integration status.');
  return 0;
}

function isClientMcpConfigured(client, text) {
  const kind = client.mcp?.configKind ?? 'json';
  const names = knownMcpServerNames();
  if (kind === 'json') {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const def = jsonMcpClientDefinition(client.id);
        const sectionName = def?.section ?? 'mcpServers';
        const section = parsed[sectionName] ?? parsed.mcpServers ?? parsed.servers;
        if (section && typeof section === 'object') {
          for (const name of names) {
            if (name in section) return true;
          }
        }
        if (Array.isArray(parsed.experimental?.modelContextProtocolServers)) {
          if (parsed.experimental.modelContextProtocolServers.some((entry) => names.includes(entry?.name))) {
            return true;
          }
        }
      }
    } catch {}
    return false;
  }
  if (kind === 'toml') {
    return names.some((name) => text.includes(`[mcp_servers.${name}]`));
  }
  if (kind === 'yaml') {
    const lines = text.split(/\r?\n/);
    const mcpIdx = lines.findIndex((l) => l.trim().startsWith('mcp_servers:'));
    if (mcpIdx !== -1) {
      return names.some((name) => lines.slice(mcpIdx).some((l) => l.trim().startsWith(`${name}:`)));
    }
    return false;
  }
  return false;
}

async function collectClientResources(client, io) {
  const resources = {};

  // 1. MCP
  if (client.mcp) {
    const configPath = typeof client.mcp.defaultConfigPath === 'function'
      ? client.mcp.defaultConfigPath(io.env)
      : null;
    let configured = false;
    try {
      if (configPath && (await fileExists(configPath))) {
        const text = await fs.readFile(configPath, 'utf8');
        configured = isClientMcpConfigured(client, text);
      }
    } catch {}
    resources.mcp = {
      configured,
      path: configPath
    };
  }

  // 2. Plugin
  const pluginId = client.pluginId ?? client.plugin?.indexId;
  if (pluginId) {
    const pluginEntry = getPlugin(pluginId);
    if (pluginEntry) {
      if (pluginEntry.kind === 'mcp') {
        resources.plugin = {
          installed: resources.mcp ? resources.mcp.configured : false,
          status: 'n/a (uses MCP)',
          detail: 'uses MCP',
          version: null
        };
      } else {
        const pStatus = await checkPluginStatus(pluginEntry, io);
        resources.plugin = {
          installed: pStatus.installed,
          status: pStatus.installed ? 'installed' : 'not installed',
          detail: pStatus.detail,
          version: pStatus.version ?? null
        };
      }
    } else {
      resources.plugin = {
        installed: false,
        status: 'n/a',
        detail: 'n/a'
      };
    }
  } else {
    resources.plugin = {
      installed: false,
      status: 'n/a',
      detail: 'n/a'
    };
  }

  // 3. Skill
  if (client.skillDir || client.skill) {
    const cwd = io.cwd ?? process.cwd();
    let installed = false;
    let version = null;
    let skillPath = null;
    if (typeof client.skillDir === 'function') {
      skillPath = path.resolve(client.skillDir(io.env, { project: false, cwd }));
    }
    if (client.skill?.kind === 'native') {
      const bin = client.skill?.bin ?? client.id;
      const ref = client.skill?.ref ?? PINNED_OPENCLAW_SKILL_NAME;
      try {
        const res = await executeSubprocess(bin, ['skills', 'list'], io, sanitizeEnv(io.env), cwd);
        if (res.code === 0 && (res.stdout.includes(ref) || res.stdout.includes('xmemo'))) {
          installed = true;
          const match = res.stdout.match(/@xmemo\/xmemo@([0-9.]+)/) || res.stdout.match(/xmemo@([0-9.]+)/);
          version = match ? match[1] : (client.skill?.version ?? PINNED_OPENCLAW_SKILL_VERSION);
        }
      } catch {}
    } else if (skillPath) {
      const exists = await fs.stat(skillPath).catch(() => null);
      if (exists && exists.isDirectory()) {
        installed = true;
        version = await extractSkillVersionFromDirectory(skillPath);
      }
    }
    resources.skill = {
      installed,
      version,
      path: skillPath
    };
  }

  // 4. Profile
  if (client.profile) {
    const targetPath = typeof client.profile.defaultTarget === 'function'
      ? client.profile.defaultTarget(io.env, { cwd: io.cwd })
      : null;
    let installed = false;
    if (targetPath) {
      try {
        const res = await profileStatusResult(client.id, targetPath);
        installed = Boolean(res?.installed);
      } catch {}
    }
    resources.profile = {
      installed,
      path: targetPath
    };
  }

  return resources;
}

export async function statusCommand(args, io) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args[0] === 'help') {
    return writeStatusHelp(io);
  }

  const optionsWithValues = new Set(['--url', '--base-url', '--timeout-ms', '--client']);
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (optionsWithValues.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('--url=') || arg.startsWith('--base-url=') || arg.startsWith('--timeout-ms=') || arg.startsWith('--client=')) {
      continue;
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  const targetClients = await resolveTargetClients('status', args, io, {
    positional: positionals,
    allowAll: true,
    allowMultiple: true,
    allowEmpty: true
  });

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

  if (targetClients.length > 0) {
    const clientReports = [];
    for (const client of targetClients) {
      const resources = await collectClientResources(client, io);
      clientReports.push({
        id: client.id,
        label: client.label,
        resources
      });
    }
    result.clients = clientReports;
  }

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

  if (result.clients) {
    for (const c of result.clients) {
      writeLine(io.stdout, '');
      writeLine(io.stdout, `${c.label} (${c.id}):`);
      if (c.resources.mcp) {
        writeLine(io.stdout, `  MCP: ${c.resources.mcp.configured ? 'configured' : 'not configured'} (${c.resources.mcp.path ?? 'no config path'})`);
      }
      if (c.resources.plugin) {
        if (c.resources.plugin.status === 'n/a (uses MCP)') {
          writeLine(io.stdout, '  Plugin: n/a (uses MCP)');
        } else {
          const pStatus = c.resources.plugin.installed
            ? 'installed'
            : (c.resources.plugin.status === 'n/a' || c.resources.plugin.detail === 'n/a' ? 'n/a' : 'not installed');
          const pDetail = c.resources.plugin.detail && c.resources.plugin.detail !== 'n/a' && c.resources.plugin.detail !== 'not installed'
            ? ` (${c.resources.plugin.detail})`
            : '';
          writeLine(io.stdout, `  Plugin: ${pStatus}${pDetail}`);
        }
      }
      if (c.resources.skill) {
        const vText = c.resources.skill.version ? ` ${c.resources.skill.version}` : '';
        writeLine(io.stdout, `  Skill: ${c.resources.skill.installed ? `installed${vText}` : 'not installed'} (${c.resources.skill.path ?? 'no skill path'})`);
      }
      if (c.resources.profile) {
        writeLine(io.stdout, `  Profile: ${c.resources.profile.installed ? 'installed' : 'not installed'} (${c.resources.profile.path ?? 'no profile path'})`);
      }
    }
  }

  return result.ok ? 0 : 1;
}

export function writeSmokeHelp(io) {
  const defaultClient = supportedDoctorClientIds()[0];
  writeLine(io.stdout, `Smoke command (deprecated, use "xmemo doctor --client ${defaultClient} --smoke"):`);
  writeLine(io.stdout, `  ${COMMAND_NAME} smoke --client ${defaultClient} [--config <path>] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Run read-only smoke checks for client MCP configuration.');
  return 0;
}

export async function smokeCommand(args, io) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args[0] === 'help') {
    return writeSmokeHelp(io);
  }

  const defaultClient = supportedDoctorClientIds()[0];
  const rawClient = optionValue(args, '--client');
  if (!rawClient) {
    throw new UsageError('Smoke currently supports only --client codex.');
  }
  const clientId = resolveClientId(rawClient);
  const client = getClient(clientId);
  if (!client || !client.doctor || clientId !== defaultClient) {
    throw new UsageError('Smoke currently supports only --client codex.');
  }

  return await client.doctor(args, io);
}
