import {
  appendTomlServerConfig,
  codexTomlSnippet
} from './codex.js';
import {
  hermesYamlSnippet,
  mergeHermesMcpConfig
} from './hermes.js';
import {
  JSON_MCP_CLIENT_DEFINITIONS,
  jsonClientSnippet,
  mergeJsonClientMcpConfig
} from './json-clients.js';
import {
  defaultAntigravity2ConfigPath,
  defaultAntigravityCliConfigPath,
  defaultAntigravityConfigPath,
  defaultAntigravityIdeConfigPath,
  defaultClaudeConfigPath,
  defaultClaudecodeConfigPath,
  defaultClineConfigPath,
  defaultCodexConfigPath,
  defaultContinueConfigPath,
  defaultCursorConfigPath,
  defaultGeminiConfigPath,
  defaultHermesConfigPath,
  defaultJetbrainsConfigPath,
  defaultKiroConfigPath,
  defaultOpencodeConfigPath,
  defaultOpenclawConfigPath,
  defaultQwenConfigPath,
  defaultTraeConfigPath,
  defaultTraeSoloConfigPath,
  defaultWindsurfConfigPath,
  defaultZedConfigPath
} from '../path-config.js';
import {
  createMcpClients,
  supportedMcpClientIds as registrySupportedMcpClientIds,
  supportedMcpClients as registrySupportedMcpClients
} from './registry.js';

export const MCP_CLIENTS = createMcpClients({
  JSON_MCP_CLIENT_DEFINITIONS,
  defaultCodexConfigPath,
  codexTomlSnippet,
  appendTomlServerConfig,
  defaultHermesConfigPath,
  hermesYamlSnippet,
  mergeHermesMcpConfig,
  jsonClientSnippet,
  mergeJsonClientMcpConfig,
  defaultCursorConfigPath,
  defaultGeminiConfigPath,
  defaultAntigravityConfigPath,
  defaultAntigravityIdeConfigPath,
  defaultAntigravity2ConfigPath,
  defaultAntigravityCliConfigPath,
  defaultWindsurfConfigPath,
  defaultClineConfigPath,
  defaultContinueConfigPath,
  defaultClaudeConfigPath,
  defaultOpenclawConfigPath,
  defaultKiroConfigPath,
  defaultZedConfigPath,
  defaultJetbrainsConfigPath,
  defaultOpencodeConfigPath,
  defaultQwenConfigPath,
  defaultTraeConfigPath,
  defaultTraeSoloConfigPath,
  defaultClaudecodeConfigPath
});

export function supportedMcpClients() {
  return registrySupportedMcpClients(MCP_CLIENTS);
}

export function supportedMcpClientIds() {
  return registrySupportedMcpClientIds(MCP_CLIENTS);
}
