import * as assert from 'assert';
import * as vscode from 'vscode';
import { XMemoAuth } from '../../auth/xmemoAuthProvider';
import { createMcpServerProvider } from '../../mcp/serverProvider';

function fakeAuth(options: { token?: string; instanceId?: string }): XMemoAuth {
  const onDidChange = new vscode.EventEmitter<void>();
  return {
    onDidChange: onDidChange.event,
    getTokenOrSignIn: async () => options.token,
    agentInstanceId: async () => options.instanceId ?? 'test-instance',
    signIn: async () => true,
    signOut: async () => undefined,
    isSignedIn: async () => Boolean(options.token),
    getToken: async () => options.token,
    getClient: async () => undefined
  } as unknown as XMemoAuth;
}

suite('XMemo MCP server provider', () => {
  test('advertises XMemo before sign-in', async () => {
    const provider = createMcpServerProvider(fakeAuth({}));
    try {
      const definitions = await provider.provideMcpServerDefinitions();
      assert.strictEqual(definitions.length, 1, 'should advertise one server');
      assert.strictEqual(definitions[0].label, 'XMemo', 'server label should be XMemo');
      assert.ok(definitions[0].uri.toString().includes('/mcp'), 'server URI should end with /mcp');
      const authHeader = definitions[0].headers?.Authorization;
      assert.strictEqual(authHeader, undefined, 'eager discovery should not include Authorization header');
    } finally {
      provider.dispose();
    }
  });

  test('resolve injects auth headers after sign-in', async () => {
    const provider = createMcpServerProvider(fakeAuth({ token: 'test-token', instanceId: 'inst-123' }));
    try {
      const resolved = await provider.resolveMcpServerDefinition({ label: 'XMemo' });
      assert.ok(resolved, 'should resolve server definition');
      assert.strictEqual(resolved.label, 'XMemo');
      assert.strictEqual(resolved.headers?.Authorization, 'Bearer test-token');
      assert.strictEqual(resolved.headers?.['X-Memory-OS-Agent-ID'], 'vscode');
      assert.strictEqual(resolved.headers?.['X-Memory-OS-Agent-Instance-ID'], 'inst-123');
    } finally {
      provider.dispose();
    }
  });

  test('resolve returns undefined when not signed in', async () => {
    const provider = createMcpServerProvider(fakeAuth({}));
    try {
      const resolved = await provider.resolveMcpServerDefinition({ label: 'XMemo' });
      assert.strictEqual(resolved, undefined);
    } finally {
      provider.dispose();
    }
  });
});
