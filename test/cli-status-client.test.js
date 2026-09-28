import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const binPath = path.resolve(repoRoot, 'bin', 'memory-os.js');

function createMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/.well-known/memory-os.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: 'memory-os',
        urls: {
          mcp: `http://${req.headers.host}/mcp`,
          onboarding_status: `http://${req.headers.host}/v1/onboarding/status`,
          token_portal: `http://${req.headers.host}/tokens`
        }
      }));
      return;
    }
    if (url.pathname === '/v1/onboarding/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        onboarding_complete: true,
        account_ready: true,
        mcp_ready: true
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function runCli(args, { cwd, env, timeout = 15000 }) {
  const sanitizedEnv = env ? { ...env } : { ...process.env };
  for (const key of Object.keys(sanitizedEnv)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_') || key.startsWith('CODEX_')) {
      delete sanitizedEnv[key];
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      env: sanitizedEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Process timed out after ${timeout}ms: ${args.join(' ')}`));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function createIsolatedEnv(t) {
  const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-status-client-test-'));
  const tempDir = await fs.realpath(rawTempDir);
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const cleanProcessEnv = { ...process.env };
  for (const key of Object.keys(cleanProcessEnv)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_') || key.startsWith('CODEX_')) {
      delete cleanProcessEnv[key];
    }
  }

  const env = {
    ...cleanProcessEnv,
    HOME: tempDir,
    USERPROFILE: tempDir,
    LOCALAPPDATA: path.join(tempDir, 'LocalAppData'),
    APPDATA: path.join(tempDir, 'AppData'),
    XDG_CONFIG_HOME: path.join(tempDir, '.config'),
    XMEMO_KEY: 'test-token',
    MEMORY_OS_API_KEY: '',
    MEMORY_OS_MCP_TOKEN: ''
  };

  return { tempDir, env };
}

test('status cursor after setup shows mcp and profile configured and installed', async (t) => {
  const server = await createMockServer();
  t.after(() => server.close());

  const { tempDir, env } = await createIsolatedEnv(t);

  // Run setup cursor --yes
  const setupResult = await runCli(['setup', 'cursor', '--yes', '--url', server.baseUrl], {
    cwd: tempDir,
    env
  });
  assert.equal(setupResult.code, 0, `setup failed: ${setupResult.stderr}`);

  // Test status cursor --json
  const jsonResult = await runCli(['status', 'cursor', '--url', server.baseUrl, '--json'], {
    cwd: tempDir,
    env
  });
  assert.equal(jsonResult.code, 0, `status --json failed: ${jsonResult.stderr}`);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.ok, true);
  assert.ok(Array.isArray(report.clients));
  assert.equal(report.clients.length, 1);

  const cursorReport = report.clients[0];
  assert.equal(cursorReport.id, 'cursor');
  assert.equal(cursorReport.label, 'Cursor');
  assert.equal(cursorReport.resources.mcp.configured, true);
  assert.ok(cursorReport.resources.mcp.path.includes('.cursor'));
  assert.equal(cursorReport.resources.profile.installed, true);
  assert.ok(cursorReport.resources.profile.path.includes('memory-profile.md'));
  assert.equal(cursorReport.resources.plugin.installed, false);

  // Test status cursor human-readable output
  const humanResult = await runCli(['status', 'cursor', '--url', server.baseUrl], {
    cwd: tempDir,
    env
  });
  assert.equal(humanResult.code, 0, `status failed: ${humanResult.stderr}`);
  assert.match(humanResult.stdout, /Cursor \(cursor\):/);
  assert.match(humanResult.stdout, /MCP: configured/);
  assert.match(humanResult.stdout, /Profile: installed/);
  assert.match(humanResult.stdout, /Plugin: (?:not installed|n\/a)/);
});

test('uninstall cursor --yes shows Planned changes preview heading and status reflects removal', async (t) => {
  const server = await createMockServer();
  t.after(() => server.close());

  const { tempDir, env } = await createIsolatedEnv(t);

  // Setup cursor first
  const setupResult = await runCli(['setup', 'cursor', '--yes', '--url', server.baseUrl], {
    cwd: tempDir,
    env
  });
  assert.equal(setupResult.code, 0);

  // Uninstall with --yes --profiles: must show "Planned changes:" and NOT "(dry run — no files were modified)"
  const uninstallResult = await runCli(['uninstall', 'cursor', '--yes', '--profiles'], {
    cwd: tempDir,
    env
  });
  assert.equal(uninstallResult.code, 0, `uninstall failed: ${uninstallResult.stderr}`);
  assert.match(uninstallResult.stdout, /Planned changes:/);
  assert.doesNotMatch(uninstallResult.stdout, /\(dry run — no files were modified\)/);

  // Status cursor should now report mcp not configured and profile not installed
  const jsonResult = await runCli(['status', 'cursor', '--url', server.baseUrl, '--json'], {
    cwd: tempDir,
    env
  });
  assert.equal(jsonResult.code, 0);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.clients[0].resources.mcp.configured, false);
  assert.equal(report.clients[0].resources.profile.installed, false);
});

test('uninstall cursor --yes without --profiles leaves profile intact but removes mcp', async (t) => {
  const server = await createMockServer();
  t.after(() => server.close());

  const { tempDir, env } = await createIsolatedEnv(t);

  // Setup cursor
  const setupResult = await runCli(['setup', 'cursor', '--yes', '--url', server.baseUrl], {
    cwd: tempDir,
    env
  });
  assert.equal(setupResult.code, 0);

  // Uninstall without --profiles
  const uninstallResult = await runCli(['uninstall', 'cursor', '--yes'], {
    cwd: tempDir,
    env
  });
  assert.equal(uninstallResult.code, 0);
  assert.match(uninstallResult.stdout, /Planned changes:/);
  assert.doesNotMatch(uninstallResult.stdout, /\(dry run — no files were modified\)/);

  // Status cursor reports mcp not configured, but profile still installed
  const jsonResult = await runCli(['status', 'cursor', '--url', server.baseUrl, '--json'], {
    cwd: tempDir,
    env
  });
  assert.equal(jsonResult.code, 0);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.clients[0].resources.mcp.configured, false);
  assert.equal(report.clients[0].resources.profile.installed, true);
});

test('uninstall cursor --dry-run shows (dry run — no files were modified) heading', async (t) => {
  const server = await createMockServer();
  t.after(() => server.close());

  const { tempDir, env } = await createIsolatedEnv(t);

  // Setup cursor
  const setupResult = await runCli(['setup', 'cursor', '--yes', '--url', server.baseUrl], {
    cwd: tempDir,
    env
  });
  assert.equal(setupResult.code, 0);

  // Uninstall with --dry-run
  const dryRunResult = await runCli(['uninstall', 'cursor', '--dry-run'], {
    cwd: tempDir,
    env
  });
  assert.equal(dryRunResult.code, 0);
  assert.match(dryRunResult.stdout, /\(dry run — no files were modified\)/);
  assert.doesNotMatch(dryRunResult.stdout, /Planned changes:/);
});

test('status codex with skill installed reports skill installed and version', async (t) => {
  const server = await createMockServer();
  t.after(() => server.close());

  const { tempDir, env } = await createIsolatedEnv(t);

  // Mock skill installation for codex: ~/.codex/skills/xmemo-memory/package.json
  const codexSkillDir = path.join(tempDir, '.codex', 'skills', 'xmemo-memory');
  await fs.mkdir(codexSkillDir, { recursive: true });
  await fs.writeFile(
    path.join(codexSkillDir, 'package.json'),
    JSON.stringify({ name: '@xmemo/skill', version: '1.1.35' }, null, 2),
    'utf8'
  );

  // Status codex --json
  const jsonResult = await runCli(['status', 'codex', '--url', server.baseUrl, '--json'], {
    cwd: tempDir,
    env
  });
  assert.equal(jsonResult.code, 0, `status failed: ${jsonResult.stderr}`);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.clients[0].id, 'codex');
  assert.equal(report.clients[0].resources.skill.installed, true);
  assert.equal(report.clients[0].resources.skill.version, '1.1.35');
  assert.ok(report.clients[0].resources.skill.path.includes('xmemo-memory'));

  // Status codex human-readable
  const humanResult = await runCli(['status', 'codex', '--url', server.baseUrl], {
    cwd: tempDir,
    env
  });
  assert.equal(humanResult.code, 0);
  assert.match(humanResult.stdout, /Codex \(codex\):/);
  assert.match(humanResult.stdout, /Skill: installed 1\.1\.35/);
});

test('status with no client arguments and nothing detected reports service probes only', async (t) => {
  const server = await createMockServer();
  t.after(() => server.close());

  const { tempDir, env } = await createIsolatedEnv(t);

  // Status with no client args in empty dir
  const jsonResult = await runCli(['status', '--url', server.baseUrl, '--json'], {
    cwd: tempDir,
    env
  });
  assert.equal(jsonResult.code, 0);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.clients, undefined);
  assert.ok(Array.isArray(report.probes));
  assert.ok(report.probes.length >= 3);

  const humanResult = await runCli(['status', '--url', server.baseUrl], {
    cwd: tempDir,
    env
  });
  assert.equal(humanResult.code, 0);
  assert.match(humanResult.stdout, /status for http:\/\/127\.0\.0\.1/);
  assert.match(humanResult.stdout, /OK\s+200/);
  assert.doesNotMatch(humanResult.stdout, /Cursor \(cursor\):/);
});

test('status client resolution strips CLAUDECODE and CODEX_* variables from outer environment', async (t) => {
  const server = await createMockServer();
  t.after(() => server.close());

  const { tempDir, env } = await createIsolatedEnv(t);
  // Inject outer agent variables
  env.CLAUDECODE = '1';
  env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  env.CODEX_THREAD_ID = 'thread-123';
  env.CODEX_SESSION_ID = 'session-456';

  const jsonResult = await runCli(['status', '--url', server.baseUrl, '--json'], {
    cwd: tempDir,
    env
  });
  assert.equal(jsonResult.code, 0);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.clients, undefined);
});

