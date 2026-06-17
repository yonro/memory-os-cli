import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { MemoriesTreeProvider } from '../views/memoriesTree';
import { splitMemories } from './recall';

export async function searchCommand(auth: XMemoAuth, tree: MemoriesTreeProvider): Promise<void> {
  const client = await auth.getClient();
  if (!client) {
    const pick = await vscode.window.showWarningMessage('XMemo: not signed in.', 'Sign In');
    if (pick === 'Sign In') {
      await vscode.commands.executeCommand('xmemo.signIn');
    }
    return;
  }

  const query = await vscode.window.showInputBox({
    title: 'XMemo: Search Memory',
    prompt: 'Search your XMemo memories',
    ignoreFocusOut: true,
    placeHolder: 'e.g. deployment, API conventions'
  });
  if (!query?.trim()) {
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'XMemo: searching...' },
    async () => {
      try {
        return await client.search(query.trim());
      } catch (error: any) {
        vscode.window.showErrorMessage(`XMemo: ${error?.message ?? error}`);
        return undefined;
      }
    }
  );
  if (!result) {
    return;
  }

  const items = result.text ? splitMemories(result.text) : [];
  tree.refresh(items, `search: ${query.trim()}`);
  if (items.length === 0) {
    vscode.window.showInformationMessage('XMemo: no matches.');
  } else {
    vscode.window.showInformationMessage(`XMemo: ${items.length} result(s) in the XMemo panel.`);
  }
}
