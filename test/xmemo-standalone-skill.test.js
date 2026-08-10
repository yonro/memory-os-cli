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
        standalone_skill: {
          status: 'available',
          runtime_model: 'standalone_skill',
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
  assert.match(res.stdout, /Authentication: Missing\/Unauthenticated/);
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
      'memory:read', 'memory:write', 'memory:restore', 'ledger:write', 'ledger:read'
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
  assert.equal(testServer.requests.at(-1).body.operation, 'todo-add');

  testServer.setResponse({ ok: true, result: { id: 'todo_new' } });
  const doneRes = await runScript(['todo-done', '--id', 'todo_new'], { baseUrl, env });
  assert.equal(doneRes.code, 0);
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
