import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { run } from '../src/cli.js';

test('help documents privacy defaults', async () => {
  const result = await invoke(['help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /no telemetry/i);
  assert.match(result.stdout, /no token in project files/i);
});

test('status does not send authorization tokens', async () => {
  const requests = [];
  const result = await invoke(['status', '--url', 'https://api.example.test', '--json'], {
    env: { MEMORY_OS_MCP_TOKEN: 'secret-token-that-must-not-leak' },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    }
  });

  assert.equal(result.code, 0);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.init.headers.authorization, undefined);
  }
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('token set refuses plaintext storage unless explicit', async () => {
  const result = await invoke(['token', 'set', '--from-stdin'], {
    stdin: 'mem_os_test_token_1234567890'
  });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /refuses plaintext token storage/i);
});

test('mcp codex config references env var without leaking token value', async () => {
  const result = await invoke(['mcp', 'add', 'codex', '--url', 'https://api.example.test'], {
    env: {
      HOME: '/tmp/example-home',
      MEMORY_OS_MCP_TOKEN: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /bearer_token_env_var = "MEMORY_OS_MCP_TOKEN"/);
  assert.match(result.stdout, /url = "https:\/\/api\.example\.test\/mcp"/);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp list exposes supported clients without token values', async () => {
  const result = await invoke(['mcp', 'list', '--json'], {
    env: { MEMORY_OS_MCP_TOKEN: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  const clients = JSON.parse(result.stdout);
  assert.deepEqual(clients.map((client) => client.id), ['codex', 'cursor']);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp cursor config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-cli-'));
  const configPath = path.join(tempDir, 'mcp.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcpServers: { existing: { url: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'cursor', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: { MEMORY_OS_MCP_TOKEN: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.existing.url, 'https://existing.example/mcp');
  assert.equal(config.mcpServers.memory_os.url, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.memory_os.headers.Authorization, 'Bearer ${env:MEMORY_OS_MCP_TOKEN}');
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';

  const code = await run(args, {
    env: options.env ?? {},
    stdin: Readable.from([options.stdin ?? '']),
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    fetch: options.fetch
  });

  return { code, stdout, stderr };
}
