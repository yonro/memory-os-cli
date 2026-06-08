import { optionValue } from '../core/args.js';
import {
  COMMAND_NAME,
  DEFAULT_PROXY_HOST,
  MCP_SERVER_NAME,
  PRODUCT_NAME,
  TOKEN_ENV_VAR
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { supportedMcpClientIds, usesClientOAuth } from '../mcp/clients/registry.js';
import { mcpLocalProxyTemplate } from '../mcp/core/templates.js';
import { defaultCopilotConfigPath } from '../mcp/identity/paths.js';
import { profileClientConfig } from '../config/profile.js';

const SETUP_CLIENT_ALIASES = new Map([
  ['codex', 'codex'],
  ['cursor', 'cursor'],
  ['copilot', 'copilot-cli'],
  ['copilot-cli', 'copilot-cli'],
  ['gemini', 'gemini-cli'],
  ['gemini-cli', 'gemini-cli'],
  ['antigravity', 'antigravity'],
  ['antigravity-ide', 'antigravity-ide'],
  ['antigravity2', 'antigravity2'],
  ['antigravity-cli', 'antigravity-cli'],
  ['windsurf', 'windsurf'],
  ['cline', 'cline'],
  ['continue', 'continue'],
  ['claude', 'claude-desktop'],
  ['claude-desktop', 'claude-desktop'],
  ['openclaw', 'openclaw'],
  ['kiro', 'kiro'],
  ['zed', 'zed'],
  ['jetbrains', 'jetbrains'],
  ['opencode', 'opencode'],
  ['hermes', 'hermes'],
  ['qwen', 'qwen'],
  ['qwencli', 'qwen'],
  ['qwen-cli', 'qwen'],
  ['trae', 'trae'],
  ['traesolo', 'trae-solo'],
  ['trae-solo', 'trae-solo'],
  ['claude-code', 'claude-code'],
  ['claudecode', 'claude-code'],
  ['claude-cli', 'claude-code'],
  ['claudecode-cli', 'claude-code']
]);

export function supportedSetupClientIds(mcpClients) {
  return [...supportedMcpClientIds(mcpClients), 'copilot-cli'];
}

export function requiredOption(args, name) {
  const value = optionValue(args, name);
  if (!value) {
    throw new UsageError(`Missing required option ${name}.`);
  }
  return value;
}

export function positionalClientArg(args, mcpClients) {
  const candidate = args[0];
  if (!candidate || candidate.startsWith('--')) {
    return null;
  }

  return normalizeSetupClientId(candidate, mcpClients);
}

export function normalizeSetupClientId(candidate, mcpClients) {
  if (!candidate) {
    return null;
  }

  const normalized = SETUP_CLIENT_ALIASES.get(candidate);
  if (!normalized) {
    throw new UsageError(`Unsupported setup client: ${candidate}. Supported clients: ${supportedSetupClientIds(mcpClients).join(', ')}.`);
  }

  return normalized;
}

export function clientSetupPlan(clientId, client, mcpUrl, env, identity) {
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

export function copilotSetupPlan(mcpUrl, proxyPort, env) {
  const proxyUrl = `http://${DEFAULT_PROXY_HOST}:${proxyPort}/mcp`;
  const template = mcpLocalProxyTemplate('copilot-cli', proxyUrl);
  return {
    id: 'copilot-cli',
    label: 'Copilot CLI',
    configKind: 'local-proxy',
    configPath: defaultCopilotConfigPath(env),
    serverName: template.serverName,
    mcpUrl,
    proxyUrl,
    tokenEnvVar: TOKEN_ENV_VAR,
    requiresCredential: template.requiresCredential,
    requiresLocalCommand: template.requiresLocalCommand,
    template: template.snippet,
    agentId: template.agentIdentity.agentId,
    writesTokenValue: false,
    writeSupported: true,
    written: false
  };
}

export function writeSetupSummary(plan, io) {
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

  if (plan.detectedClients) {
    writeLine(io.stdout, '');
    if (plan.detectedClients.length === 0) {
      writeLine(io.stdout, 'No local IDE or CLI client configurations were detected.');
      writeLine(io.stdout, `Run \`${COMMAND_NAME} setup <client>\` to configure a client manually.`);
    } else {
      writeLine(io.stdout, `Auto-detected ${plan.detectedClients.length} client(s):`);
      for (const client of plan.detectedClients) {
        writeLine(io.stdout, `  [${client.written ? '✔' : ' '}] ${client.label}`);
        writeLine(io.stdout, `      Config: ${client.configPath}`);
        writeLine(io.stdout, `      Agent ID: ${client.agentId}`);
      }
      if (plan.detectedClients.some(c => c.written)) {
        writeLine(io.stdout, '');
        writeLine(io.stdout, 'Successfully applied XMemo MCP configuration to all detected clients!');
        writeLine(io.stdout, 'Restart your IDEs or reload their MCP configurations to apply the changes.');
      } else {
        writeLine(io.stdout, '');
        writeLine(io.stdout, `Run \`${COMMAND_NAME} setup --all --write\` to write configurations for all detected clients.`);
      }
    }
    return;
  }

  if (plan.selectedClient) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Selected client: ${plan.selectedClient.label}`);
    writeLine(io.stdout, `  Config path: ${plan.selectedClient.configPath}`);
    writeLine(io.stdout, `  Written: ${plan.selectedClient.written}`);
    writeLine(io.stdout, `  Token value embedded: ${plan.selectedClient.writesTokenValue}`);
    writeLine(io.stdout, `  Agent ID: ${plan.selectedClient.agentId}`);
    if (plan.selectedClient.agentInstanceIdPath) {
      writeLine(io.stdout, `  Agent instance ID stored: ${plan.selectedClient.agentInstanceIdPath}`);
    }
    if (plan.selectedClient.configKind === 'local-proxy') {
      writeLine(io.stdout, `  Local proxy: ${plan.selectedClient.requiresLocalCommand}`);
      if (plan.selectedClient.written) {
        writeLine(io.stdout, `  Next: keep \`${plan.selectedClient.requiresLocalCommand}\` running while you use Copilot CLI.`);
        writeLine(io.stdout, '  If Copilot CLI is already open, reload MCP config or restart Copilot CLI.');
      } else {
        writeLine(io.stdout, '  MCP template:');
        writeLine(io.stdout, JSON.stringify(plan.selectedClient.template, null, 2));
        writeLine(io.stdout, `  Next: ${COMMAND_NAME} setup copilot --url ${plan.baseUrl}`);
      }
      return;
    }
    if (plan.selectedClient.behaviorProfile) {
      const profile = plan.selectedClient.behaviorProfile;
      const profileClient = profileClientConfig(profile.client);
      writeLine(io.stdout, `  Behavior profile target: ${profile.targetPath}`);
      writeLine(io.stdout, `  Behavior profile client: ${profileClient?.label ?? profile.client}`);
      writeLine(io.stdout, `  Behavior profile installed: ${profile.written}`);
      writeLine(io.stdout, `  Behavior profile changed: ${profile.changed}`);
      if (!profile.written) {
        writeLine(io.stdout, `  Profile preview: ${COMMAND_NAME} profile install ${profile.client} --target ${profile.targetPath}`);
      }
    }
    if (plan.selectedClient.written) {
      writeLine(io.stdout, '');
      const cid = plan.selectedClient.id;
      if (cid === 'opencode') {
        writeLine(io.stdout, '💡 Next steps for OpenCode:');
        writeLine(io.stdout, '  1. Open or restart OpenCode.');
        writeLine(io.stdout, '  2. Trigger any XMemo tool call, or manually run `opencode mcp auth XMemo` in your terminal.');
        writeLine(io.stdout, '  3. A browser window will automatically pop up requesting XMemo OAuth authorization.');
        writeLine(io.stdout, '  4. Log in or register on the webpage, then click "Authorize" to link OpenCode.');
      } else if (cid === 'qwen') {
        writeLine(io.stdout, '💡 Next steps for Qwen:');
        writeLine(io.stdout, '  1. Open or restart Qwen.');
        writeLine(io.stdout, '  2. When Qwen connects to XMemo MCP, a browser window will automatically pop up requesting OAuth authorization.');
        writeLine(io.stdout, '  3. Follow the page prompts to sign in and click "Authorize" to link Qwen.');
      } else if (cid === 'trae' || cid === 'trae-solo') {
        writeLine(io.stdout, `💡 Next steps for ${plan.selectedClient.label}:`);
        writeLine(io.stdout, `  1. Restart ${plan.selectedClient.label} to load the new MCP configuration.`);
        writeLine(io.stdout, `  2. Make sure the ${TOKEN_ENV_VAR} environment variable is set in your user environment.`);
        if (plan.tokenPortalUrl) {
          writeLine(io.stdout, `     (Token portal: ${plan.tokenPortalUrl})`);
        }
      } else if (usesClientOAuth(cid)) {
        writeLine(io.stdout, `💡 Next steps for ${plan.selectedClient.label}:`);
        writeLine(io.stdout, '  1. When the agent starts or first makes an XMemo tool call, a browser window will automatically pop up requesting OAuth authorization.');
        writeLine(io.stdout, '  2. Follow the page prompts to sign in and click "Authorize".');
      } else {
        writeLine(io.stdout, `💡 Next steps for ${plan.selectedClient.label}:`);
        writeLine(io.stdout, '  1. Restart your editor/client to load the new MCP configuration.');
        writeLine(io.stdout, `  2. Make sure the ${TOKEN_ENV_VAR} environment variable is set in your user environment.`);
        if (plan.tokenPortalUrl) {
          writeLine(io.stdout, `     (Token portal: ${plan.tokenPortalUrl})`);
        }
      }
    } else {
      writeLine(io.stdout, `  Next: ${COMMAND_NAME} setup ${plan.selectedClient.id} --url ${plan.baseUrl}`);
    }
    return;
  }

  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Next steps:');
  writeLine(io.stdout, `  1. Create a scoped token in the token portal and store it in ${plan.tokenEnvVar}.`);
  writeLine(io.stdout, `  2. Configure a client, for example: ${COMMAND_NAME} setup codex --url ${plan.baseUrl}`);
  writeLine(io.stdout, `  3. Run ${COMMAND_NAME} status to smoke-test the service without sending the token.`);
}

