import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { MemoriesTreeProvider } from '../views/memoriesTree';

export function splitMemories(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function recallCommand(auth: XMemoAuth, tree: MemoriesTreeProvider): Promise<void> {
  const client = await auth.getClient();
  if (!client) {
    const pick = await vscode.window.showWarningMessage('XMemo: not signed in.', 'Sign In');
    if (pick === 'Sign In') {
      await vscode.commands.executeCommand('xmemo.signIn');
    }
    return;
  }

  const query = await vscode.window.showInputBox({
    title: 'XMemo: Recall',
    prompt: 'What do you want to recall?',
    ignoreFocusOut: true,
    placeHolder: 'e.g. error format convention'
  });
  if (!query?.trim()) {
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'XMemo: recalling...' },
    async () => {
      try {
        return await client.recall(query.trim());
      } catch (error: any) {
        vscode.window.showErrorMessage(`XMemo: ${error?.message ?? error}`);
        return undefined;
      }
    }
  );
  if (!result) {
    return;
  }
  if (!result.text) {
    tree.refresh([]);
    vscode.window.showInformationMessage('XMemo: nothing recalled for that query.');
    return;
  }

  tree.refresh(splitMemories(result.text), `recall: ${query.trim()}`);

  const action = await vscode.window.showInformationMessage(
    result.text.length > 300 ? result.text.slice(0, 300) + '...' : result.text,
    'Insert into Editor',
    'Copy'
  );
  if (action === 'Copy') {
    await vscode.env.clipboard.writeText(result.text);
  } else if (action === 'Insert into Editor') {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((b) => b.insert(editor.selection.active, result.text));
    }
  }
}
