import {
  appendTomlServerConfig,
  appendGrokServerConfig,
  codexTomlSnippet,
  grokTomlSnippet,
  removeTomlServerConfig
} from './formats/toml.js';
import {
  hermesYamlSnippet,
  mergeHermesMcpConfig,
  removeHermesMcpConfig
} from './formats/yaml.js';
import {
  JSON_MCP_CLIENT_DEFINITIONS,
  jsonClientSnippet,
  mergeJsonClientMcpConfig,
  removeJsonClientMcpConfig
} from './formats/json.js';
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
  defaultGrokConfigPath,
  defaultHermesConfigPath,
  defaultJetbrainsConfigPath,
  defaultKimiCodeConfigPath,
  defaultKiroConfigPath,
  defaultOpencodeConfigPath,
  defaultOpenclawConfigPath,
  defaultQwenConfigPath,
  defaultTraeConfigPath,
  defaultTraeSoloConfigPath,
  defaultWindsurfConfigPath,
  defaultZedConfigPath
} from '../config/paths.js';
import {
  createMcpClients,
  supportedMcpClientIds as registrySupportedMcpClientIds,
  supportedMcpClients as registrySupportedMcpClients
} from './clients/registry.js';

export const MCP_CLIENTS = createMcpClients({
  JSON_MCP_CLIENT_DEFINITIONS,
  defaultCodexConfigPath,
  codexTomlSnippet,
  appendTomlServerConfig,
  removeTomlServerConfig,
  defaultGrokConfigPath,
  grokTomlSnippet,
  appendGrokServerConfig,
  defaultHermesConfigPath,
  hermesYamlSnippet,
  mergeHermesMcpConfig,
  removeHermesMcpConfig,
  jsonClientSnippet,
  mergeJsonClientMcpConfig,
  removeJsonClientMcpConfig,
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
  defaultKimiCodeConfigPath,
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

