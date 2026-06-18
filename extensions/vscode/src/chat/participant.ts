import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { MemoriesTreeProvider } from '../views/memoriesTree';

export function registerXMemoChatParticipant(context: vscode.ExtensionContext, auth: XMemoAuth, tree: MemoriesTreeProvider): void {
  const chat: any = (vscode as any).chat;
  if (!chat || typeof chat.createChatParticipant !== 'function') {
    console.warn('XMemo: Chat Participant API not available in this VS Code version.');
    return;
  }

  const participant = chat.createChatParticipant('xmemo', async (request: vscode.ChatRequest, response: vscode.ChatResponseStream, _token: vscode.CancellationToken) => {
    const command = request.command;
    const prompt = request.prompt.trim();

    if (command === 'status' || (!command && prompt.toLowerCase() === 'status')) {
      const signedIn = await auth.isSignedIn();
      const cfg = vscode.workspace.getConfiguration('xmemo');
      response.markdown(`**XMemo status**\n\n`);
      response.markdown(`- Signed in: ${signedIn ? 'yes' : 'no'}\n`);
      response.markdown(`- Service URL: ${cfg.get<string>('apiBaseUrl') ?? 'https://xmemo.dev'}\n`);
      response.markdown(`- Agent ID: ${cfg.get<string>('agentId') ?? 'vscode'}\n`);
      response.markdown(`- VS Code-native MCP provider: registered (XMemo)\n`);
      response.markdown(`- Language Model Tools: xmemo_recall, xmemo_search_memory, xmemo_context_pack, xmemo_remember, xmemo_explain_memory\n`);
      if (!signedIn) {
        response.button({ command: 'xmemo.signIn', title: 'Sign in to XMemo' });
      }
      return;
    }

    if (command === 'recall' || (!command && prompt.toLowerCase().startsWith('recall'))) {
      const query = command === 'recall' ? prompt : prompt.replace(/^recall\s*/i, '');
      if (!query) {
        response.markdown('Usage: `@xmemo /recall <query>`');
        return;
      }
      const client = await auth.getClient();
      if (!client) {
        response.markdown('Not signed in to XMemo. Use `@xmemo /status` to sign in.');
        return;
      }
      try {
        const result = await client.recall(query, 3);
        response.markdown(`**Recall: "${query}"**\n\n${result.text || '(no memories found)'}`);
      } catch (error: any) {
        response.markdown(`Error: ${error?.message ?? String(error)}`);
      }
      return;
    }

    if (command === 'remember' || (!command && prompt.toLowerCase().startsWith('remember'))) {
      const content = command === 'remember' ? prompt : prompt.replace(/^remember\s*/i, '');
      if (!content) {
        response.markdown('Usage: `@xmemo /remember <fact>`');
        return;
      }
      const client = await auth.getClient();
      if (!client) {
        response.markdown('Not signed in to XMemo. Use `@xmemo /status` to sign in.');
        return;
      }
      const path = vscode.window.activeTextEditor?.document.uri.fsPath || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'workspace');
      try {
        const result = await client.remember(content, path);
        response.markdown(`**Remembered**\n\n${result.text || 'Saved to XMemo.'}`);
        tree.refresh();
      } catch (error: any) {
        response.markdown(`Error: ${error?.message ?? String(error)}`);
      }
      return;
    }

    if (command === 'agents' || (!command && prompt.toLowerCase() === 'agents')) {
      response.markdown('Open the **XMemo Agent Integrations** view from the activity bar to see detected agents and connect them.');
      response.button({ command: 'xmemo.showAgentIntegrations', title: 'Show Agent Integrations' });
      return;
    }

    if (command === 'explain' || (!command && prompt.toLowerCase().startsWith('explain'))) {
      const reference = command === 'explain' ? prompt : prompt.replace(/^explain\s*/i, '');
      if (!reference) {
        response.markdown('Usage: `@xmemo /explain <memory reference>`');
        return;
      }
      const client = await auth.getClient();
      if (!client) {
        response.markdown('Not signed in to XMemo. Use `@xmemo /status` to sign in.');
        return;
      }
      try {
        const result = await client.recall(reference, 3);
        response.markdown(`**Explain: "${reference}"**\n\n${result.text || '(no memory found)'}\n\nProvenance: results are ranked by semantic similarity to your query and scoped to your authenticated account.`);
      } catch (error: any) {
        response.markdown(`Error: ${error?.message ?? String(error)}`);
      }
      return;
    }

    response.markdown(
      '**@xmemo** — XMemo agent memory assistant\n\n' +
      'Available commands:\n' +
      '- `@xmemo /status` — show sign-in, MCP, and integration state\n' +
      '- `@xmemo /recall <query>` — recall relevant memories\n' +
      '- `@xmemo /remember <fact>` — save a memory\n' +
      '- `@xmemo /explain <reference>` — explain why a memory matched\n' +
      '- `@xmemo /agents` — open the Agent Integrations panel\n\n' +
      'You can also invoke XMemo tools directly from VS Code agent mode: `xmemo_recall`, `xmemo_search_memory`, `xmemo_context_pack`, `xmemo_remember`, `xmemo_explain_memory`.'
    );
  });

  participant.iconPath = new vscode.ThemeIcon('lightbulb');
  context.subscriptions.push(participant);
}
