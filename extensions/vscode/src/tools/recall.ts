import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { XMemoTool, errorResult, textResult, truncate, workspaceHints } from './types';

export const recallTool: XMemoTool = {
  id: 'xmemo_recall',
  schema: {
    name: 'Recall XMemo memory',
    description: 'Retrieve the most relevant XMemo memory for the current task or question. Use when the user asks about a past decision, context, or project history that may have been saved before.',
    tags: ['xmemo', 'memory'],
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A concise natural-language query describing what you are trying to recall.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return. Default 3.',
          default: 3
        }
      },
      required: ['query']
    }
  },
  async invoke(options, _token, auth) {
    const client = await auth.getClient();
    if (!client) {
      return errorResult('Not signed in to XMemo.');
    }
    const input = options.input as { query: string; limit?: number };
    try {
      const result = await client.recall(input.query, input.limit ?? 3);
      const hints = workspaceHints();
      return textResult(truncate([`Relevant memories for "${input.query}":`, result.text, '', 'Workspace context:', hints].join('\n')));
    } catch (error: any) {
      return errorResult(error?.message ?? String(error));
    }
  }
};
