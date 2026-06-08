import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_INSTANCE_ENV_VAR,
  AGENT_ID_HEADER,
  AGENT_INSTANCE_HEADER,
  MCP_SERVER_NAME,
  TOKEN_ENV_VAR
} from '../../core/constants.js';
import { UsageError } from '../../core/errors.js';
import {
  bestEffortChmod,
  isPlainObject,
  parseJsonConfig,
  readTextIfExists
} from '../../core/runtime.js';
import { envReferenceIdentity } from '../identity/device.js';
import { existingJsonMcpServerName } from '../core/names.js';

export const JSON_MCP_CLIENT_DEFINITIONS = Object.freeze([
  httpClientDefinition('cursor', 'Cursor', 'defaultCursorConfigPath', { urlKey: 'url', authentication: 'env-bearer' }),
  httpClientDefinition('gemini-cli', 'Gemini CLI', 'defaultGeminiConfigPath', { urlKey: 'httpUrl', authentication: 'oauth' }),
  httpClientDefinition('antigravity', 'Antigravity', 'defaultAntigravityConfigPath', { urlKey: 'serverUrl', authentication: 'oauth' }),
  httpClientDefinition('antigravity-ide', 'Antigravity IDE', 'defaultAntigravityIdeConfigPath', { urlKey: 'url', authentication: 'oauth', defaultIdentityId: 'antigravity', extra: { type: 'http' } }),
  httpClientDefinition('antigravity2', 'Antigravity 2.0', 'defaultAntigravity2ConfigPath', { urlKey: 'url', authentication: 'oauth', defaultIdentityId: 'antigravity', extra: { type: 'http' } }),
  httpClientDefinition('antigravity-cli', 'Antigravity CLI', 'defaultAntigravityCliConfigPath', { urlKey: 'httpUrl', authentication: 'oauth', defaultIdentityId: 'antigravity' }),
  httpClientDefinition('windsurf', 'Windsurf', 'defaultWindsurfConfigPath', { urlKey: 'serverUrl', authentication: 'env-bearer' }),
  httpClientDefinition('cline', 'Cline', 'defaultClineConfigPath', { urlKey: 'httpUrl', authentication: 'env-bearer' }),
  nestedTransportClientDefinition('continue', 'Continue', 'defaultContinueConfigPath'),
  commandClientDefinition('claude-desktop', 'Claude Desktop', 'defaultClaudeConfigPath'),
  httpClientDefinition('openclaw', 'OpenClaw', 'defaultOpenclawConfigPath', { urlKey: 'url', authentication: 'env-bearer' }),
  httpClientDefinition('kiro', 'Kiro', 'defaultKiroConfigPath', { urlKey: 'url', authentication: 'env-bearer', requiredTokenEnv: TOKEN_ENV_VAR }),
  commandClientDefinition('zed', 'Zed', 'defaultZedConfigPath', { section: 'context_servers' }),
  nestedTransportClientDefinition('jetbrains', 'JetBrains', 'defaultJetbrainsConfigPath'),
  remoteClientDefinition('opencode', 'OpenCode', 'defaultOpencodeConfigPath'),
  httpClientDefinition('qwen', 'Qwen', 'defaultQwenConfigPath', { urlKey: 'httpUrl', authentication: 'oauth' }),
  commandClientDefinition('trae', 'Trae', 'defaultTraeConfigPath'),
  commandClientDefinition('trae-solo', 'Trae Solo', 'defaultTraeSoloConfigPath'),
  commandClientDefinition('claude-code', 'Claude Code', 'defaultClaudecodeConfigPath')
]);

const JSON_MCP_CLIENTS_BY_ID = new Map(JSON_MCP_CLIENT_DEFINITIONS.map((definition) => [definition.id, definition]));

function httpClientDefinition(id, label, defaultConfigPath, options) {
  return {
    id,
    label,
    defaultConfigPath,
    configKind: 'json',
    section: 'mcpServers',
    serverKind: 'http',
    bearerSyntax: 'env-colon',
    ...options
  };
}

function nestedTransportClientDefinition(id, label, defaultConfigPath) {
  return {
    id,
    label,
    defaultConfigPath,
    configKind: 'json',
    section: 'mcpServers',
    serverKind: 'nested-transport',
    authentication: 'env-bearer',
    bearerSyntax: 'plain',
    mergeExperimentalModelContextProtocolServers: true
  };
}

function commandClientDefinition(id, label, defaultConfigPath, options = {}) {
  return {
    id,
    label,
    defaultConfigPath,
    configKind: 'json',
    section: 'mcpServers',
    serverKind: 'mcp-remote-command',
    authentication: 'env-bearer',
    ...options
  };
}

function remoteClientDefinition(id, label, defaultConfigPath) {
  return {
    id,
    label,
    defaultConfigPath,
    configKind: 'json',
    section: 'mcp',
    serverKind: 'remote',
    authentication: 'oauth'
  };
}

export function jsonMcpClientDefinition(clientId) {
  return JSON_MCP_CLIENTS_BY_ID.get(clientId) ?? null;
}

export function jsonMcpClientIds() {
  return JSON_MCP_CLIENT_DEFINITIONS.map((definition) => definition.id);
}

export function jsonClientConfig(clientId, mcpUrl, identity) {
  const definition = requireJsonMcpClientDefinition(clientId);
  return sectionConfig(definition.section, jsonClientServerConfig(clientId, mcpUrl, identity));
}

export function jsonClientSnippet(clientId, mcpUrl, identity) {
  return `${JSON.stringify(jsonClientConfig(clientId, mcpUrl, identity), null, 2)}\n`;
}

export function jsonClientServerConfig(clientId, mcpUrl, identity) {
  const definition = requireJsonMcpClientDefinition(clientId);
  const resolvedIdentity = identity ?? envReferenceIdentity(definition.defaultIdentityId ?? definition.id);
  return serverConfigFromDefinition(definition, mcpUrl, resolvedIdentity);
}

export async function mergeJsonClientMcpConfig(clientId, configPath, mcpUrl, identity) {
  const definition = requireJsonMcpClientDefinition(clientId);
  const serverConfig = serverConfigFromDefinition(definition, mcpUrl, identity);
  await mergeJsonSectionConfig(configPath, definition.section, serverConfig, definition.section, (parsed) => {
    if (definition.mergeExperimentalModelContextProtocolServers && isPlainObject(parsed.experimental)) {
      mergeExperimentalModelContextProtocolServers(parsed, serverConfig, mcpUrl);
    }
  });
}

function requireJsonMcpClientDefinition(clientId) {
  const definition = jsonMcpClientDefinition(clientId);
  if (!definition) {
    throw new UsageError(`Unsupported JSON MCP client: ${clientId}`);
  }
  return definition;
}

function sectionConfig(sectionName, serverConfig) {
  return {
    [sectionName]: {
      [MCP_SERVER_NAME]: serverConfig
    }
  };
}

function serverConfigFromDefinition(definition, mcpUrl, identity) {
  if (definition.serverKind === 'mcp-remote-command') {
    return mcpRemoteCommandJsonServerConfig(mcpUrl, identity);
  }

  if (definition.serverKind === 'nested-transport') {
    return {
      transport: {
        type: 'streamable-http',
        url: mcpUrl,
        headers: headersForDefinition(definition, identity)
      }
    };
  }

  if (definition.serverKind === 'remote') {
    return {
      type: 'remote',
      url: mcpUrl,
      enabled: true,
      headers: headersForDefinition(definition, identity)
    };
  }

  return {
    ...(definition.extra ?? {}),
    [definition.urlKey]: mcpUrl,
    headers: headersForDefinition(definition, identity)
  };
}

function headersForDefinition(definition, identity) {
  const headers = {
    [AGENT_ID_HEADER]: identity.agentId,
    [AGENT_INSTANCE_HEADER]: identity.agentInstanceId
  };

  if (definition.authentication === 'env-bearer') {
    headers.Authorization = authorizationHeader(definition.bearerSyntax);
  }

  return orderedHeaders(headers);
}

function orderedHeaders(headers) {
  if (!headers.Authorization) {
    return headers;
  }
  return {
    Authorization: headers.Authorization,
    [AGENT_ID_HEADER]: headers[AGENT_ID_HEADER],
    [AGENT_INSTANCE_HEADER]: headers[AGENT_INSTANCE_HEADER]
  };
}

function authorizationHeader(syntax) {
  if (syntax === 'plain') {
    return `Bearer \${${TOKEN_ENV_VAR}}`;
  }
  return `Bearer \${env:${TOKEN_ENV_VAR}}`;
}

function mcpRemoteCommandJsonServerConfig(mcpUrl, identity) {
  return {
    command: 'npx',
    args: [
      '-y',
      'mcp-remote',
      mcpUrl,
      '--header',
      `Authorization:Bearer \${${TOKEN_ENV_VAR}}`,
      '--header',
      `${AGENT_ID_HEADER}:${identity.agentId}`,
      '--header',
      `${AGENT_INSTANCE_HEADER}:\${${AGENT_INSTANCE_ENV_VAR}}`
    ],
    env: {
      [TOKEN_ENV_VAR]: `\${env:${TOKEN_ENV_VAR}}`,
      [AGENT_INSTANCE_ENV_VAR]: identity.agentInstanceId
    }
  };
}

async function mergeJsonSectionConfig(configPath, sectionName, serverConfig, duplicatePath = sectionName, afterMerge) {
  const existing = await readTextIfExists(configPath);
  const parsed = existing.trim().length === 0 ? {} : parseJsonConfig(existing, configPath);
  if (!isPlainObject(parsed)) {
    throw new UsageError(`MCP JSON config must be an object: ${configPath}`);
  }
  if (!isPlainObject(parsed[sectionName])) {
    parsed[sectionName] = {};
  }
  const existingName = existingJsonMcpServerName(parsed[sectionName]);
  if (existingName) {
    throw new UsageError(`MCP config already contains ${duplicatePath}.${existingName}. Edit ${configPath} manually to avoid duplicate server definitions.`);
  }
  parsed[sectionName][MCP_SERVER_NAME] = serverConfig;
  afterMerge?.(parsed);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await bestEffortChmod(configPath, 0o600);
}

function mergeExperimentalModelContextProtocolServers(parsed, serverConfig, mcpUrl) {
  if (!Array.isArray(parsed.experimental.modelContextProtocolServers)) {
    parsed.experimental.modelContextProtocolServers = [];
  }
  const hasXMemo = parsed.experimental.modelContextProtocolServers.some(
    (srv) => srv.transport && srv.transport.url === mcpUrl
  );
  if (!hasXMemo) {
    parsed.experimental.modelContextProtocolServers.push(serverConfig);
  }
}

export const cursorJsonConfig = (mcpUrl, identity = envReferenceIdentity('cursor')) => jsonClientConfig('cursor', mcpUrl, identity);
export const cursorJsonSnippet = (mcpUrl, identity = envReferenceIdentity('cursor')) => jsonClientSnippet('cursor', mcpUrl, identity);
export const cursorJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('cursor')) => jsonClientServerConfig('cursor', mcpUrl, identity);
export const mergeJsonMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('cursor', configPath, mcpUrl, identity);

export const geminiJsonConfig = (mcpUrl, identity = envReferenceIdentity('gemini-cli')) => jsonClientConfig('gemini-cli', mcpUrl, identity);
export const geminiJsonSnippet = (mcpUrl, identity = envReferenceIdentity('gemini-cli')) => jsonClientSnippet('gemini-cli', mcpUrl, identity);
export const geminiJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('gemini-cli')) => jsonClientServerConfig('gemini-cli', mcpUrl, identity);
export const mergeGeminiMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('gemini-cli', configPath, mcpUrl, identity);

export const antigravityJsonConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientConfig('antigravity', mcpUrl, identity);
export const antigravityJsonSnippet = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientSnippet('antigravity', mcpUrl, identity);
export const antigravityJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientServerConfig('antigravity', mcpUrl, identity);
export const mergeAntigravityMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('antigravity', configPath, mcpUrl, identity);

export const antigravityIdeJsonConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientConfig('antigravity-ide', mcpUrl, identity);
export const antigravityIdeJsonSnippet = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientSnippet('antigravity-ide', mcpUrl, identity);
export const antigravityIdeJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientServerConfig('antigravity-ide', mcpUrl, identity);
export const mergeAntigravityIdeMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('antigravity-ide', configPath, mcpUrl, identity);

export const antigravity2JsonConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientConfig('antigravity2', mcpUrl, identity);
export const antigravity2JsonSnippet = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientSnippet('antigravity2', mcpUrl, identity);
export const antigravity2JsonServerConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientServerConfig('antigravity2', mcpUrl, identity);
export const mergeAntigravity2McpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('antigravity2', configPath, mcpUrl, identity);

export const antigravityCliJsonConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientConfig('antigravity-cli', mcpUrl, identity);
export const antigravityCliJsonSnippet = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientSnippet('antigravity-cli', mcpUrl, identity);
export const antigravityCliJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('antigravity')) => jsonClientServerConfig('antigravity-cli', mcpUrl, identity);
export const mergeAntigravityCliMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('antigravity-cli', configPath, mcpUrl, identity);

export const windsurfJsonConfig = (mcpUrl, identity = envReferenceIdentity('windsurf')) => jsonClientConfig('windsurf', mcpUrl, identity);
export const windsurfJsonSnippet = (mcpUrl, identity = envReferenceIdentity('windsurf')) => jsonClientSnippet('windsurf', mcpUrl, identity);
export const windsurfJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('windsurf')) => jsonClientServerConfig('windsurf', mcpUrl, identity);
export const mergeWindsurfMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('windsurf', configPath, mcpUrl, identity);

export const clineJsonConfig = (mcpUrl, identity = envReferenceIdentity('cline')) => jsonClientConfig('cline', mcpUrl, identity);
export const clineJsonSnippet = (mcpUrl, identity = envReferenceIdentity('cline')) => jsonClientSnippet('cline', mcpUrl, identity);
export const clineJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('cline')) => jsonClientServerConfig('cline', mcpUrl, identity);
export const mergeClineMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('cline', configPath, mcpUrl, identity);

export const continueJsonConfig = (mcpUrl, identity = envReferenceIdentity('continue')) => jsonClientConfig('continue', mcpUrl, identity);
export const continueJsonSnippet = (mcpUrl, identity = envReferenceIdentity('continue')) => jsonClientSnippet('continue', mcpUrl, identity);
export const continueJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('continue')) => jsonClientServerConfig('continue', mcpUrl, identity);
export const mergeContinueMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('continue', configPath, mcpUrl, identity);

export const claudeJsonConfig = (mcpUrl, identity = envReferenceIdentity('claude-desktop')) => jsonClientConfig('claude-desktop', mcpUrl, identity);
export const claudeJsonSnippet = (mcpUrl, identity = envReferenceIdentity('claude-desktop')) => jsonClientSnippet('claude-desktop', mcpUrl, identity);
export const claudeJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('claude-desktop')) => jsonClientServerConfig('claude-desktop', mcpUrl, identity);
export const mergeClaudeMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('claude-desktop', configPath, mcpUrl, identity);

export const openclawJsonConfig = (mcpUrl, identity = envReferenceIdentity('openclaw')) => jsonClientConfig('openclaw', mcpUrl, identity);
export const openclawJsonSnippet = (mcpUrl, identity = envReferenceIdentity('openclaw')) => jsonClientSnippet('openclaw', mcpUrl, identity);
export const openclawJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('openclaw')) => jsonClientServerConfig('openclaw', mcpUrl, identity);
export const mergeOpenclawMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('openclaw', configPath, mcpUrl, identity);

export const kiroJsonConfig = (mcpUrl, identity = envReferenceIdentity('kiro')) => jsonClientConfig('kiro', mcpUrl, identity);
export const kiroJsonSnippet = (mcpUrl, identity = envReferenceIdentity('kiro')) => jsonClientSnippet('kiro', mcpUrl, identity);
export const kiroJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('kiro')) => jsonClientServerConfig('kiro', mcpUrl, identity);
export const mergeKiroMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('kiro', configPath, mcpUrl, identity);

export const zedJsonConfig = (mcpUrl, identity = envReferenceIdentity('zed')) => jsonClientConfig('zed', mcpUrl, identity);
export const zedJsonSnippet = (mcpUrl, identity = envReferenceIdentity('zed')) => jsonClientSnippet('zed', mcpUrl, identity);
export const zedJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('zed')) => jsonClientServerConfig('zed', mcpUrl, identity);
export const mergeZedMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('zed', configPath, mcpUrl, identity);

export const jetbrainsJsonConfig = (mcpUrl, identity = envReferenceIdentity('jetbrains')) => jsonClientConfig('jetbrains', mcpUrl, identity);
export const jetbrainsJsonSnippet = (mcpUrl, identity = envReferenceIdentity('jetbrains')) => jsonClientSnippet('jetbrains', mcpUrl, identity);
export const jetbrainsJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('jetbrains')) => jsonClientServerConfig('jetbrains', mcpUrl, identity);
export const mergeJetbrainsMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('jetbrains', configPath, mcpUrl, identity);

export const opencodeJsonConfig = (mcpUrl, identity = envReferenceIdentity('opencode')) => jsonClientConfig('opencode', mcpUrl, identity);
export const opencodeJsonSnippet = (mcpUrl, identity = envReferenceIdentity('opencode')) => jsonClientSnippet('opencode', mcpUrl, identity);
export const opencodeJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('opencode')) => jsonClientServerConfig('opencode', mcpUrl, identity);
export const mergeOpencodeMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('opencode', configPath, mcpUrl, identity);

export const qwenJsonConfig = (mcpUrl, identity = envReferenceIdentity('qwen')) => jsonClientConfig('qwen', mcpUrl, identity);
export const qwenJsonSnippet = (mcpUrl, identity = envReferenceIdentity('qwen')) => jsonClientSnippet('qwen', mcpUrl, identity);
export const qwenJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('qwen')) => jsonClientServerConfig('qwen', mcpUrl, identity);
export const mergeQwenMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('qwen', configPath, mcpUrl, identity);

export const traeJsonConfig = (mcpUrl, identity = envReferenceIdentity('trae')) => jsonClientConfig('trae', mcpUrl, identity);
export const traeJsonSnippet = (mcpUrl, identity = envReferenceIdentity('trae')) => jsonClientSnippet('trae', mcpUrl, identity);
export const traeJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('trae')) => jsonClientServerConfig('trae', mcpUrl, identity);
export const mergeTraeMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('trae', configPath, mcpUrl, identity);

export const traeSoloJsonConfig = (mcpUrl, identity = envReferenceIdentity('trae-solo')) => jsonClientConfig('trae-solo', mcpUrl, identity);
export const traeSoloJsonSnippet = (mcpUrl, identity = envReferenceIdentity('trae-solo')) => jsonClientSnippet('trae-solo', mcpUrl, identity);
export const traeSoloJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('trae-solo')) => jsonClientServerConfig('trae-solo', mcpUrl, identity);
export const mergeTraeSoloMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('trae-solo', configPath, mcpUrl, identity);

export const claudecodeJsonConfig = (mcpUrl, identity = envReferenceIdentity('claude-code')) => jsonClientConfig('claude-code', mcpUrl, identity);
export const claudecodeJsonSnippet = (mcpUrl, identity = envReferenceIdentity('claude-code')) => jsonClientSnippet('claude-code', mcpUrl, identity);
export const claudecodeJsonServerConfig = (mcpUrl, identity = envReferenceIdentity('claude-code')) => jsonClientServerConfig('claude-code', mcpUrl, identity);
export const mergeClaudecodeMcpConfig = (configPath, mcpUrl, identity) => mergeJsonClientMcpConfig('claude-code', configPath, mcpUrl, identity);

