import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { AGENT_ID_HEADER, AGENT_INSTANCE_HEADER, DEFAULT_AGENT_ID, DEFAULT_SERVICE_URL } from '../constants';

const PROVIDER_ID = 'xmemo.mcp';

/**
 * Contributes XMemo to VS Code's native MCP/agent-mode surface.
 *
 * This provider is intentionally scoped to VS Code's own MCP registry. Adjacent
 * agent extensions such as Claude Code, Codex, Cursor, or Windsurf only gain
 * XMemo memory if they consume VS Code MCP definitions or are configured through
 * their own MCP settings.
 *
 * Token handling: the eager discovery path returns a token-free server
 * definition. VS Code calls provideMcpServerDefinitions eagerly and that path
 * must not require auth. When VS Code actually starts the server, the optional
 * resolveMcpServerDefinition path asks the AuthenticationProvider for a session
 * and injects the bearer header in memory. The token is not written to settings,
 * mcp.json, or logs.
 */
export interface McpServerProvider {
  onDidChangeMcpServerDefinitions: vscode.Event<void>;
  provideMcpServerDefinitions(): Promise<any[]>;
  resolveMcpServerDefinition(server: any): Promise<any | undefined>;
  dispose(): void;
}

export function createMcpServerProvider(auth: XMemoAuth): McpServerProvider {
  const didChange = new vscode.EventEmitter<void>();
  const authDisposable = auth.onDidChange(() => didChange.fire());
  const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('xmemo.apiBaseUrl') || event.affectsConfiguration('xmemo.agentId')) {
      didChange.fire();
    }
  });

  return {
    onDidChangeMcpServerDefinitions: didChange.event,
    provideMcpServerDefinitions: async () => {
      return [definition()];
    },
    resolveMcpServerDefinition: async () => {
      const token = await auth.getTokenOrSignIn();
      if (!token) {
        return undefined;
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        [AGENT_ID_HEADER]: agentId(),
        [AGENT_INSTANCE_HEADER]: await auth.agentInstanceId()
      };
      return definition(headers);
    },
    dispose: () => {
      authDisposable.dispose();
      configDisposable.dispose();
      didChange.dispose();
    }
  };
}

export function registerMcpServerProvider(context: vscode.ExtensionContext, auth: XMemoAuth): void {
  const lm: any = (vscode as any).lm;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== 'function') {
    return;
  }

  const provider = createMcpServerProvider(auth);
  context.subscriptions.push(provider);

  try {
    context.subscriptions.push(lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider));
  } catch (error) {
    console.warn('XMemo: MCP server provider registration skipped:', error);
  }
}

function mcpUri(): vscode.Uri {
  const cfg = vscode.workspace.getConfiguration('xmemo');
  const baseUrl = (cfg.get<string>('apiBaseUrl') || DEFAULT_SERVICE_URL).replace(/\/$/, '');
  return vscode.Uri.parse(`${baseUrl}/mcp`);
}

function agentId(): string {
  const cfg = vscode.workspace.getConfiguration('xmemo');
  return cfg.get<string>('agentId') || DEFAULT_AGENT_ID;
}

function definition(headers?: Record<string, string>): any {
  const Http = (vscode as any).McpHttpServerDefinition;
  if (typeof Http === 'function') {
    return new Http('XMemo', mcpUri(), headers);
  }
  const def: any = { label: 'XMemo', uri: mcpUri() };
  if (headers) {
    def.headers = headers;
  }
  return def;
}
