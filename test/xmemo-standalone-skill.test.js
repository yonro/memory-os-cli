import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills/xmemo/scripts/xmemo-skill.mjs');

// Helper to run the script in a child process
async function runScript(args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [skillScript, ...args], {
      env: {
        ...process.env,
        XMEMO_BASE_URL: options.baseUrl,
        XMEMO_KEY: options.env?.XMEMO_KEY,
        ...options.env,
      },
      cwd: repoRoot
    });

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

// Simple test server helper
function createTestServer() {
  const requests = [];
  let responseData = { ok: true, result: {} };
  let responseStatus = 200;
  let rawResponse = null;
  
  // Custom response sequence mapping
  let responsesSeq = [];
  let responseIndex = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      });

      if (responsesSeq.length > 0) {
        const nextResp = responsesSeq[responseIndex] || responsesSeq[responsesSeq.length - 1];
        responseIndex++;
        res.writeHead(nextResp.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nextResp.body));
      } else if (rawResponse) {
        res.writeHead(rawResponse.status, { 'Content-Type': rawResponse.contentType });
        res.end(rawResponse.body);
      } else {
        res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
      }
    });
  });

  return {
    server,
    requests,
    setResponse: (data, status = 200) => {
      responseData = data;
      responseStatus = status;
      responsesSeq = [];
      rawResponse = null;
    },
    setResponseSeq: (seq) => {
      responsesSeq = seq;
      responseIndex = 0;
      rawResponse = null;
    },
    setRawResponse: (body, status = 502, contentType = 'text/html') => {
      rawResponse = { body, status, contentType };
      responsesSeq = [];
    },
    start: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${server.address().port}`);
      });
    }),
    stop: () => new Promise((resolve) => {
      server.close(() => resolve());
    }),
  };
}

test('skill script doctor command calls /v1/skill/operations with operation doctor', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'doctor',
    result: { status: 'ok', auth_valid: true, scopes: ['memory:read'] }
  });

  const res = await runScript(['doctor'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /XMemo Service Status: OK/);
  assert.equal(testServer.requests.length, 1);
  const req = testServer.requests[0];
  assert.equal(req.url, '/v1/skill/operations');
  assert.equal(req.method, 'POST');
  assert.equal(req.body.operation, 'doctor');
  assert.equal(req.headers.authorization, 'Bearer secret-token-key');

  await testServer.stop();
});


test('skill script anonymous doctor command succeeds when no credentials are present', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'doctor',
    result: { status: 'ok', auth_valid: false }
  });

  const res = await runScript(['doctor'], {
    baseUrl,
    env: {} // no token
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /XMemo Service Status: OK/);
  assert.match(res.stdout, /Authentication: Missing\/Unauthenticated/);

  await testServer.stop();
});

test('skill script bad token doctor command fails with non-zero exit code', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: false,
    error: { code: 'permission_denied', message: 'Invalid or inactive API Key' }
  }, 403);

  const res = await runScript(['doctor'], {
    baseUrl,
    env: { XMEMO_KEY: 'bad-token-key' }
  });

  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /Invalid or inactive API Key/);

  await testServer.stop();
});

test('skill script remember command calls /v1/skill/operations with operation remember', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'remember',
    result: 'mem_123'
  });

  const res = await runScript(['remember', '--content', 'hello world', '--path', 'conventions'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /Saved to XMemo/);
  assert.equal(testServer.requests.length, 1);
  const req = testServer.requests[0];
  assert.equal(req.url, '/v1/skill/operations');
  assert.equal(req.body.operation, 'remember');
  assert.equal(req.body.arguments.content, 'hello world');
  assert.equal(req.body.arguments.path, 'conventions');

  await testServer.stop();
});

test('skill script extracts object IDs for remember and expense-add', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({ ok: true, result: { id: 'mem_object_123' } });
  const rememberRes = await runScript(['remember', '--content', 'hello', '--path', 'test'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });
  assert.equal(rememberRes.code, 0);
  assert.match(rememberRes.stdout, /ID: mem_object_123/);
  assert.doesNotMatch(rememberRes.stdout, /\[object Object\]/);

  testServer.setResponse({ ok: true, result: { memory_id: 'ledger_object_456' } });
  const expenseRes = await runScript(['expense-add', '--item', 'lunch', '--amount', '15.5', '--currency', 'USD'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });
  assert.equal(expenseRes.code, 0);
  assert.match(expenseRes.stdout, /ID: ledger_object_456/);
  assert.doesNotMatch(expenseRes.stdout, /\[object Object\]/);

  await testServer.stop();
});

test('skill script accepts wrapped recall, search, and TODO list payloads', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };

  testServer.setResponse({ ok: true, result: { results: [{ id: 'recall_1', path: 'projects/test', content: 'A'.repeat(500) }], coverage: { matched: 1 } } });
  const recallRes = await runScript(['recall', '--query', 'test', '--compact'], { baseUrl, env });
  assert.equal(recallRes.code, 0);
  assert.match(recallRes.stdout, /ID: recall_1/);
  assert.match(recallRes.stdout, /truncated/);

  testServer.setResponse({ ok: true, result: { results: [{ id: 'search_1', path: 'projects/test', content: 'result' }] } });
  const searchRes = await runScript(['search', '--query', 'test'], { baseUrl, env });
  assert.equal(searchRes.code, 0);
  assert.match(searchRes.stdout, /ID: search_1/);

  testServer.setResponse({ ok: true, result: { todos: [{ id: 'todo_1', content: 'ship the fix', status: 'open' }] } });
  const todoListRes = await runScript(['todo-list'], { baseUrl, env });
  assert.equal(todoListRes.code, 0);
  assert.match(todoListRes.stdout, /ship the fix \(ID: todo_1\)/);

  await testServer.stop();
});

test('skill script exposes usage and preserves non-JSON server diagnostics', async () => {
  const helpRes = await runScript(['recall', '--help']);
  assert.equal(helpRes.code, 0);
  assert.match(helpRes.stdout, /node scripts\/xmemo-skill\.mjs recall/);

  const unknownRes = await runScript(['not-a-command']);
  assert.notEqual(unknownRes.code, 0);
  assert.match(unknownRes.stderr, /Unknown command: not-a-command/);
  assert.match(unknownRes.stdout, /Commands:/);

  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setRawResponse('<html>upstream unavailable</html>');
  const failureRes = await runScript(['search', '--query', 'test'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });
  assert.notEqual(failureRes.code, 0);
  assert.match(failureRes.stderr, /non-JSON response \(HTTP 502\)/);
  assert.match(failureRes.stderr, /upstream unavailable/);

  await testServer.stop();
});

test('skill script smoke-covers todo add and todo done operations', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };

  testServer.setResponse({ ok: true, result: { id: 'todo_new' } });
  const addRes = await runScript(['todo-add', '--content', 'follow up'], { baseUrl, env });
  assert.equal(addRes.code, 0);
  assert.equal(testServer.requests.at(-1).body.operation, 'todo-add');

  testServer.setResponse({ ok: true, result: { id: 'todo_new' } });
  const doneRes = await runScript(['todo-done', '--id', 'todo_new'], { baseUrl, env });
  assert.equal(doneRes.code, 0);
  assert.equal(testServer.requests.at(-1).body.operation, 'todo-done');

  await testServer.stop();
});

test('skill script state-save and state-restore commands', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'state-save',
    result: 'state_saved'
  });

  const saveRes = await runScript(['state-save', '--key', 'active_task', '--content', 'running tests'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });
  assert.equal(saveRes.code, 0);
  assert.equal(testServer.requests[0].body.operation, 'state-save');
  assert.equal(testServer.requests[0].body.arguments.key, 'active_task');
  assert.equal(testServer.requests[0].body.arguments.content, 'running tests');

  testServer.setResponse({
    ok: true,
    operation: 'state-restore',
    result: { state_key: 'active_task', content: 'running tests' }
  });

  const restoreRes = await runScript(['state-restore', '--key', 'active_task'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });
  assert.equal(restoreRes.code, 0);
  assert.match(restoreRes.stdout, /running tests/);

  await testServer.stop();
});

test('skill script expense-add command calls /v1/skill/operations with operation expense-add', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'expense-add',
    result: 'ledger_mem_123'
  });

  const res = await runScript(['expense-add', '--item', 'lunch', '--amount', '15.5', '--currency', 'USD'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /Expense recorded/);
  const req = testServer.requests[0];
  assert.equal(req.body.operation, 'expense-add');
  assert.equal(req.body.arguments.item, 'lunch');
  assert.equal(req.body.arguments.amount, '15.5');
  assert.equal(req.body.arguments.currency, 'USD');

  await testServer.stop();
});

test('skill script auth status verification checks endpoint', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    status: 'valid',
    scopes: ['memory:read', 'memory:write'],
    setup_state: 'setup_completed'
  });

  // Temporarily stub homedir credentials or pass XMEMO_KEY as environment fallback.
  // When XMEMO_KEY is set, getStoredToken returns it, so "auth status" works without credentials file.
  const res = await runScript(['auth', 'status', '--verify'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /Status: Logged in \(verified\)/);
  assert.match(res.stdout, /memory:read, memory:write/);

  assert.equal(testServer.requests.length, 1);
  assert.equal(testServer.requests[0].url, '/v1/auth/token/validate');
  assert.equal(testServer.requests[0].method, 'GET');
  assert.equal(testServer.requests[0].headers.authorization, 'Bearer secret-token-key');

  await testServer.stop();
});
