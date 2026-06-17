import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';

export async function saveSelectionCommand(auth: XMemoAuth, onSaved: () => void): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage('XMemo: select some text first.');
    return;
  }

  const client = await auth.getClient();
  if (!client) {
    const pick = await vscode.window.showWarningMessage('XMemo: not signed in.', 'Sign In');
    if (pick === 'Sign In') {
      await vscode.commands.executeCommand('xmemo.signIn');
    }
    return;
  }

  const selected = editor.document.getText(editor.selection);
  const note = await vscode.window.showInputBox({
    title: 'XMemo: Save Selection',
    prompt: 'Optional note to store alongside the selection (Enter to skip).',
    ignoreFocusOut: true
  });

  const workspaceName = vscode.workspace.name ?? 'workspace';
  const language = editor.document.languageId;
  const file = vscode.workspace.asRelativePath(editor.document.uri);
  const header = `[${workspaceName}] ${file} (${language})${note ? ` - ${note}` : ''}`;
  const content = `${header}\n\n${selected}`;
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const path = `projects/${slug || 'workspace'}`;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'XMemo: saving selection...' },
    async () => {
      try {
        await client.remember(content, path);
        vscode.window.showInformationMessage('XMemo: selection saved.');
        onSaved();
      } catch (error: any) {
        vscode.window.showErrorMessage(`XMemo: ${error?.message ?? error}`);
      }
    }
  );
}
