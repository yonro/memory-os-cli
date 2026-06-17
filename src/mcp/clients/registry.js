import { JSON_MCP_CLIENT_DEFINITIONS } from '../formats/json.js';

export function createMcpClients(deps) {
  const clients = new Map();

  clients.set('codex', {
    label: 'Codex',
    defaultConfigPath: deps.defaultCodexConfigPath,
    buildSnippet: deps.codexTomlSnippet,
    writeConfig: (configPath, mcpUrl, identity, options = {}) => deps.appendTomlServerConfig(configPath, mcpUrl, identity, options.force),
    removeConfig: (configPath, options = {}) => deps.removeTomlServerConfig(configPath, options),
    configKind: 'toml'
  });

  clients.set('grok', {
    label: 'Grok',
    defaultConfigPath: deps.defaultGrokConfigPath,
    buildSnippet: deps.grokTomlSnippet,
    writeConfig: (configPath, mcpUrl, identity, options = {}) => deps.appendGrokServerConfig(configPath, mcpUrl, identity, options.force),
    removeConfig: (configPath, options = {}) => deps.removeTomlServerConfig(configPath, options),
    configKind: 'toml'
  });

  for (const definition of deps.JSON_MCP_CLIENT_DEFINITIONS) {
    if (definition.id === 'qwen') {
      clients.set('hermes', hermesClient(deps));
    }
    clients.set(definition.id, jsonClient(definition, deps));
  }

  if (!clients.has('hermes')) {
    clients.set('hermes', hermesClient(deps));
  }

  return clients;
}

function jsonClient(definition, deps) {
  return {
    label: definition.label,
    defaultConfigPath: deps[definition.defaultConfigPath],
    buildSnippet: (mcpUrl, identity) => deps.jsonClientSnippet(definition.id, mcpUrl, identity),
    writeConfig: (configPath, mcpUrl, identity, options = {}) => deps.mergeJsonClientMcpConfig(definition.id, configPath, mcpUrl, identity, options.force),
    removeConfig: (configPath, options = {}) => deps.removeJsonClientMcpConfig(definition.id, configPath, options),
    configKind: definition.configKind,
    authentication: definition.authentication
  };
}

function hermesClient(deps) {
  return {
    label: 'Hermes',
    defaultConfigPath: deps.defaultHermesConfigPath,
    buildSnippet: deps.hermesYamlSnippet,
    writeConfig: (configPath, mcpUrl, identity, options = {}) => deps.mergeHermesMcpConfig(configPath, mcpUrl, identity, options.force),
    removeConfig: (configPath, options = {}) => deps.removeHermesMcpConfig(configPath, options),
    configKind: 'yaml'
  };
}

export function supportedMcpClients(mcpClients) {
  const clients = Array.from(mcpClients.entries()).map(([id, client]) => ({
    id,
    label: client.label,
    configKind: client.configKind
  }));
  clients.push({ id: 'copilot-cli', label: 'Copilot CLI', configKind: 'local-proxy' });
  return clients;
}

export function supportedMcpClientIds(mcpClients) {
  return Array.from(mcpClients.keys());
}

export function usesClientOAuth(clientId) {
  return JSON_MCP_CLIENT_DEFINITIONS.some(
    (definition) => definition.id === clientId && definition.authentication === 'oauth'
  );
}

