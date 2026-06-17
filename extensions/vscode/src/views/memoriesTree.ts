import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';

class MemoryItem extends vscode.TreeItem {
  constructor(label: string, detail: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = detail;
    this.iconPath = new vscode.ThemeIcon('lightbulb');
    this.command = {
      command: 'xmemo.copyMemory',
      title: 'Copy',
      arguments: [detail]
    };
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    if (command) {
      this.command = command;
    }
  }
}

/**
 * Sidebar showing the results of the last recall/search. A dedicated
 * recent/pinned-memories source is deferred to v1.1 (no public "list memories"
 * tool in the frozen public layer yet).
 */
export class MemoriesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private items: string[] = [];
  private context = '';

  constructor(private readonly auth: XMemoAuth) {
    auth.onDidChange(() => this.refresh());
  }

  refresh(items?: string[], context?: string): void {
    if (items !== undefined) {
      this.items = items;
    }
    if (context !== undefined) {
      this.context = context;
    }
    this.changeEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!(await this.auth.isSignedIn())) {
      return [new MessageItem('Sign in to XMemo', { command: 'xmemo.signIn', title: 'Sign In' })];
    }
    if (this.items.length === 0) {
      return [new MessageItem('Run "XMemo: Recall…" or "Search Memory"', { command: 'xmemo.recall', title: 'Recall' })];
    }
    const header = this.context ? [new MessageItem(this.context)] : [];
    return [...header, ...this.items.map((r) => new MemoryItem(r.split('\n')[0].slice(0, 80), r))];
  }
}
