import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { XMemoTool, errorResult, textResult, truncate, workspaceHints } from './types';

/**
 * Builds a task-scoped context pack from memory + workspace hints.
 * This is implemented on top of search_memory so it works without a dedicated
 * server-side context_pack tool.
 */
export const contextPackTool: XMemoTool = {
  id: 'xmemo_context_pack',
  schema: {
    name: 'Build XMemo context pack',
    description: 'Build a task-scoped context pack from XMemo memory plus current workspace hints. Use before starting a complex task to load relevant prior decisions.',
    tags: ['xmemo', 'memory'],
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A one-sentence description of the task the user wants to perform.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memory entries. Default 5.',
          default: 5
        }
      },
      required: ['task']
    }
  },
  async invoke(options, _token, auth) {
    const client = await auth.getClient();
    if (!client) {
      return errorResult('Not signed in to XMemo.');
    }
    const input = options.input as { task: string; limit?: number };
    try {
      const result = await client.search(input.task, input.limit ?? 5);
      const hints = workspaceHints();
      const pack = [
        '# XMemo context pack',
        `task: ${input.task}`,
        '',
        '## Workspace context',
        hints || '(no workspace open)',
        '',
        '## Relevant memories',
        result.text || '(none found)',
        '',
        'Use the memories above as prior project context. Ask the user before acting on destructive or security-sensitive items.'
      ].join('\n');
      return textResult(truncate(pack));
    } catch (error: any) {
      return errorResult(error?.message ?? String(error));
    }
  }
};
