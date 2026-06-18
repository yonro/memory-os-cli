import * as vscode from 'vscode';
import { XMemoAuth } from './auth/xmemoAuthProvider';
import { rememberCommand } from './commands/remember';
import { recallCommand } from './commands/recall';
import { searchCommand } from './commands/search';
import { saveSelectionCommand } from './commands/saveSelection';
import { MemoriesTreeProvider } from './views/memoriesTree';
import { registerMcpServerProvider } from './mcp/serverProvider';
import { registerLanguageModelTools } from './tools/register';
import { registerXMemoChatParticipant } from './chat/participant';
import { registerAgentIntegrationsView } from './agent/agentIntegrationsTree';

export function activate(context: vscode.ExtensionContext): void {
  const auth = new XMemoAuth(context);

  const tree = new MemoriesTreeProvider(auth);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('xmemo.memories', tree));

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'xmemo.recall';
  context.subscriptions.push(status);

  const refreshStatus = async () => {
    const signedIn = await auth.isSignedIn();
    status.text = signedIn ? '$(lightbulb) XMemo' : '$(lightbulb) XMemo: Sign in';
    status.tooltip = signedIn ? 'XMemo: recall a memory' : 'Sign in to XMemo';
    status.show();
  };
  context.subscriptions.push(auth.onDidChange(() => void refreshStatus()));
  void refreshStatus();

  // MCP server contribution (agent gains memory). Feature-detected.
  registerMcpServerProvider(context, auth);

  // Language Model Tools for VS Code-native agent mode.
  registerLanguageModelTools(context, auth);

  // @xmemo chat participant for diagnostics and quick commands.
  registerXMemoChatParticipant(context, auth, tree);

  // Agent Integrations panel for detecting and connecting adjacent agents.
  registerAgentIntegrationsView(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('xmemo.signIn', () => auth.signIn()),
    vscode.commands.registerCommand('xmemo.signOut', () => auth.signOut()),
    vscode.commands.registerCommand('xmemo.remember', () => rememberCommand(auth, () => tree.refresh())),
    vscode.commands.registerCommand('xmemo.recall', () => recallCommand(auth, tree)),
    vscode.commands.registerCommand('xmemo.searchMemory', () => searchCommand(auth, tree)),
    vscode.commands.registerCommand('xmemo.saveSelection', () => saveSelectionCommand(auth, () => tree.refresh())),
    vscode.commands.registerCommand('xmemo.refreshMemories', () => tree.refresh()),
    vscode.commands.registerCommand('xmemo.copyMemory', async (text?: string) => {
      if (text) {
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('XMemo: copied to clipboard.');
      }
    })
  );
}

export function deactivate(): void {
  /* no-op */
}
