import {
  AGENT_ID_HEADER,
  AGENT_INSTANCE_ENV_VAR,
  AGENT_INSTANCE_HEADER,
  COMMAND_NAME,
  DEFAULT_PROXY_PORT,
  MCP_SERVER_NAME,
  TOKEN_ENV_VAR
} from '../../core/constants.js';
import { codexTomlSnippet } from '../formats/toml.js';
import {
  jsonClientConfig,
  jsonMcpClientDefinition
} from '../formats/json.js';

export function mcpConfigTemplate(clientId, mcpUrl, options = {}) {
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
      agentInstanceGeneration: agentInstanceGenerationPolicy(clientId, options),
      writesTokenValue: false
    };
  }

  const jsonDefinition = jsonMcpClientDefinition(clientId);
  if (jsonDefinition) {
    return jsonDefinition.authentication === 'oauth'
      ? oauthJsonMcpTemplate(clientId, mcpUrl, jsonClientConfig(clientId, mcpUrl), options)
      : bearerJsonMcpTemplate(clientId, mcpUrl, jsonClientConfig(clientId, mcpUrl), options);
  }

  return {
    client: clientId,
    serverName: MCP_SERVER_NAME,
    snippetFormat: 'json',
    snippet: {
      mcpServers: {
        [MCP_SERVER_NAME]: {
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
    agentInstanceGeneration: agentInstanceGenerationPolicy(clientId, options),
    writesTokenValue: false
  };
}

export function mcpLocalProxyTemplate(clientId, proxyUrl, options = {}) {
  return {
    client: clientId,
    serverName: MCP_SERVER_NAME,
    snippetFormat: 'json',
    snippet: {
      mcpServers: {
        [MCP_SERVER_NAME]: {
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
    agentInstanceGeneration: agentInstanceGenerationPolicy(clientId, options),
    writesTokenValue: false
  };
}

export function agentInstanceGenerationPolicy(clientId, options = {}) {
  const automaticCommand = options.mcpClients?.has(clientId)
    ? `${COMMAND_NAME} mcp add ${clientId} --write`
    : clientId === 'copilot-cli'
      ? `${COMMAND_NAME} setup copilot --write`
      : null;
  return {
    requiredForHeaders: true,
    stablePerInstall: true,
    automaticCommand,
    generatedPattern: `xmemo-${clientId}-<uuid>`,
    storagePath: `~/.config/xmemo/agent-instances/${clientId}.json`,
    manualEnvVar: AGENT_INSTANCE_ENV_VAR
  };
}

function bearerJsonMcpTemplate(clientId, mcpUrl, snippet, options) {
  return {
    client: clientId,
    serverName: MCP_SERVER_NAME,
    snippetFormat: 'json',
    snippet,
    requiresEnv: [TOKEN_ENV_VAR],
    optionalEnv: [AGENT_INSTANCE_ENV_VAR],
    authentication: 'env-bearer',
    agentIdentity: {
      agentId: clientId,
      agentIdHeader: AGENT_ID_HEADER,
      agentInstanceEnvVar: AGENT_INSTANCE_ENV_VAR,
      agentInstanceHeader: AGENT_INSTANCE_HEADER
    },
    agentInstanceGeneration: agentInstanceGenerationPolicy(clientId, options),
    mcpUrl,
    writesTokenValue: false
  };
}

function oauthJsonMcpTemplate(clientId, mcpUrl, snippet, options) {
  return {
    client: clientId,
    serverName: MCP_SERVER_NAME,
    snippetFormat: 'json',
    snippet,
    requiresEnv: [],
    optionalEnv: [AGENT_INSTANCE_ENV_VAR],
    authentication: 'oauth',
    agentIdentity: {
      agentId: clientId,
      agentIdHeader: AGENT_ID_HEADER,
      agentInstanceEnvVar: AGENT_INSTANCE_ENV_VAR,
      agentInstanceHeader: AGENT_INSTANCE_HEADER
    },
    agentInstanceGeneration: agentInstanceGenerationPolicy(clientId, options),
    mcpUrl,
    writesTokenValue: false
  };
}

