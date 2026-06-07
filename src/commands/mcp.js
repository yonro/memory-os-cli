import { hasFlag, optionValue, parsePositiveInteger } from '../args.js';
import { baseUrlOption } from '../base-url.js';
import {
  AGENT_INSTANCE_ENV_VAR,
  COMMAND_NAME,
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  MCP_SERVER_NAME,
  PRODUCT_NAME,
  TOKEN_ENV_VAR
} from '../constants.js';
import { UsageError } from '../errors.js';
import { endpointUrl, normalizeBaseUrl } from '../http.js';
import { writeLine } from '../io.js';
import {
  MCP_CLIENTS,
  supportedMcpClientIds,
  supportedMcpClients
} from '../mcp/clients.js';
import { mcpProxyCommand } from '../mcp/copilot-proxy.js';
import {
  agentIdentity,
  envReferenceIdentity
} from '../mcp/identity.js';
import {
  agentInstanceGenerationPolicy,
  mcpConfigTemplate,
  mcpLocalProxyTemplate
} from '../mcp/templates.js';
import { usesClientOAuth } from '../mcp/registry.js';
import {
  codexMemoryProfile,
  writeCodexMemoryProfile
} from '../profile.js';

export async function mcpCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'MCP commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp list`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client <codex|cursor|copilot-cli|antigravity|generic> [--base-url <url>] [--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp proxy [--port ${DEFAULT_PROXY_PORT}] [--base-url <url>]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp profile codex [--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <${supportedMcpClientIds().join('|')}> [--url <https://api.example.com>]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <${supportedMcpClientIds().join('|')}> [--url <https://api.example.com>] --write [--config <path>]`);
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
    const clientId = optionValue(args, '--client') ?? args[1] ?? 'generic';
    const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
    const mcpUrl = endpointUrl(baseUrl, '/mcp');
    const useLocalProxy = clientId === 'copilot-cli' && !hasFlag(args, '--remote-env');
    const proxyPort = parsePositiveInteger(optionValue(args, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
    const proxyUrl = `http://${DEFAULT_PROXY_HOST}:${proxyPort}/mcp`;
    const templateOptions = { mcpClients: MCP_CLIENTS };
    const template = useLocalProxy
      ? mcpLocalProxyTemplate(clientId, proxyUrl, templateOptions)
      : mcpConfigTemplate(clientId, mcpUrl, templateOptions);

    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(template, null, 2));
      return 0;
    }

    writeLine(io.stdout, `${PRODUCT_NAME} MCP config template for ${clientId}`);
    if (useLocalProxy) {
      writeLine(io.stdout, `Requires credential: ${COMMAND_NAME} login or ${COMMAND_NAME} token add --from-stdin`);
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
    const oauthClient = usesClientOAuth(target);
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
      writesTokenValue: false
    }, null, 2));
    return 0;
  }

  const identity = hasFlag(args, '--write') ? await agentIdentity(target, io.env) : envReferenceIdentity(target);
  if (hasFlag(args, '--write')) {
    await client.writeConfig(configPath, mcpUrl, identity);
    writeLine(io.stdout, `Updated ${client.label} MCP config: ${configPath}`);
    if (usesClientOAuth(target)) {
      writeLine(io.stdout, `Token value was not written. ${client.label} will complete MCP OAuth on first use.`);
    } else {
      writeLine(io.stdout, `Token value was not written. ${client.label} will read ${TOKEN_ENV_VAR} from the environment.`);
    }
    writeLine(io.stdout, `Agent instance ID stored outside git: ${identity.path}`);
    return 0;
  }

  const snippet = client.buildSnippet(mcpUrl, identity);
  writeLine(io.stdout, `Add this to your ${client.label} config (${configPath}):`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, snippet.trimEnd());
  writeLine(io.stdout, '');
  if (usesClientOAuth(target)) {
    writeLine(io.stdout, `Restart ${client.label} and complete its MCP OAuth flow. No token value is included here.`);
  } else {
    writeLine(io.stdout, `Set ${TOKEN_ENV_VAR} in your user environment or secret manager. The token value is not included here.`);
  }
  writeLine(io.stdout, `${AGENT_INSTANCE_ENV_VAR} must be stable per local ${client.label} install; run ${COMMAND_NAME} mcp add ${target} --write to generate it automatically.`);
  return 0;
}
