import assert from 'node:assert/strict';
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
