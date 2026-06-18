import * as vscode from 'vscode';
import { XMemoAuth } from '../auth/xmemoAuthProvider';
import { AGENT_CLIENTS, detectAgentClients, statusIcon } from './detector';
import { AgentClientState, AgentStatus } from './types';
import { connectClient, disconnectClient, isJsonClient, redactedPreview } from './writer';

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

export function registerAgentIntegrationsView(context: vscode.ExtensionContext, auth: XMemoAuth): {
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
      await runConnect(target, auth, provider);
    }),
    vscode.commands.registerCommand('xmemo.disconnectAgent', async (item?: AgentIntegrationItem) => {
      const target = item?.state;
      if (!target) {
        return;
      }
      await runDisconnect(target, auth, provider);
    }),
    vscode.commands.registerCommand('xmemo.connectAllAgents', async () => {
      const targets = provider.statesSnapshot.filter((s) => s.status === 'config-found' || s.status === 'config-missing');
      if (targets.length === 0) {
        vscode.window.showInformationMessage('All detected agents are already connected or not installed.');
        return;
      }

      const results: string[] = [];
      for (const target of targets) {
        try {
          if (isJsonClient(target.definition.id)) {
            const result = connectClient(target.definition.id, target.configPath, mcpUrl(), await identityFor(auth), { preview: true });
            results.push(`${target.definition.label}:\n${redactedPreview(result.preview)}`);
          } else {
            results.push(`${target.definition.label}: will use CLI command (non-JSON config)`);
          }
        } catch (error: any) {
          results.push(`${target.definition.label}: preview failed - ${error?.message ?? error}`);
        }
      }

      const choice = await vscode.window.showInformationMessage(
        `Connect ${targets.length} detected agent(s) to XMemo?`,
        { modal: true, detail: results.join('\n\n') },
        'Approve & Connect',
        'Copy CLI Commands'
      );
      if (choice === 'Approve & Connect') {
        for (const target of targets) {
          await runConnect(target, auth, provider, { silent: true });
        }
        vscode.window.showInformationMessage('Agent connection batch completed. Some agents may require a restart.');
      } else if (choice === 'Copy CLI Commands') {
        const cli = targets.map((s) => `npx -y @xmemo/client mcp add ${s.definition.id} --write`).join('\n');
        await vscode.env.clipboard.writeText(cli);
        vscode.window.showInformationMessage('CLI commands copied to clipboard.');
      }
    })
  );

  // Refresh once at activation so the view is not empty.
  void provider.refresh();

  return { provider, reveal };
}

function mcpUrl(): string {
  const cfg = vscode.workspace.getConfiguration('xmemo');
  return `${(cfg.get<string>('apiBaseUrl') ?? 'https://xmemo.dev').replace(/\/$/, '')}/mcp`;
}

async function identityFor(auth: XMemoAuth): Promise<{ agentId: string; agentInstanceId: string }> {
  const cfg = vscode.workspace.getConfiguration('xmemo');
  return {
    agentId: cfg.get<string>('agentId') ?? 'vscode',
    agentInstanceId: await auth.agentInstanceId()
  };
}

async function runConnect(
  target: AgentClientState,
  auth: XMemoAuth,
  provider: AgentIntegrationsTreeProvider,
  options: { silent?: boolean } = {}
): Promise<void> {
  if (!isJsonClient(target.definition.id)) {
    // Non-JSON clients (e.g., Codex TOML) fall back to CLI.
    const cli = `npx -y @xmemo/client mcp add ${target.definition.id} --write`;
    const choice = await vscode.window.showInformationMessage(
      `Connect ${target.definition.label} to XMemo?`,
      { modal: true, detail: `This agent requires the CLI to write its config.\n\n${cli}\n\nTarget config:\n${target.configPath}` },
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
    return;
  }

  const preview = connectClient(target.definition.id, target.configPath, mcpUrl(), await identityFor(auth), { preview: true });
  if (!options.silent) {
    const choice = await vscode.window.showInformationMessage(
      `Connect ${target.definition.label} to XMemo?`,
      { modal: true, detail: `Config path: ${target.configPath}\n\n${redactedPreview(preview.preview)}` },
      'Approve & Connect'
    );
    if (choice !== 'Approve & Connect') {
      return;
    }
  }

  connectClient(target.definition.id, target.configPath, mcpUrl(), await identityFor(auth), { force: true });
  if (!options.silent) {
    vscode.window.showInformationMessage(`${target.definition.label} connected to XMemo. Restart the agent if needed.`);
  }
  provider.refresh();
}

async function runDisconnect(
  target: AgentClientState,
  auth: XMemoAuth,
  provider: AgentIntegrationsTreeProvider
): Promise<void> {
  if (!isJsonClient(target.definition.id)) {
    const cli = `npx -y @xmemo/client mcp remove ${target.definition.id} --write`;
    const choice = await vscode.window.showWarningMessage(
      `Disconnect ${target.definition.label} from XMemo?`,
      { modal: true, detail: `This agent requires the CLI to modify its config.\n\n${cli}\n\nTarget config:\n${target.configPath}` },
      'Run in Terminal'
    );
    if (choice === 'Run in Terminal') {
      const terminal = vscode.window.createTerminal(`XMemo: disconnect ${target.definition.label}`);
      terminal.sendText(cli);
      terminal.show();
    }
    return;
  }

  const result = disconnectClient(target.definition.id, target.configPath, { preview: true });
  const choice = await vscode.window.showWarningMessage(
    `Disconnect ${target.definition.label} from XMemo?`,
    { modal: true, detail: `Config path: ${target.configPath}\n\n${redactedPreview(result.preview)}` },
    'Approve & Disconnect'
  );
  if (choice !== 'Approve & Disconnect') {
    return;
  }

  disconnectClient(target.definition.id, target.configPath);
  vscode.window.showInformationMessage(`${target.definition.label} disconnected from XMemo.`);
  provider.refresh();
}
