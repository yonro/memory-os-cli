import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { XMemoTool, errorResult, textResult, truncate } from './types';

export const rememberTool: XMemoTool = {
  id: 'xmemo_remember',
  schema: {
    name: 'Remember in XMemo',
    description: 'Save an explicit user-approved decision, fact, or context into XMemo. Only use when the user explicitly asks to remember something.',
    tags: ['xmemo', 'memory'],
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The exact content to remember.'
        },
        path: {
          type: 'string',
          description: 'A file path, issue URL, or workspace-relative location to associate with the memory. Defaults to the active file path or workspace root.',
          default: ''
        }
      },
      required: ['content']
    }
  },
  async invoke(options, _token, auth) {
    const client = await auth.getClient();
    if (!client) {
      return errorResult('Not signed in to XMemo.');
    }
    const input = options.input as { content: string; path?: string };
    const path = input.path || vscode.window.activeTextEditor?.document.uri.fsPath || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'workspace');
    try {
      const result = await client.remember(input.content, path);
      return textResult(truncate(`Saved to XMemo:\n${result.text}`));
    } catch (error: any) {
      return errorResult(error?.message ?? String(error));
    }
  }
};
