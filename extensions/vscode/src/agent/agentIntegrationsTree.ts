import * as vscode from 'vscode';
import { AGENT_CLIENTS, detectAgentClients, statusIcon } from './detector';
import { AgentClientState, AgentStatus } from './types';

export class AgentIntegrationItem extends vscode.TreeItem {
  constructor(
    public readonly state: AgentClientState,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(`${state.definition.label}`, collapsibleState);
    this.id = state.definition.id;
    this.iconPath = new vscode.ThemeIcon(this.iconName(state.status));
    this.description = this.describeStatus(state.status);
    this.tooltip = `${state.definition.label}\nPath: ${state.configPath}\nStatus: ${state.detail || this.describeStatus(state.status)}`;
    this.contextValue = `agent.${state.status}`;
    this.command = {
      command: 'xmemo.openAgentConfig',
      title: 'Open Config',
      arguments: [state]
    };
  }

  private iconName(status: AgentStatus): string {
    switch (status) {
      case 'connected':
        return 'check';
      case 'config-found':
        return 'warning';
      case 'config-missing':
        return 'circle-outline';
      case 'unsupported':
        return 'exclude';
      default:
        return 'question';
    }
  }

  private describeStatus(status: AgentStatus): string {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'config-found':
        return 'Config found, XMemo missing';
      case 'config-missing':
        return 'Config not found';
      case 'unsupported':
        return 'Unsupported';
      default:
        return 'Unknown';
    }
  }
}

export class AgentIntegrationsTreeProvider implements vscode.TreeDataProvider<AgentIntegrationItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AgentIntegrationItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private states: AgentClientState[] = [];

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async getChildren(_element?: AgentIntegrationItem): Promise<AgentIntegrationItem[]> {
    if (_element) {
      return [];
    }
    this.states = await detectAgentClients();
    return this.states.map(
      (state) => new AgentIntegrationItem(state, vscode.TreeItemCollapsibleState.None)
    );
  }

  getTreeItem(element: AgentIntegrationItem): vscode.TreeItem {
    return element;
  }

  get statesSnapshot(): AgentClientState[] {
    return [...this.states];
  }
}

export function registerAgentIntegrationsView(context: vscode.ExtensionContext): {
  provider: AgentIntegrationsTreeProvider;
  reveal: () => Promise<void>;
} {
  const provider = new AgentIntegrationsTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('xmemo.agentIntegrations', provider)
  );

  const reveal = async () => {
    await vscode.commands.executeCommand('xmemo.agentIntegrations.focus');
    provider.refresh();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('xmemo.refreshAgentIntegrations', () => provider.refresh()),
    vscode.commands.registerCommand('xmemo.showAgentIntegrations', reveal),
    vscode.commands.registerCommand('xmemo.openAgentConfig', (state?: AgentClientState) => {
      if (state) {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(state.configPath));
      }
    }),
    vscode.commands.registerCommand('xmemo.connectAgent', async (item?: AgentIntegrationItem) => {
      const target = item?.state ?? provider.statesSnapshot.find((s) => s.definition.id === 'vscode-mcp');
      if (!target) {
        return;
      }
      const cli = `npx -y @xmemo/client mcp add ${target.definition.id} --write`;
      const choice = await vscode.window.showInformationMessage(
        `Connect ${target.definition.label} to XMemo?`,
        { modal: true, detail: `This will run:\n${cli}\n\nTarget config:\n${target.configPath}` },
        'Copy CLI Command',
        'Run in Terminal'
      );
      if (choice === 'Copy CLI Command') {
        await vscode.env.clipboard.writeText(cli);
        vscode.window.showInformationMessage('CLI command copied to clipboard.');
      } else if (choice === 'Run in Terminal') {
        const terminal = vscode.window.createTerminal(`XMemo: connect ${target.definition.label}`);
        terminal.sendText(cli);
        terminal.show();
      }
    }),
    vscode.commands.registerCommand('xmemo.disconnectAgent', async (item?: AgentIntegrationItem) => {
      const target = item?.state;
      if (!target) {
        return;
      }
      const cli = `npx -y @xmemo/client mcp remove ${target.definition.id} --write`;
      const choice = await vscode.window.showWarningMessage(
        `Disconnect ${target.definition.label} from XMemo?`,
        { modal: true, detail: `This will run:\n${cli}\n\nTarget config:\n${target.configPath}` },
        'Run in Terminal'
      );
      if (choice === 'Run in Terminal') {
        const terminal = vscode.window.createTerminal(`XMemo: disconnect ${target.definition.label}`);
        terminal.sendText(cli);
        terminal.show();
      }
    }),
    vscode.commands.registerCommand('xmemo.connectAllAgents', async () => {
      const missing = provider.statesSnapshot.filter((s) => s.status === 'config-found' || s.status === 'config-missing');
      if (missing.length === 0) {
        vscode.window.showInformationMessage('All detected agents are already connected or not installed.');
        return;
      }
      const cli = missing.map((s) => `npx -y @xmemo/client mcp add ${s.definition.id} --write`).join(' && ');
      const choice = await vscode.window.showInformationMessage(
        `Connect ${missing.length} detected agent(s) to XMemo?`,
        { modal: true, detail: `Commands to run:\n${cli}` },
        'Copy CLI Command',
        'Run in Terminal'
      );
      if (choice === 'Copy CLI Command') {
        await vscode.env.clipboard.writeText(cli);
        vscode.window.showInformationMessage('CLI command copied to clipboard.');
      } else if (choice === 'Run in Terminal') {
        const terminal = vscode.window.createTerminal('XMemo: connect all agents');
        terminal.sendText(cli);
        terminal.show();
      }
    })
  );

  // Refresh once at activation so the view is not empty.
  void provider.refresh();

  return { provider, reveal };
}
