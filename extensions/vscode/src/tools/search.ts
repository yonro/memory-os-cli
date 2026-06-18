import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { XMemoTool, errorResult, textResult, truncate } from './types';

export const searchTool: XMemoTool = {
  id: 'xmemo_search_memory',
  schema: {
    name: 'Search XMemo memory',
    description: 'Search XMemo memories with filters and return compact, cited snippets. Use when you need multiple matching memories rather than the single best match.',
    tags: ['xmemo', 'memory'],
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results. Default 5.',
          default: 5
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
      const result = await client.search(input.query, input.limit ?? 5);
      return textResult(truncate(`Search results for "${input.query}":\n${result.text}`));
    } catch (error: any) {
      return errorResult(error?.message ?? String(error));
    }
  }
};
