import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  formatRemainingValidity,
  extractExpiresInSeconds,
  extractRequestId,
  COMMAND_USAGE_REGISTRY,
  buildTopLevelHelp,
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
  resolveCommandInputs,
} from '../skills/xmemo/scripts/xmemo-skill.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills/xmemo/scripts/xmemo-skill.mjs');

test('skill script recall-context calls the bounded direct REST endpoint', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({
    context_text: 'Recent project progress',
    items: [{ id: 'memory-1', content: 'Recent project progress' }],
  });

  try {
    const res = await runScript([
      'recall-context', '--query', 'recent project progress', '--max_items', '5', '--max_tokens', '1000', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.context_text, 'Recent project progress');
    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.url, '/v1/recall/context');
    assert.equal(req.method, 'POST');
    assert.deepEqual(req.body, {
      query: 'recent project progress',
      path: '%',
      bucket: '%',
      memory_type: 'auto',
      status: 'active',
      max_items: 5,
      max_tokens: 1000,
      prefer_working: true,
    });
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');
  } finally {
    await testServer.stop();
  }
});

test('skill script opts recall-context into Knowledge only when requested', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };
  try {
    testServer.setResponse({
      context_text: 'Memory and Knowledge context',
      items: [{ id: 'memory-1', type: 'memory' }, { id: 'knowledge-1', type: 'knowledge' }],
    });
    const res = await runScript([
      'recall-context', '--query', 'release conventions', '--include_knowledge', 'true', '--json'
    ], { baseUrl, env });
    assert.equal(res.code, 0);
    assert.equal(testServer.requests.at(-1).body.include_knowledge, true);

    const invalid = await runScript([
      'recall-context', '--query', 'release conventions', '--include_knowledge', 'yes'
    ], { baseUrl, env });
    assert.notEqual(invalid.code, 0);
    assert.match(invalid.stderr, /--include_knowledge must be true or false/);
  } finally {
    await testServer.stop();
  }
});

// Helper to run the script in a child process
async function runScript(args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const forceTty = options.pipe
      ? '0'
      : (options.isTty !== undefined
          ? (options.isTty ? '1' : '0')
          : (options.env?.XMEMO_FORCE_TTY ?? '1'));
    const childEnv = {
      ...process.env,
      HOME: options.homeDir || process.env.HOME,
      USERPROFILE: options.homeDir || process.env.USERPROFILE,
      XMEMO_BASE_URL: options.baseUrl,
      XMEMO_KEY: options.env?.XMEMO_KEY,
      XMEMO_FORCE_TTY: forceTty,
      ...options.env,
    };
    if (!options.env || !('JARVIS_AUTHD_SOCK' in options.env)) {
      delete childEnv.JARVIS_AUTHD_SOCK;
    }
    const child = spawn(process.execPath, [skillScript, ...args], {
      env: childEnv,
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
  let responseDelayMs = 0;
  
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

      const sendResponse = () => {
        if (res.destroyed || res.writableEnded) return;
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
      };
      if (responseDelayMs > 0) {
        setTimeout(sendResponse, responseDelayMs);
      } else {
        sendResponse();
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
    setResponseDelay: (delayMs) => {
      responseDelayMs = delayMs;
    },
    start: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${server.address().port}`);
      });
    }),
    stop: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

test('skill script doctor command calls /v1/skill/operations with operation doctor', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'doctor',
    result: { status: 'ok', auth_valid: true, scopes: ['memory:read'] },
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

test('skill script doctor --json reports bounded discovery diagnostics and a next action', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponseSeq([
    {
      status: 200,
      body: {
        schema_version: '1.0',
        protocol: 'memory-os-agent-discovery-v1',
        service: 'memory-os',
        mcp_url: 'https://xmemo.dev/mcp',
        supported_clients: ['codex', 'claude-code', 'openclaw'],
        standalone_skill: {
          status: 'available',
          runtime_model: 'standalone_skill',
          package: { version: 'skill-v1.1.16' },
          operations: ['remember', 'recall', 'doctor'],
          auth: { default_scopes: ['memory:read', 'memory:write'] },
        },
      },
    },
    { status: 200, body: { ok: true, operation: 'doctor', result: { auth_valid: false } } },
  ]);

  try {
    const res = await runScript(['doctor', '--anonymous', '--json'], { baseUrl, env: {} });
    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.clientDiagnostics.discovery.status, 'available');
    assert.equal(payload.clientDiagnostics.discovery.service, 'memory-os');
    assert.equal(payload.clientDiagnostics.discovery.serviceVersion, null);
    assert.equal(payload.clientDiagnostics.discovery.mcpUrl, 'https://xmemo.dev/mcp');
    assert.deepEqual(payload.clientDiagnostics.discovery.supportedClients, ['codex', 'claude-code', 'openclaw']);
    assert.equal(payload.clientDiagnostics.discovery.standaloneSkill.packageVersion, 'skill-v1.1.16');
    assert.deepEqual(payload.clientDiagnostics.discovery.standaloneSkill.operations, ['remember', 'recall', 'doctor']);
    assert.equal(payload.clientDiagnostics.nextAction.command, 'node scripts/xmemo-skill.mjs auth status --verify');
    assert.equal(testServer.requests.length, 2);
    assert.equal(testServer.requests[0].headers.authorization, undefined);
    assert.equal(testServer.requests[1].headers.authorization, undefined);
  } finally {
    await testServer.stop();
  }
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
  assert.match(res.stdout, /Next: node scripts\/xmemo-skill\.mjs login --allow-plaintext/);

  await testServer.stop();
});

test('skill script doctor keeps a healthy JSON result when discovery is unavailable', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponseSeq([
    { status: 503, body: { error: 'discovery temporarily unavailable' } },
    { status: 200, body: { ok: true, operation: 'doctor', result: { auth_valid: false } } },
  ]);

  try {
    const res = await runScript(['doctor', '--json'], { baseUrl, env: {} });
    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.clientDiagnostics.discovery.status, 'unavailable');
    assert.equal(payload.clientDiagnostics.discovery.errorCode, 'http_error');
    assert.equal(payload.clientDiagnostics.discovery.httpStatus, 503);
    assert.equal(payload.clientDiagnostics.nextAction.command, 'node scripts/xmemo-skill.mjs login --allow-plaintext');
    assert.equal(testServer.requests.length, 2);
  } finally {
    await testServer.stop();
  }
});

test('skill script doctor --anonymous does not transmit an available credential', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({
    ok: true,
    operation: 'doctor',
    result: { status: 'ok', auth_valid: false }
  });

  const res = await runScript(['doctor', '--anonymous'], {
    baseUrl,
    env: { XMEMO_KEY: 'credential-must-not-be-sent' }
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /Authentication: Not checked \(anonymous mode\)/);
  assert.doesNotMatch(res.stdout, /Next:/);
  assert.equal(testServer.requests.length, 1);
  assert.equal(testServer.requests[0].headers.authorization, undefined);

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

test('skill script renders reminders array from real server todo-list payload in terminal mode', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };

  testServer.setResponse({
    ok: true,
    operation: 'todo-list',
    result: {
      reminders: [
        { id: 'rem_001', content: 'Review ClawHub release checklist', status: 'open' },
        { id: 'rem_002', content: 'Verify namespace assertion gate', status: 'done' },
      ],
    },
  });

  const todoListRes = await runScript(['todo-list'], { baseUrl, env });
  assert.equal(todoListRes.code, 0);
  assert.doesNotMatch(todoListRes.stdout, /No TODOs found\./);
  assert.match(todoListRes.stdout, /- \[ \] Review ClawHub release checklist \(ID: rem_001\)/);
  assert.match(todoListRes.stdout, /- \[x\] Verify namespace assertion gate \(ID: rem_002\)/);

  const jsonRes = await runScript(['todo-list', '--json'], { baseUrl, env });
  assert.equal(jsonRes.code, 0);
  const jsonOutput = JSON.parse(jsonRes.stdout);
  assert.equal(jsonOutput.ok, true);
  assert.equal(jsonOutput.result.reminders.length, 2);

  await testServer.stop();
});

test('skill script exposes usage and preserves non-JSON server diagnostics', async () => {
  const helpRes = await runScript(['recall', '--help']);
  assert.equal(helpRes.code, 0);
  assert.match(helpRes.stdout, /node scripts\/xmemo-skill\.mjs recall/);

  const loginHelp = await runScript(['login', '--help']);
  assert.equal(loginHelp.code, 0);
  assert.match(loginHelp.stdout, /login --allow-plaintext/);
  assert.doesNotMatch(loginHelp.stdout, /Commands:/);

  const rootHelp = await runScript(['--help']);
  assert.equal(rootHelp.code, 0);
  assert.match(rootHelp.stdout, /recall-context --query <text>/);

  const contextHelp = await runScript(['recall-context', '--help']);
  assert.equal(contextHelp.code, 0);
  assert.match(contextHelp.stdout, /--include_knowledge <true\|false>/);

  const changelog = await fs.readFile(path.join(repoRoot, 'skills/xmemo/CHANGELOG.md'), 'utf8');
  const latestRelease = changelog.match(/^##\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  assert.match(latestRelease ?? '', /^\d+\.\d+\.\d+$/);

  const versionRes = await runScript(['--version']);
  assert.equal(versionRes.code, 0);
  assert.equal(versionRes.stdout.trim(), latestRelease);

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

test('skill script rejects unsafe origins and unknown or secret-like options before transmission', async () => {
  const unsafeOrigin = await runScript(['doctor', '--base-url', 'http://example.com'], {
    env: { XMEMO_KEY: 'secret-token-key' }
  });
  assert.notEqual(unsafeOrigin.code, 0);
  assert.match(unsafeOrigin.stderr, /must use HTTPS/);

  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  try {
    const secretValue = 'must_not_be_transmitted_123';
    const rejected = await runScript(['remember', '--content', 'safe', '--token', secretValue], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.notEqual(rejected.code, 0);
    assert.match(rejected.stderr, /Refusing sensitive command-line option --token/);
    assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, new RegExp(secretValue));
    assert.equal(testServer.requests.length, 0);
  } finally {
    await testServer.stop();
  }
});

test('skill script enforces request timeout', async () => {
  const timeoutServer = createTestServer();
  const timeoutBaseUrl = await timeoutServer.start();
  timeoutServer.setResponseDelay(100);
  try {
    const timeout = await runScript(['search', '--query', 'slow', '--timeout-ms', '20'], {
      baseUrl: timeoutBaseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.notEqual(timeout.code, 0);
    assert.match(timeout.stderr, /timed out after 20 ms/);
  } finally {
    await timeoutServer.stop();
  }
});

test('skill script rejects oversized responses', async () => {
  const largeServer = createTestServer();
  const largeBaseUrl = await largeServer.start();
  largeServer.setRawResponse('x'.repeat(8_388_609), 200, 'text/plain');
  try {
    const oversized = await runScript(['search', '--query', 'large'], {
      baseUrl: largeBaseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.notEqual(oversized.code, 0);
    assert.match(oversized.stderr, /exceeded the 8388608-byte safety limit/);
  } finally {
    await largeServer.stop();
  }
});

test('skill script redacts sensitive fields from JSON output', async () => {
  const jsonServer = createTestServer();
  const jsonBaseUrl = await jsonServer.start();
  jsonServer.setResponse({
    ok: true,
    result: { id: 'memory-1', token: 'server_token_must_not_print' }
  });
  try {
    const redacted = await runScript(['remember', '--content', 'safe', '--json'], {
      baseUrl: jsonBaseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(redacted.code, 0);
    assert.match(redacted.stdout, /\[REDACTED\]/);
    assert.doesNotMatch(redacted.stdout, /server_token_must_not_print/);
  } finally {
    await jsonServer.stop();
  }
});

test('skill script requires explicit consent before storing plaintext credentials', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-credential-test-'));
  const credentialPath = path.join(homeDir, '.xmemo', 'skill-credentials.json');
  const token = 'formal_token_value_123456';
  try {
    const loginRefused = await runScript(['login'], { homeDir, env: {} });
    assert.notEqual(loginRefused.code, 0);
    assert.match(loginRefused.stderr, /--allow-plaintext/);

    const refused = await runScript(['auth', 'add', '--from-stdin'], {
      homeDir,
      env: {},
      stdin: token,
    });
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /--allow-plaintext/);
    await assert.rejects(fs.readFile(credentialPath, 'utf8'), { code: 'ENOENT' });

    const falseValueDoesNotBypass = await runScript(['auth', 'add', '--from-stdin', '--allow-plaintext=false'], {
      homeDir,
      env: {},
      stdin: token,
    });
    assert.notEqual(falseValueDoesNotBypass.code, 0);
    assert.match(falseValueDoesNotBypass.stderr, /--allow-plaintext/);
    await assert.rejects(fs.readFile(credentialPath, 'utf8'), { code: 'ENOENT' });

    const accepted = await runScript(['auth', 'add', '--from-stdin', '--allow-plaintext'], {
      homeDir,
      env: {},
      stdin: token,
    });
    assert.equal(accepted.code, 0);
    assert.match(accepted.stderr, /unencrypted/i);
    assert.doesNotMatch(`${accepted.stdout}${accepted.stderr}`, new RegExp(token));

    const stored = JSON.parse(await fs.readFile(credentialPath, 'utf8'));
    assert.equal(stored.token, token);
    assert.equal(stored.storage, 'plaintext-user-file');
    assert.equal(stored.plaintext_storage_consent, true);
    assert.equal(typeof stored.plaintext_storage_consent_at, 'string');
    if (process.platform !== 'win32') {
      const stat = await fs.stat(credentialPath);
      assert.equal(stat.mode & 0o777, 0o600);
    }
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('skill script device login preserves formal-account scopes and respects authorization expiry', async () => {
  const successServer = createTestServer();
  const successBaseUrl = await successServer.start();
  const successHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-login-scope-test-'));
  try {
    successServer.setResponseSeq([
      {
        status: 200,
        body: {
          device_code: 'device-code',
          verification_uri_complete: 'https://xmemo.dev/device',
          user_code: 'ABCD-EFGH',
          interval: 0.001,
          expires_in: 1,
        },
      },
      {
        status: 200,
        body: { access_token: 'formal_token_value_123456' },
      },
    ]);
    const success = await runScript(['login', '--allow-plaintext'], {
      baseUrl: successBaseUrl,
      homeDir: successHome,
      env: {},
    });
    assert.equal(success.code, 0);
    assert.deepEqual(successServer.requests[0].body.scopes, [
      'memory:read', 'memory:write', 'memory:restore', 'ledger:write', 'ledger:read', 'knowledge:read'
    ]);
  } finally {
    await successServer.stop();
    await fs.rm(successHome, { recursive: true, force: true });
  }

  const expiryServer = createTestServer();
  const expiryBaseUrl = await expiryServer.start();
  const expiryHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-login-expiry-test-'));
  try {
    expiryServer.setResponseSeq([
      {
        status: 200,
        body: {
          device_code: 'expiring-device-code',
          verification_uri_complete: 'https://xmemo.dev/device',
          user_code: 'EXPI-RE00',
          interval: 0.001,
          expires_in: 0.02,
        },
      },
      {
        status: 200,
        body: { error: 'authorization_pending' },
      },
    ]);
    const expired = await runScript(['login', '--allow-plaintext'], {
      baseUrl: expiryBaseUrl,
      homeDir: expiryHome,
      env: {},
    });
    assert.notEqual(expired.code, 0);
    assert.match(expired.stderr, /authorization code expired|authorization window expired/);
  } finally {
    await expiryServer.stop();
    await fs.rm(expiryHome, { recursive: true, force: true });
  }
});

test('skill script keeps XMEMO_KEY ahead of a stored credential', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-env-priority-test-'));
  try {
    const credentialDir = path.join(homeDir, '.xmemo');
    await fs.mkdir(credentialDir, { recursive: true });
    await fs.writeFile(path.join(credentialDir, 'skill-credentials.json'), JSON.stringify({
      token: 'stored_token_should_not_be_used',
      credential_type: 'formal',
    }));
    testServer.setResponse({ status: 'valid', scopes: ['memory:read'] });

    const result = await runScript(['auth', 'status', '--verify'], {
      baseUrl,
      homeDir,
      env: { XMEMO_KEY: 'environment_token_wins_123456' },
    });
    assert.equal(result.code, 0);
    assert.equal(testServer.requests[0].headers.authorization, 'Bearer environment_token_wins_123456');
  } finally {
    await testServer.stop();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('skill script does not reveal token prefixes or revoke externally managed XMEMO_KEY by default', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-env-logout-test-'));
  const credentialDir = path.join(homeDir, '.xmemo');
  const credentialPath = path.join(credentialDir, 'skill-credentials.json');
  const environmentToken = 'mos_sensitive_account_prefix:secret-value';
  try {
    await fs.mkdir(credentialDir, { recursive: true });
    await fs.writeFile(credentialPath, JSON.stringify({
      token: 'stored_fallback_must_remain',
      credential_type: 'formal',
      storage: 'plaintext-user-file',
      plaintext_storage_consent: true,
    }));

    const status = await runScript(['auth', 'status'], {
      baseUrl,
      homeDir,
      env: { XMEMO_KEY: environmentToken }
    });
    assert.equal(status.code, 0);
    assert.match(status.stdout, /Credential Source: XMEMO_KEY/);
    assert.doesNotMatch(`${status.stdout}${status.stderr}`, /mos_sensitive_account_prefix/);

    const logout = await runScript(['logout'], {
      baseUrl,
      homeDir,
      env: { XMEMO_KEY: environmentToken }
    });
    assert.equal(logout.code, 0);
    assert.match(logout.stdout, /externally managed/);
    assert.equal(testServer.requests.length, 0);
    assert.equal(JSON.parse(await fs.readFile(credentialPath, 'utf8')).token, 'stored_fallback_must_remain');
  } finally {
    await testServer.stop();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('skill script smoke-covers todo add and todo done operations', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };

  testServer.setResponse({ ok: true, result: { id: 'todo_new' } });
  const addRes = await runScript(['todo-add', '--content', 'follow up'], { baseUrl, env });
  assert.equal(addRes.code, 0);
  assert.match(addRes.stdout, /TODO added/);
  assert.match(addRes.stdout, /todo_new/);
  assert.equal(testServer.requests.at(-1).body.operation, 'todo-add');

  testServer.setResponse({ ok: true, result: { id: 'todo_new' } });
  const doneRes = await runScript(['todo-done', '--id', 'todo_new'], { baseUrl, env });
  assert.equal(doneRes.code, 0);
  assert.match(doneRes.stdout, /TODO completed/);
  assert.match(doneRes.stdout, /todo_new/);
  assert.equal(testServer.requests.at(-1).body.operation, 'todo-done');

  await testServer.stop();
});

test('skill script gates temporary registration and uses the temporary memory REST surface', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-test-'));
  try {
    const rejected = await runScript(['register'], { baseUrl, homeDir, env: {} });
    assert.notEqual(rejected.code, 0);
    assert.match(rejected.stderr, /conditional fallback/);
    assert.equal(testServer.requests.length, 0);

    const unconsented = await runScript(['register', '--reason', 'unattended'], { baseUrl, homeDir, env: {} });
    assert.notEqual(unconsented.code, 0);
    assert.match(unconsented.stderr, /--allow-plaintext/);
    assert.equal(testServer.requests.length, 0);

    testServer.setResponseSeq([
      {
        status: 200,
        body: {
          temporary_token: {
            limits: { max_items: 75, ttl_seconds: 604800, max_lifetime_seconds: 1209600 },
          },
        },
      },
      {
        status: 201,
        body: {
          agent_id: 'agent_temp_1',
          temporary_token: 'temp_token_secret',
          claim_code: 'claim_1',
          bind_url: 'https://example.test/agents/bind?code=claim_1',
          status: 'unclaimed',
        },
      },
    ]);
    const register = await runScript(['register', '--reason', 'unattended', '--allow-plaintext'], { baseUrl, homeDir, env: {} });
    assert.equal(register.code, 0);
    assert.match(register.stdout, /Temporary XMemo memory enabled/);
    assert.match(register.stdout, /up to 75 items/);
    assert.match(register.stdout, /7 days without successful memory activity/);
    assert.match(register.stdout, /maximum 14 days from registration/);
    assert.match(register.stdout, /bind\?code=claim_1/);
    assert.doesNotMatch(register.stdout, /temp_token_secret/);
    assert.match(register.stderr, /unencrypted/i);
    assert.equal(testServer.requests.at(-1).url, '/v1/agents/register');
    assert.equal(testServer.requests.at(-1).body.entry_type, 'skill');
    assert.equal(testServer.requests.at(-1).body.metadata.registration_reason, 'unattended');
    const stored = JSON.parse(await fs.readFile(path.join(homeDir, '.xmemo', 'skill-credentials.json'), 'utf8'));
    assert.equal(stored.credential_type, 'temporary');
    assert.equal(stored.storage, 'plaintext-user-file');
    assert.equal(stored.claim_code, undefined);

    testServer.setResponse({
      detail: {
        errorType: 'binding_confirmation_required',
        confirmation_token: 'confirmation_value_must_not_print',
      },
    }, 428);
    const pending = await runScript(['remember', '--content', 'pending claim', '--json'], { baseUrl, homeDir, env: {} });
    assert.notEqual(pending.code, 0);
    assert.match(pending.stdout, /\[REDACTED\]/);
    assert.doesNotMatch(`${pending.stdout}${pending.stderr}`, /confirmation_value_must_not_print/);

    testServer.setResponse({ id: 'temporary_memory_1' }, 201);
    const remember = await runScript(['remember', '--content', 'temporary note', '--path', 'scratch', '--metadata', '{"mode":"temporary"}'], { baseUrl, homeDir, env: {} });
    assert.equal(remember.code, 0);
    assert.match(remember.stdout, /temporary XMemo memory/);
    assert.equal(testServer.requests.at(-1).url, '/v1/remember');
    assert.equal(testServer.requests.at(-1).headers.authorization, 'Bearer temp_token_secret');
    assert.deepEqual(testServer.requests.at(-1).body.metadata, { mode: 'temporary' });

    testServer.setResponse({ results: [{ id: 'temporary_memory_1', path: 'scratch', content: 'temporary result' }] });
    const recall = await runScript(['recall', '--query', 'temporary'], { baseUrl, homeDir, env: {} });
    assert.equal(recall.code, 0);
    assert.match(recall.stdout, /temporary result/);
    assert.match(testServer.requests.at(-1).url, /^\/v1\/recall\?query=temporary/);

    testServer.setResponse({ results: [{ id: 'temporary_memory_2', path: 'scratch', content: 'temporary search result' }] });
    const search = await runScript(['search', '--query', 'temporary', '--explain', 'false'], { baseUrl, homeDir, env: {} });
    assert.equal(search.code, 0);
    assert.match(search.stdout, /temporary search result/);
    assert.match(testServer.requests.at(-1).url, /^\/v1\/memories\/search\?query=temporary.*explain=false/);

    const unsupported = await runScript(['todo-list'], { baseUrl, homeDir, env: {} });
    assert.notEqual(unsupported.code, 0);
    assert.match(unsupported.stderr, /supports only remember, recall, and search/);
  } finally {
    await testServer.stop();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('skill script confirms a claimed temporary registration and stores the formal handoff token', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-claim-test-'));
  try {
    testServer.setResponse({
      agent_id: 'agent_temp_claim',
      temporary_token: 'temp_claim_token',
      claim_code: 'claim_2',
      bind_url: 'https://example.test/agents/bind?code=claim_2',
      status: 'unclaimed',
    });
    const register = await runScript(['register', '--reason', 'declined', '--allow-plaintext'], { baseUrl, homeDir, env: {} });
    assert.equal(register.code, 0);

    testServer.setResponseSeq([
      { status: 200, body: { status: 'pending_bind_confirmation', confirmation_token: 'confirm_once' } },
      { status: 200, body: { status: 'success' } },
      { status: 200, body: { status: 'claimed', formal_token: 'formal_handoff_token' } },
    ]);
    const claim = await runScript(['auth', 'claim-confirm'], { baseUrl, homeDir, env: {} });
    assert.equal(claim.code, 0);
    assert.match(claim.stdout, /Formal XMemo credential received/);
    assert.doesNotMatch(claim.stdout, /formal_handoff_token/);
    assert.equal(testServer.requests.at(-2).url, '/v1/agents/bind/confirm-current-user');
    assert.deepEqual(testServer.requests.at(-2).body, { confirmation_token: 'confirm_once' });
    const stored = JSON.parse(await fs.readFile(path.join(homeDir, '.xmemo', 'skill-credentials.json'), 'utf8'));
    assert.equal(stored.token, 'formal_handoff_token');
    assert.equal(stored.credential_type, 'formal');
    assert.equal(stored.pending_confirmation_token, undefined);
    assert.equal(stored.claim_code, undefined);

    testServer.setResponse({ ok: true, result: { todos: [] } });
    const todoList = await runScript(['todo-list'], { baseUrl, homeDir, env: {} });
    assert.equal(todoList.code, 0);
    assert.equal(testServer.requests.at(-1).url, '/v1/skill/operations');
    assert.equal(testServer.requests.at(-1).headers.authorization, 'Bearer formal_handoff_token');
  } finally {
    await testServer.stop();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('skill script lets the temporary-token holder deny a pending account bind', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-deny-test-'));
  try {
    testServer.setResponse({
      agent_id: 'agent_temp_deny',
      temporary_token: 'temp_deny_token',
      bind_url: 'https://example.test/agents/bind?code=claim_deny',
      status: 'unclaimed',
    }, 201);
    const register = await runScript(['register', '--reason', 'declined', '--allow-plaintext'], { baseUrl, homeDir, env: {} });
    assert.equal(register.code, 0);

    testServer.setResponse({
      detail: {
        errorType: 'binding_confirmation_required',
        confirmation_token: 'deny_confirmation_must_not_print',
      },
    }, 428);
    const challenged = await runScript(['remember', '--content', 'challenge'], { baseUrl, homeDir, env: {} });
    assert.notEqual(challenged.code, 0);

    testServer.setResponse({ status: 'unclaimed' });
    const denied = await runScript(['auth', 'claim-deny'], { baseUrl, homeDir, env: {} });
    assert.equal(denied.code, 0);
    assert.match(denied.stdout, /binding declined/i);
    assert.doesNotMatch(`${denied.stdout}${denied.stderr}`, /deny_confirmation_must_not_print/);
    assert.equal(testServer.requests.at(-1).url, '/v1/agents/bind/deny-current-user');
    assert.deepEqual(testServer.requests.at(-1).body, {});
    const stored = JSON.parse(await fs.readFile(path.join(homeDir, '.xmemo', 'skill-credentials.json'), 'utf8'));
    assert.equal(stored.token, 'temp_deny_token');
    assert.equal(stored.credential_type, 'temporary');
    assert.equal(stored.pending_confirmation_token, undefined);
  } finally {
    await testServer.stop();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('skill script normalizes JSON, boolean, and state TTL arguments to the server contract', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };
  try {
    testServer.setResponse({ ok: true, result: { id: 'typed_memory' } });
    const remember = await runScript([
      'remember', '--content', 'typed', '--metadata', '{"source":"test","rank":2}',
    ], { baseUrl, env });
    assert.equal(remember.code, 0);
    assert.deepEqual(testServer.requests.at(-1).body.arguments.metadata, { source: 'test', rank: 2 });

    testServer.setResponse({ ok: true, result: { results: [] } });
    const recall = await runScript([
      'recall', '--query', 'typed', '--explain', 'false', '--prefer_working', 'true',
    ], { baseUrl, env });
    assert.equal(recall.code, 0);
    assert.equal(testServer.requests.at(-1).body.arguments.explain, false);
    assert.equal(testServer.requests.at(-1).body.arguments.prefer_working, true);

    testServer.setResponse({ ok: true, result: 'state_saved' });
    const ttlZero = await runScript(['save-state', '--key', 'active', '--ttl_seconds', '0'], { baseUrl, env });
    assert.equal(ttlZero.code, 0);
    assert.equal(testServer.requests.at(-1).body.arguments.ttl_seconds, '0');

    const invalidMetadata = await runScript(['remember', '--content', 'bad', '--metadata', '[]'], { baseUrl, env });
    assert.notEqual(invalidMetadata.code, 0);
    assert.match(invalidMetadata.stderr, /--metadata must be a JSON object/);

    const invalidBoolean = await runScript(['search', '--query', 'bad', '--explain', 'yes'], { baseUrl, env });
    assert.notEqual(invalidBoolean.code, 0);
    assert.match(invalidBoolean.stderr, /--explain must be true or false/);

    const invalidTtl = await runScript(['save-state', '--key', 'active', '--ttl_seconds', '604801'], { baseUrl, env });
    assert.notEqual(invalidTtl.code, 0);
    assert.match(invalidTtl.stderr, /between 0 and 604800/);
  } finally {
    await testServer.stop();
  }
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

test('skill script renders empty and partial state-restore results clearly', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };

  try {
    testServer.setResponse({ ok: true, operation: 'state-restore', result: null });
    const missing = await runScript(['restore-state', '--key', 'active_task'], { baseUrl, env });
    assert.equal(missing.code, 0);
    assert.match(missing.stdout, /No saved working state found/);
    assert.doesNotMatch(missing.stdout, /undefined/);

    testServer.setResponse({ ok: true, operation: 'state-restore', result: { content: '' } });
    const partial = await runScript(['restore-state', '--key', 'active_task'], { baseUrl, env });
    assert.equal(partial.code, 0);
    assert.match(partial.stdout, /Key: active_task/);
    assert.match(partial.stdout, /Content: \(empty\)/);
    assert.doesNotMatch(partial.stdout, /undefined/);
  } finally {
    await testServer.stop();
  }
});

test('skill script creates and restores full restart-continuity snapshots', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };

  try {
    testServer.setResponse({
      id: 'restart_123',
      memory_id: 'memory_123',
      status: 'created',
      expires_at: '2026-08-10T00:00:00Z',
      snapshot: { active_state: { content: 'must stay out of normal output' } },
    }, 201);
    const snapshot = await runScript([
      'restart-snapshot',
      '--session_id', 'handoff-a',
      '--timeline_limit', '10',
      '--reminder_limit', '5',
      '--decision_limit', '0',
      '--ttl_seconds', '2592000',
      '--metadata', '{"source":"skill-test"}',
      '--scope', 'project-demo',
    ], { baseUrl, env });

    assert.equal(snapshot.code, 0);
    assert.match(snapshot.stdout, /Restart snapshot saved/);
    assert.match(snapshot.stdout, /restart_123/);
    assert.doesNotMatch(snapshot.stdout, /must stay out of normal output/);
    assert.equal(testServer.requests.at(-1).url, '/v1/restart/snapshot');
    assert.equal(testServer.requests.at(-1).headers.authorization, 'Bearer secret-token-key');
    assert.deepEqual(testServer.requests.at(-1).body, {
      session_id: 'handoff-a',
      timeline_limit: 10,
      reminder_limit: 5,
      decision_limit: 0,
      ttl_seconds: 2592000,
      metadata: { source: 'skill-test' },
      scope: 'project-demo',
    });

    testServer.setResponse({
      id: 'restart_123',
      memory_id: 'memory_123',
      status: 'restored',
      restored_at: '2026-08-03T00:00:00Z',
      snapshot: {},
      state_update: null,
      restore_event: null,
    });
    const restore = await runScript([
      'restart-restore',
      '--source_session_id', 'handoff-a',
      '--target_session_id', 'handoff-b',
      '--restore_state', 'true',
      '--record_restore_event', 'false',
    ], { baseUrl, env });

    assert.equal(restore.code, 0);
    assert.match(restore.stdout, /Restart snapshot restored/);
    assert.equal(testServer.requests.at(-1).url, '/v1/restart/restore');
    assert.deepEqual(testServer.requests.at(-1).body, {
      source_session_id: 'handoff-a',
      target_session_id: 'handoff-b',
      restore_state: true,
      record_restore_event: false,
    });

    testServer.setResponse({
      ok: true,
      id: null,
      status: 'not_found',
      restored: false,
    });
    const emptyRestore = await runScript([
      'restart-restore',
      '--source_session_id', 'handoff-empty',
    ], { baseUrl, env });
    assert.equal(emptyRestore.code, 0);
    assert.match(emptyRestore.stdout, /No active restart snapshot found to restore/);

    const invalidLimit = await runScript([
      'restart-snapshot', '--timeline_limit', '101',
    ], { baseUrl, env });
    assert.notEqual(invalidLimit.code, 0);
    assert.match(invalidLimit.stderr, /--timeline_limit must be between 0 and 100/);
  } finally {
    await testServer.stop();
  }
});

test('skill script restart-snapshot and restart-restore --json output contains standard ok: true envelope and failure paths', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const env = { XMEMO_KEY: 'secret-token-key' };

  try {
    // 1. restart-snapshot --json success path
    testServer.setResponse({
      id: 'restart_snap_123',
      memory_id: 'mem_snap_123',
      status: 'created',
      expires_at: '2026-08-10T00:00:00Z',
      snapshot: { active_state: { content: 'state body' } },
    }, 201);

    const snapRes = await runScript([
      'restart-snapshot',
      '--session_id', 'handoff-json-a',
      '--json',
    ], { baseUrl, env });

    assert.equal(snapRes.code, 0);
    const snapData = JSON.parse(snapRes.stdout);
    assert.equal(snapData.ok, true);
    assert.equal(snapData.id, 'restart_snap_123');
    assert.equal(snapData.status, 'created');
    assert.equal(snapData.expires_at, '2026-08-10T00:00:00Z');

    // 2. restart-restore --json success path
    testServer.setResponse({
      id: 'restart_snap_123',
      memory_id: 'mem_snap_123',
      status: 'restored',
      restored_at: '2026-08-03T00:00:00Z',
      snapshot: {},
    }, 200);

    const restoreRes = await runScript([
      'restart-restore',
      '--source_session_id', 'handoff-json-a',
      '--json',
    ], { baseUrl, env });

    assert.equal(restoreRes.code, 0);
    const restoreData = JSON.parse(restoreRes.stdout);
    assert.equal(restoreData.ok, true);
    assert.equal(restoreData.id, 'restart_snap_123');
    assert.equal(restoreData.status, 'restored');
    assert.equal(restoreData.restored_at, '2026-08-03T00:00:00Z');

    // 3. restart-restore --json empty/not_found state path
    testServer.setResponse({
      id: null,
      status: 'not_found',
      restored: false,
    }, 200);

    const emptyRes = await runScript([
      'restart-restore',
      '--source_session_id', 'handoff-empty-json',
      '--json',
    ], { baseUrl, env });

    assert.equal(emptyRes.code, 0);
    const emptyData = JSON.parse(emptyRes.stdout);
    assert.equal(emptyData.ok, true);
    assert.equal(emptyData.restored, false);

    // 4. restart-snapshot --json failure paths (S3 exit code classification)
    // 4a. Client-side argument validation error -> exit code 1
    const invalidLimitRes = await runScript([
      'restart-snapshot',
      '--timeline_limit', '101',
      '--json',
    ], { baseUrl, env });
    assert.equal(invalidLimitRes.code, 1);

    // 4b. 4xx error from server -> exit code 1
    testServer.setResponse({
      ok: false,
      error: { code: 'invalid_request', message: 'Session ID is invalid' },
    }, 400);

    const badRequestRes = await runScript([
      'restart-snapshot',
      '--session_id', 'bad-session',
      '--json',
    ], { baseUrl, env });
    assert.equal(badRequestRes.code, 1);
    const badRequestData = JSON.parse(badRequestRes.stdout);
    assert.equal(badRequestData.ok, false);
    assert.equal(badRequestData.error.code, 'invalid_request');

    // 4c. 401/403 error from server -> exit code 2
    testServer.setResponse({
      ok: false,
      error: { code: 'unauthorized', message: 'Token expired' },
    }, 401);

    const authErrRes = await runScript([
      'restart-snapshot',
      '--session_id', 'handoff-auth-err',
      '--json',
    ], { baseUrl, env });
    assert.equal(authErrRes.code, 2);
    const authErrData = JSON.parse(authErrRes.stdout);
    assert.equal(authErrData.error.code, 'unauthorized');

    // 4d. 5xx error from server -> exit code 3
    testServer.setResponse({
      ok: false,
      error: { code: 'internal_error', message: 'Database failure' },
    }, 500);

    const serverErrRes = await runScript([
      'restart-snapshot',
      '--session_id', 'handoff-500',
      '--json',
    ], { baseUrl, env });
    assert.equal(serverErrRes.code, 3);
    const serverErrData = JSON.parse(serverErrRes.stdout);
    assert.equal(serverErrData.error.code, 'internal_error');

    // 5. restart-restore --json failure paths
    testServer.setResponse({
      ok: false,
      error: { code: 'snapshot_corrupted', message: 'Corrupted snapshot data' },
    }, 400);

    const restoreFailRes = await runScript([
      'restart-restore',
      '--source_session_id', 'handoff-corrupted',
      '--json',
    ], { baseUrl, env });
    assert.equal(restoreFailRes.code, 1);
    const restoreFailData = JSON.parse(restoreFailRes.stdout);
    assert.equal(restoreFailData.ok, false);
    assert.equal(restoreFailData.error.code, 'snapshot_corrupted');

    testServer.setResponse({
      ok: false,
      error: { code: 'internal_error', message: 'Storage timeout' },
    }, 500);

    const restore500Res = await runScript([
      'restart-restore',
      '--source_session_id', 'handoff-500',
      '--json',
    ], { baseUrl, env });
    assert.equal(restore500Res.code, 3);
    const restore500Data = JSON.parse(restore500Res.stdout);
    assert.equal(restore500Data.error.code, 'internal_error');

  } finally {
    await testServer.stop();
  }
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

  const aliasRes = await runScript(['auth-status', '--verify'], {
    baseUrl,
    env: { XMEMO_KEY: 'secret-token-key' }
  });
  assert.equal(aliasRes.code, 0);
  assert.match(aliasRes.stdout, /Status: Logged in \(verified\)/);
  assert.equal(testServer.requests.at(-1).url, '/v1/auth/token/validate');

  await testServer.stop();
});

test('skill script read queries explain endpoint and returns minimal projection', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    id: 'mem_12345',
    path: 'docs/architecture',
    content: 'Memory content for architecture design.',
    version: 'v2'
  });

  try {
    const res = await runScript([
      'read', '--id', 'mem_12345', '--bucket', 'my-bucket', '--scope', 'my-scope', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: true,
      id: 'mem_12345',
      path: 'docs/architecture',
      content: 'Memory content for architecture design.',
      version: 'v2',
      truncated: false
    });

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1/memories/mem_12345/explain?include_embedding=false&bucket=my-bucket&scope=my-scope');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');

    // Terminal mode check
    const termRes = await runScript(['read', '--id', 'mem_12345'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, /Memory: mem_12345/);
    assert.match(termRes.stdout, /Path: docs\/architecture/);
    assert.match(termRes.stdout, /Version: v2/);
    assert.match(termRes.stdout, /Content: Memory content for architecture design\./);
  } finally {
    await testServer.stop();
  }
});

test('skill script read handles empty content as a valid result', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    id: 'mem_empty',
    path: 'docs/empty',
    content: '',
    version: 'v1'
  });

  try {
    const res = await runScript(['read', '--id', 'mem_empty', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.id, 'mem_empty');
    assert.equal(payload.content, '');
    assert.equal(payload.truncated, false);

    const termRes = await runScript(['read', '--id', 'mem_empty'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, /Memory: mem_empty/);
  } finally {
    await testServer.stop();
  }
});

test('skill script read returns not_found on 404 and soft-deleted status', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 404 status
    testServer.setResponse({ error: { code: 'not_found', message: 'Memory not found' } }, 404);
    const notFoundRes = await runScript(['read', '--id', 'missing_mem', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(notFoundRes.code, 1);
    const notFoundPayload = JSON.parse(notFoundRes.stdout);
    assert.equal(notFoundPayload.ok, false);
    assert.equal(notFoundPayload.error.code, 'not_found');

    // Soft-deleted status (HTTP 200 with status: 'deleted')
    testServer.setResponse({
      id: 'deleted_mem',
      path: 'docs/del',
      content: 'soft deleted content',
      status: 'deleted'
    }, 200);
    const deletedRes = await runScript(['read', '--id', 'deleted_mem', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(deletedRes.code, 1);
    const deletedPayload = JSON.parse(deletedRes.stdout);
    assert.equal(deletedPayload.ok, false);
    assert.equal(deletedPayload.error.code, 'not_found');
    assert.match(deletedPayload.error.message, /not found or deleted/);
  } finally {
    await testServer.stop();
  }
});

test('skill script read preserves 401 and 403 errors without downgrade to 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 401 Unauthorized
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Invalid or expired token' } }, 401);
    const authRes = await runScript(['read', '--id', 'any_mem', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'expired-token' }
    });
    assert.equal(authRes.code, 2);
    const authPayload = JSON.parse(authRes.stdout);
    assert.equal(authPayload.ok, false);
    assert.equal(authPayload.error.code, 'unauthorized');
    assert.notEqual(authPayload.error.code, 'not_found');

    // 403 Forbidden
    testServer.setResponse({ error: { code: 'forbidden', message: 'Insufficient scope' } }, 403);
    const forbiddenRes = await runScript(['read', '--id', 'any_mem', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'scoped-token' }
    });
    assert.equal(forbiddenRes.code, 2);
    const forbiddenPayload = JSON.parse(forbiddenRes.stdout);
    assert.equal(forbiddenPayload.ok, false);
    assert.equal(forbiddenPayload.error.code, 'forbidden');
    assert.notEqual(forbiddenPayload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script read handles character pagination via offset and limit', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    id: 'mem_paged',
    path: 'docs/paged',
    content: '0123456789ABCDEF',
    version: 'v1'
  });

  try {
    // Window from 0 with limit 5 (offset=0, limit=5, truncated=true)
    const page1 = await runScript([
      'read', '--id', 'mem_paged', '--offset', '0', '--limit', '5', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(page1.code, 0);
    const payload1 = JSON.parse(page1.stdout);
    assert.equal(payload1.content, '01234');
    assert.equal(payload1.truncated, true);

    // Window from 5 with limit 5 (offset=5, limit=5, truncated=true)
    const page2 = await runScript([
      'read', '--id', 'mem_paged', '--offset', '5', '--limit', '5', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(page2.code, 0);
    const payload2 = JSON.parse(page2.stdout);
    assert.equal(payload2.content, '56789');
    assert.equal(payload2.truncated, true);

    // Full window (offset=0, limit=16, truncated=false)
    const full = await runScript([
      'read', '--id', 'mem_paged', '--offset', '0', '--limit', '16', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(full.code, 0);
    const payloadFull = JSON.parse(full.stdout);
    assert.equal(payloadFull.content, '0123456789ABCDEF');
    assert.equal(payloadFull.truncated, false);

    // Terminal mode with truncation flag
    const termTrunc = await runScript([
      'read', '--id', 'mem_paged', '--offset', '0', '--limit', '5'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(termTrunc.code, 0);
    assert.match(termTrunc.stdout, /\[truncated\]/);
  } finally {
    await testServer.stop();
  }
});

test('skill script read defaults version to null when absent and renders unknown in terminal', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    id: 'mem_unversioned',
    path: 'docs/raw',
    content: 'unversioned memory content'
  });

  try {
    const res = await runScript(['read', '--id', 'mem_unversioned', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.version, null);

    const termRes = await runScript(['read', '--id', 'mem_unversioned'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, /Version: \(unknown\)/);
  } finally {
    await testServer.stop();
  }
});

test('skill script update sends PATCH /v1/memories/{id} with flags and returns projection', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    id: 'mem_upd_1',
    path: 'projects/new-path',
    content: 'Updated content here',
    metadata: { key: 'value' },
    bucket: 'custom-bucket',
    scope: 'custom-scope'
  });

  try {
    const res = await runScript([
      'update', '--id', 'mem_upd_1',
      '--content', 'Updated content here',
      '--path', 'projects/new-path',
      '--metadata', '{"key":"value"}',
      '--bucket', 'custom-bucket',
      '--scope', 'custom-scope',
      '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.id, 'mem_upd_1');
    assert.equal(payload.path, 'projects/new-path');
    assert.equal(payload.updated, true);

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'PATCH');
    assert.equal(req.url, '/v1/memories/mem_upd_1');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');
    assert.deepEqual(req.body, {
      content: 'Updated content here',
      path: 'projects/new-path',
      metadata: { key: 'value' },
      bucket: 'custom-bucket',
      scope: 'custom-scope'
    });

    // Terminal mode check
    const termRes = await runScript([
      'update', '--id', 'mem_upd_1', '--path', 'projects/new-path'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, /Memory updated\./);
    assert.match(termRes.stdout, /ID: mem_upd_1/);
    assert.match(termRes.stdout, /Path: projects\/new-path/);
  } finally {
    await testServer.stop();
  }
});

test('skill script update passes through 400 invalid_memory_id without downgrade to 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 400 with invalid_memory_id
    testServer.setResponse({
      error: { code: 'invalid_memory_id', message: "Invalid memory ID syntax: '!@#$'" }
    }, 400);

    const res = await runScript([
      'update', '--id', '!@#$', '--content', 'new content', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'invalid_memory_id');
    assert.notEqual(payload.error.code, 'not_found');
    assert.match(payload.error.message, /Invalid memory ID/);

    const termRes = await runScript([
      'update', '--id', '!@#$', '--content', 'new content'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(termRes.code, 1);
    assert.match(termRes.stderr, /Code: invalid_memory_id/);

    // 400 with a different code (e.g. invalid_metadata) does NOT get overwritten as invalid_memory_id
    testServer.setResponse({
      error: { code: 'invalid_metadata', message: 'Metadata schema validation failed' }
    }, 400);
    const resOther = await runScript([
      'update', '--id', 'mem_1', '--metadata', '{"bad":true}', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(resOther.code, 1);
    const payloadOther = JSON.parse(resOther.stdout);
    assert.equal(payloadOther.error.code, 'invalid_metadata');
    assert.notEqual(payloadOther.error.code, 'invalid_memory_id');

    // 400 without code defaults to invalid_request
    testServer.setResponse({
      error: { message: 'Malformed payload' }
    }, 400);
    const resNoCode = await runScript([
      'update', '--id', 'mem_1', '--content', 'new content', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(resNoCode.code, 1);
    const payloadNoCode = JSON.parse(resNoCode.stdout);
    assert.equal(payloadNoCode.error.code, 'invalid_request');
    assert.notEqual(payloadNoCode.error.code, 'invalid_memory_id');
  } finally {
    await testServer.stop();
  }
});

test('skill script update returns not_found on 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({
      error: { code: 'not_found', message: 'Memory does not exist' }
    }, 404);

    const res = await runScript([
      'update', '--id', 'non_existing_mem', '--content', 'new content', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script update preserves 401 and 403 errors without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Missing token' } }, 401);
    const res401 = await runScript([
      'update', '--id', 'mem_1', '--content', 'new content', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-token' } });
    assert.equal(res401.code, 2);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Read-only token' } }, 403);
    const res403 = await runScript([
      'update', '--id', 'mem_1', '--content', 'new content', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'readonly-token' } });
    assert.equal(res403.code, 2);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script forget without --confirm exits non-zero and makes zero network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // Under JSON mode
    const resJson = await runScript([
      'forget', '--id', 'mem_to_delete', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 1);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'confirmation_required');
    assert.equal(payload.error.target_id, 'mem_to_delete');
    assert.match(payload.error.message, /Confirmation required/);
    assert.equal(testServer.requests.length, 0);

    // Under terminal mode
    const resTerm = await runScript([
      'forget', '--id', 'mem_to_delete'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 1);
    assert.match(resTerm.stderr, /Confirmation required to forget memory or ledger record 'mem_to_delete'/);
    assert.match(resTerm.stderr, /Target: mem_to_delete/);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await testServer.stop();
  }
});

test('skill script forget with --confirm sends POST /v1/memories/{id}/forget with mode soft_delete', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    result: { id: 'mem_to_delete', status: 'deleted' }
  });

  const ALLOWED_SERVICE_MODES = new Set(['soft_delete', 'hard_delete', 'redact']);

  try {
    const res = await runScript([
      'forget', '--id', 'mem_to_delete', '--confirm', '--reason', 'outdated info', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.id, 'mem_to_delete');
    assert.equal(payload.mode, 'soft_delete');
    assert.equal(payload.forgotten, true);

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/memories/mem_to_delete/forget');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');
    assert.deepEqual(req.body, {
      mode: 'soft_delete',
      reason: 'outdated info'
    });
    assert.ok(ALLOWED_SERVICE_MODES.has(req.body.mode), `Outgoing mode '${req.body.mode}' must be a valid service enum`);

    // Terminal mode check without --reason: confirms reason is omitted from body
    const termRes = await runScript([
      'forget', '--id', 'mem_to_delete', '--confirm'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, /Record forgotten \(soft-deleted\)\./);
    assert.match(termRes.stdout, /ID: mem_to_delete/);
    assert.equal(testServer.requests.length, 2);
    const req2 = testServer.requests[1];
    assert.equal(req2.body.mode, 'soft_delete');
    assert.equal('reason' in req2.body, false, 'reason field must be omitted when --reason flag is absent');
  } finally {
    await testServer.stop();
  }
});

test('skill script forget returns not_found on 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({
      error: { code: 'not_found', message: 'Memory not found' }
    }, 404);

    const res = await runScript([
      'forget', '--id', 'missing_mem', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script forget preserves 401 and 403 errors without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Missing token' } }, 401);
    const res401 = await runScript([
      'forget', '--id', 'mem_1', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-token' } });
    assert.equal(res401.code, 2);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Read-only token' } }, 403);
    const res403 = await runScript([
      'forget', '--id', 'mem_1', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'readonly-token' } });
    assert.equal(res403.code, 2);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script forget handles ledger transaction ID, passing ID to POST /v1/memories/{id}/forget', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    result: { id: 'tx_ledger_123', status: 'deleted' }
  });

  try {
    const res = await runScript([
      'forget', '--id', 'tx_ledger_123', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 0);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.id, 'tx_ledger_123');
    assert.equal(payload.mode, 'soft_delete');
    assert.equal(payload.forgotten, true);

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/memories/tx_ledger_123/forget');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');
    assert.deepEqual(req.body, { mode: 'soft_delete' });

    // Terminal mode check
    const termRes = await runScript([
      'forget', '--id', 'tx_ledger_123', '--confirm'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, /Record forgotten \(soft-deleted\)\./);
    assert.match(termRes.stdout, /ID: tx_ledger_123/);
  } finally {
    await testServer.stop();
  }
});

test('skill script forget with ledger transaction ID without --confirm makes zero network requests and reports target ID', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    const resJson = await runScript([
      'forget', '--id', 'tx_ledger_456', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 1);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'confirmation_required');
    assert.equal(payload.error.target_id, 'tx_ledger_456');
    assert.match(payload.error.message, /Confirmation required to forget memory or ledger record 'tx_ledger_456'/);
    assert.equal(testServer.requests.length, 0);

    const resTerm = await runScript([
      'forget', '--id', 'tx_ledger_456'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 1);
    assert.match(resTerm.stderr, /Confirmation required to forget memory or ledger record 'tx_ledger_456'/);
    assert.match(resTerm.stderr, /Target: tx_ledger_456/);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await testServer.stop();
  }
});

test('skill script forget preserves server 403 forbidden error without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // Tests client-side preservation of server 403 response without downgrade to 404 or success
    testServer.setResponse({ detail: 'delete scope required' }, 403);
    const res = await runScript([
      'forget', '--id', 'tx_ledger_789', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'test-unauthorized-token' } });

    assert.equal(res.code, 2);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'forbidden');
    assert.match(payload.error.message, /delete scope required/);
    assert.notEqual(payload.error.code, 'not_found');

    // Terminal mode check
    const termRes = await runScript([
      'forget', '--id', 'tx_ledger_789', '--confirm'
    ], { baseUrl, env: { XMEMO_KEY: 'test-unauthorized-token' } });
    assert.equal(termRes.code, 2);
    assert.match(termRes.stderr, /delete scope required/);
  } finally {
    await testServer.stop();
  }
});

test('skill script forget preserves 403 cross-tenant / unauthorized tenant scope rejection', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'tenant_forbidden', message: 'Cross-tenant deletion not permitted' } }, 403);
    const res = await runScript([
      'forget', '--id', 'foreign_tx_001', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'tenant-a-key' } });

    assert.equal(res.code, 2);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'tenant_forbidden');
    assert.match(payload.error.message, /Cross-tenant deletion not permitted/);
    assert.notEqual(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger list excludes transactions whose backing record was forgotten', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  const allTransactions = [
    { id: 'tx_keep_1', amount: 42.5, currency: 'USD', category: 'Food', date: '2026-09-20' },
    { id: 'tx_delete_2', amount: 15.0, currency: 'USD', category: 'Coffee', date: '2026-09-21' },
  ];
  const remainingTransactions = [
    { id: 'tx_keep_1', amount: 42.5, currency: 'USD', category: 'Food', date: '2026-09-20' },
  ];

  try {
    // Step 1: ledger-list initially returns 2 transactions
    testServer.setResponse({ ok: true, transactions: allTransactions, total: 2 });
    const listRes1 = await runScript(['ledger-list', '--json'], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(listRes1.code, 0);
    const listPayload1 = JSON.parse(listRes1.stdout);
    assert.equal(listPayload1.transactions.length, 2);
    assert.ok(listPayload1.transactions.some(t => t.id === 'tx_delete_2'));

    // Step 2: forget the transaction using its transaction id
    testServer.setResponse({ ok: true, result: { id: 'tx_delete_2', status: 'deleted' } });
    const forgetRes = await runScript([
      'forget', '--id', 'tx_delete_2', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(forgetRes.code, 0);
    const forgetPayload = JSON.parse(forgetRes.stdout);
    assert.equal(forgetPayload.ok, true);
    assert.equal(forgetPayload.id, 'tx_delete_2');
    assert.equal(forgetPayload.forgotten, true);

    // Step 3: subsequent ledger-list reflects exclusion of forgotten record
    testServer.setResponse({ ok: true, transactions: remainingTransactions, total: 1 });
    const listRes2 = await runScript(['ledger-list', '--json'], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.equal(listRes2.code, 0);
    const listPayload2 = JSON.parse(listRes2.stdout);
    assert.equal(listPayload2.transactions.length, 1);
    assert.equal(listPayload2.transactions[0].id, 'tx_keep_1');
    assert.ok(!listPayload2.transactions.some(t => t.id === 'tx_delete_2'));
  } finally {
    await testServer.stop();
  }
});

test('skill script top-level help lists read, update, and forget commands', async () => {
  const res = await runScript(['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /read --id <id> \[--offset <n>\] \[--limit <n>\]/);
  assert.match(res.stdout, /update --id <id> \[--content <text>\]/);
  assert.match(res.stdout, /forget --id <id> \[--reason <text>\] --confirm/);
  assert.match(res.stdout, /ledger-list \[--month <YYYY-MM>\]/);
  assert.match(res.stdout, /ledger-summary \[--months <n>\]/);
  assert.match(res.stdout, /overview/);
  assert.match(res.stdout, /activity/);
  assert.match(res.stdout, /stats/);
});

test('skill script ledger-list success path sends POST /v1/skill/operations with allow-listed arguments', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'ledger-list',
    result: {
      transactions: [
        {
          id: 'tx_1',
          amount: 100.5,
          currency: 'CNY',
          transaction_date: '2026-09-15',
          category: 'Food',
          transaction_type: 'expense',
          description: 'Team Lunch'
        }
      ],
      total: 1
    }
  });

  const ALLOWED_LEDGER_LIST_PARAMS = new Set([
    'limit', 'offset', 'currency', 'date_from', 'date_to', 'category', 'min_amount', 'max_amount', 'transaction_type'
  ]);

  try {
    const resJson = await runScript([
      'ledger-list',
      '--limit', '10',
      '--offset', '0',
      '--currency', 'CNY',
      '--category', 'Food',
      '--min-amount', '10',
      '--max-amount', '200',
      '--type', 'expense',
      '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.total, 1);
    assert.equal(payload.transactions.length, 1);
    assert.equal(payload.transactions[0].id, 'tx_1');

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');

    const reqUrl = new URL(req.url, 'http://localhost');
    assert.equal(reqUrl.pathname, '/v1/skill/operations');

    // Strict parameter allow-list check
    const args = req.body?.arguments || {};
    assert.equal(req.body?.operation, 'ledger-list');
    for (const key of Object.keys(args)) {
      assert.ok(ALLOWED_LEDGER_LIST_PARAMS.has(key), `Outgoing parameter '${key}' must be within allowed server set`);
    }
    assert.equal('owner_id' in args, false, 'Server resolves owner identity from key; must not send owner_id');
    assert.equal('user_id' in args, false, 'Server resolves owner identity from key; must not send user_id');
    assert.equal(args.limit, 10);
    assert.equal(args.offset, 0);
    assert.equal(args.currency, 'CNY');
    assert.equal(args.category, 'Food');
    assert.equal(args.min_amount, 10);
    assert.equal(args.max_amount, 200);
    assert.equal(args.transaction_type, 'expense');
    assert.equal('month' in args, false);
    assert.equal('bucket' in args, false);
    assert.equal('scope' in args, false);

    // Terminal mode rendering check
    const resTerm = await runScript([
      'ledger-list', '--limit', '10', '--currency', 'CNY'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /XMemo Ledger Transactions \(1/);
    assert.match(resTerm.stdout, /100\.5 CNY/);
    assert.match(resTerm.stdout, /\[Food\]/);
    assert.match(resTerm.stdout, /Team Lunch/);
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-list converts --month locally to date_from and date_to without transmitting month', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'ledger-list',
    result: {
      transactions: [],
      total: 0
    }
  });

  const ALLOWED_LEDGER_LIST_PARAMS = new Set([
    'limit', 'offset', 'currency', 'date_from', 'date_to', 'category', 'min_amount', 'max_amount', 'transaction_type'
  ]);

  try {
    const res = await runScript([
      'ledger-list', '--month', '2026-09', '--currency', 'CNY', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 0);
    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'POST');

    const reqUrl = new URL(req.url, 'http://localhost');
    assert.equal(reqUrl.pathname, '/v1/skill/operations');

    const args = req.body?.arguments || {};
    assert.equal(req.body?.operation, 'ledger-list');

    // Strict parameter allow-list check
    for (const key of Object.keys(args)) {
      assert.ok(ALLOWED_LEDGER_LIST_PARAMS.has(key), `Outgoing parameter '${key}' must be within allowed server set`);
    }

    assert.equal('owner_id' in args, false, 'Server resolves owner identity from key; must not send owner_id');
    assert.equal('user_id' in args, false, 'Server resolves owner identity from key; must not send user_id');
    assert.equal('month' in args, false, 'Server does not accept month; must not be sent');
    assert.equal('bucket' in args, false, 'Server does not accept bucket; must not be sent');
    assert.equal('scope' in args, false, 'Server does not accept scope; must not be sent');
    assert.equal(args.date_from, '2026-09-01');
    assert.equal(args.date_to, '2026-09-30');
    assert.equal(args.currency, 'CNY');
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-list handles empty result cleanly as exit code 0 without not_found error', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'ledger-list',
    result: {
      transactions: [],
      total: 0
    }
  });

  try {
    const resJson = await runScript([
      'ledger-list', '--month', '2026-09', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.transactions, []);
    assert.equal(payload.total, 0);

    const resTerm = await runScript([
      'ledger-list', '--month', '2026-09'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /No ledger transactions found\./);
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-list returns not_found on 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { message: 'Not found' } }, 404);
    const res = await runScript([
      'ledger-list', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-list preserves 401 and 403 without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Auth required' } }, 401);
    const res401 = await runScript([
      'ledger-list', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res401.code, 2);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Scope missing' } }, 403);
    const res403 = await runScript([
      'ledger-list', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res403.code, 2);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
    assert.match(payload403.error.message, /re-?authorization/i);
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-list 400 without error.code defaults to invalid_request', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ message: 'Malformed parameters' }, 400);
    const res = await runScript([
      'ledger-list', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'invalid_request');
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-summary success path sends POST /v1/skill/operations with allow-listed arguments', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'ledger-summary',
    result: {
      summary: [
        {
          month: '2026-09',
          currency: 'CNY',
          expense_total: 500,
          income_total: 1000,
          refund_total: 0,
          net_total: 500,
          transaction_count: 5
        }
      ],
      months: 6,
      total_months: 1,
      total_transactions: 5
    }
  });

  const ALLOWED_LEDGER_SUMMARY_PARAMS = new Set([
    'months', 'currency', 'transaction_type'
  ]);

  try {
    const resJson = await runScript([
      'ledger-summary', '--months', '6', '--currency', 'CNY', '--type', 'expense', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.months, 6);
    assert.equal(payload.summary.length, 1);
    assert.equal(payload.summary[0].month, '2026-09');

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');

    const reqUrl = new URL(req.url, 'http://localhost');
    assert.equal(reqUrl.pathname, '/v1/skill/operations');

    const args = req.body?.arguments || {};
    assert.equal(req.body?.operation, 'ledger-summary');

    // Strict parameter allow-list check
    for (const key of Object.keys(args)) {
      assert.ok(ALLOWED_LEDGER_SUMMARY_PARAMS.has(key), `Outgoing parameter '${key}' must be within allowed server set`);
    }
    assert.equal('owner_id' in args, false, 'Must not send owner_id');
    assert.equal('user_id' in args, false, 'Must not send user_id');
    assert.equal(args.months, 6);
    assert.equal(args.currency, 'CNY');
    assert.equal(args.transaction_type, 'expense');
    assert.equal('month' in args, false, 'Must not send month');
    assert.equal('bucket' in args, false, 'Must not send bucket');
    assert.equal('scope' in args, false, 'Must not send scope');

    // Terminal mode rendering check
    const resTerm = await runScript([
      'ledger-summary', '--months', '6', '--currency', 'CNY'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /XMemo Ledger Monthly Summary \(1 month\):/);
    assert.match(resTerm.stdout, /2026-09 \(CNY\):/);
    assert.match(resTerm.stdout, /Expense: 500 CNY/);
    assert.match(resTerm.stdout, /Income: 1000 CNY/);
    assert.match(resTerm.stdout, /Net: 500 CNY/);
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-summary handles legacy single-month object response in terminal mode', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'ledger-summary',
    result: {
      month: '2026-09',
      currency: 'CNY',
      total: 1250.5,
      count: 5
    }
  });

  try {
    const resTerm = await runScript([
      'ledger-summary', '--months', '3', '--currency', 'CNY'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /XMemo ledger summary for 2026-09: 1250\.5 CNY across 5 transactions\./);
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-summary handles empty/zero result cleanly as exit code 0', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'ledger-summary',
    result: {
      summary: [],
      months: 6,
      total_months: 0,
      total_transactions: 0
    }
  });

  try {
    const resJson = await runScript([
      'ledger-summary', '--months', '6', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.summary, []);

    const resTerm = await runScript([
      'ledger-summary', '--months', '6'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /No ledger monthly summary available\./);
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-summary returns not_found on 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { message: 'Not found' } }, 404);
    const res = await runScript([
      'ledger-summary', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-summary preserves 401 and 403 without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Session required' } }, 401);
    const res401 = await runScript([
      'ledger-summary', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res401.code, 2);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Ledger scope required' } }, 403);
    const res403 = await runScript([
      'ledger-summary', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res403.code, 2);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
    assert.match(payload403.error.message, /re-?authorization/i);
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-summary 400 without error.code defaults to invalid_request', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ message: 'Bad query' }, 400);
    const res = await runScript([
      'ledger-summary', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'invalid_request');
  } finally {
    await testServer.stop();
  }
});

test('skill script ledger-list displays (unknown) when tx.amount is missing', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'ledger-list',
    result: {
      transactions: [
        {
          id: 'tx_missing_amount',
          currency: 'CNY',
          transaction_date: '2026-09-15',
          category: 'Food',
          transaction_type: 'expense',
          description: 'Unknown Price Meal'
        }
      ],
      total: 1
    }
  });

  try {
    const res = await runScript([
      'ledger-list', '--limit', '10', '--currency', 'CNY'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 0);
    assert.match(res.stdout, /\(unknown\) CNY/);
    assert.doesNotMatch(res.stdout, /\b0 CNY\b/);
  } finally {
    await testServer.stop();
  }
});

test('skill script overview success path sends POST /v1/skill/operations with zero arguments', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'overview',
    result: {
      memories_total: 42,
      memories_active: 35,
      memories_archived: 5,
      memories_forgotten: 2,
      agents_active: 3,
      storage_mb: 1.25,
      tokens_30d: 15400,
      demo: false,
      dev_mode: false
    }
  });

  try {
    const resJson = await runScript([
      'overview', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.memories_total, 42);
    assert.equal(payload.memories_active, 35);
    assert.equal(payload.memories_archived, 5);
    assert.equal(payload.memories_forgotten, 2);
    assert.equal(payload.agents_active, 3);
    assert.equal(payload.storage_mb, 1.25);
    assert.equal(payload.tokens_30d, 15400);

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');

    const reqUrl = new URL(req.url, 'http://localhost');
    assert.equal(reqUrl.pathname, '/v1/skill/operations');
    assert.equal(reqUrl.search, '', 'POST /v1/skill/operations must not have query parameters');

    const args = req.body?.arguments || {};
    assert.equal(req.body?.operation, 'overview');
    assert.deepEqual(args, {});
    assert.equal('owner_id' in args, false, 'Must not send owner_id');
    assert.equal('user_id' in args, false, 'Must not send user_id');

    // Terminal mode rendering check
    const resTerm = await runScript([
      'overview'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /XMemo Account Overview:/);
    assert.match(resTerm.stdout, /Memories: 42 total \(35 active, 5 archived, 2 forgotten\)/);
    assert.match(resTerm.stdout, /Active Agents: 3/);
    assert.match(resTerm.stdout, /Storage: 1\.25 MB/);
    assert.match(resTerm.stdout, /Tokens \(30d\): 15400/);
  } finally {
    await testServer.stop();
  }
});

test('skill script overview handles empty/zero data cleanly as exit code 0', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'overview',
    result: {
      memories_total: 0,
      memories_active: 0,
      memories_archived: 0,
      memories_forgotten: 0,
      agents_active: 0,
      storage_mb: 0.0,
      tokens_30d: 0,
      demo: false,
      dev_mode: false
    }
  });

  try {
    const resTerm = await runScript([
      'overview'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /XMemo Account Overview:/);
    assert.match(resTerm.stdout, /Memories: 0 total \(0 active, 0 archived, 0 forgotten\)/);
    assert.match(resTerm.stdout, /Active Agents: 0/);
    assert.match(resTerm.stdout, /Storage: 0 MB/);
    assert.match(resTerm.stdout, /Tokens \(30d\): 0/);

    const resJson = await runScript([
      'overview', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.memories_total, 0);
  } finally {
    await testServer.stop();
  }
});

test('skill script overview returns not_found on 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'not_found', message: 'Overview endpoint not found' } }, 404);
    const res = await runScript([
      'overview', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script overview preserves 401 and 403 without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Token required' } }, 401);
    const res401 = await runScript([
      'overview', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res401.code, 2);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Read scope required' } }, 403);
    const res403 = await runScript([
      'overview', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res403.code, 2);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
    assert.match(payload403.error.message, /re-?authorization/i);
  } finally {
    await testServer.stop();
  }
});

test('skill script overview 400 without error.code defaults to invalid_request', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ message: 'Bad query' }, 400);
    const res = await runScript([
      'overview', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'invalid_request');
  } finally {
    await testServer.stop();
  }
});

test('skill script activity success path sends POST /v1/skill/operations with allow-listed arguments', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'activity',
    result: {
      activity: [
        {
          ts: '2026-09-21T10:00:00Z',
          type: 'memory_created',
          summary: 'Stored system architecture decision',
          ref_id: 'mem_123'
        }
      ],
      total: 1,
      dev_mode: false
    }
  });

  const ALLOWED_ACTIVITY_PARAMS = new Set(['limit']);

  try {
    const resJson = await runScript([
      'activity', '--limit', '15', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.total, 1);
    assert.equal(payload.activity.length, 1);
    assert.equal(payload.activity[0].type, 'memory_created');

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');

    const reqUrl = new URL(req.url, 'http://localhost');
    assert.equal(reqUrl.pathname, '/v1/skill/operations');

    const args = req.body?.arguments || {};
    assert.equal(req.body?.operation, 'activity');

    // Strict parameter allow-list check
    for (const key of Object.keys(args)) {
      assert.ok(ALLOWED_ACTIVITY_PARAMS.has(key), `Outgoing parameter '${key}' must be within allowed activity set`);
    }
    assert.equal('owner_id' in args, false, 'Must not send owner_id');
    assert.equal('user_id' in args, false, 'Must not send user_id');
    assert.equal(args.limit, 15);
    assert.equal('scope' in args, false);
    assert.equal('bucket' in args, false);

    // Terminal mode rendering check
    const resTerm = await runScript([
      'activity', '--limit', '15'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /XMemo Recent Activity \(1 \(total: 1\)\):/);
    assert.match(resTerm.stdout, /2026-09-21T10:00:00Z/);
    assert.match(resTerm.stdout, /MEMORY_CREATED/);
    assert.match(resTerm.stdout, /Stored system architecture decision/);
    assert.match(resTerm.stdout, /\[ref: mem_123\]/);
  } finally {
    await testServer.stop();
  }
});

test('skill script activity handles empty result cleanly as exit code 0', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    ok: true,
    operation: 'activity',
    result: {
      activity: [],
      total: 0,
      dev_mode: false
    }
  });

  try {
    const resTerm = await runScript([
      'activity'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /No recent activity found\./);

    const resJson = await runScript([
      'activity', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.total, 0);
    assert.deepEqual(payload.activity, []);
  } finally {
    await testServer.stop();
  }
});

test('skill script activity returns not_found on 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'not_found', message: 'Activity endpoint not found' } }, 404);
    const res = await runScript([
      'activity', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script activity preserves 401 and 403 without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Token required' } }, 401);
    const res401 = await runScript([
      'activity', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res401.code, 2);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Activity read forbidden' } }, 403);
    const res403 = await runScript([
      'activity', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res403.code, 2);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
    assert.match(payload403.error.message, /re-?authorization/i);
  } finally {
    await testServer.stop();
  }
});

test('skill script activity 400 without error.code defaults to invalid_request', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ message: 'Bad limit parameter' }, 400);
    const res = await runScript([
      'activity', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'invalid_request');
  } finally {
    await testServer.stop();
  }
});

test('skill script read-only commands reject undeclared flags locally with zero network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    const resOverview = await runScript(['overview', '--unexpected-flag', 'val'], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.notEqual(resOverview.code, 0);
    assert.match(resOverview.stderr, /Unknown option for overview: --unexpected-flag/);

    const resActivity = await runScript(['activity', '--owner_id', 'user_1'], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.notEqual(resActivity.code, 0);
    assert.match(resActivity.stderr, /Unknown option for activity: --owner_id/);

    const resLedgerList = await runScript(['ledger-list', '--user_id', 'user_1'], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.notEqual(resLedgerList.code, 0);
    assert.match(resLedgerList.stderr, /Unknown option for ledger-list: --user_id/);

    const resLedgerSummary = await runScript(['ledger-summary', '--extra', '123'], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.notEqual(resLedgerSummary.code, 0);
    assert.match(resLedgerSummary.stderr, /Unknown option for ledger-summary: --extra/);

    assert.equal(testServer.requests.length, 0, 'Must not send any network requests when invalid flags are provided');
  } finally {
    await testServer.stop();
  }
});

test('skill script stats success path sends GET /v1/memories/stats with allow-listed query params', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    total_count: 100,
    filtered_count: 85,
    scanned_count: 100,
    truncated: false,
    latest_at: '2026-09-20T12:00:00Z',
    oldest_at: '2026-09-01T08:00:00Z',
    type_counts: { episodic: 60, semantic: 25 },
    status_counts: { active: 80, archived: 5 },
    bucket_counts: { main: 85 },
    path_counts: { 'projects/test': 50 },
    groups: [
      {
        group_by: { type: 'episodic', status: 'active' },
        count: 55,
        latest_at: '2026-09-20T12:00:00Z'
      }
    ]
  });

  const ALLOWED_STATS_PARAMS = new Set([
    'owner', 'team_id', 'scope', 'path', 'bucket', 'memory_type', 'status', 'source', 'since', 'until', 'metadata', 'group_by', 'top_n'
  ]);

  try {
    const resJson = await runScript([
      'stats',
      '--scope', 'team',
      '--path', 'projects/%',
      '--bucket', 'main',
      '--memory-type', 'episodic',
      '--status', 'active',
      '--source', 'cli',
      '--since', '2026-09-01T00:00:00Z',
      '--until', '2026-09-20T00:00:00Z',
      '--group-by', 'type,status',
      '--top-n', '50',
      '--team-id', 'team_abc',
      '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.total_count, 100);
    assert.equal(payload.filtered_count, 85);
    assert.equal(payload.type_counts.episodic, 60);

    assert.equal(testServer.requests.length, 1);
    const req = testServer.requests[0];
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, 'Bearer secret-token-key');

    const reqUrl = new URL(req.url, 'http://localhost');
    assert.equal(reqUrl.pathname, '/v1/memories/stats');

    // Strict parameter allow-list check
    for (const key of reqUrl.searchParams.keys()) {
      assert.ok(ALLOWED_STATS_PARAMS.has(key), `Outgoing parameter '${key}' must be within allowed stats set`);
    }
    assert.equal(reqUrl.searchParams.get('scope'), 'team');
    assert.equal(reqUrl.searchParams.get('path'), 'projects/%');
    assert.equal(reqUrl.searchParams.get('bucket'), 'main');
    assert.equal(reqUrl.searchParams.get('memory_type'), 'episodic');
    assert.equal(reqUrl.searchParams.get('status'), 'active');
    assert.equal(reqUrl.searchParams.get('source'), 'cli');
    assert.equal(reqUrl.searchParams.get('since'), '2026-09-01T00:00:00Z');
    assert.equal(reqUrl.searchParams.get('until'), '2026-09-20T00:00:00Z');
    assert.equal(reqUrl.searchParams.get('group_by'), 'type,status');
    assert.equal(reqUrl.searchParams.get('top_n'), '50');
    assert.equal(reqUrl.searchParams.get('team_id'), 'team_abc');
    assert.equal(reqUrl.searchParams.has('month'), false);
    assert.equal(reqUrl.searchParams.has('currency'), false);

    // Terminal mode rendering check
    const resTerm = await runScript([
      'stats', '--path', 'projects/%'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /XMemo Memory Statistics:/);
    assert.match(resTerm.stdout, /Total Memories: 100 \(filtered: 85, scanned: 100\)/);
    assert.match(resTerm.stdout, /Latest Memory: 2026-09-20T12:00:00Z/);
    assert.match(resTerm.stdout, /Oldest Memory: 2026-09-01T08:00:00Z/);
    assert.match(resTerm.stdout, /Types: episodic: 60, semantic: 25/);
    assert.match(resTerm.stdout, /Status: active: 80, archived: 5/);
    assert.match(resTerm.stdout, /Buckets: main: 85/);
    assert.match(resTerm.stdout, /Groups \(1\):/);
    assert.match(resTerm.stdout, /\[type=episodic, status=active\]: 55/);
  } finally {
    await testServer.stop();
  }
});

test('skill script stats handles empty result cleanly as exit code 0', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  testServer.setResponse({
    total_count: 0,
    filtered_count: 0,
    scanned_count: 0,
    truncated: false,
    latest_at: null,
    oldest_at: null,
    type_counts: {},
    status_counts: {},
    bucket_counts: {},
    path_counts: {},
    groups: []
  });

  try {
    const resTerm = await runScript([
      'stats'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /No memory statistics available\./);

    const resJson = await runScript([
      'stats', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(resJson.code, 0);
    const payload = JSON.parse(resJson.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.total_count, 0);
  } finally {
    await testServer.stop();
  }
});

test('skill script stats rejects --top-n out of bounds locally with zero network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    const res0 = await runScript([
      'stats', '--top-n', '0'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.notEqual(res0.code, 0);
    assert.match(res0.stderr, /--top-n must be between 1 and 200/);
    assert.equal(testServer.requests.length, 0, 'Zero requests must be sent on local validation error');

    const res201 = await runScript([
      'stats', '--top-n', '201'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.notEqual(res201.code, 0);
    assert.match(res201.stderr, /--top-n must be between 1 and 200/);
    assert.equal(testServer.requests.length, 0, 'Zero requests must be sent on local validation error');

    const resAbc = await runScript([
      'stats', '--top-n', 'abc'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });
    assert.notEqual(resAbc.code, 0);
    assert.match(resAbc.stderr, /--top-n must be an integer between 1 and 200/);
    assert.equal(testServer.requests.length, 0, 'Zero requests must be sent on local validation error');
  } finally {
    await testServer.stop();
  }
});

test('skill script stats returns not_found on 404', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'not_found', message: 'Stats endpoint not found' } }, 404);
    const res = await runScript([
      'stats', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script stats preserves 401 and 403 without downgrade', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Token required' } }, 401);
    const res401 = await runScript([
      'stats', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res401.code, 2);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Stats read forbidden' } }, 403);
    const res403 = await runScript([
      'stats', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'bad-key' } });
    assert.equal(res403.code, 2);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
  } finally {
    await testServer.stop();
  }
});

test('skill script stats 400 without error.code defaults to invalid_request', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({ message: 'Bad stats query' }, 400);
    const res = await runScript([
      'stats', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'secret-token-key' } });

    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'invalid_request');
  } finally {
    await testServer.stop();
  }
});

test('S1-1: terminal error output includes request_id when present in error response', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 1a. Server error with error.request_id in terminal mode
    testServer.setResponse({
      ok: false,
      error: {
        code: 'not_found',
        message: 'Requested memory not found on server',
        request_id: 'req_test_abc123'
      }
    }, 404);

    const termResWithReqId = await runScript(['read', '--id', 'mem_missing_1'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(termResWithReqId.code, 1);
    assert.match(termResWithReqId.stderr, /Error: Requested memory not found on server \(Code: not_found\) \(request_id: req_test_abc123\)/);

    // 1b. Server error with top-level request_id in terminal mode
    testServer.setResponse({
      ok: false,
      error: {
        code: 'rate_limited',
        message: 'Too many requests'
      },
      request_id: 'req_top_level_456'
    }, 429);

    const termResTopLevel = await runScript(['read', '--id', 'mem_missing_2'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(termResTopLevel.code, 1);
    assert.match(termResTopLevel.stderr, /\(request_id: req_top_level_456\)/);

    // 1c. Server error without request_id in terminal mode (omitted cleanly)
    testServer.setResponse({
      ok: false,
      error: {
        code: 'not_found',
        message: 'No request ID present'
      }
    }, 404);

    const termResWithoutReqId = await runScript(['read', '--id', 'mem_missing_3'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(termResWithoutReqId.code, 1);
    assert.match(termResWithoutReqId.stderr, /Error: No request ID present \(Code: not_found\)/);
    assert.doesNotMatch(termResWithoutReqId.stderr, /request_id/);

    // 1d. JSON mode preserves request_id in JSON envelope
    testServer.setResponse({
      ok: false,
      error: {
        code: 'forbidden',
        message: 'Access denied',
        request_id: 'req_json_789'
      }
    }, 403);

    const jsonRes = await runScript(['read', '--id', 'mem_missing_4', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(jsonRes.code, 2);
    const jsonPayload = JSON.parse(jsonRes.stdout);
    assert.equal(jsonPayload.ok, false);
    assert.equal(jsonPayload.error.request_id, 'req_json_789');

    // 1e. Unit test extractRequestId helper
    assert.equal(extractRequestId({ error: { request_id: 'req_1' } }), 'req_1');
    assert.equal(extractRequestId({ request_id: 'req_2' }), 'req_2');
    assert.equal(extractRequestId({ error: {} }), null);
    assert.equal(extractRequestId(null), null);
    assert.equal(extractRequestId('string'), null);
  } finally {
    await testServer.stop();
  }
});

test('S1-2: login polling wait prints remaining validity countdown and duration formatting', async () => {
  // 2a. Test formatRemainingValidity countdown formatting
  assert.equal(formatRemainingValidity(572), '9m32s');
  assert.equal(formatRemainingValidity(600), '10m0s');
  assert.equal(formatRemainingValidity(45), '45s');
  assert.equal(formatRemainingValidity(3665), '1h1m5s');
  assert.equal(formatRemainingValidity(0), '0s');
  assert.equal(formatRemainingValidity(-10), '0s');

  // 2b. Test extractExpiresInSeconds
  assert.equal(extractExpiresInSeconds({ expires_in: 572 }), 572);
  assert.equal(extractExpiresInSeconds({ expires: 300 }), 300);
  assert.equal(extractExpiresInSeconds({ expires: true }), 600);
  assert.equal(extractExpiresInSeconds({ expires: [123] }), 600);
  assert.equal(extractExpiresInSeconds({}), 600);

  // 2c. Test login output includes (valid for 9m32s) when server returns expires_in: 572
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-login-countdown-'));

  try {
    testServer.setResponseSeq([
      {
        status: 200,
        body: {
          device_code: 'countdown-device-code',
          verification_uri_complete: 'https://xmemo.dev/device',
          user_code: 'COUNT-DOWN',
          interval: 0.001,
          expires_in: 572,
        },
      },
      {
        status: 200,
        body: { access_token: 'formal_token_countdown' },
      },
    ]);

    const res = await runScript(['login', '--allow-plaintext'], {
      baseUrl,
      homeDir,
      env: {},
    });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Waiting for authorization\.\.\. \(valid for 9m32s\)/);
  } finally {
    await testServer.stop();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('S1-3: non-TTY stdout pipeline defaults to JSON, explicit --terminal is respected', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse({
      id: 'mem_pipe_test',
      content: 'Pipeline content testing',
      path: 'docs/pipe.md',
      updated_at: '2026-09-22T00:00:00Z'
    });

    // 3a. Simulated non-TTY (pipe: true) without --json => automatically outputs JSON
    const pipeAutoJson = await runScript(['read', '--id', 'mem_pipe_test'], {
      baseUrl,
      pipe: true,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(pipeAutoJson.code, 0);
    const parsed = JSON.parse(pipeAutoJson.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.id, 'mem_pipe_test');
    assert.equal(parsed.content, 'Pipeline content testing');

    // 3b. Simulated non-TTY (pipe: true) with explicit --terminal => outputs human-readable terminal text
    const pipeTerminal = await runScript(['read', '--id', 'mem_pipe_test', '--terminal'], {
      baseUrl,
      pipe: true,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(pipeTerminal.code, 0);
    assert.match(pipeTerminal.stdout, /Memory: mem_pipe_test \| Path: docs\/pipe\.md/);
    assert.match(pipeTerminal.stdout, /Content: Pipeline content testing/);
    assert.throws(() => JSON.parse(pipeTerminal.stdout));

    // 3c. Simulated non-TTY with --no-json alias => outputs human-readable terminal text
    const pipeNoJson = await runScript(['read', '--id', 'mem_pipe_test', '--no-json'], {
      baseUrl,
      pipe: true,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(pipeNoJson.code, 0);
    assert.match(pipeNoJson.stdout, /Memory: mem_pipe_test \| Path:/);

    // 3d. Conflicting flags --json and --terminal error out
    const conflict = await runScript(['read', '--id', 'mem_pipe_test', '--json', '--terminal'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(conflict.code, 1);
    assert.match(conflict.stderr, /Cannot specify both --json and --terminal/);
  } finally {
    await testServer.stop();
  }
});

test('S1-4: single source of truth for command usage, anti-drift assertion', async () => {
  // 4a. Run root --help and verify it contains every registered command
  const rootHelpRes = await runScript(['--help']);
  assert.equal(rootHelpRes.code, 0);
  assert.match(rootHelpRes.stdout, /Global options:/);
  assert.match(rootHelpRes.stdout, /--terminal/);

  // 4b. Anti-drift assertion: iterate through all commands in COMMAND_USAGE_REGISTRY
  for (const [cmd, entry] of Object.entries(COMMAND_USAGE_REGISTRY)) {
    if (entry.aliasOf) continue;

    // Verify root --help includes the command usage string
    assert.ok(
      rootHelpRes.stdout.includes(entry.usage),
      `Root --help missing exact usage for command '${cmd}': expected '${entry.usage}'`
    );

    // Verify <command> --help includes the exact same usage string
    const cmdArgs = cmd.split(' ');
    const cmdHelpRes = await runScript([...cmdArgs, '--help']);
    assert.equal(cmdHelpRes.code, 0);
    assert.ok(
      cmdHelpRes.stdout.includes(entry.usage),
      `Command '${cmd} --help' output does not match COMMAND_USAGE_REGISTRY: expected '${entry.usage}' in '${cmdHelpRes.stdout}'`
    );
  }

  // 4c. Explicitly assert ledger-list usage contains all flags in both places
  const ledgerListEntry = COMMAND_USAGE_REGISTRY['ledger-list'];
  assert.ok(ledgerListEntry.usage.includes('--category <name>'));
  assert.ok(ledgerListEntry.usage.includes('--type <type>'));
  assert.ok(ledgerListEntry.usage.includes('--min-amount <n>'));
  assert.ok(ledgerListEntry.usage.includes('--max-amount <n>'));
  assert.ok(ledgerListEntry.usage.includes('--limit <n>'));
  assert.ok(ledgerListEntry.usage.includes('--offset <n>'));

  const ledgerHelpRes = await runScript(['ledger-list', '--help']);
  assert.ok(ledgerHelpRes.stdout.includes(ledgerListEntry.usage));
  assert.ok(rootHelpRes.stdout.includes(ledgerListEntry.usage));
});

test('S2-1: remember supports --content - (stdin) and --file <path> with identical outbound payload structure', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-s2-test-'));
  testServer.setResponse({ ok: true, result: { id: 'mem-s2-123' } });

  try {
    // 1. File import
    const tmpFile = path.join(tmpDir, 'decision.md');
    await fs.writeFile(tmpFile, 'Architecture decision saved from file.', 'utf8');

    const fileRes = await runScript(['remember', '--file', tmpFile, '--path', 'projects/s2/decisions'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(fileRes.code, 0);
    assert.match(fileRes.stdout, /Saved to XMemo/);
    assert.match(fileRes.stdout, /mem-s2-123/);
    assert.equal(testServer.requests.length, 1);
    assert.equal(testServer.requests[0].url, '/v1/skill/operations');
    assert.equal(testServer.requests[0].method, 'POST');
    assert.deepEqual(testServer.requests[0].body, {
      operation: 'remember',
      arguments: {
        content: 'Architecture decision saved from file.',
        path: 'projects/s2/decisions',
      },
    });

    // 2. Standard input (--content -)
    const stdinRes = await runScript(['remember', '--content', '-', '--path', 'projects/s2/decisions'], {
      baseUrl,
      stdin: 'Architecture decision saved from stdin.',
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(stdinRes.code, 0);
    assert.match(stdinRes.stdout, /Saved to XMemo/);
    assert.match(stdinRes.stdout, /mem-s2-123/);
    assert.equal(testServer.requests.length, 2);
    assert.equal(testServer.requests[1].url, '/v1/skill/operations');
    assert.equal(testServer.requests[1].method, 'POST');
    assert.deepEqual(testServer.requests[1].body, {
      operation: 'remember',
      arguments: {
        content: 'Architecture decision saved from stdin.',
        path: 'projects/s2/decisions',
      },
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('S2-2: remember enforces mutual exclusion between --content and --file', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-s2-test-'));
  const tmpFile = path.join(tmpDir, 'test.txt');
  await fs.writeFile(tmpFile, 'some text', 'utf8');

  try {
    // Both --content <text> and --file <path>
    const conflict1 = await runScript(['remember', '--content', 'inline text', '--file', tmpFile], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(conflict1.code, 1);
    assert.match(conflict1.stderr, /Cannot specify both --content and --file/);
    assert.equal(testServer.requests.length, 0);

    // Both --content - and --file <path>
    const conflict2 = await runScript(['remember', '--content', '-', '--file', tmpFile], {
      baseUrl,
      stdin: 'stdin text',
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(conflict2.code, 1);
    assert.match(conflict2.stderr, /Cannot specify both --content and --file/);
    assert.equal(testServer.requests.length, 0);

    // Duplicate --content flags
    const conflict3 = await runScript(['remember', '--content', 'first', '--content', 'second'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(conflict3.code, 1);
    assert.match(conflict3.stderr, /Cannot specify multiple --content options/);
    assert.equal(testServer.requests.length, 0);

    // Duplicate --file flags
    const conflict4 = await runScript(['remember', '--file', tmpFile, '--file', tmpFile], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(conflict4.code, 1);
    assert.match(conflict4.stderr, /Cannot specify multiple --file options/);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('S2-3: complex multiline, quotes, backticks, and Unicode content match byte-for-byte across stdin, file, and direct content', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-s2-test-'));
  testServer.setResponse({ ok: true, result: { id: 'mem-s2-bytes' } });

  const complexContent = [
    '# Release Architecture & Decisions 🚀',
    '',
    'Key specifications:',
    '- Contains "double quotes", \'single quotes\', and `embedded backticks`.',
    '- Math and symbols: $E = mc^2$, 100€, ±5%, §14.2, © 2026.',
    '- Multi-language Unicode: 日本語のテスト, 中文测试, café, résumé, São Paulo, crème brûlée.',
    '  - Indented code block:',
    '    ```json',
    '    {"nested": true, "key": "value"}',
    '    ```',
    'End of message with newline.\n'
  ].join('\n');

  try {
    const tmpFile = path.join(tmpDir, 'complex.md');
    await fs.writeFile(tmpFile, complexContent, 'utf8');

    // 1. Sent via --file
    const fileRes = await runScript(['remember', '--file', tmpFile, '--path', 'conventions/complex'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(fileRes.code, 0);

    // 2. Sent via --content - (stdin)
    const stdinRes = await runScript(['remember', '--content', '-', '--path', 'conventions/complex'], {
      baseUrl,
      stdin: complexContent,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(stdinRes.code, 0);

    // 3. Sent via direct --content
    const directRes = await runScript(['remember', '--content', complexContent, '--path', 'conventions/complex'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(directRes.code, 0);

    assert.equal(testServer.requests.length, 3);
    const filePayload = testServer.requests[0].body.arguments.content;
    const stdinPayload = testServer.requests[1].body.arguments.content;
    const directPayload = testServer.requests[2].body.arguments.content;

    // Byte-identical assertion across stdin, file, and original content
    assert.equal(filePayload, complexContent, 'File payload must match original content exactly');
    assert.equal(stdinPayload, complexContent, 'Stdin payload must match original content exactly');
    assert.equal(directPayload, complexContent, 'Direct payload must match original content exactly');
    assert.strictEqual(filePayload, stdinPayload, 'File and Stdin payloads must be strictly equal');
    assert.strictEqual(stdinPayload, directPayload, 'Stdin and Direct payloads must be strictly equal');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('S2-4: remember reports user error code 1 and zero requests when file cannot be read', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-s2-test-'));
  const nonExistentFile = path.join(tmpDir, 'does-not-exist-xyz123.md');

  try {
    const res = await runScript(['remember', '--file', nonExistentFile], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Failed to read file/);
    assert.match(res.stderr, /ENOENT/);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('S2-5: remember validates non-empty content for stdin, file, and missing flags', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-s2-test-'));

  try {
    // Missing both --content and --file
    const missingBoth = await runScript(['remember', '--path', 'some/path'], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(missingBoth.code, 1);
    assert.match(missingBoth.stderr, /remember requires --content or --file/);
    assert.equal(testServer.requests.length, 0);

    // Empty file (0 bytes)
    const emptyFile = path.join(tmpDir, 'empty.txt');
    await fs.writeFile(emptyFile, '', 'utf8');
    const emptyFileRes = await runScript(['remember', '--file', emptyFile], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(emptyFileRes.code, 1);
    assert.match(emptyFileRes.stderr, /remember content must not be empty/);
    assert.equal(testServer.requests.length, 0);

    // Whitespace-only file
    const whitespaceFile = path.join(tmpDir, 'whitespace.txt');
    await fs.writeFile(whitespaceFile, '   \n  \t  \n', 'utf8');
    const whitespaceFileRes = await runScript(['remember', '--file', whitespaceFile], {
      baseUrl,
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(whitespaceFileRes.code, 1);
    assert.match(whitespaceFileRes.stderr, /remember content must not be empty/);
    assert.equal(testServer.requests.length, 0);

    // Empty stdin
    const emptyStdinRes = await runScript(['remember', '--content', '-'], {
      baseUrl,
      stdin: '',
      env: { XMEMO_KEY: 'secret-token-key' }
    });
    assert.equal(emptyStdinRes.code, 1);
    assert.match(emptyStdinRes.stderr, /remember content must not be empty/);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('S3-1: exit code 0 on success across commands', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 1. remember success -> 0
    testServer.setResponse({ ok: true, result: { id: 'mem_success_0' } }, 200);
    const remRes = await runScript(['remember', '--content', 'success content', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(remRes.code, 0);

    // 2. read success -> 0
    testServer.setResponse({ memory: { id: 'mem_success_0', content: 'test' } }, 200);
    const readRes = await runScript(['read', '--id', 'mem_success_0', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(readRes.code, 0);

    // 3. doctor --anonymous -> 0
    testServer.setResponse({ status: 'ok', result: { service: 'healthy' } }, 200);
    const docRes = await runScript(['doctor', '--anonymous', '--json'], { baseUrl });
    assert.equal(docRes.code, 0);

    // 4. auth status without token (logged out) -> 0
    const emptyHome = path.join(os.tmpdir(), `xmemo-empty-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(emptyHome, { recursive: true });
    try {
      const authStatusRes = await runScript(['auth', 'status', '--json'], {
        baseUrl,
        homeDir: emptyHome,
        env: { XMEMO_KEY: '' }
      });
      assert.equal(authStatusRes.code, 0);
      const authStatusPayload = JSON.parse(authStatusRes.stdout);
      assert.equal(authStatusPayload.status, 'logged_out');
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true }).catch(() => {});
    }

    // 5. --help and --version -> 0
    const helpRes = await runScript(['--help']);
    assert.equal(helpRes.code, 0);
    const verRes = await runScript(['--version']);
    assert.equal(verRes.code, 0);
    const subHelpRes = await runScript(['remember', '--help']);
    assert.equal(subHelpRes.code, 0);

    // 6. ledger-list empty results -> 0
    testServer.setResponse({ ok: true, result: { transactions: [], total: 0 } }, 200);
    const ledgerRes = await runScript(['ledger-list', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(ledgerRes.code, 0);
  } finally {
    await testServer.stop();
  }
});

test('S3-2: exit code 1 on user error across validation, conflicts, missing flags/files, and 4xx', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 1. Unknown command / unknown flag
    const unknownCmd = await runScript(['not-a-command'], { baseUrl });
    assert.equal(unknownCmd.code, 1);
    const unknownFlag = await runScript(['remember', '--bad-flag', 'val'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(unknownFlag.code, 1);

    // 2. Mutual exclusion conflict (--content and --file)
    const mutexRes = await runScript(['remember', '--content', 'hello', '--file', 'somefile.txt'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(mutexRes.code, 1);

    // 3. Missing --confirm on forget
    const noConfirmRes = await runScript(['forget', '--id', 'mem_123'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(noConfirmRes.code, 1);

    // 4. Missing / unreadable file
    const missingFileRes = await runScript(['remember', '--file', 'nonexistent_file_path_xyz_123.txt'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(missingFileRes.code, 1);

    // 5. 400 Bad Request
    testServer.setResponse({ error: { code: 'bad_request', message: 'Malformed parameter' } }, 400);
    const res400 = await runScript(['read', '--id', 'invalid_id', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(res400.code, 1);
    const payload400 = JSON.parse(res400.stdout);
    assert.equal(payload400.ok, false);

    // 6. 404 Not Found
    testServer.setResponse({ error: { code: 'not_found', message: 'Item not found' } }, 404);
    const res404 = await runScript(['read', '--id', 'mem_not_found', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(res404.code, 1);

    // 7. 428 Precondition Required / 429 Too Many Requests
    testServer.setResponse({ error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } }, 429);
    const res429 = await runScript(['read', '--id', 'mem_rate_limit', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(res429.code, 1);
  } finally {
    await testServer.stop();
  }
});

test('S3-3: exit code 2 on authentication and authorization errors (401, 403, missing credentials, auth verify failure)', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 1. Missing credentials / unauthenticated
    const emptyHome = path.join(os.tmpdir(), `xmemo-no-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(emptyHome, { recursive: true });
    try {
      const noAuthRes = await runScript(['remember', '--content', 'secret data'], {
        baseUrl,
        homeDir: emptyHome,
        env: { XMEMO_KEY: '' }
      });
      assert.equal(noAuthRes.code, 2);
      assert.match(noAuthRes.stderr, /No XMemo credential found/);
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true }).catch(() => {});
    }

    // 2. 401 Unauthorized
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Invalid or expired token' } }, 401);
    const res401 = await runScript(['remember', '--content', 'test', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'expired-token' }
    });
    assert.equal(res401.code, 2);

    // 3. 403 Forbidden
    testServer.setResponse({ error: { code: 'forbidden', message: 'Insufficient scope' } }, 403);
    const res403 = await runScript(['remember', '--content', 'test', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'limited-token' }
    });
    assert.equal(res403.code, 2);

    // 4. auth status --verify failure on 401/403
    testServer.setResponse({ error: { code: 'unauthorized', message: 'Token expired' } }, 401);
    const verifyFailRes = await runScript(['auth', 'status', '--verify', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'expired-token' }
    });
    assert.equal(verifyFailRes.code, 2);

    // 5. doctor auth invalid
    testServer.setResponse({ ok: true, result: { service: 'healthy', auth_valid: false } }, 200);
    const docInvalidRes = await runScript(['doctor', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'invalid-token' }
    });
    assert.equal(docInvalidRes.code, 2);
  } finally {
    await testServer.stop();
  }
});

test('S3-4: exit code 3 on server/network errors (5xx, ECONNREFUSED, timeout, response > 8 MiB)', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // 1. 500 Internal Server Error
    testServer.setResponse({ error: { code: 'internal_error', message: 'DB connection failure' } }, 500);
    const res500 = await runScript(['remember', '--content', 'test', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(res500.code, 3);

    // 2. 502 Bad Gateway / Raw non-JSON response
    testServer.setRawResponse('<html>502 Bad Gateway</html>', 502, 'text/html');
    const res502 = await runScript(['remember', '--content', 'test', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(res502.code, 3);

    // 3. 503 Service Unavailable
    testServer.setResponse({ error: { code: 'service_unavailable', message: 'Server under maintenance' } }, 503);
    const res503 = await runScript(['remember', '--content', 'test', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(res503.code, 3);

    // 4. ECONNREFUSED / unreachable host
    const connRefusedRes = await runScript(['remember', '--content', 'test'], {
      baseUrl: 'http://127.0.0.1:49991',
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(connRefusedRes.code, 3);

    // 5. Request timeout
    testServer.setResponseDelay(600);
    const timeoutRes = await runScript(['remember', '--content', 'test', '--timeout-ms', '100'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(timeoutRes.code, 3);
    testServer.setResponseDelay(0);

    // 6. Safety size limit exceeded > 8 MiB
    testServer.setRawResponse('A'.repeat(8.5 * 1024 * 1024), 200, 'application/json');
    const oversizeRes = await runScript(['read', '--id', 'oversized_mem', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-key' }
    });
    assert.equal(oversizeRes.code, 3);
    assert.match(oversizeRes.stderr, /safety limit/i);
  } finally {
    await testServer.stop();
  }
});

test('S3-5: unit tests asserting exported EXIT_CODE and exit code classification helpers', () => {
  // 1. EXIT_CODE mapping constants
  assert.equal(EXIT_CODE.SUCCESS, 0);
  assert.equal(EXIT_CODE.USER_ERROR, 1);
  assert.equal(EXIT_CODE.AUTH_ERROR, 2);
  assert.equal(EXIT_CODE.SERVER_ERROR, 3);
  assert.ok(Object.isFrozen(EXIT_CODE));

  // 2. exitCodeForHttpStatus
  assert.equal(exitCodeForHttpStatus(200), EXIT_CODE.SUCCESS);
  assert.equal(exitCodeForHttpStatus(201), EXIT_CODE.SUCCESS);
  assert.equal(exitCodeForHttpStatus(204), EXIT_CODE.SUCCESS);
  assert.equal(exitCodeForHttpStatus(400), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(404), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(405), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(409), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(422), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(428), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(429), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(401), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForHttpStatus(403), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForHttpStatus(500), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForHttpStatus(502), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForHttpStatus(503), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForHttpStatus(504), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForHttpStatus(undefined), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(null), EXIT_CODE.USER_ERROR);

  // 3. exitCodeForErrorCode
  assert.equal(exitCodeForErrorCode('unauthorized'), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForErrorCode('forbidden'), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForErrorCode('tenant_forbidden'), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForErrorCode('missing_credentials'), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForErrorCode('timeout'), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForErrorCode('ECONNREFUSED'), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForErrorCode('ENOTFOUND'), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForErrorCode('ETIMEDOUT'), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForErrorCode('internal_error'), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForErrorCode('invalid_argument'), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForErrorCode('not_found'), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForErrorCode('bad_request'), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForErrorCode(undefined), null);
  assert.equal(exitCodeForErrorCode(null), null);

  // 4. exitCodeForError
  const err401 = new Error('Unauthorized access');
  err401.statusCode = 401;
  assert.equal(exitCodeForError(err401), EXIT_CODE.AUTH_ERROR);

  const err403 = new Error('Forbidden scope');
  err403.statusCode = 403;
  assert.equal(exitCodeForError(err403), EXIT_CODE.AUTH_ERROR);

  const err500 = new Error('Internal crash');
  err500.statusCode = 500;
  assert.equal(exitCodeForError(err500), EXIT_CODE.SERVER_ERROR);

  const errNetwork = new Error('connect ECONNREFUSED 127.0.0.1:49999');
  errNetwork.code = 'ECONNREFUSED';
  assert.equal(exitCodeForError(errNetwork), EXIT_CODE.SERVER_ERROR);

  const errTimeout = new Error('Request timed out after 30000ms');
  assert.equal(exitCodeForError(errTimeout), EXIT_CODE.SERVER_ERROR);

  const errGeneric = new Error('User input invalid');
  assert.equal(exitCodeForError(errGeneric), EXIT_CODE.USER_ERROR);
});

// =====================================================================
// F1 Slice: Input Limits (OH3) & Restart Envelope Harmonization
// =====================================================================

test('F1-1: remember via stdin accepts exactly MAX_MEMORY_CONTENT_BYTES (524288) and passes to server', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const exactContent = 'a'.repeat(524288);
  try {
    const res = await runScript(['remember', '--content', '-', '--path', 'tests/exact', '--json'], {
      baseUrl,
      stdin: exactContent,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 0);
    assert.equal(testServer.requests.length, 1);
    assert.equal(testServer.requests[0].body.arguments.content.length, 524288);
  } finally {
    await testServer.stop();
  }
});

test('F1-2: remember via stdin rejects 524289 bytes in terminal mode with code 1 and 0 network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const overContent = 'b'.repeat(524289);
  try {
    const res = await runScript(['remember', '--content', '-', '--path', 'tests/over', '--terminal'], {
      baseUrl,
      stdin: overContent,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Error: Memory content exceeds maximum limit of 524288 bytes\./);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await testServer.stop();
  }
});

test('F1-3: remember via stdin rejects 524289 bytes under --json with content_too_large and 0 network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const overContent = 'c'.repeat(524289);
  try {
    const res = await runScript(['remember', '--content', '-', '--path', 'tests/over', '--json'], {
      baseUrl,
      stdin: overContent,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'content_too_large',
        message: 'Memory content exceeds maximum limit of 524288 bytes.',
      },
    });
    assert.equal(testServer.requests.length, 0);
  } finally {
    await testServer.stop();
  }
});

test('F1-4: remember via --file accepts exactly 524288 bytes and passes to server', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-file-test-'));
  const filePath = path.join(tempDir, 'exact.txt');
  await fs.writeFile(filePath, 'd'.repeat(524288), 'utf8');
  try {
    const res = await runScript(['remember', '--file', filePath, '--path', 'tests/file-exact', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 0);
    assert.equal(testServer.requests.length, 1);
    assert.equal(testServer.requests[0].body.arguments.content.length, 524288);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('F1-5: remember via --file rejects 524289 bytes in terminal mode with code 1 and 0 network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-file-test-'));
  const filePath = path.join(tempDir, 'over.txt');
  await fs.writeFile(filePath, 'e'.repeat(524289), 'utf8');
  try {
    const res = await runScript(['remember', '--file', filePath, '--path', 'tests/file-over', '--terminal'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Error: File '.*' exceeds maximum limit of 524288 bytes\./);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('F1-6: remember via --file rejects 524289 bytes under --json with content_too_large and 0 network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-file-test-'));
  const filePath = path.join(tempDir, 'over.txt');
  await fs.writeFile(filePath, 'f'.repeat(524289), 'utf8');
  try {
    const res = await runScript(['remember', '--file', filePath, '--path', 'tests/file-over', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'content_too_large');
    assert.match(payload.error.message, /exceeds maximum limit of 524288 bytes\./);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('F1-5b: remember via --file rejects directory path as non-regular file with code 1 and 0 network requests', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-dir-test-'));
  try {
    const resTerm = await runScript(['remember', '--file', tempDir, '--path', 'tests/file-dir', '--terminal'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(resTerm.code, 1);
    assert.match(resTerm.stderr, /Error: Failed to read file '.*': --file must be a regular file\./);

    const resJson = await runScript(['remember', '--file', tempDir, '--path', 'tests/file-dir', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(resJson.code, 1);
    assert.match(resJson.stderr, /Error: Failed to read file '.*': --file must be a regular file\./);
    assert.equal(testServer.requests.length, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await testServer.stop();
  }
});

test('F1-6b: remember via --file bounded reader rejects 524289 bytes even if fs.stat size is 0', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-bounded-test-'));
  const filePath = path.join(tempDir, 'grow.txt');
  await fs.writeFile(filePath, 'g'.repeat(524289), 'utf8');

  const fsPromises = await import('node:fs/promises');
  const originalStat = fsPromises.default.stat;
  fsPromises.default.stat = async (p) => {
    if (p === filePath) {
      return { isFile: () => true, size: 0 };
    }
    return originalStat(p);
  };

  let captured = null;
  const originalExit = process.exit;
  const originalLog = console.log;
  try {
    process.exit = (code) => {
      captured.exitCode = code;
      throw new Error(`EXIT_${code}`);
    };
    console.log = (msg) => {
      try { captured.payload = JSON.parse(msg); } catch {}
    };

    captured = {};
    await assert.rejects(
      async () => {
        await resolveCommandInputs('remember', { file: filePath, path: 'tests/bounded' }, { json: true });
      },
      /EXIT_1/
    );
    assert.equal(captured.exitCode, 1);
    assert.equal(captured.payload.ok, false);
    assert.equal(captured.payload.error.code, 'content_too_large');
    assert.match(captured.payload.error.message, /exceeds maximum limit of 524288 bytes\./);
  } finally {
    fsPromises.default.stat = originalStat;
    process.exit = originalExit;
    console.log = originalLog;
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
test('F1-6c: rejectBooleanValue rejects inline values for boolean flags with exact error text', async () => {
  const { rejectBooleanValue, parseArgs } = await import('../skills/xmemo/scripts/lib/cli-input.mjs');

  assert.throws(
    () => rejectBooleanValue('json', '1'),
    (err) => err.message === '--json does not accept a value; pass it as a bare flag.'
  );
  assert.throws(
    () => rejectBooleanValue('terminal', 'true'),
    (err) => err.message === '--terminal does not accept a value; pass it as a bare flag.'
  );

  assert.throws(
    () => parseArgs(['overview', '--json=1']),
    (err) => err.message === '--json does not accept a value; pass it as a bare flag.'
  );

  const res = await runScript(['overview', '--json=1']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /Error: --json does not accept a value; pass it as a bare flag\./);
});

test('F1-7: restart-snapshot --json maps 400 detail to invalid_request envelope and exit code 1', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({ detail: 'Invalid snapshot arguments' }, 400);
  try {
    const res = await runScript(['restart-snapshot', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'Invalid snapshot arguments',
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-8: restart-snapshot --json preserves request_id in failure envelope', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({ detail: 'Invalid snapshot key', request_id: 'req-snap-400' }, 400);
  try {
    const res = await runScript(['restart-snapshot', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'Invalid snapshot key',
        request_id: 'req-snap-400',
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-9: restart-snapshot --json maps 404 to HTTP 404 code and exit code 1', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({ detail: 'Session context not found' }, 404);
  try {
    const res = await runScript(['restart-snapshot', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'HTTP 404',
        message: 'Session context not found',
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-10: restart-snapshot --json maps 500 to HTTP 500 code and exit code 3', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({ detail: 'Database transaction failed', request_id: 'req-snap-500' }, 500);
  try {
    const res = await runScript(['restart-snapshot', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 3);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'HTTP 500',
        message: 'Database transaction failed',
        request_id: 'req-snap-500',
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-11: restart-snapshot --json preserves server { ok: false, error } structure', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({
    ok: false,
    error: {
      code: 'quota_exceeded',
      message: 'Snapshot storage quota reached',
      current_usage: 10,
    },
  }, 429);
  try {
    const res = await runScript(['restart-snapshot', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'quota_exceeded',
        message: 'Snapshot storage quota reached',
        current_usage: 10,
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-12: restart-restore --json maps 400 detail to invalid_request envelope and exit code 1', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({ detail: 'Invalid restore arguments' }, 400);
  try {
    const res = await runScript(['restart-restore', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'Invalid restore arguments',
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-13: restart-restore --json maps 404 to HTTP 404 code and exit code 1', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({ detail: 'Snapshot not found', request_id: 'req-rst-404' }, 404);
  try {
    const res = await runScript(['restart-restore', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'HTTP 404',
        message: 'Snapshot not found',
        request_id: 'req-rst-404',
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-14: restart-restore --json maps 500 to HTTP 500 code and exit code 3', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({ detail: 'Internal restore crash' }, 500);
  try {
    const res = await runScript(['restart-restore', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 3);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'HTTP 500',
        message: 'Internal restore crash',
      },
    });
  } finally {
    await testServer.stop();
  }
});

test('F1-15: restart-restore --json preserves server { ok: false, error } structure', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();
  testServer.setResponse({
    ok: false,
    error: {
      code: 'snapshot_conflict',
      message: 'Active session state conflicts with target snapshot',
      conflict_key: 'active_task',
    },
  }, 409);
  try {
    const res = await runScript(['restart-restore', '--json'], {
      baseUrl,
      env: { XMEMO_KEY: 'test-token' },
    });
    assert.equal(res.code, 1);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload, {
      ok: false,
      error: {
        code: 'snapshot_conflict',
        message: 'Active session state conflicts with target snapshot',
        conflict_key: 'active_task',
      },
    });
  } finally {
    await testServer.stop();
  }
});
