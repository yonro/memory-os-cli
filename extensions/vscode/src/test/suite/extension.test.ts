import * as assert from 'assert';
import * as vscode from 'vscode';

suite('XMemo extension', () => {
  test('activates and registers commands', async () => {
    const ext = vscode.extensions.getExtension('xmemo.xmemo-vscode');
    assert.ok(ext, 'extension should be present');
    await ext!.activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const id of [
      'xmemo.signIn',
      'xmemo.signOut',
      'xmemo.remember',
      'xmemo.recall',
      'xmemo.searchMemory',
      'xmemo.saveSelection',
      'xmemo.showAgentIntegrations',
      'xmemo.refreshAgentIntegrations',
      'xmemo.connectAgent',
      'xmemo.disconnectAgent',
      'xmemo.connectAllAgents'
    ]) {
      assert.ok(cmds.includes(id), `missing command: ${id}`);
    }
  });

  test('contributes the XMemo MCP provider id', () => {
    const ext = vscode.extensions.getExtension('xmemo.xmemo-vscode');
    const providers = ext?.packageJSON?.contributes?.mcpServerDefinitionProviders ?? [];
    assert.ok(providers.some((p: any) => p.id === 'xmemo.mcp'), 'mcp provider declared');
  });

  test('contributes Language Model Tools', () => {
    const ext = vscode.extensions.getExtension('xmemo.xmemo-vscode');
    const tools = ext?.packageJSON?.contributes?.languageModelTools ?? [];
    for (const id of ['xmemo_recall', 'xmemo_search_memory', 'xmemo_context_pack', 'xmemo_remember', 'xmemo_explain_memory']) {
      assert.ok(tools.some((t: any) => t.id === id), `missing lm tool: ${id}`);
    }
  });

  test('contributes the @xmemo chat participant', () => {
    const ext = vscode.extensions.getExtension('xmemo.xmemo-vscode');
    const participants = ext?.packageJSON?.contributes?.chatParticipants ?? [];
    assert.ok(participants.some((p: any) => p.id === 'xmemo'), 'chat participant declared');
  });

  test('contributes the Agent Integrations view', () => {
    const ext = vscode.extensions.getExtension('xmemo.xmemo-vscode');
    const views = ext?.packageJSON?.contributes?.views?.xmemo ?? [];
    assert.ok(views.some((v: any) => v.id === 'xmemo.agentIntegrations'), 'agent integrations view declared');
  });
});
