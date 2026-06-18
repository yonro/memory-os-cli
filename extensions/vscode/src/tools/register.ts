import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { contextPackTool } from './contextPack';
import { explainMemoryTool } from './explain';
import { recallTool } from './recall';
import { rememberTool } from './remember';
import { searchTool } from './search';
import { XMemoTool } from './types';

const TOOLS: XMemoTool[] = [recallTool, searchTool, rememberTool, contextPackTool, explainMemoryTool];

export function registerLanguageModelTools(context: vscode.ExtensionContext, auth: XMemoAuth): void {
  const lm: any = (vscode as any).lm;
  if (!lm || typeof lm.registerTool !== 'function') {
    console.warn('XMemo: Language Model Tools API not available in this VS Code version.');
    return;
  }

  for (const tool of TOOLS) {
    const disposable = lm.registerTool(tool.id, {
      prepareInvocation: async (options: vscode.LanguageModelToolInvocationPrepareOptions<unknown>) => {
        const params = options.input as Record<string, unknown> | undefined;
        const confirmed = params?.confirmed === true;
        if (tool.id === 'xmemo_remember' && !confirmed) {
          return {
            invocationMessage: `Save memory to XMemo: "${String(params?.content ?? '').slice(0, 80)}..."`,
            confirmationMessages: {
              title: 'Allow saving to XMemo?',
              message: `The model wants to save the following memory:\n\n${String(params?.content ?? '')}\n\nIt will be stored in your XMemo account.`
            }
          };
        }
        return { invocationMessage: `Using XMemo: ${tool.schema.name}` };
      },
      invoke: async (options: vscode.LanguageModelToolInvocationOptions<unknown>, token: vscode.CancellationToken) => {
        return tool.invoke(options, token, auth);
      }
    });
    context.subscriptions.push(disposable);
  }
}
