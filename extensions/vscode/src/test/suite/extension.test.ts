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
      'xmemo.saveSelection'
    ]) {
      assert.ok(cmds.includes(id), `missing command: ${id}`);
    }
  });

  test('contributes the XMemo MCP provider id', () => {
    const ext = vscode.extensions.getExtension('xmemo.xmemo-vscode');
    const providers = ext?.packageJSON?.contributes?.mcpServerDefinitionProviders ?? [];
    assert.ok(providers.some((p: any) => p.id === 'xmemo.mcp'), 'mcp provider declared');
  });
});
