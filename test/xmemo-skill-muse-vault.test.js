import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  isSurrogateToken,
  validateSurrogate,
  assertSurrogateOrigin,
  VaultKeyError,
  VAULT_CREDENTIAL_NAME,
  VAULT_ENTRY_NAME,
  VAULT_ALLOWED_ORIGIN,
  getVaultSurrogate,
} from '../skills/xmemo/scripts/lib/muse-vault.mjs';

import {
  getStoredCredential,
  saveToken,
} from '../skills/xmemo/scripts/lib/auth-state.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');

function createMockAuthdServer() {
  const isWindows = process.platform === 'win32';
  const socketDir = isWindows ? '' : (process.platform === 'darwin' ? '/tmp' : os.tmpdir());
  const socketPath = isWindows
    ? `\\\\.\\pipe\\authd-mock-${Date.now()}-${randomUUID()}`
    : path.join(socketDir, `mv-${Date.now()}-${randomUUID().slice(0, 8)}.sock`);

  let handler = null;
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsed,
      });

      if (handler) {
        handler(req, res, parsed);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'hsurr:mock-surrogate-token-12345' }));
      }
    });
  });

  return {
    socketPath,
    requests,
    setHandler: (fn) => {
      handler = fn;
    },
    start: () =>
      new Promise((resolve, reject) => {
        server.listen(socketPath, () => resolve(socketPath));
        server.on('error', reject);
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(async () => {
          if (!isWindows) {
            await fs.unlink(socketPath).catch(() => {});
          }
          resolve();
        });
      }),
  };
}

async function runCli(args, { homeDir, env = {}, stdin } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const childEnv = {
      ...process.env,
      HOME: homeDir || process.env.HOME,
      USERPROFILE: homeDir || process.env.USERPROFILE,
      XMEMO_FORCE_TTY: '1',
      ...env,
    };

    const child = spawn(process.execPath, [skillScript, ...args], {
      env: childEnv,
      cwd: repoRoot,
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
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

test('muse-vault: unit tests for surrogate helpers and errors', () => {
  assert.equal(isSurrogateToken('hsurr:abc'), true);
  assert.equal(isSurrogateToken('hsurr:1234567890'), true);
  assert.equal(isSurrogateToken('mos_live_key'), false);
  assert.equal(isSurrogateToken(''), false);
  assert.equal(isSurrogateToken(null), false);
  assert.equal(isSurrogateToken(undefined), false);

  assert.equal(validateSurrogate('hsurr:valid-surrogate-123'), 'hsurr:valid-surrogate-123');
  assert.throws(() => validateSurrogate('invalid-prefix'), (err) => err instanceof VaultKeyError && err.code === 'authd_error');
  assert.throws(() => validateSurrogate('hsurr:'), (err) => err instanceof VaultKeyError && err.code === 'authd_error');
  assert.throws(() => validateSurrogate('hsurr:with space'), (err) => err instanceof VaultKeyError && err.code === 'authd_error');
  assert.throws(() => validateSurrogate('hsurr:with\nnewline'), (err) => err instanceof VaultKeyError && err.code === 'authd_error');
  assert.throws(() => validateSurrogate('hsurr:' + 'a'.repeat(4097)), (err) => err instanceof VaultKeyError && err.code === 'authd_error');

  // Origin check
  assert.doesNotThrow(() => assertSurrogateOrigin('Bearer hsurr:abc123', 'https://xmemo.dev/v1/memories'));
  assert.doesNotThrow(() => assertSurrogateOrigin('Bearer hsurr:abc123', new URL('https://xmemo.dev/v1/memories')));
  assert.doesNotThrow(() => assertSurrogateOrigin('Bearer mos_regular_token', 'https://custom.xmemo.internal'));
  assert.doesNotThrow(() => assertSurrogateOrigin(null, 'https://custom.xmemo.internal'));
  assert.throws(
    () => assertSurrogateOrigin('Bearer hsurr:abc123', 'https://custom.xmemo.internal'),
    /Meta Muse vault credentials \(surrogate\) are restricted to https:\/\/xmemo\.dev/
  );
  assert.throws(
    () => assertSurrogateOrigin('Bearer hsurr:abc123', 'http://127.0.0.1:8080'),
    /Meta Muse vault credentials \(surrogate\) are restricted to https:\/\/xmemo\.dev/
  );

  const err = new VaultKeyError('Test error', 'unavailable');
  assert.equal(err.code, 'unavailable');
  assert.equal(err.name, 'VaultKeyError');
});

test('muse-vault: unavailable socket triggers silent fallback to file credential with zero stderr', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));
  const xmemoDir = path.join(tmpHome, '.xmemo');
  await fs.mkdir(xmemoDir, { recursive: true });
  await fs.writeFile(
    path.join(xmemoDir, 'skill-credentials.json'),
    JSON.stringify({
      token: 'mos_fallback_file_token',
      storage: 'plaintext-user-file',
      plaintext_storage_consent: true,
    })
  );

  const nonExistentSock = process.platform === 'win32'
    ? '\\\\.\\pipe\\nonexistent-authd-sock-test'
    : path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), `nonexistent-sock-${randomUUID().slice(0, 8)}.sock`);

  try {
    const res = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: nonExistentSock,
        XMEMO_KEY: '',
      },
    });

    assert.equal(res.code, 0);
    assert.match(res.stdout, /Credential Source: formal-user-credential-file/);
    assert.equal(res.stderr.trim(), '');
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: 403 and 404 from authd trigger silent fallback with zero stderr', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));
  const xmemoDir = path.join(tmpHome, '.xmemo');
  await fs.mkdir(xmemoDir, { recursive: true });
  await fs.writeFile(
    path.join(xmemoDir, 'skill-credentials.json'),
    JSON.stringify({
      token: 'mos_fallback_file_token',
      storage: 'plaintext-user-file',
      plaintext_storage_consent: true,
    })
  );

  try {
    // 404 case
    authd.setHandler((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    const res404 = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(res404.code, 0);
    assert.match(res404.stdout, /Credential Source: formal-user-credential-file/);
    assert.equal(res404.stderr.trim(), '');

    // 403 case
    authd.setHandler((req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
    });

    const res403 = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(res403.code, 0);
    assert.match(res403.stdout, /Credential Source: formal-user-credential-file/);
    assert.equal(res403.stderr.trim(), '');
  } finally {
    await authd.stop();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: 500, malformed JSON, and non-hsurr value trigger exactly one stderr line + fallback', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));
  const xmemoDir = path.join(tmpHome, '.xmemo');
  await fs.mkdir(xmemoDir, { recursive: true });
  await fs.writeFile(
    path.join(xmemoDir, 'skill-credentials.json'),
    JSON.stringify({
      token: 'mos_fallback_file_token',
      storage: 'plaintext-user-file',
      plaintext_storage_consent: true,
    })
  );

  try {
    // 500 server error
    authd.setHandler((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    });

    const res500 = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(res500.code, 0);
    assert.match(res500.stdout, /Credential Source: formal-user-credential-file/);
    const stderrLines500 = res500.stderr.trim().split('\n');
    assert.equal(stderrLines500.length, 1);
    assert.match(stderrLines500[0], /⚠️ Meta Muse vault error: Auth daemon returned HTTP 500/);

    // Malformed JSON
    authd.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('invalid-json{{{');
    });

    const resMalformed = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(resMalformed.code, 0);
    assert.match(resMalformed.stdout, /Credential Source: formal-user-credential-file/);
    const stderrLinesMalformed = resMalformed.stderr.trim().split('\n');
    assert.equal(stderrLinesMalformed.length, 1);
    assert.match(stderrLinesMalformed[0], /⚠️ Meta Muse vault error: Failed to parse auth daemon response as JSON/);

    // Non-hsurr token
    authd.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'not-a-surrogate-token' }));
    });

    const resNonHsurr = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(resNonHsurr.code, 0);
    assert.match(resNonHsurr.stdout, /Credential Source: formal-user-credential-file/);
    const stderrLinesNonHsurr = resNonHsurr.stderr.trim().split('\n');
    assert.equal(stderrLinesNonHsurr.length, 1);
    assert.match(stderrLinesNonHsurr[0], /⚠️ Meta Muse vault error: Invalid surrogate token/);
  } finally {
    await authd.stop();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: authd hit returns surrogate and auth status shows muse-vault without exposing token', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));

  try {
    const res = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(res.code, 0);
    assert.match(res.stdout, /Status: Logged in/);
    assert.match(res.stdout, /Credential Source: muse-vault/);
    assert.equal(res.stdout.includes('hsurr:'), false, 'Surrogate token must never be printed in stdout');
    assert.equal(res.stderr.trim(), '');

    // JSON mode
    const resJson = await runCli(['auth', 'status', '--json'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(resJson.code, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.equal(parsed.status, 'logged_in');
    assert.equal(parsed.credential_source, 'muse-vault');
    assert.equal(resJson.stdout.includes('hsurr:'), false, 'Surrogate token must never appear in JSON output');

    // Verify authd received correct payload
    assert.equal(authd.requests.length >= 2, true);
    assert.equal(authd.requests[0].method, 'POST');
    assert.equal(authd.requests[0].url, '/v1/credentials/surrogate');
    assert.deepEqual(authd.requests[0].body, { name: VAULT_CREDENTIAL_NAME });
  } finally {
    await authd.stop();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: origin guard rejects custom base URL with zero network requests', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  // Create a dummy HTTP server for the custom base URL
  let networkRequestsMade = 0;
  const mockApiServer = http.createServer((req, res) => {
    networkRequestsMade++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, results: [] }));
  });

  const apiPort = await new Promise((resolve) => {
    mockApiServer.listen(0, '127.0.0.1', () => resolve(mockApiServer.address().port));
  });

  const customBaseUrl = `http://127.0.0.1:${apiPort}`;
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));

  try {
    const res = await runCli(['recall', '--query', 'test-query', '--base-url', customBaseUrl], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(res.code, 1);
    assert.match(res.stderr, /Meta Muse vault credentials \(surrogate\) are restricted to https:\/\/xmemo\.dev/);
    assert.match(res.stderr, /Unset XMEMO_BASE_URL or use a standard credential/);
    assert.equal(networkRequestsMade, 0, 'Target server must have received exactly 0 network requests');
  } finally {
    await new Promise((resolve) => mockApiServer.close(resolve));
    await authd.stop();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: saveToken and auth add reject surrogate tokens', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));

  try {
    // 1. saveToken() direct call rejection
    await assert.rejects(
      async () => {
        await saveToken('hsurr:attempt-to-persist-surrogate', {}, { allowPlaintext: true });
      },
      /Refusing to persist Meta Muse surrogate token to disk/
    );

    // 2. auth add CLI rejection
    const res = await runCli(['auth', 'add', '--from-stdin', '--allow-plaintext'], {
      homeDir: tmpHome,
      stdin: 'hsurr:attempt-to-add-via-stdin',
    });

    assert.equal(res.code, 1);
    assert.match(res.stderr, /Refusing to store Meta Muse surrogate token/);

    // Assert no credential file was written
    const credPath = path.join(tmpHome, '.xmemo', 'skill-credentials.json');
    let exists = false;
    try {
      await fs.stat(credPath);
      exists = true;
    } catch {}
    assert.equal(exists, false, 'No credentials file should be created');
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: logout sends no revoke request, deletes no files, and outputs unchanged notice', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));
  const xmemoDir = path.join(tmpHome, '.xmemo');
  await fs.mkdir(xmemoDir, { recursive: true });
  const dummyFile = path.join(xmemoDir, 'skill-credentials.json');
  await fs.writeFile(dummyFile, JSON.stringify({ token: 'dummy_local_file_token', storage: 'plaintext-user-file' }));

  try {
    // Plain text logout
    const resText = await runCli(['logout'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(resText.code, 0);
    assert.match(resText.stdout, /XMemo credential is provided by Meta Muse \(muse-vault\)/);
    assert.match(resText.stdout, /To disconnect, remove the credential in Meta Muse/);

    // Local file must be preserved
    const fileStillExists = await fs.stat(dummyFile).then(() => true).catch(() => false);
    assert.equal(fileStillExists, true, 'Local credential file must not be deleted on vault logout');

    // JSON mode logout
    const resJson = await runCli(['logout', '--json'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: '',
      },
    });

    assert.equal(resJson.code, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.deepEqual(parsed, {
      status: 'vault_credential_unchanged',
      credential_source: 'muse-vault',
      remote_revoked: false,
      local_file_removed: false,
    });
  } finally {
    await authd.stop();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: XMEMO_KEY set in environment short-circuits authd with zero socket access', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));

  try {
    const res = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        JARVIS_AUTHD_SOCK: authd.socketPath,
        XMEMO_KEY: 'mos_explicit_env_token_123',
      },
    });

    assert.equal(res.code, 0);
    assert.match(res.stdout, /Credential Source: XMEMO_KEY/);
    assert.equal(authd.requests.length, 0, 'Auth daemon must have received 0 requests when XMEMO_KEY is set');
  } finally {
    await authd.stop();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: authd timeout triggers authd_error with single stderr line', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-home-'));
  const xmemoDir = path.join(tmpHome, '.xmemo');
  await fs.mkdir(xmemoDir, { recursive: true });
  await fs.writeFile(
    path.join(xmemoDir, 'skill-credentials.json'),
    JSON.stringify({
      token: 'mos_fallback_file_token',
      storage: 'plaintext-user-file',
      plaintext_storage_consent: true,
    })
  );

  try {
    // Hang request to trigger timeout
    authd.setHandler((req, res) => {
      // Never send response
    });

    // Test getVaultSurrogate timeout option directly
    await assert.rejects(
      async () => {
        await getVaultSurrogate({ socketPath: authd.socketPath, timeoutMs: 50 });
      },
      (err) => err instanceof VaultKeyError && err.code === 'authd_error' && /timed out/.test(err.message)
    );
  } finally {
    await authd.stop();
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('muse-vault: response size cap rejects oversized responses from authd', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  try {
    authd.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Send 70 KiB of data (limit is 64 KiB)
      res.write('{"access_token":"hsurr:' + 'a'.repeat(70000) + '"}');
      res.end();
    });

    await assert.rejects(
      async () => {
        await getVaultSurrogate({ socketPath: authd.socketPath });
      },
      (err) => err instanceof VaultKeyError && err.code === 'authd_error'
    );
  } finally {
    await authd.stop();
  }
});

test('muse-vault: auth daemon response split inside multi-byte CJK character decodes correctly without U+FFFD', async () => {
  const authd = createMockAuthdServer();
  await authd.start();

  const testPayload = {
    access_token: 'hsurr:mock-surrogate-token-cjk-split-999',
    description: '中文密钥描述，测试跨TCP分块解码完整性',
  };
  const jsonStr = JSON.stringify(testPayload);
  const buf = Buffer.from(jsonStr, 'utf8');

  // Split deliberately inside '中' (1 + 2 bytes across chunks)
  const cjkIndex = buf.indexOf(Buffer.from('中', 'utf8'));
  assert.ok(cjkIndex >= 0);
  const splitPoint = cjkIndex + 1;

  try {
    authd.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(buf.subarray(0, splitPoint));
      setTimeout(() => {
        res.write(buf.subarray(splitPoint));
        res.end();
      }, 15);
    });

    const surrogate = await getVaultSurrogate({ socketPath: authd.socketPath });
    assert.equal(surrogate, 'hsurr:mock-surrogate-token-cjk-split-999');
  } finally {
    await authd.stop();
  }
});


