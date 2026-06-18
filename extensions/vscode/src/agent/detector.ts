import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentClientDefinition, AgentClientState, AgentStatus } from './types';

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export const AGENT_CLIENTS: AgentClientDefinition[] = [
  {
    id: 'vscode-mcp',
    label: 'VS Code User MCP',
    configKind: 'json',
    defaultConfigPath: () => {
      const home = homeDir();
      if (process.platform === 'win32') {
        return path.join(process.env.USERPROFILE || home, '.vscode', 'mcp.json');
      }
      if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
      }
      return path.join(home, '.config', 'Code', 'User', 'mcp.json');
    }
  },
  {
    id: 'codex',
    label: 'Codex',
    configKind: 'toml',
    defaultConfigPath: () => path.join(homeDir(), '.codex', 'config.toml')
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    configKind: 'json',
    defaultConfigPath: () => path.join(homeDir(), '.claude.json')
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configKind: 'json',
    defaultConfigPath: () => path.join(homeDir(), '.cursor', 'mcp.json')
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    configKind: 'json',
    defaultConfigPath: () => path.join(homeDir(), '.codeium', 'windsurf', 'mcp_config.json')
  },
  {
    id: 'cline',
    label: 'Cline',
    configKind: 'json',
    defaultConfigPath: () => path.join(homeDir(), 'Documents', 'Cline', 'MCP', 'cline_mcp_settings.json')
  },
  {
    id: 'continue',
    label: 'Continue',
    configKind: 'json',
    defaultConfigPath: () => path.join(homeDir(), '.continue', 'config.json')
  }
];

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return undefined;
  }
}

function looksLikeXMemoConfig(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('xmemo') || lower.includes('xmemo.dev') || lower.includes('x-memo-os-agent-id');
}

function detectJsonXMemo(configPath: string): boolean {
  const text = readText(configPath);
  if (!text) {
    return false;
  }
  if (!looksLikeXMemoConfig(text)) {
    return false;
  }
  try {
    const parsed = JSON.parse(text) as any;
    return hasXMemoServerDeep(parsed);
  } catch {
    return false;
  }
}

function hasXMemoServerDeep(obj: any): boolean {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  if (Array.isArray(obj)) {
    return obj.some(hasXMemoServerDeep);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (typeof key === 'string' && key.toLowerCase().includes('xmemo')) {
      return true;
    }
    if (typeof value === 'string' && (value.includes('xmemo.dev') || value.toLowerCase().includes('xmemo'))) {
      return true;
    }
    if (value && typeof value === 'object' && hasXMemoServerDeep(value)) {
      return true;
    }
  }
  return false;
}

function detectPlainXMemo(configPath: string): boolean {
  const text = readText(configPath);
  return text ? looksLikeXMemoConfig(text) : false;
}

export async function detectAgentClients(): Promise<AgentClientState[]> {
  const results: AgentClientState[] = [];
  for (const definition of AGENT_CLIENTS) {
    const configPath = definition.defaultConfigPath();
    const exists = fileExists(configPath);
    let status: AgentStatus;
    let detail: string | undefined;

    if (!exists) {
      status = 'config-missing';
      detail = 'Config file not found';
    } else if (definition.configKind === 'json') {
      const connected = detectJsonXMemo(configPath);
      status = connected ? 'connected' : 'config-found';
      detail = connected ? 'XMemo server configured' : 'Config exists, XMemo not found';
    } else {
      const connected = detectPlainXMemo(configPath);
      status = connected ? 'connected' : 'config-found';
      detail = connected ? 'XMemo server configured' : 'Config exists, XMemo not found';
    }

    results.push({ definition, status, configPath, detail });
  }
  return results;
}

export function statusIcon(status: AgentStatus): string {
  switch (status) {
    case 'connected':
      return '$(pass)';
    case 'config-found':
      return '$(warning)';
    case 'config-missing':
      return '$(circle-outline)';
    case 'unsupported':
      return '$(exclude)';
    default:
      return '$(question)';
  }
}
