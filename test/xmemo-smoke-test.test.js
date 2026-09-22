import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  READ_ONLY_COMMANDS,
  WRITE_COMMANDS,
  parseArgs,
  runSmokeTests,
} from '../skills/xmemo/scripts/smoke-test.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeScript = path.join(repoRoot, 'skills/xmemo/scripts/smoke-test.mjs');
const skillScript = path.join(repoRoot, 'skills/xmemo/scripts/xmemo-skill.mjs');

function createTestServer() {
  const requests = [];
  let responseData = { ok: true, result: {} };
  let responseStatus = 200;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsedBody = null;
      try {
        if (body) parsedBody = JSON.parse(body);
      } catch {
        parsedBody = body;
      }
      requests.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: parsedBody,
      });

      // Probe paths handling
      if (req.url?.includes('__smoke_probe_nonexistent_id__')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Item not found' } }));
        return;
      }

      // Default responses
      if (typeof responseData === 'function') {
        const result = responseData(req, parsedBody);
        res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
        return;
      }

      res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
    });
  });

  return {
    server,
    requests,
    setResponse: (data, status = 200) => {
      responseData = data;
      responseStatus = status;
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

async function runChildScript(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      cwd: repoRoot,
    });
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

test('smoke-test: exports command arrays and constants', () => {
  assert.ok(Array.isArray(READ_ONLY_COMMANDS));
  assert.ok(READ_ONLY_COMMANDS.length >= 15);
  assert.ok(Object.isFrozen(READ_ONLY_COMMANDS));

  assert.ok(Array.isArray(WRITE_COMMANDS));
  assert.ok(WRITE_COMMANDS.length >= 9);
  assert.ok(Object.isFrozen(WRITE_COMMANDS));

  const readIds = READ_ONLY_COMMANDS.map((c) => c.id);
  assert.ok(readIds.includes('version'));
  assert.ok(readIds.includes('help'));
  assert.ok(readIds.includes('doctor-anonymous'));
  assert.ok(readIds.includes('auth-status'));
  assert.ok(readIds.includes('overview'));
  assert.ok(readIds.includes('activity'));
  assert.ok(readIds.includes('stats'));
  assert.ok(readIds.includes('ledger-list'));
  assert.ok(readIds.includes('ledger-summary'));
  assert.ok(readIds.includes('todo-list'));
  assert.ok(readIds.includes('search'));
  assert.ok(readIds.includes('recall'));
  assert.ok(readIds.includes('recall-context'));
  assert.ok(readIds.includes('read-probe'));
  assert.ok(readIds.includes('state-restore-probe'));

  const writeIds = WRITE_COMMANDS.map((c) => c.id);
  assert.ok(writeIds.includes('remember'));
  assert.ok(writeIds.includes('update'));
  assert.ok(writeIds.includes('forget'));
  assert.ok(writeIds.includes('todo-add'));
  assert.ok(writeIds.includes('todo-done'));
  assert.ok(writeIds.includes('expense-add'));
  assert.ok(writeIds.includes('save-state'));
  assert.ok(writeIds.includes('restart-snapshot'));
  assert.ok(writeIds.includes('restart-restore'));
});

test('smoke-test: parseArgs parses CLI options accurately', () => {
  const opts1 = parseArgs([]);
  assert.equal(opts1.executeWrites, false);
  assert.equal(opts1.json, false);
  assert.equal(opts1.verbose, false);
  assert.equal(opts1.help, false);

  const opts2 = parseArgs([
    '--base-url', 'http://127.0.0.1:8080',
    '--timeout-ms', '5000',
    '--execute-writes',
    '--json',
    '--verbose',
    '--token', 'secret-key-123',
  ]);
  assert.equal(opts2.baseUrl, 'http://127.0.0.1:8080');
  assert.equal(opts2.timeoutMs, 5000);
  assert.equal(opts2.executeWrites, true);
  assert.equal(opts2.json, true);
  assert.equal(opts2.verbose, true);
  assert.equal(opts2.token, 'secret-key-123');

  const opts3 = parseArgs(['--help']);
  assert.equal(opts3.help, true);
});

test('smoke-test: CLI --help outputs usage information and exits 0', async () => {
  const res = await runChildScript(smokeScript, ['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /XMemo Skill Pre-Release Smoke Test Runner/);
  assert.match(res.stdout, /--execute-writes/);
  assert.match(res.stdout, /--base-url/);
});

test('smoke-test: default run executes all read-only commands and skips write commands', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse((req) => {
      if (req.url === '/v1/auth/token/validate') {
        return { status: 200, body: { status: 'valid', scopes: ['memory:read'] } };
      }
      if (req.url === '/v1/recall/context') {
        return { status: 200, body: { ok: true, context_text: 'sample context' } };
      }
      return { status: 200, body: { ok: true, result: {} } };
    });

    const res = await runChildScript(smokeScript, [
      '--base-url', baseUrl,
      '--script-path', skillScript,
      '--token', 'test-smoke-key',
      '--json',
    ]);

    assert.equal(res.code, 0, `smoke-test failed: ${res.stderr}\n${res.stdout}`);
    const summary = JSON.parse(res.stdout);
    assert.equal(summary.ok, true);
    assert.equal(summary.failed, 0);
    assert.equal(summary.executeWrites, false);
    assert.equal(summary.passed, READ_ONLY_COMMANDS.length);
    assert.equal(summary.skipped, WRITE_COMMANDS.length);

    // Verify each write command is marked skipped
    const skippedItems = summary.results.filter((r) => r.status === 'skipped');
    assert.equal(skippedItems.length, WRITE_COMMANDS.length);
    for (const item of skippedItems) {
      assert.equal(item.type, 'write');
      assert.match(item.reason, /pass --execute-writes to run/);
    }
  } finally {
    await testServer.stop();
  }
});

test('smoke-test: --execute-writes runs both read-only and write commands', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    testServer.setResponse((req) => {
      if (req.url === '/v1/auth/token/validate') {
        return { status: 200, body: { status: 'valid', scopes: ['memory:read', 'memory:write'] } };
      }
      if (req.url === '/v1/recall/context') {
        return { status: 200, body: { ok: true, context_text: 'sample context' } };
      }
      if (req.url === '/v1/restart/snapshot') {
        return { status: 200, body: { ok: true, snapshot_id: 'snap_123' } };
      }
      return { status: 200, body: { ok: true, result: { id: 'sample_id' } } };
    });

    const res = await runChildScript(smokeScript, [
      '--base-url', baseUrl,
      '--script-path', skillScript,
      '--token', 'test-smoke-key',
      '--execute-writes',
      '--json',
    ]);

    assert.equal(res.code, 0, `smoke-test failed: ${res.stderr}\n${res.stdout}`);
    const summary = JSON.parse(res.stdout);
    assert.equal(summary.ok, true);
    assert.equal(summary.failed, 0);
    assert.equal(summary.executeWrites, true);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.passed, READ_ONLY_COMMANDS.length + WRITE_COMMANDS.length);
  } finally {
    await testServer.stop();
  }
});

test('smoke-test: detects command failure, reports failure checklist, and exits non-zero', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // Inject a 500 error specifically for overview
    testServer.setResponse((req, body) => {
      if (body?.operation === 'overview') {
        return { status: 500, body: { error: { code: 'database_error', message: 'Internal DB failure' } } };
      }
      return { status: 200, body: { ok: true, result: {} } };
    });

    // Test in terminal mode to check human-readable checklist
    const termRes = await runChildScript(smokeScript, [
      '--base-url', baseUrl,
      '--script-path', skillScript,
      '--token', 'test-smoke-key',
    ]);

    assert.equal(termRes.code, 1);
    assert.match(termRes.stderr, /Failed Command Checklist:/);
    assert.match(termRes.stderr, /overview/);
    assert.match(termRes.stderr, /Smoke testing failed\. Aborting release\./);

    // Test in JSON mode to check structured failure envelope
    const jsonRes = await runChildScript(smokeScript, [
      '--base-url', baseUrl,
      '--script-path', skillScript,
      '--token', 'test-smoke-key',
      '--json',
    ]);

    assert.equal(jsonRes.code, 1);
    const summary = JSON.parse(jsonRes.stdout);
    assert.equal(summary.ok, false);
    assert.ok(summary.failed >= 1);
    const overviewFailure = summary.failures.find((f) => f.id === 'overview');
    assert.ok(overviewFailure, 'overview failure should be recorded');
    assert.equal(overviewFailure.status, 'failed');
    assert.match(overviewFailure.error, /exit code 3/);
  } finally {
    await testServer.stop();
  }
});

test('smoke-test: detects envelope missing required ok key and marks as failed', async () => {
  const testServer = createTestServer();
  const baseUrl = await testServer.start();

  try {
    // Mock server returns 200 but response lacks ok: true
    testServer.setResponse((req, body) => {
      if (body?.operation === 'search') {
        return { status: 200, body: { broken_envelope: true } };
      }
      return { status: 200, body: { ok: true, result: {} } };
    });

    const res = await runChildScript(smokeScript, [
      '--base-url', baseUrl,
      '--script-path', skillScript,
      '--token', 'test-smoke-key',
      '--json',
    ]);

    assert.equal(res.code, 1);
    const summary = JSON.parse(res.stdout);
    assert.equal(summary.ok, false);
    const searchFailure = summary.failures.find((f) => f.id === 'search');
    assert.ok(searchFailure, 'search should be marked failed due to missing ok in envelope');
    assert.match(searchFailure.error, /Expected ok: true in envelope/);
  } finally {
    await testServer.stop();
  }
});
