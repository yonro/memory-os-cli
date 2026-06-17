import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';

function defaultPath(): string {
  const name = vscode.workspace.name;
  if (!name) {
    return 'projects';
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `projects/${slug || 'workspace'}`;
}

export async function rememberCommand(auth: XMemoAuth, onSaved: () => void): Promise<void> {
  const client = await auth.getClient();
  if (!client) {
    const pick = await vscode.window.showWarningMessage('XMemo: not signed in.', 'Sign In');
    if (pick === 'Sign In') {
      await vscode.commands.executeCommand('xmemo.signIn');
    }
    return;
  }

  const content = await vscode.window.showInputBox({
    title: 'XMemo: Remember',
    prompt: 'What should XMemo remember? (decision, convention, context...)',
    ignoreFocusOut: true,
    placeHolder: 'e.g. API errors must use RFC-7807 problem+json'
  });
  if (!content?.trim()) {
    return;
  }

  const path = await vscode.window.showInputBox({
    title: 'XMemo: Category (path)',
    prompt: 'Where to file this memory?',
    ignoreFocusOut: true,
    value: defaultPath(),
    placeHolder: 'e.g. projects/xmemo, preferences'
  });
  if (!path?.trim()) {
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'XMemo: saving...' },
    async () => {
      try {
        await client.remember(content.trim(), path.trim());
        vscode.window.showInformationMessage('XMemo: memory saved.');
        onSaved();
      } catch (error: any) {
        vscode.window.showErrorMessage(`XMemo: ${error?.message ?? error}`);
      }
    }
  );
}
