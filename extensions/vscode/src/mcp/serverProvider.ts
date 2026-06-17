import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { AGENT_ID_HEADER, AGENT_INSTANCE_HEADER, DEFAULT_AGENT_ID, DEFAULT_SERVICE_URL } from '../constants';

const PROVIDER_ID = 'xmemo.mcp';

/**
 * Contributes the XMemo MCP server to the editor's AI agent (Copilot Chat /
 * Cursor / Windsurf), so the agent itself gains memory.
 *
 * Token handling: the bearer token is supplied to the McpHttpServerDefinition
 * headers at runtime, read fresh from the AuthenticationProvider on each
 * provideMcpServerDefinitions call. It is NOT written to settings.json or any
 * on-disk MCP config, and is never logged. VS Code holds the definition in
 * memory and sends it to https://xmemo.dev/mcp over TLS only. When the user
 * signs out, onDidChange fires and the definition list becomes empty.
 *
 * Requires the MCP API (VS Code 1.101+); declared via engines.vscode and the
 * contributes.mcpServerDefinitionProviders point. Still feature-detected so a
 * fork lacking the API degrades to the native commands instead of throwing.
 */
export function registerMcpServerProvider(context: vscode.ExtensionContext, auth: XMemoAuth): void {
  const lm: any = (vscode as any).lm;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== 'function') {
    return;
  }

  const didChange = new vscode.EventEmitter<void>();
  context.subscriptions.push(didChange, auth.onDidChange(() => didChange.fire()));

  const provider = {
    onDidChangeMcpServerDefinitions: didChange.event,
    provideMcpServerDefinitions: async () => {
      const token = await auth.getToken();
      if (!token) {
        return [];
      }
      const cfg = vscode.workspace.getConfiguration('xmemo');
      const baseUrl = (cfg.get<string>('apiBaseUrl') || DEFAULT_SERVICE_URL).replace(/\/$/, '');
      const agentId = cfg.get<string>('agentId') || DEFAULT_AGENT_ID;
      const uri = vscode.Uri.parse(`${baseUrl}/mcp`);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        [AGENT_ID_HEADER]: agentId,
        [AGENT_INSTANCE_HEADER]: await auth.agentInstanceId()
      };

      const Http = (vscode as any).McpHttpServerDefinition;
      if (typeof Http === 'function') {
        return [new Http('XMemo', uri, headers)];
      }
      return [{ label: 'XMemo', uri, headers }];
    }
  };

  try {
    context.subscriptions.push(lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider));
  } catch (error) {
    console.warn('XMemo: MCP server provider registration skipped:', error);
  }
}
