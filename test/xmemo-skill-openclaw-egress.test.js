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
  isOpenClawSentinel,
  isProxyEnvActive,
  assertOpenClawEgress,
  assertEgressSecurity,
  sanitizeSensitiveValue,
  OPENCLAW_SENTINEL_REGEX,
  ALLOWED_EGRESS_ORIGIN,
} from '../skills/xmemo/scripts/lib/openclaw-egress.mjs';

import {
  getStoredCredential,
  saveToken,
} from '../skills/xmemo/scripts/lib/auth-state.mjs';

import { redactSensitiveResponse, safeJson } from '../skills/xmemo/scripts/lib/api.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');


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
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('openclaw-egress: isOpenClawSentinel identifies valid sentinels and rejects look-alikes', () => {
  // Valid sentinels
  assert.equal(isOpenClawSentinel('oc-sent-v2.abc.end'), true);
  assert.equal(isOpenClawSentinel('oc-sent-v2.A_1-b.end'), true);
  assert.equal(isOpenClawSentinel('oc-sent-v2.XMEMO_KEY_gateway_12345.end'), true);
  assert.equal(isOpenClawSentinel('oc-sent-v2.a.end'), true);

  // Look-alikes and invalid
  assert.equal(isOpenClawSentinel('oc-sent-v2.invalid!char.end'), false);
  assert.equal(isOpenClawSentinel('oc-sent-v2.has spaces.end'), false);
  assert.equal(isOpenClawSentinel('oc-sent-v2.abc'), false); // missing .end
  assert.equal(isOpenClawSentinel('prefix.oc-sent-v2.abc.end'), false);
  assert.equal(isOpenClawSentinel('oc-sent-v2.abc.end.suffix'), false);
  assert.equal(isOpenClawSentinel('oc-sent-v1.abc.end'), false);
  assert.equal(isOpenClawSentinel('oc-sent-v2..end'), false); // empty payload
  assert.equal(isOpenClawSentinel(''), false);
  assert.equal(isOpenClawSentinel(null), false);
  assert.equal(isOpenClawSentinel(undefined), false);
  assert.equal(isOpenClawSentinel(12345), false);
  assert.equal(isOpenClawSentinel({}), false);
});

test('openclaw-egress: getStoredCredential handles sentinels as openclaw-secret with zero daemon access', async () => {
  const sentinelToken = 'oc-sent-v2.gateway-secret-token.end';
  const originalKey = process.env.XMEMO_KEY;
  const originalSock = process.env.JARVIS_AUTHD_SOCK;

  try {
    // 1. Sentinel in XMEMO_KEY
    process.env.XMEMO_KEY = sentinelToken;
    process.env.JARVIS_AUTHD_SOCK = '/nonexistent/mock/sock/path';

    const cred = await getStoredCredential();
    assert.deepEqual(cred, {
      token: sentinelToken,
      credential_type: 'environment',
      storage: 'openclaw-secret',
    });

    // 2. Ordinary token in XMEMO_KEY
    process.env.XMEMO_KEY = 'mos_ordinary_token_abc';
    const credOrdinary = await getStoredCredential();
    assert.deepEqual(credOrdinary, {
      token: 'mos_ordinary_token_abc',
      credential_type: 'environment',
      storage: 'environment',
    });

    // 3. Look-alike invalid sentinel is treated as ordinary environment token
    process.env.XMEMO_KEY = 'oc-sent-v2.invalid!token';
    const credLookalike = await getStoredCredential();
    assert.deepEqual(credLookalike, {
      token: 'oc-sent-v2.invalid!token',
      credential_type: 'environment',
      storage: 'environment',
    });
  } finally {
    if (originalKey === undefined) delete process.env.XMEMO_KEY;
    else process.env.XMEMO_KEY = originalKey;
    if (originalSock === undefined) delete process.env.JARVIS_AUTHD_SOCK;
    else process.env.JARVIS_AUTHD_SOCK = originalSock;
  }
});

test('openclaw-egress: proxy environment precheck requires proxy and truthy NODE_USE_ENV_PROXY', () => {
  // Missing both
  assert.equal(isProxyEnvActive({}), false);

  // HTTPS_PROXY only
  assert.equal(isProxyEnvActive({ HTTPS_PROXY: 'http://127.0.0.1:8080' }), false);

  // NODE_USE_ENV_PROXY only
  assert.equal(isProxyEnvActive({ NODE_USE_ENV_PROXY: '1' }), false);

  // NODE_USE_ENV_PROXY is '0' or 'false'
  assert.equal(isProxyEnvActive({ HTTPS_PROXY: 'http://127.0.0.1:8080', NODE_USE_ENV_PROXY: '0' }), false);
  assert.equal(isProxyEnvActive({ HTTPS_PROXY: 'http://127.0.0.1:8080', NODE_USE_ENV_PROXY: 'false' }), false);

  // Valid proxy configurations
  assert.equal(isProxyEnvActive({ HTTPS_PROXY: 'http://127.0.0.1:8080', NODE_USE_ENV_PROXY: '1' }), true);
  assert.equal(isProxyEnvActive({ https_proxy: 'http://127.0.0.1:8080', NODE_USE_ENV_PROXY: '1' }), true);
  assert.equal(isProxyEnvActive({ HTTPS_PROXY: 'http://127.0.0.1:8080', NODE_USE_ENV_PROXY: 'true' }), true);
});

test('openclaw-egress: fail-closed when proxy environment is inactive with zero network requests', async () => {
  const sentinelToken = 'oc-sent-v2.test-fail-closed.end';
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-oc-home-'));

  try {
    // 1. Without any proxy env
    const resNoProxy = await runCli(['auth', 'status', '--verify'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
        HTTPS_PROXY: '',
        https_proxy: '',
        NODE_USE_ENV_PROXY: '',
      },
    });

    assert.equal(resNoProxy.code, 1);
    assert.match(resNoProxy.stderr, /OpenClaw egress proxy is required when using OpenClaw secrets/);
    assert.match(resNoProxy.stderr, /secrets\.egressProxy\.enabled/);

    // 2. With HTTPS_PROXY but NODE_USE_ENV_PROXY missing
    const resNoNodeEnv = await runCli(['auth', 'status', '--verify'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
        HTTPS_PROXY: 'http://127.0.0.1:9999',
        NODE_USE_ENV_PROXY: '',
      },
    });

    assert.equal(resNoNodeEnv.code, 1);
    assert.match(resNoNodeEnv.stderr, /OpenClaw egress proxy is required when using OpenClaw secrets/);

    // 3. With NODE_USE_ENV_PROXY='0'
    const resDisabledNodeEnv = await runCli(['auth', 'status', '--verify'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
        HTTPS_PROXY: 'http://127.0.0.1:9999',
        NODE_USE_ENV_PROXY: '0',
      },
    });

    assert.equal(resDisabledNodeEnv.code, 1);
    assert.match(resDisabledNodeEnv.stderr, /OpenClaw egress proxy is required when using OpenClaw secrets/);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('openclaw-egress: origin guard rejects custom base URL with zero network requests', async () => {
  const sentinelToken = 'oc-sent-v2.test-origin-guard.end';
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-oc-home-'));

  // Dummy target HTTP server
  let requestsReceived = 0;
  const dummyServer = http.createServer((req, res) => {
    requestsReceived++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  const dummyPort = await new Promise((resolve) => {
    dummyServer.listen(0, '127.0.0.1', () => resolve(dummyServer.address().port));
  });

  try {
    const res = await runCli(['auth', 'status', '--verify', '--base-url', `http://127.0.0.1:${dummyPort}`], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
        HTTPS_PROXY: 'http://127.0.0.1:8080',
        NODE_USE_ENV_PROXY: '1',
      },
    });

    assert.equal(res.code, 1);
    assert.match(res.stderr, /OpenClaw secret sentinels are restricted to https:\/\/xmemo\.dev/);
    assert.match(res.stderr, /Unset XMEMO_BASE_URL or use a standard credential/);
    assert.equal(requestsReceived, 0, 'Target server must not receive any request');
  } finally {
    await new Promise((resolve) => dummyServer.close(resolve));
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('openclaw-egress: precheck accepts authenticated proxy with credentials in HTTPS_PROXY', async () => {
  const sentinelToken = 'oc-sent-v2.test-auth-proxy.end';
  const authProxyUrl = 'http://openclaw-proc:secret-token-12345@127.0.0.1:18789';

  // 1. isProxyEnvActive recognizes auth-requiring proxy URL
  assert.equal(
    isProxyEnvActive({ HTTPS_PROXY: authProxyUrl, NODE_USE_ENV_PROXY: '1' }),
    true
  );
  assert.equal(
    isProxyEnvActive({ https_proxy: authProxyUrl, NODE_USE_ENV_PROXY: '1' }),
    true
  );

  // 2. assertOpenClawEgress passes with auth-requiring proxy URL
  assert.doesNotThrow(() => {
    assertOpenClawEgress(sentinelToken, 'https://xmemo.dev', {
      HTTPS_PROXY: authProxyUrl,
      NODE_USE_ENV_PROXY: '1',
    });
  });

  // 3. assertEgressSecurity passes with auth-requiring proxy URL
  assert.doesNotThrow(() => {
    assertEgressSecurity(`Bearer ${sentinelToken}`, 'https://xmemo.dev', {
      HTTPS_PROXY: authProxyUrl,
      NODE_USE_ENV_PROXY: '1',
    });
  });

  // 4. CLI with auth-requiring proxy executes precheck and reports openclaw-secret
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-oc-home-'));
  try {
    const res = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
        HTTPS_PROXY: authProxyUrl,
        NODE_USE_ENV_PROXY: '1',
      },
    });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Credential Source: openclaw-secret/);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('openclaw-egress: auth status displays openclaw-secret without printing sentinel token', async () => {
  const sentinelToken = 'oc-sent-v2.my-secret-key-sentinel.end';
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-oc-home-'));

  try {
    // 1. Text mode
    const resText = await runCli(['auth', 'status'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
      },
    });

    assert.equal(resText.code, 0);
    assert.match(resText.stdout, /Status: Logged in/);
    assert.match(resText.stdout, /Credential Source: openclaw-secret/);
    assert.equal(resText.stdout.includes('oc-sent-v2.'), false, 'Sentinel token must never be printed in text output');

    // 2. JSON mode
    const resJson = await runCli(['auth', 'status', '--json'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
      },
    });

    assert.equal(resJson.code, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.equal(parsed.status, 'logged_in');
    assert.equal(parsed.credential_source, 'openclaw-secret');
    assert.equal(resJson.stdout.includes('oc-sent-v2.'), false, 'Sentinel token must never appear in JSON output');
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('openclaw-egress: logout preserves openclaw-secret and refuses --revoke-environment-token', async () => {
  const sentinelToken = 'oc-sent-v2.logout-test-sentinel.end';
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-oc-home-'));

  try {
    // 1. Standard text logout
    const resText = await runCli(['logout'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
      },
    });

    assert.equal(resText.code, 0);
    assert.match(resText.stdout, /XMemo credential is provided by OpenClaw \(openclaw-secret\)/);
    assert.match(resText.stdout, /openclaw secrets delete/);

    // 2. JSON logout
    const resJson = await runCli(['logout', '--json'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
      },
    });

    assert.equal(resJson.code, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.deepEqual(parsed, {
      status: 'openclaw_secret_unchanged',
      credential_source: 'openclaw-secret',
      remote_revoked: false,
      local_file_removed: false,
    });

    // 3. Logout with --revoke-environment-token must be refused
    const resRefused = await runCli(['logout', '--revoke-environment-token'], {
      homeDir: tmpHome,
      env: {
        XMEMO_KEY: sentinelToken,
      },
    });

    assert.equal(resRefused.code, 1);
    assert.match(resRefused.stderr, /OpenClaw secret sentinels are managed by OpenClaw and cannot be revoked remotely/);
    assert.match(resRefused.stderr, /openclaw secrets delete/);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('openclaw-egress: saveToken and auth add reject sentinel tokens', async () => {
  const sentinelToken = 'oc-sent-v2.attempt-to-persist-sentinel.end';
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-oc-home-'));

  try {
    // 1. Direct saveToken call
    await assert.rejects(
      async () => {
        await saveToken(sentinelToken, {}, { allowPlaintext: true });
      },
      /Refusing to persist OpenClaw sentinel token to disk/
    );

    // 2. CLI auth add from stdin
    const res = await runCli(['auth', 'add', '--from-stdin', '--allow-plaintext'], {
      homeDir: tmpHome,
      stdin: sentinelToken,
    });

    assert.equal(res.code, 1);
    assert.match(res.stderr, /Refusing to store OpenClaw sentinel token/);

    // Verify no credential file was written
    const credPath = path.join(tmpHome, '.xmemo', 'skill-credentials.json');
    let exists = false;
    try {
      await fs.stat(credPath);
      exists = true;
    } catch {}
    assert.equal(exists, false, 'No credentials file should be created for sentinel token');
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('openclaw-egress: redaction covers sentinel strings', () => {
  const sentinel = 'oc-sent-v2.secret_data_123.end';

  // 1. Direct sentinel value
  assert.equal(sanitizeSensitiveValue(sentinel), '[REDACTED]');
  assert.equal(redactSensitiveResponse(sentinel), '[REDACTED]');

  // 2. Embedded in text
  const textWithSentinel = `Failed with token oc-sent-v2.embed-secret.end in request`;
  assert.equal(
    sanitizeSensitiveValue(textWithSentinel),
    'Failed with token [REDACTED] in request'
  );

  // 3. Inside object and JSON
  const payload = {
    error: {
      message: `Error carrying oc-sent-v2.embed-secret.end token`,
      token: sentinel,
    },
  };
  const jsonStr = safeJson(payload);
  assert.equal(jsonStr.includes('oc-sent-v2.'), false, 'JSON output must never contain sentinel strings');
  assert.equal(jsonStr.includes('[REDACTED]'), true);
});
