export type AgentStatus = 'connected' | 'config-found' | 'config-missing' | 'unsupported' | 'unknown';

export interface AgentClientDefinition {
  id: string;
  label: string;
  configKind: 'json' | 'toml' | 'yaml' | 'vscode-mcp' | 'unknown';
  defaultConfigPath: () => string;
}

export interface AgentClientState {
  definition: AgentClientDefinition;
  status: AgentStatus;
  configPath: string;
  detail?: string;
}

export interface XMemoMcpConfig {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}
