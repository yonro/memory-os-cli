import { hasFlag, optionValue } from './args.js';
import { UsageError } from './errors.js';
import { writeLine } from './io.js';
import {
  CLIENT_REGISTRY,
  getClient,
  resolveClientId
} from '../clients/registry.js';

export function clientSupportsResource(client, resource) {
  if (!client) return false;
  switch (resource) {
    case 'setup':
    case 'uninstall':
      return Boolean(client.setup);
    case 'status':
      return true;
    case 'mcp':
      return Boolean(client.mcp);
    case 'plugin':
      return Boolean(client.plugin || client.pluginId);
    case 'skill':
      return Boolean(client.skill || client.skillDir);
    case 'profile':
      return Boolean(client.profile);
    default:
      return true;
  }
}

export function supportedClientsFor(resource) {
  return CLIENT_REGISTRY.filter((c) => clientSupportsResource(c, resource));
}

export function detectCallingAgentFromEnv(env, resource) {
  if (!env) return null;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) {
    const claude = getClient('claude-code');
    if (claude && (!resource || clientSupportsResource(claude, resource))) {
      return claude;
    }
  }
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_HOME) {
    const codex = getClient('codex');
    if (codex && (!resource || clientSupportsResource(codex, resource))) {
      return codex;
    }
  }
  return null;
}

export async function detectInstalledClients(resource, io) {
  const candidates = supportedClientsFor(resource);
  const cwd = io?.cwd ?? process.cwd();
  const env = io?.env ?? process.env;
  const detected = [];

  for (const client of candidates) {
    if (typeof client.detect === 'function') {
      try {
        const ok = await client.detect(env, { cwd });
        const isDetected = ok === true || Boolean(ok && ok.detected);
        if (isDetected) {
          detected.push(client);
        }
      } catch {
        // detection failure treated as not detected
      }
    }
  }
  return detected;
}

async function promptSelectClient(clients, io) {
  writeLine(io.stdout, 'Multiple matching clients detected:');
  clients.forEach((c, idx) => {
    writeLine(io.stdout, `  ${idx + 1}) ${c.label} (${c.id})`);
  });
  writeLine(io.stdout, `Select a client to configure [1-${clients.length}, or Enter to cancel]: `);

  return await new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += String(chunk);
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        cleanup();
        const line = buffer.slice(0, nl).trim();
        const num = parseInt(line, 10);
        if (!isNaN(num) && num >= 1 && num <= clients.length) {
          resolve(clients[num - 1]);
        } else {
          resolve(null);
        }
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    function cleanup() {
      io.stdin?.off?.('data', onData);
      io.stdin?.off?.('end', onEnd);
    }
    if (io.stdin && typeof io.stdin.on === 'function') {
      io.stdin.on('data', onData);
      io.stdin.on('end', onEnd);
    } else {
      resolve(null);
    }
  });
}

export async function resolveTargetClients(resource, args, io, options = {}) {
  const allowAll = options.allowAll !== false;
  const allowMultiple = options.allowMultiple !== false;
  const hasAll = allowAll && hasFlag(args, '--all');

  // Extract explicit client arguments
  const explicitRaw = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--client') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        explicitRaw.push(args[i + 1]);
        i++;
      }
    } else if (arg.startsWith('--client=')) {
      explicitRaw.push(arg.slice('--client='.length));
    }
  }

  // Also check positional client candidate if passed in options.positional
  if (options.positional) {
    explicitRaw.push(...(Array.isArray(options.positional) ? options.positional : [options.positional]));
  }

  if (hasAll && explicitRaw.length > 0) {
    throw new UsageError('Cannot specify both --all and a specific client.');
  }

  if (hasAll) {
    return supportedClientsFor(resource);
  }

  if (explicitRaw.length > 0) {
    const resolved = [];
    for (const raw of explicitRaw) {
      const client = getClient(raw);
      if (!client) {
        const supported = supportedClientsFor(resource).map((c) => c.id).join(', ');
        throw new UsageError(`Unknown client: "${raw}". Supported clients: ${supported}.`);
      }
      if (!clientSupportsResource(client, resource)) {
        throw new UsageError(`Client "${client.label}" does not support ${resource}.`);
      }
      if (!resolved.some((c) => c.id === client.id)) {
        resolved.push(client);
      }
    }
    if (!allowMultiple && resolved.length > 1) {
      throw new UsageError(`Multiple clients specified (${resolved.map((c) => c.id).join(', ')}), but this command accepts only one.`);
    }
    return resolved;
  }

  // Auto-detect calling agent from environment
  const envAgent = detectCallingAgentFromEnv(io?.env, resource);
  if (envAgent) {
    return [envAgent];
  }

  // Auto-detect installed clients
  const detected = await detectInstalledClients(resource, io);
  if (detected.length === 1) {
    return detected;
  }

  if (detected.length > 1) {
    const isInteractive = io?.stdin?.isTTY && !hasFlag(args, '--yes') && !hasFlag(args, '-y') && !hasFlag(args, '--json');
    if (isInteractive) {
      const chosen = await promptSelectClient(detected, io);
      if (chosen) {
        return [chosen];
      }
      throw new UsageError('Operation cancelled: no client selected.');
    }
    const detectedNames = detected.map((c) => c.id).join(', ');
    throw new UsageError(`Multiple matching clients detected (${detectedNames}); specify --client <id> or --all.`);
  }

  // detected.length === 0
  if (resource === 'skill' && (hasFlag(args, '--dir') || optionValue(args, '--dir'))) {
    return [];
  }

  const supported = supportedClientsFor(resource).map((c) => c.id).join(', ');
  const extraHint = resource === 'skill' ? ' (or --dir <path>)' : '';
  throw new UsageError(`No matching client detected; specify --client <id>${extraHint}. Supported clients: ${supported}.`);
}

export async function resolveTarget(resource, args, io, options = {}) {
  const clients = await resolveTargetClients(resource, args, io, { ...options, allowMultiple: false });
  return clients[0] ? { client: clients[0], source: explicitOrSource(resource, args, io, clients[0]) } : null;
}

function explicitOrSource(resource, args, io, client) {
  if (hasFlag(args, '--client') || args.some((a) => a.startsWith('--client='))) {
    return 'explicit';
  }
  const envAgent = detectCallingAgentFromEnv(io?.env, resource);
  if (envAgent && envAgent.id === client.id) {
    return 'calling-agent-env';
  }
  return 'detected';
}
