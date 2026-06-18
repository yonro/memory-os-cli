import * as fs from 'fs';
import * as path from 'path';

const MCP_SERVER_NAME = 'XMemo';
const AGENT_ID_HEADER = 'X-Memory-OS-Agent-ID';
const AGENT_INSTANCE_HEADER = 'X-Memory-OS-Agent-Instance-ID';
const TOKEN_ENV_VAR = 'XMEMO_KEY';

export interface AgentIdentity {
  agentId: string;
  agentInstanceId: string;
}

export interface WriteResult {
  written: boolean;
  preview: string;
  message: string;
}

export type JsonClientId = 'vscode-mcp' | 'cursor' | 'windsurf' | 'cline' | 'continue' | 'claude-code';

interface ClientWriter {
  id: JsonClientId;
  label: string;
  section: string;
  buildServerConfig: (mcpUrl: string, identity: AgentIdentity) => unknown;
  detectExisting: (parsed: any) => boolean;
}

function headersFor(identity: AgentIdentity): Record<string, string> {
  return {
    [AGENT_ID_HEADER]: identity.agentId,
    [AGENT_INSTANCE_HEADER]: identity.agentInstanceId
  };
}

function httpServerConfig(urlKey: string, mcpUrl: string, identity: AgentIdentity): Record<string, unknown> {
  return {
    [urlKey]: mcpUrl,
    headers: {
      Authorization: `Bearer \${${TOKEN_ENV_VAR}}`,
      ...headersFor(identity)
    }
  };
}

function nestedTransportServerConfig(mcpUrl: string, identity: AgentIdentity): Record<string, unknown> {
  return {
    transport: {
      type: 'streamable-http',
      url: mcpUrl,
      headers: headersFor(identity)
    }
  };
}

function claudeCodeServerConfig(mcpUrl: string, identity: AgentIdentity): Record<string, unknown> {
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
      `${AGENT_INSTANCE_HEADER}:\${${TOKEN_ENV_VAR}_INSTANCE_ID}`
    ],
    env: {
      [TOKEN_ENV_VAR]: `\${${TOKEN_ENV_VAR}}`,
      [`${TOKEN_ENV_VAR}_INSTANCE_ID`]: identity.agentInstanceId
    }
  };
}

const JSON_CLIENT_WRITERS: ClientWriter[] = [
  {
    id: 'vscode-mcp',
    label: 'VS Code User MCP',
    section: 'mcpServers',
    buildServerConfig: (mcpUrl, identity) => httpServerConfig('url', mcpUrl, identity),
    detectExisting: (parsed) => isPlainObject(parsed?.mcpServers?.[MCP_SERVER_NAME])
  },
  {
    id: 'cursor',
    label: 'Cursor',
    section: 'mcpServers',
    buildServerConfig: (mcpUrl, identity) => httpServerConfig('url', mcpUrl, identity),
    detectExisting: (parsed) => isPlainObject(parsed?.mcpServers?.[MCP_SERVER_NAME])
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    section: 'mcpServers',
    buildServerConfig: (mcpUrl, identity) => httpServerConfig('serverUrl', mcpUrl, identity),
    detectExisting: (parsed) => isPlainObject(parsed?.mcpServers?.[MCP_SERVER_NAME])
  },
  {
    id: 'cline',
    label: 'Cline',
    section: 'mcpServers',
    buildServerConfig: (mcpUrl, identity) => httpServerConfig('httpUrl', mcpUrl, identity),
    detectExisting: (parsed) => isPlainObject(parsed?.mcpServers?.[MCP_SERVER_NAME])
  },
  {
    id: 'continue',
    label: 'Continue',
    section: 'mcpServers',
    buildServerConfig: (mcpUrl, identity) => nestedTransportServerConfig(mcpUrl, identity),
    detectExisting: (parsed) => isPlainObject(parsed?.mcpServers?.[MCP_SERVER_NAME])
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    section: 'mcpServers',
    buildServerConfig: claudeCodeServerConfig,
    detectExisting: (parsed) => isPlainObject(parsed?.mcpServers?.[MCP_SERVER_NAME])
  }
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(configPath: string): any {
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    if (text.trim().length === 0) {
      return {};
    }
    return JSON.parse(text);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw new Error(`Cannot read ${configPath}: ${error?.message ?? error}`);
  }
}

export function isJsonClient(clientId: string): clientId is JsonClientId {
  return JSON_CLIENT_WRITERS.some((writer) => writer.id === clientId);
}

export function connectClient(
  clientId: JsonClientId,
  configPath: string,
  mcpUrl: string,
  identity: AgentIdentity,
  options: { force?: boolean; preview?: boolean } = {}
): WriteResult {
  const writer = JSON_CLIENT_WRITERS.find((w) => w.id === clientId);
  if (!writer) {
    throw new Error(`Unsupported JSON client: ${clientId}`);
  }

  const parsed = readJsonFile(configPath) as Record<string, any>;
  if (!isPlainObject(parsed)) {
    throw new Error(`MCP config must be a JSON object: ${configPath}`);
  }

  if (!isPlainObject(parsed[writer.section])) {
    parsed[writer.section] = {};
  }

  const existing = writer.detectExisting(parsed);
  if (existing && !options.force) {
    return {
      written: false,
      preview: JSON.stringify(parsed, null, 2),
      message: `${writer.label} already has an XMemo entry. Use force to overwrite.`
    };
  }

  (parsed[writer.section] as Record<string, any>)[MCP_SERVER_NAME] = writer.buildServerConfig(mcpUrl, identity);
  const preview = JSON.stringify(parsed, null, 2);

  if (!options.preview) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${preview}\n`);
  }

  return {
    written: !options.preview,
    preview,
    message: options.preview
      ? `Preview of ${writer.label} config`
      : `Connected ${writer.label} to XMemo.`
  };
}

export function disconnectClient(clientId: JsonClientId, configPath: string, options: { preview?: boolean } = {}): WriteResult {
  const writer = JSON_CLIENT_WRITERS.find((w) => w.id === clientId);
  if (!writer) {
    throw new Error(`Unsupported JSON client: ${clientId}`);
  }

  const parsed = readJsonFile(configPath);
  if (!isPlainObject(parsed)) {
    return { written: false, preview: '{}', message: 'Config file is not a JSON object.' };
  }

  const section = parsed[writer.section];
  if (!isPlainObject(section) || !(MCP_SERVER_NAME in section)) {
    return { written: false, preview: JSON.stringify(parsed, null, 2), message: 'XMemo entry not found.' };
  }

  delete section[MCP_SERVER_NAME];
  const preview = JSON.stringify(parsed, null, 2);

  if (!options.preview) {
    fs.writeFileSync(configPath, `${preview}\n`);
  }

  return {
    written: !options.preview,
    preview,
    message: options.preview
      ? `Preview after disconnecting ${writer.label}`
      : `Disconnected ${writer.label} from XMemo.`
  };
}

export function redactedPreview(preview: string): string {
  return preview
    .replace(/(Authorization\s*[:=]\s*["']?)Bearer\s+[^\s"']+/gi, '$1Bearer <redacted>')
    .replace(new RegExp(`"${TOKEN_ENV_VAR}"\\s*:\\s*"[^"]*"`, 'g'), `"${TOKEN_ENV_VAR}": "<redacted>"`);
}
