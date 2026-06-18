import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';

/**
 * Shared shape for an XMemo Language Model Tool.
 */
export interface XMemoTool {
  readonly id: string;
  readonly schema: vscode.LanguageModelToolInformation;
  invoke(options: vscode.LanguageModelToolInvocationOptions<unknown>, token: vscode.CancellationToken, auth: XMemoAuth): Promise<vscode.LanguageModelToolResult>;
}

export function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

export function errorResult(message: string): vscode.LanguageModelToolResult {
  return textResult(`XMemo error: ${message}`);
}

export function workspaceHints(): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const root = folders[0]?.uri.fsPath;
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const selected = vscode.window.activeTextEditor?.selection;
  const lines: string[] = [];
  if (root) {
    lines.push(`workspace root: ${root}`);
  }
  if (active) {
    lines.push(`active file: ${active}`);
  }
  if (selected && !selected.isEmpty) {
    const text = vscode.window.activeTextEditor!.document.getText(selected).slice(0, 500);
    lines.push(`selected text (truncated): ${text}`);
  }
  return lines.join('\n');
}

export function truncate(text: string, max = 4000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n... (truncated)`;
}
