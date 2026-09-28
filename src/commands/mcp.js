import { hasFlag, optionValue, parsePositiveInteger } from '../core/args.js';
import { baseUrlOption } from '../network/base-url.js';
import {
  AGENT_INSTANCE_ENV_VAR,
  COMMAND_NAME,
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  MCP_SERVER_NAME,
  PRODUCT_NAME,
  TOKEN_ENV_VAR
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { endpointUrl, normalizeBaseUrl } from '../network/http.js';
import { writeLine } from '../core/io.js';
import {
  MCP_CLIENTS,
  resolveClientAlias,
  supportedMcpClientIds,
  supportedMcpClients
} from '../mcp/clients.js';
import { mcpProxyCommand } from '../mcp/proxy/copilot.js';
import {
  agentIdentity,
  envReferenceIdentity
} from '../mcp/identity/device.js';
import {
  agentInstanceGenerationPolicy,
  mcpConfigTemplate,
  mcpLocalProxyTemplate
} from '../mcp/core/templates.js';
import fs from 'node:fs/promises';
import { fileExists } from '../core/runtime.js';
import {
  CLIENT_REGISTRY,
  getClient,
  supportedProfileClientIds
} from '../clients/registry.js';
import { usesClientOAuth } from '../mcp/clients/registry.js';
import {
  codexMemoryProfile,
  writeCodexMemoryProfile
} from '../config/profile.js';
import { startStdioServer } from '../mcp/stdio-server.js';

export const resolveMcpClientTarget = resolveClientAlias;

export function writeMcpHelp(io, subcommand) {
  if (subcommand === 'list') {
    writeLine(io.stdout, 'MCP list command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp list [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'List supported MCP clients.');
    return 0;
  }
  if (subcommand === 'config') {
    writeLine(io.stdout, 'MCP config command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client <client-id> [--base-url <url>] [--port <port>] [--auth oauth|key] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Print an MCP client configuration snippet without writing files.');
    return 0;
  }
  if (subcommand === 'add') {
    writeLine(io.stdout, 'MCP add command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <client-id> [--url <url>] [--write] [--config <path>] [--auth oauth|key] [--force]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Add XMemo to a client configuration file.');
    return 0;
  }
  if (subcommand === 'proxy') {
    writeLine(io.stdout, 'MCP proxy command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp proxy [--port ${DEFAULT_PROXY_PORT}] [--base-url <url>]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Run a local MCP proxy server.');
    return 0;
  }
  const defaultProfileClient = supportedProfileClientIds()[0];
  const authModeClient = CLIENT_REGISTRY.find((c) => c.mcp?.supportsAuthMode);
  if (subcommand === 'profile') {
    writeLine(io.stdout, 'MCP profile command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp profile ${defaultProfileClient} [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Display or check ${getClient(defaultProfileClient)?.label ?? 'Codex'} behavior profile.`);
    return 0;
  }
  if (subcommand === 'serve' || subcommand === 'stdio') {
    writeLine(io.stdout, 'MCP serve command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp serve`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Start the stdio MCP server for agent integration.');
    return 0;
  }
  writeLine(io.stdout, 'MCP commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp serve`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client ${authModeClient?.id} [--auth oauth|key] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp add ${authModeClient?.id} [--auth oauth|key] [--write] [--force] [--config <path>]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp list`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client <${supportedMcpClientIds().join('|')}> [--base-url <url>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp proxy [--port ${DEFAULT_PROXY_PORT}] [--base-url <url>]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp profile ${defaultProfileClient} [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <${supportedMcpClientIds().join('|')}> [--url <https://api.example.com>]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <${supportedMcpClientIds().join('|')}> [--url <https://api.example.com>] --write [--config <path>]`);
  return 0;
}

export async function mcpCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h' || subcommand.startsWith('-') || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify({
        schemaVersion: '1',
        ok: true,
        command: 'mcp',
        data: {
          subcommands: ['list', 'config', 'add', 'proxy', 'profile', 'serve'],
          supportedClients: supportedMcpClientIds()
        },
        error: null
      }, null, 2));
      return 0;
    }
    return writeMcpHelp(io, subcommand);
  }

  if (subcommand === 'serve' || subcommand === 'stdio') {
    await startStdioServer(io.env);
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
    writeLine(io.stdout, `Generated configs never embed token values; OAuth clients do not require ${TOKEN_ENV_VAR} in their config.`);
    return 0;
  }

  if (subcommand === 'config') {
    const rawClientId = optionValue(args, '--client') ?? args[1] ?? 'generic';
    const clientId = resolveClientAlias(rawClientId);
    if (clientId !== 'generic' && !MCP_CLIENTS.has(clientId)) {
      throw new UsageError(`Unsupported MCP client: ${rawClientId}. Supported clients: ${supportedMcpClientIds().join(', ')}.`);
    }
    const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
    const mcpUrl = endpointUrl(baseUrl, '/mcp');
    const targetClient = getClient(clientId) || MCP_CLIENTS.get(clientId);
    const useLocalProxy = targetClient?.mcp?.configKind === 'local-proxy' && !hasFlag(args, '--remote-env');
    const proxyPort = parsePositiveInteger(optionValue(args, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
    const proxyUrl = `http://${DEFAULT_PROXY_HOST}:${proxyPort}/mcp`;
    const auth = optionValue(args, '--auth');
    const authModeClient = CLIENT_REGISTRY.find((c) => c.mcp?.supportsAuthMode);
    if (auth && (clientId !== authModeClient?.id || !['oauth', 'key'].includes(auth))) {
      throw new UsageError(`--auth oauth|key is supported only for ${authModeClient?.label ?? 'Kiro'}.`);
    }
    const templateOptions = { mcpClients: MCP_CLIENTS, auth };
    const template = useLocalProxy
      ? mcpLocalProxyTemplate(clientId, proxyUrl, templateOptions)
      : mcpConfigTemplate(clientId, mcpUrl, templateOptions);

    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(template, null, 2));
      return 0;
    }

    writeLine(io.stdout, `${PRODUCT_NAME} MCP config template for ${clientId}`);
    if (useLocalProxy) {
      writeLine(io.stdout, `Requires credential: ${COMMAND_NAME} login or ${COMMAND_NAME} token add --from-stdin --allow-plaintext`);
      writeLine(io.stdout, `Run local proxy: ${template.requiresLocalCommand}`);
    } else {
      if (template.requiresEnv?.length > 0) {
        writeLine(io.stdout, `Requires env: ${template.requiresEnv.join(', ')}`);
      } else if (template.authentication === 'oauth') {
        writeLine(io.stdout, 'Requires auth: complete the client MCP OAuth flow after setup.');
      }
    }
    if (typeof template.snippet === 'string') {
      writeLine(io.stdout, template.snippet.trimEnd());
    } else {
      writeLine(io.stdout, JSON.stringify(template.snippet, null, 2));
    }
    if (template.optionalEnv?.includes(AGENT_INSTANCE_ENV_VAR)) {
      writeLine(io.stdout, '');
      writeLine(io.stdout, `${AGENT_INSTANCE_ENV_VAR} must be stable per local client install.`);
      if (template.agentInstanceGeneration?.automaticCommand) {
        writeLine(io.stdout, `Use ${template.agentInstanceGeneration.automaticCommand} to generate and persist it, or set it to a unique value such as xmemo-${clientId}-<uuid>.`);
      } else {
        writeLine(io.stdout, `Set it to a unique value such as xmemo-${clientId}-<uuid> and persist it outside git.`);
      }
    }
    writeLine(io.stdout, 'Review the template before applying it. Token values are not included.');
    return 0;
  }

  if (subcommand === 'proxy') {
    return await mcpProxyCommand(args.slice(1), io, { agentIdentity });
  }

  if (subcommand === 'profile') {
    const defaultProfileClient = supportedProfileClientIds()[0];
    const targetId = args[1] ?? defaultProfileClient;
    if (targetId !== defaultProfileClient) {
      const defaultLabel = getClient(defaultProfileClient)?.label ?? 'Codex';
      throw new UsageError(`Only the ${defaultLabel} memory behavior profile is available in this MCP-depth release.`);
    }

    const profile = codexMemoryProfile();
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(profile, null, 2));
      return 0;
    }

    writeCodexMemoryProfile(profile, io);
    return 0;
  }

  if (subcommand === 'remove' || subcommand === 'rm') {
    if (subcommand === 'rm' && !hasFlag(args, '--json') && io.stderr?.isTTY) {
      writeLine(io.stderr, "Hint: 'xmemo mcp rm' is an alias for 'xmemo mcp remove'.");
    }
    const rawTarget = args[1] ?? optionValue(args, '--client');
    const target = resolveClientAlias(rawTarget);
    const client = getClient(target) || MCP_CLIENTS.get(target);
    if (!client || !client.mcp?.removeConfig) {
      throw new UsageError(`Unsupported MCP client: ${rawTarget ?? 'missing'}. Supported clients: ${supportedMcpClientIds().join(', ')}.`);
    }
    const configPath = optionValue(args, '--config') ?? (typeof client.mcp.defaultConfigPath === 'function' ? client.mcp.defaultConfigPath(io.env) : null);
    const result = await client.mcp.removeConfig(configPath, { preview: hasFlag(args, '--dry-run') });
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(result, null, 2));
    } else {
      writeLine(io.stdout, result.removed ? `Removed MCP config from ${configPath}` : `No MCP config found in ${configPath}`);
    }
    return 0;
  }

  if (subcommand === 'status') {
    const rawTarget = args[1] ?? optionValue(args, '--client');
    const target = resolveClientAlias(rawTarget);
    const client = getClient(target) || MCP_CLIENTS.get(target);
    if (!client || !client.mcp) {
      throw new UsageError(`Unsupported MCP client: ${rawTarget ?? 'missing'}. Supported clients: ${supportedMcpClientIds().join(', ')}.`);
    }
    const configPath = optionValue(args, '--config') ?? (typeof client.mcp.defaultConfigPath === 'function' ? client.mcp.defaultConfigPath(io.env) : null);
    let configured = false;
    try {
      if (configPath && (await fileExists(configPath))) {
        const text = await fs.readFile(configPath, 'utf8');
        configured = text.includes(MCP_SERVER_NAME) || text.includes('XMemo') || text.includes('xmemo');
      }
    } catch {}
    const statusResult = {
      client: client.id,
      label: client.label,
      configPath,
      configured,
      authentication: client.mcp.authentication
    };
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(statusResult, null, 2));
    } else {
      writeLine(io.stdout, `${client.label} MCP status: ${configured ? 'configured' : 'not configured'} (${configPath ?? 'no config path'})`);
    }
    return 0;
  }

  if (subcommand === 'add' && !hasFlag(args, '--json') && io.stderr?.isTTY) {
    writeLine(io.stderr, "Hint: 'xmemo mcp add' is an alias for 'xmemo mcp install'.");
  }

  const rawTarget = args[1] ?? '';
  const target = resolveClientAlias(rawTarget);
  const auth = optionValue(args, '--auth');
  const authModeClient = CLIENT_REGISTRY.find((c) => c.mcp?.supportsAuthMode);
  if (auth && (target !== authModeClient?.id || !['oauth', 'key'].includes(auth))) {
    throw new UsageError(`--auth oauth|key is supported only for ${authModeClient?.label ?? 'Kiro'}.`);
  }
  const client = MCP_CLIENTS.get(target);

  if ((subcommand !== 'add' && subcommand !== 'install') || !client) {
    throw new UsageError(`Supported MCP setup command: ${COMMAND_NAME} mcp add <${supportedMcpClientIds().join('|')}> [--url <url>]`);
  }

  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const configPath = optionValue(args, '--config') ?? (typeof client.defaultConfigPath === 'function' ? client.defaultConfigPath(io.env) : null);
  const mcpUrl = endpointUrl(baseUrl, '/mcp');
  const isLocalProxy = client.configKind === 'local-proxy';
  const proxyPort = parsePositiveInteger(optionValue(args, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
  const proxyUrl = `http://${DEFAULT_PROXY_HOST}:${proxyPort}/mcp`;
  const targetUrl = isLocalProxy ? proxyUrl : mcpUrl;

  const willWrite = hasFlag(args, '--write');
  const identity = willWrite ? await agentIdentity(target, io.env) : envReferenceIdentity(target);
  if (willWrite) {
    if (typeof client.writeConfig === 'function') {
      await client.writeConfig(configPath, targetUrl, identity, { auth, force: hasFlag(args, '--force') });
    }
  }

  if (hasFlag(args, '--json')) {
    if (isLocalProxy) {
      const template = mcpLocalProxyTemplate(target, proxyUrl, { mcpClients: MCP_CLIENTS });
      writeLine(io.stdout, JSON.stringify({
        client: target,
        label: client.label,
        configKind: client.configKind,
        configPath,
        serverName: MCP_SERVER_NAME,
        url: proxyUrl,
        proxyUrl,
        requiresLocalCommand: template.requiresLocalCommand,
        tokenEnvVar: null,
        authentication: 'local-proxy',
        agentId: identity.agentId,
        agentInstanceId: identity.agentInstanceId,
        agentInstanceIdPath: identity.path,
        agentInstanceGeneration: agentInstanceGenerationPolicy(target, { mcpClients: MCP_CLIENTS }),
        writesTokenValue: false,
        written: willWrite
      }, null, 2));
      return 0;
    }
    const oauthClient = (usesClientOAuth(target) && auth !== 'key');
    writeLine(io.stdout, JSON.stringify({
      client: target,
      label: client.label,
      configKind: client.configKind,
      configPath,
      serverName: MCP_SERVER_NAME,
      url: mcpUrl,
      tokenEnvVar: oauthClient ? null : TOKEN_ENV_VAR,
      authentication: oauthClient ? 'oauth' : 'env-bearer',
      agentId: identity.agentId,
      agentInstanceId: identity.agentInstanceId,
      agentInstanceIdPath: identity.path,
      agentInstanceGeneration: agentInstanceGenerationPolicy(target, { mcpClients: MCP_CLIENTS }),
      writesTokenValue: false,
      written: willWrite
    }, null, 2));
    return 0;
  }

  if (willWrite) {
    writeLine(io.stdout, `Updated ${client.label} MCP config: ${configPath}`);
    if (isLocalProxy) {
      writeLine(io.stdout, `Local proxy URL configured: ${proxyUrl}`);
      writeLine(io.stdout, `Next: keep \`${COMMAND_NAME} mcp proxy --port ${proxyPort}\` running while you use ${client.label}.`);
      return 0;
    }
    if ((usesClientOAuth(target) && auth !== 'key')) {
      writeLine(io.stdout, `Token value was not written. ${client.label} will complete MCP OAuth on first use.`);
    } else {
      writeLine(io.stdout, `Token value was not written. ${client.label} will read ${TOKEN_ENV_VAR} from the environment.`);
    }
    writeLine(io.stdout, `Agent instance ID stored outside git: ${identity.path}`);
    return 0;
  }

  if (typeof client.buildSnippet === 'function') {
    const snippet = client.buildSnippet(mcpUrl, identity, { auth });
    writeLine(io.stdout, `Add this to your ${client.label} config (${configPath}):`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, typeof snippet === 'string' ? snippet.trimEnd() : JSON.stringify(snippet, null, 2));
    writeLine(io.stdout, '');
    if ((usesClientOAuth(target) && auth !== 'key')) {
      writeLine(io.stdout, `Restart ${client.label} and complete its MCP OAuth flow. No token value is included here.`);
    } else {
      writeLine(io.stdout, `Set ${TOKEN_ENV_VAR} in your user environment or secret manager. The token value is not included here.`);
    }
    writeLine(io.stdout, `${AGENT_INSTANCE_ENV_VAR} must be stable per local ${client.label} install; run ${COMMAND_NAME} mcp add ${target} --write to generate it automatically.`);
    return 0;
  }

  if (isLocalProxy) {
    const template = mcpLocalProxyTemplate(target, proxyUrl, { mcpClients: MCP_CLIENTS });
    writeLine(io.stdout, `Add this to your ${client.label} config (${configPath}):`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, JSON.stringify(template.snippet, null, 2));
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Requires credential: ${COMMAND_NAME} login or ${COMMAND_NAME} token add --from-stdin --allow-plaintext`);
    writeLine(io.stdout, `Run local proxy: ${template.requiresLocalCommand}`);
    writeLine(io.stdout, `Run \`${COMMAND_NAME} mcp add ${target} --write\` to write this configuration automatically.`);
    return 0;
  }

  writeLine(io.stdout, `No manual MCP snippet is available for ${client.label}.`);
  writeLine(io.stdout, `Configure automatically with: ${COMMAND_NAME} mcp add ${target} --write`);
  return 0;
}

