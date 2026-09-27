import { hasFlag, optionValue } from '../core/args.js';
import { TOKEN_ENV_VAR } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { PINNED_OPENCLAW_PLUGIN_SPEC } from '../core/pins.js';
import { runProcess } from '../core/runtime.js';
import { resolveCredentialToken } from '../network/auth.js';

const DEFAULT_OPENCLAW_BIN = 'openclaw';
const OPENCLAW_PLUGIN_SPEC = PINNED_OPENCLAW_PLUGIN_SPEC;
const OPENCLAW_SKILL_REF = 'xmemo';
const OPENCLAW_MCP_NAME = 'xmemo';

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function extractLastJsonObject(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  for (let index = trimmed.lastIndexOf('{'); index >= 0; index = trimmed.lastIndexOf('{', index - 1)) {
    const candidate = trimmed.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning; OpenClaw may print warnings before the final JSON object.
    }
  }
  return null;
}

async function runOpenClaw(openclawBin, args, io) {
  const result = await runProcess(openclawBin, args, io, { stream: false });
  if (result.code !== 0) {
    throw new UsageError(
      `OpenClaw command failed (${result.code}): ${commandText(openclawBin, args)}\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function credentialPlan(env) {
  if (env[TOKEN_ENV_VAR]) {
    return { ready: true, source: 'env', variable: TOKEN_ENV_VAR };
  }
  if (env.MEMORY_OS_MCP_TOKEN) {
    return { ready: true, source: 'env', variable: 'MEMORY_OS_MCP_TOKEN' };
  }
  return { ready: false, source: 'shared-credential-or-missing', variable: null };
}

export async function openclawSetupPlan({ setupPlan, optionArgs, io, dryRun }) {
  const openclawBin = optionValue(optionArgs, '--openclaw-bin') ?? DEFAULT_OPENCLAW_BIN;
  const mcpOnly = hasFlag(optionArgs, '--mcp-only');
  const withMcp = mcpOnly || hasFlag(optionArgs, '--with-mcp');
  const noSkill = hasFlag(optionArgs, '--no-skill');
  const force = hasFlag(optionArgs, '--force');
  const isJson = hasFlag(optionArgs, '--json');
  const credential = credentialPlan(io.env);
  const sharedToken = await resolveCredentialToken(io.env);
  if (sharedToken && !credential.ready) {
    credential.ready = true;
    credential.source = 'shared-credential';
  }

  const pluginArgs = ['plugins', 'install', OPENCLAW_PLUGIN_SPEC, ...(force ? ['--force'] : [])];
  const skillArgs = ['skills', 'install', OPENCLAW_SKILL_REF, ...(force ? ['--force'] : [])];
  const mcpArgs = [
    'mcp',
    'add',
    OPENCLAW_MCP_NAME,
    '--url',
    setupPlan.mcpUrl,
    '--transport',
    'streamable-http',
    '--header',
    `Authorization=Bearer \${${TOKEN_ENV_VAR}}`,
    '--no-probe',
  ];

  const selectedClient = {
    id: 'openclaw',
    label: 'OpenClaw',
    configKind: 'native-plugin',
    setupMode: mcpOnly ? 'mcp-only' : withMcp ? 'native-with-mcp' : 'native',
    written: false,
    writesTokenValue: false,
    openclawBin,
    credential,
    nativePlugin: {
      package: OPENCLAW_PLUGIN_SPEC,
      command: commandText(openclawBin, pluginArgs),
      installed: false,
      skipped: mcpOnly,
    },
    skill: {
      ref: OPENCLAW_SKILL_REF,
      command: commandText(openclawBin, skillArgs),
      installed: false,
      skipped: noSkill || mcpOnly,
    },
    mcp: {
      enabled: withMcp,
      serverName: OPENCLAW_MCP_NAME,
      mcpUrl: setupPlan.mcpUrl,
      command: commandText(openclawBin, mcpArgs),
      written: false,
      only: mcpOnly,
      note: withMcp
        ? mcpOnly
          ? `Hosted MCP references ${TOKEN_ENV_VAR}; native plugin and Skill are skipped by --mcp-only.`
          : `Hosted MCP fallback references ${TOKEN_ENV_VAR}; native plugin remains primary.`
        : 'Hosted MCP is not installed by default; use --with-mcp for an explicit fallback.',
    },
    status: null,
    dryRun,
  };

  if (dryRun) {
    return selectedClient;
  }

  if (!mcpOnly) {
    if (!isJson) {
      writeLine(io.stdout, `Running: ${commandText(openclawBin, pluginArgs)}`);
    }
    await runOpenClaw(openclawBin, pluginArgs, io);
    selectedClient.nativePlugin.installed = true;

    if (!noSkill) {
      if (!isJson) {
        writeLine(io.stdout, `Running: ${commandText(openclawBin, skillArgs)}`);
      }
      await runOpenClaw(openclawBin, skillArgs, io);
      selectedClient.skill.installed = true;
    }
  }

  if (withMcp) {
    if (!isJson) {
      writeLine(io.stdout, `Running: ${commandText(openclawBin, mcpArgs)}`);
    }
    await runOpenClaw(openclawBin, mcpArgs, io);
    selectedClient.mcp.written = true;
  }

  if (!mcpOnly) {
    const statusResult = await runOpenClaw(openclawBin, ['xmemo', 'status', '--json'], io);
    selectedClient.status = extractLastJsonObject(statusResult.stdout);
  }
  selectedClient.written = true;
  return selectedClient;
}
