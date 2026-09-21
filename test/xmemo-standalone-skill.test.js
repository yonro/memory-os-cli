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
    const child = spawn(process.execPath, [skillScript, ...args], {
      env: {
        ...process.env,
        HOME: options.homeDir || process.env.HOME,
        USERPROFILE: options.homeDir || process.env.USERPROFILE,
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
    assert.equal(authRes.code, 1);
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
    assert.equal(forbiddenRes.code, 1);
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
    assert.equal(res401.code, 1);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Read-only token' } }, 403);
    const res403 = await runScript([
      'update', '--id', 'mem_1', '--content', 'new content', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'readonly-token' } });
    assert.equal(res403.code, 1);
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
    assert.match(resTerm.stderr, /Confirmation required to forget memory 'mem_to_delete'/);
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
    assert.match(termRes.stdout, /Memory forgotten \(soft-deleted\)\./);
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
    assert.equal(res401.code, 1);
    const payload401 = JSON.parse(res401.stdout);
    assert.equal(payload401.ok, false);
    assert.equal(payload401.error.code, 'unauthorized');
    assert.notEqual(payload401.error.code, 'not_found');

    testServer.setResponse({ error: { code: 'forbidden', message: 'Read-only token' } }, 403);
    const res403 = await runScript([
      'forget', '--id', 'mem_1', '--confirm', '--json'
    ], { baseUrl, env: { XMEMO_KEY: 'readonly-token' } });
    assert.equal(res403.code, 1);
    const payload403 = JSON.parse(res403.stdout);
    assert.equal(payload403.ok, false);
    assert.equal(payload403.error.code, 'forbidden');
    assert.notEqual(payload403.error.code, 'not_found');
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
});


