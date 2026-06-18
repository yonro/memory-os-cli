import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { XMemoTool, errorResult, textResult, truncate } from './types';

/**
 * Explains why a memory matched or exists, by recalling it and wrapping the
 * result with provenance guidance.
 */
export const explainMemoryTool: XMemoTool = {
  id: 'xmemo_explain_memory',
  schema: {
    name: 'Explain XMemo memory',
    description: 'Explain why a memory matched or exists in XMemo. Use when the user asks "why did you recall this?" or wants provenance on a memory reference.',
    tags: ['xmemo', 'memory'],
    inputSchema: {
      type: 'object',
      properties: {
        reference: {
          type: 'string',
          description: 'A memory ID, path, or query that identifies the memory to explain.'
        }
      },
      required: ['reference']
    }
  },
  async invoke(options, _token, auth) {
    const client = await auth.getClient();
    if (!client) {
      return errorResult('Not signed in to XMemo.');
    }
    const input = options.input as { reference: string };
    try {
      const result = await client.recall(input.reference, 3);
      const explanation = [
        `Memory explanation for "${input.reference}":`,
        result.text || '(no memory found)',
        '',
        'Provenance: XMemo returns memories based on semantic similarity to your query, scoped to your authenticated account and workspace attribution headers. If this result looks wrong, use a more specific query or ask the user to verify.'
      ].join('\n');
      return textResult(truncate(explanation));
    } catch (error: any) {
      return errorResult(error?.message ?? String(error));
    }
  }
};
