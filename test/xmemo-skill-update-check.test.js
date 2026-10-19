import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  CHECK_INTERVAL_MS,
  NOTIFY_INTERVAL_MS,
  DEFAULT_CHECK_TIMEOUT_MS,
  parseSemver,
  compareSemver,
  isUpdateCheckDisabled,
  getUpdateCheckCachePath,
  readUpdateCheckCache,
  writeUpdateCheckCache,
  fetchLatestSkillVersion,
  checkSkillUpdateOnDemand,
  maybeCheckForSkillUpdate,
} from '../skills/xmemo/scripts/lib/update-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');

function runSkill(args, env = {}) {
  return new Promise((resolve, reject) => {
    // Clear CI and XMEMO_NO_UPDATE_CHECK from process.env unless explicitly provided
    const baseEnv = { ...process.env };
    delete baseEnv.CI;
    delete baseEnv.XMEMO_NO_UPDATE_CHECK;

    const child = spawn(process.execPath, [skillScript, ...args], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function createMockServer(options = {}) {
  const requests = [];
  const {
    latestVersion = 'skill-v1.1.45',
    discoveryDelayMs = 0,
    discoveryStatus = 200,
    corruptDiscovery = false,
  } = options;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += String(c)));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (req.url === '/.well-known/agent-discovery.json' && req.method === 'GET') {
        setTimeout(() => {
          if (discoveryStatus !== 200) {
            res.writeHead(discoveryStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'discovery error' }));
            return;
          }
          if (corruptDiscovery) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{ invalid json');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            standalone_skill: {
              package: {
                name: 'xmemo',
                version: latestVersion,
              },
            },
          }));
        }, discoveryDelayMs);
        return;
      }

      if (req.url === '/v1/skill/operations' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          result: [
            { id: 'mem_1', content: 'Design architecture note', memory_type: 'working', score: 0.92 },
          ],
        }));
        return;
      }

      if (req.url === '/v1/recall/context' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          context_text: 'Recall context architecture note',
          items: [{ id: 'mem_1', content: 'Recall context architecture note' }],
        }));
        return;
      }

      if (req.url === '/v1/auth/token/validate' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, scopes: ['memory:read', 'memory:write'], setup_state: 'complete' }));
        return;
      }

      if (req.url === '/v1/status' || req.url === '/v1/doctor') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          status: 'healthy',
          checks: { storage: 'ok', auth: 'ok' },
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Not found' } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('update-check exports constants and semver parser/comparator', () => {
  assert.equal(CHECK_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(NOTIFY_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(DEFAULT_CHECK_TIMEOUT_MS, 1500);

  assert.deepEqual(parseSemver('1.1.44'), { major: 1, minor: 1, patch: 44, prerelease: null });
  assert.deepEqual(parseSemver('v1.1.45'), { major: 1, minor: 1, patch: 45, prerelease: null });
  assert.deepEqual(parseSemver('1.2.0-beta.1'), { major: 1, minor: 2, patch: 0, prerelease: 'beta.1' });
  assert.equal(parseSemver('invalid'), null);
  assert.equal(parseSemver(null), null);

  assert.equal(compareSemver('1.1.44', '1.1.44'), 0);
  assert.ok(compareSemver('1.1.45', '1.1.44') > 0);
  assert.ok(compareSemver('1.1.44', '1.1.45') < 0);
  assert.ok(compareSemver('2.0.0', '1.9.99') > 0);
  assert.ok(compareSemver('1.2.0', '1.1.99') > 0);
});

test('isUpdateCheckDisabled respects environment variables', () => {
  const origEnv = { ...process.env };
  try {
    delete process.env.XMEMO_NO_UPDATE_CHECK;
    delete process.env.CI;
    assert.equal(isUpdateCheckDisabled(), false);

    process.env.XMEMO_NO_UPDATE_CHECK = '1';
    assert.equal(isUpdateCheckDisabled(), true);

    process.env.XMEMO_NO_UPDATE_CHECK = 'true';
    assert.equal(isUpdateCheckDisabled(), true);

    delete process.env.XMEMO_NO_UPDATE_CHECK;
    process.env.CI = 'true';
    assert.equal(isUpdateCheckDisabled(), true);

    process.env.CI = '1';
    assert.equal(isUpdateCheckDisabled(), true);

    process.env.CI = '0';
    assert.equal(isUpdateCheckDisabled(), false);

    process.env.CI = 'false';
    assert.equal(isUpdateCheckDisabled(), false);
  } finally {
    process.env = origEnv;
  }
});

test('readUpdateCheckCache and writeUpdateCheckCache handle file I/O safely', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const cachePath = path.join(tempHome, '.xmemo', 'skill-update-check.json');
  try {
    const missing = await readUpdateCheckCache(cachePath);
    assert.equal(missing, null);

    const testData = {
      lastCheck: '2026-10-19T10:00:00.000Z',
      latestVersion: '1.1.45',
      notifiedVersion: '1.1.45',
      notifiedAt: '2026-10-19T10:00:00.000Z',
    };
    await writeUpdateCheckCache(cachePath, testData);

    const readBack = await readUpdateCheckCache(cachePath);
    assert.deepEqual(readBack, testData);

    // Corrupted file handling
    await writeFile(cachePath, '{ corrupt json');
    const corrupted = await readUpdateCheckCache(cachePath);
    assert.equal(corrupted, null);
  } finally {
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('version --check succeeds and outputs installed/latest/update_available in terminal and json mode', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-ver-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ latestVersion: 'skill-v1.1.45' });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_FORCE_TTY: '1',
    };

    // Terminal mode with update available
    const resTerm = await runSkill(['version', '--check', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stdout, /Installed:\s+1\.1\.44/);
    assert.match(resTerm.stdout, /Latest:\s+1\.1\.45/);
    assert.match(resTerm.stdout, /Update available:\s+yes/);

    // JSON mode with update available
    const resJson = await runSkill(['version', '--check', '--json', '--base-url', mock.baseUrl], env);
    assert.equal(resJson.code, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.deepEqual(parsed, {
      installed: '1.1.44',
      latest: '1.1.45',
      update_available: true,
    });

    // Check request header has no Authorization
    const discoveryReqs = mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json');
    assert.ok(discoveryReqs.length >= 2);
    for (const req of discoveryReqs) {
      assert.equal(req.headers.authorization, undefined, 'agent-discovery.json request must not carry Authorization header');
    }
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('version --check fails gracefully with non-zero exit code when server returns 500 or is down', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-ver-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ discoveryStatus: 500 });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_FORCE_TTY: '1',
    };

    // Terminal mode failure
    const resTerm = await runSkill(['version', '--check', '--terminal', '--base-url', mock.baseUrl], env);
    assert.notEqual(resTerm.code, 0);
    assert.match(resTerm.stderr, /Error: Version check failed/);

    // JSON mode failure
    const resJson = await runSkill(['version', '--check', '--json', '--base-url', mock.baseUrl], env);
    assert.notEqual(resJson.code, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'update_check_failed');
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('recall emits stderr update notification when new version available, stdout untouched, exit code 0', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-recall-upd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ latestVersion: 'skill-v1.1.45' });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      XMEMO_FORCE_TTY: '1',
    };

    // 1. Terminal recall
    const resTerm = await runSkill(['recall', '--query', 'architecture', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(resTerm.code, 0);
    assert.match(resTerm.stderr, /XMEMO_UPDATE_AVAILABLE: XMemo Skill 1\.1\.45 is available \(installed 1\.1\.44\)\. Ask the user once before updating; run: node scripts\/xmemo-skill\.mjs update/);
    assert.match(resTerm.stdout, /Design architecture note/);

    // 2. Cache inspection
    const cacheFile = path.join(tempHome, '.xmemo', 'skill-update-check.json');
    const cacheContent = JSON.parse(await readFile(cacheFile, 'utf8'));
    assert.equal(cacheContent.latestVersion, '1.1.45');
    assert.equal(cacheContent.notifiedVersion, '1.1.45');
    assert.ok(cacheContent.lastCheck);
    assert.ok(cacheContent.notifiedAt);

    // 3. Verify discovery request headers had no Authorization despite XMEMO_KEY set
    const discoveryReqs = mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json');
    assert.equal(discoveryReqs.length, 1);
    assert.equal(discoveryReqs[0].headers.authorization, undefined, 'discovery request MUST NOT carry Authorization header');

    // 4. Operations request had Authorization
    const opReqs = mock.requests.filter((r) => r.url === '/v1/skill/operations');
    assert.equal(opReqs.length, 1);
    assert.match(opReqs[0].headers.authorization, /^Bearer /);
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('recall-context and doctor also perform update check on success', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-cmds-upd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ latestVersion: 'skill-v1.1.45' });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      XMEMO_FORCE_TTY: '1',
    };

    // doctor --anonymous
    const resDoctor = await runSkill(['doctor', '--anonymous', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(resDoctor.code, 0);
    assert.match(resDoctor.stderr, /XMEMO_UPDATE_AVAILABLE: XMemo Skill 1\.1\.45 is available/);

    // doctor in json mode
    const cacheFile = path.join(tempHome, '.xmemo', 'skill-update-check.json');
    await rm(cacheFile, { force: true });

    const resDoctorJson = await runSkill(['doctor', '--anonymous', '--json', '--base-url', mock.baseUrl], env);
    assert.equal(resDoctorJson.code, 0);
    assert.match(resDoctorJson.stderr, /XMEMO_UPDATE_AVAILABLE: XMemo Skill 1\.1\.45 is available/);
    const docParsed = JSON.parse(resDoctorJson.stdout);
    assert.equal(docParsed.ok, true);

    // recall-context in json mode
    await rm(cacheFile, { force: true });
    const resCtxJson = await runSkill(['recall-context', '--query', 'architecture', '--json', '--base-url', mock.baseUrl], env);
    assert.equal(resCtxJson.code, 0);
    assert.match(resCtxJson.stderr, /XMEMO_UPDATE_AVAILABLE: XMemo Skill 1\.1\.45 is available/);
    const ctxParsed = JSON.parse(resCtxJson.stdout);
    assert.equal(ctxParsed.ok, true);
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('throttling: 24h suppresses requests; 7d suppresses duplicate notification for same version', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-throttle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ latestVersion: 'skill-v1.1.45' });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      XMEMO_FORCE_TTY: '1',
    };

    // 1st run: requests discovery, emits notification
    const res1 = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(res1.code, 0);
    assert.match(res1.stderr, /XMEMO_UPDATE_AVAILABLE:/);
    const reqCount1 = mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json').length;
    assert.equal(reqCount1, 1);

    // 2nd run immediately after: 24h throttling prevents network call
    const res2 = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(res2.code, 0);
    assert.doesNotMatch(res2.stderr, /XMEMO_UPDATE_AVAILABLE:/);
    const reqCount2 = mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json').length;
    assert.equal(reqCount2, 1, 'Should make 0 new requests within 24h');

    // 3rd run: Simulate 25 hours passed, but same version 1.1.45 (< 7 days)
    const cacheFile = path.join(tempHome, '.xmemo', 'skill-update-check.json');
    const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
    cache.lastCheck = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    // notifiedAt was 25h ago (< 7 days)
    cache.notifiedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeFile(cacheFile, JSON.stringify(cache, null, 2));

    const res3 = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(res3.code, 0);
    assert.doesNotMatch(res3.stderr, /XMEMO_UPDATE_AVAILABLE:/, 'Same version within 7 days should not re-notify');
    const reqCount3 = mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json').length;
    assert.equal(reqCount3, 2, 'Should check network after 24 hours');
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('notification re-triggers when version increments even if within 7 days', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-bump-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ latestVersion: 'skill-v1.1.46' });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      XMEMO_FORCE_TTY: '1',
    };

    // Pre-populate cache: lastCheck was 25h ago, notifiedVersion was 1.1.45 (1 day ago)
    const cacheFile = path.join(tempHome, '.xmemo', 'skill-update-check.json');
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify({
      lastCheck: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      latestVersion: '1.1.45',
      notifiedVersion: '1.1.45',
      notifiedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    }, null, 2));

    // When latest version becomes 1.1.46: notification MUST be emitted
    const res = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(res.code, 0);
    assert.match(res.stderr, /XMEMO_UPDATE_AVAILABLE: XMemo Skill 1\.1\.46 is available/);
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('XMEMO_NO_UPDATE_CHECK and CI completely suppress update check and cache', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-suppress-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ latestVersion: 'skill-v1.1.45' });

  try {
    // 1. With XMEMO_NO_UPDATE_CHECK=1
    const env1 = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      XMEMO_NO_UPDATE_CHECK: '1',
      XMEMO_FORCE_TTY: '1',
    };
    const res1 = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env1);
    assert.equal(res1.code, 0);
    assert.doesNotMatch(res1.stderr, /XMEMO_UPDATE_AVAILABLE:/);
    assert.equal(mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json').length, 0);

    // 2. With CI=true
    const env2 = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      CI: 'true',
      XMEMO_FORCE_TTY: '1',
    };
    const res2 = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env2);
    assert.equal(res2.code, 0);
    assert.doesNotMatch(res2.stderr, /XMEMO_UPDATE_AVAILABLE:/);
    assert.equal(mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json').length, 0);

    // Verify cache file was not created
    const cacheFile = path.join(tempHome, '.xmemo', 'skill-update-check.json');
    let exists = true;
    try {
      await readFile(cacheFile);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, 'Cache file should not be created when update check is disabled');
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('silent fault tolerance: network failure, 500, corrupt json, or corrupt cache do not break commands', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-fault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ discoveryStatus: 500 });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      XMEMO_FORCE_TTY: '1',
    };

    // 1. 500 error from discovery: command must still succeed
    const res500 = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(res500.code, 0);
    assert.doesNotMatch(res500.stderr, /XMEMO_UPDATE_AVAILABLE:/);
    assert.match(res500.stdout, /Design architecture note/);

    // Cache should record lastCheck even on failure to avoid spamming
    const cacheFile = path.join(tempHome, '.xmemo', 'skill-update-check.json');
    const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
    assert.ok(cache.lastCheck);

    // 2. Corrupt cache file: command must still succeed
    await writeFile(cacheFile, '{ invalid json');
    const resCorrupt = await runSkill(['recall', '--query', 'test', '--terminal', '--base-url', mock.baseUrl], env);
    assert.equal(resCorrupt.code, 0);
    assert.match(resCorrupt.stdout, /Design architecture note/);
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('other commands do not perform update checks', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-nocmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer({ latestVersion: 'skill-v1.1.45' });

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test_token_secret',
      XMEMO_FORCE_TTY: '1',
    };

    // 1. auth status
    await runSkill(['auth', 'status', '--terminal', '--base-url', mock.baseUrl], env);

    // 2. auth status --verify (explicitly assert 0 requests to agent-discovery.json with empty cache)
    await runSkill(['auth', 'status', '--verify', '--terminal', '--base-url', mock.baseUrl], env);

    // 3. remember
    await runSkill(['remember', '--content', 'Test note', '--terminal', '--base-url', mock.baseUrl], env);

    const discoveryReqs = mock.requests.filter((r) => r.url === '/.well-known/agent-discovery.json');
    assert.equal(discoveryReqs.length, 0, 'auth status, auth status --verify, and remember must make 0 update discovery requests');

    // Verify auth validate request actually succeeded
    const validateReqs = mock.requests.filter((r) => r.url === '/v1/auth/token/validate');
    assert.equal(validateReqs.length, 1, 'auth status --verify should have called /v1/auth/token/validate');
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('online read-only smoke check against xmemo.dev (skipped in offline CI)', { skip: !process.env.ONLINE_SMOKE && !!process.env.CI }, async () => {
  const res = await runSkill(['version', '--check', '--json']);
  assert.equal(res.code, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.installed, '1.1.44');
  assert.equal(typeof parsed.latest, 'string');
  assert.equal(typeof parsed.update_available, 'boolean');
});

