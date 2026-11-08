import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');
const fixturePath = path.join(repoRoot, 'test', 'fixtures', 'routes-equivalence.json');

function createMockServer() {
  const capturedRequests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsedBody = null;
      let bodyKeys = null;
      if (body.trim()) {
        try {
          parsedBody = JSON.parse(body);
          if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)) {
            bodyKeys = Object.keys(parsedBody).sort();
          } else if (Array.isArray(parsedBody)) {
            bodyKeys = [];
          }
        } catch {
          bodyKeys = [];
        }
      }
      capturedRequests.push({
        method: req.method,
        path: req.url,
        bodyKeys,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      const url = req.url;
      if (url.includes('/.well-known/agent-discovery.json')) {
        res.end(JSON.stringify({ ok: true, standalone_skill: { package: { version: '1.1.53' } } }));
      } else if (url.includes('/.well-known/xmemo-agent.json')) {
        res.end(JSON.stringify({ ok: true, temporary_token: { limits: { max_items: 100, ttl_seconds: 1209600, max_lifetime_seconds: 2592000 } } }));
      } else if (url.includes('/v1/auth/device/start')) {
        res.end(JSON.stringify({ ok: true, device_code: 'dc-123', user_code: 'uc-123', verification_uri: 'http://test', interval: 0, expires_in: 300 }));
      } else if (url.includes('/v1/auth/device/token')) {
        res.end(JSON.stringify({ ok: true, access_token: 'tok-new', token: 'tok-new', expires_in: 3600 }));
      } else if (url.includes('/v1/agents/temporary-register')) {
        res.end(JSON.stringify({ ok: true, temporary_token: 'tok-temp', agent_id: 'agent-temp-123', bind_url: 'http://test/bind' }));
      } else if (url.includes('/v1/auth/token/revoke-self')) {
        res.end(JSON.stringify({ ok: true, revoked: true }));
      } else if (url.includes('/v1/auth/token/validate')) {
        res.end(JSON.stringify({ ok: true, valid: true, expires_at: new Date(Date.now() + 86400000).toISOString() }));
      } else if (url.includes('/v1/agents/status')) {
        res.end(JSON.stringify({ ok: true, status: 'active', agent_id: 'agent-123' }));
      } else if (url.includes('/v1/agents/bind/')) {
        res.end(JSON.stringify({ ok: true, status: 'ok', token: 'tok-formal' }));
      } else if (url.includes('/v1/skills/') && url.includes('/components')) {
        res.end(JSON.stringify({ ok: true, skill_id: 's1', components: [] }));
      } else if (url.includes('/v1/skills/') && url.includes('/render')) {
        res.end(JSON.stringify({ ok: true, rendered: 'output' }));
      } else if (url.includes('/v1/skills/')) {
        res.end(JSON.stringify({ ok: true, skill_id: 's1', name: 'Test' }));
      } else if (url.includes('/v1/skills')) {
        res.end(JSON.stringify({ ok: true, skills: [{ skill_id: 's1' }] }));
      } else if (url.includes('/v1/me/dream/runs/')) {
        res.end(JSON.stringify({ ok: true, items: [{ kind: 'digest', digest_summary: 'All good' }] }));
      } else if (url.includes('/v1/restart/snapshot')) {
        res.end(JSON.stringify({ ok: true, snapshot_id: 'snap-1', status: 'saved' }));
      } else if (url.includes('/v1/restart/restore')) {
        res.end(JSON.stringify({ ok: true, snapshot_id: 'snap-1', status: 'restored' }));
      } else if (url.includes('/v1/recall/context')) {
        res.end(JSON.stringify({ ok: true, context: 'recalled context' }));
      } else if (url.includes('/v1/memories/stats')) {
        res.end(JSON.stringify({ ok: true, total: 5, count: 5 }));
      } else if (url.includes('/relationships')) {
        res.end(JSON.stringify({ ok: true, contract_version: '1.0', items: [{ relationship_id: 'rel-1' }] }));
      } else if (url.includes('/forget')) {
        res.end(JSON.stringify({ ok: true, forgotten: true }));
      } else if (url.includes('/restore')) {
        res.end(JSON.stringify({ ok: true, restored: true }));
      } else if (url.includes('/explain')) {
        res.end(JSON.stringify({ ok: true, memory: { id: 'mem-1', content: 'expanded memory content' } }));
      } else if (url.includes('/v1/memories/search') || url.includes('/v1/recall')) {
        res.end(JSON.stringify({ ok: true, items: [{ id: 'mem-1', content: 'test memory' }], result: [{ id: 'mem-1', content: 'test memory' }] }));
      } else if (url.includes('/v1/remember')) {
        res.end(JSON.stringify({ ok: true, id: 'mem-temp', status: 'created' }));
      } else if (url.includes('/v1/skill/operations')) {
        res.end(JSON.stringify({ ok: true, result: { status: 'success', doctor_version: '1.0', auth_valid: true, items: [] } }));
      } else {
        res.end(JSON.stringify({ ok: true, result: {} }));
      }
    });
  });

  return { server, capturedRequests };
}

async function runCommandWithServer(args, options = {}) {
  const { server, capturedRequests } = createMockServer();
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'xmemo-route-test-'));
  const xmemoDir = path.join(tempHome, '.xmemo');
  await mkdir(xmemoDir, { recursive: true });

  const credType = options.temporaryCredential ? 'temporary' : 'api_key';
  const creds = {
    token: 'xmemo-test-token-valid',
    credential_type: credType,
    agent_id: 'agent-test-123',
    storage_type: 'plaintext-user-file',
    plaintext_storage_consent: true,
  };
  if (options.temporaryCredential) {
    creds.bind_url = 'http://test/bind';
    creds.pending_confirmation_token = 'conf-123';
  }
  if (!options.noStoredCredential) {
    await writeFile(path.join(xmemoDir, 'skill-credentials.json'), JSON.stringify(creds), 'utf8');
  }

  const env = {
    ...process.env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    APPDATA: tempHome,
    LOCALAPPDATA: tempHome,
    XDG_CONFIG_HOME: tempHome,
  };
  delete env.XMEMO_KEY;
  delete env.CI;
  delete env.XMEMO_NO_UPDATE_CHECK;

  if (options.untrustedOrigin) {
    delete env.XMEMO_TRUSTED_ORIGIN;
  } else {
    env.XMEMO_TRUSTED_ORIGIN = baseUrl;
  }

  const fullArgs = [skillScript, ...args, '--base-url', baseUrl, '--json'];

  const child = spawn(process.execPath, fullArgs, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  server.close();
  await rm(tempHome, { recursive: true, force: true });

  return {
    exitCode,
    stdout,
    stderr,
    requests: capturedRequests,
  };
}

test('route equivalence: all commands match recorded pre-refactor routes fixture', async (t) => {
  const fixtureRaw = await readFile(fixturePath, 'utf8');
  const fixtureCases = JSON.parse(fixtureRaw);
  assert.ok(fixtureCases.length >= 60, `Fixture must contain at least 60 cases (found ${fixtureCases.length})`);

  for (const tc of fixtureCases) {
    await t.test(tc.name, async () => {
      const result = await runCommandWithServer(tc.args, tc.options);
      assert.deepEqual(
        result.requests,
        tc.expectedRequests,
        `Captured requests mismatch for ${tc.name}`
      );
      if (tc.name.startsWith('negative:')) {
        assert.equal(result.requests.length, 0, `Negative case ${tc.name} must produce zero requests`);
      }
    });
  }
});

test('centralized routes: no hardcoded /v1/ literals remain outside core.mjs', async () => {
  const dirs = [
    path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'commands'),
    path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'lib'),
    path.join(repoRoot, 'skills', 'xmemo', 'scripts'),
  ];
  const filesWithV1 = [];
  for (const dir of dirs) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.mjs')) {
        if (entry.name === 'core.mjs') continue;
        const filePath = path.join(dir, entry.name);
        const content = await readFile(filePath, 'utf8');
        if (content.includes('/v1/')) {
          filesWithV1.push({ file: entry.name, path: filePath });
        }
      }
    }
  }
  assert.deepEqual(filesWithV1, [], `Found hardcoded '/v1/' literals in files outside core.mjs: ${filesWithV1.map((f) => f.file).join(', ')}`);
});

