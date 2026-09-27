import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { run } from '../src/cli.js';
import { credentialsPath } from '../src/network/auth.js';
import { defaultProfileTarget } from '../src/config/profile.js';

const MOCK_SECRET_TOKEN = 'xmemo_mock_token_secret_1234567890abcdef';

async function snapshotDirectory(dir) {
  const entries = {};
  async function scan(current, rel = '') {
    const items = await fs.readdir(current, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(current, item.name);
      const relPath = path.join(rel, item.name);
      if (item.isDirectory()) {
        await scan(fullPath, relPath);
      } else if (item.isFile()) {
        const content = await fs.readFile(fullPath);
        entries[relPath] = content.toString('hex');
      }
    }
  }
  await scan(dir);
  return entries;
}

function createMockFetch(token = MOCK_SECRET_TOKEN) {
  return async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/v1/auth/device/start')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            device_code: 'mock-device-code',
            user_code: 'MOCK-CODE',
            verification_uri: 'https://xmemo.dev/device',
            verification_uri_complete: 'https://xmemo.dev/device?code=MOCK-CODE',
            expires_in: 600,
            interval: 1
          };
        },
        async text() {
          return JSON.stringify(await this.json());
        }
      };
    }
    if (urlStr.includes('/api/v1/auth/device/token')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            access_token: token,
            token_type: 'Bearer',
            account: {
              id: 'usr_mock_123',
              email: 'mockuser@example.test',
              name: 'Mock User'
            }
          };
        },
        async text() {
          return JSON.stringify(await this.json());
        }
      };
    }
    return {
      ok: false,
      status: 404,
      async json() {
        return { error: 'not_found' };
      },
      async text() {
        return '{"error":"not_found"}';
      }
    };
  };
}

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const stdin = Readable.from([options.stdin ?? '']);

  const code = await run(args, {
    env: options.env !== undefined ? options.env : process.env,
    stdin,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    fetch: options.fetch,
    spawn: options.spawn,
    sleep: async () => {},
    cwd: options.cwd
  });

  return { code, stdout, stderr };
}

function makeIsolatedEnv(tempHome) {
  const localAppData = path.join(tempHome, 'AppData', 'Local');
  const appData = path.join(tempHome, 'AppData', 'Roaming');
  const xdgConfig = path.join(tempHome, '.config');
  const xdgData = path.join(tempHome, '.local', 'share');
  const configHome = path.join(xdgConfig, 'xmemo');

  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    LOCALAPPDATA: localAppData,
    APPDATA: appData,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    XMEMO_CONFIG_HOME: configHome,
    XMEMO_URL: 'https://xmemo.dev',
    XMEMO_BASE_URL: 'https://xmemo.dev'
  };

  delete env.XMEMO_KEY;
  delete env.MEMORY_OS_MCP_TOKEN;
  delete env.XMEMO_TOKEN;

  return env;
}

test('init help forms output help text and zero errors', async () => {
  const forms = [
    ['init', '--help'],
    ['init', '-h'],
    ['help', 'init'],
    ['start', '--help'],
    ['start', '-h'],
    ['help', 'start']
  ];

  for (const cmd of forms) {
    const res = await invoke(cmd, { env: {} });
    assert.equal(res.code, 0, `Command ${cmd.join(' ')} should exit 0`);
    assert.equal(res.stderr, '', `Command ${cmd.join(' ')} should have empty stderr`);
    assert.match(res.stdout, /Guided first-run onboarding/i);
    assert.match(res.stdout, /--client/);
    assert.match(res.stdout, /--yes/);
    assert.match(res.stdout, /--dry-run/);
  }
});

test('init all-Enter run writes nothing and displays skipped items with rerun commands', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-all-enter-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-all-enter-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  await fs.mkdir(env.LOCALAPPDATA, { recursive: true });
  await fs.mkdir(env.APPDATA, { recursive: true });
  await fs.mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await fs.mkdir(env.XMEMO_CONFIG_HOME, { recursive: true });

  // Plant a fake cursor candidate directory to make cursor detected
  await fs.mkdir(path.join(tempHome, '.cursor'), { recursive: true });
  await fs.writeFile(path.join(tempHome, 'canary.txt'), 'home-unmodified\n');
  await fs.writeFile(path.join(tempCwd, 'canary.txt'), 'cwd-unmodified\n');

  const homeBefore = await snapshotDirectory(tempHome);
  const cwdBefore = await snapshotDirectory(tempCwd);

  // Stdin provides empty lines (Enters / EOF)
  const res = await invoke(['init', '--client', 'cursor'], {
    env,
    cwd: tempCwd,
    stdin: '\n\n\n\n\n\n\n\n'
  });

  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');

  const homeAfter = await snapshotDirectory(tempHome);
  const cwdAfter = await snapshotDirectory(tempCwd);

  // Assert absolutely nothing was written to tempHome or tempCwd
  assert.deepEqual(homeAfter, homeBefore, 'tempHome must be completely unmodified by all-Enter run');
  assert.deepEqual(cwdAfter, cwdBefore, 'tempCwd must be completely unmodified by all-Enter run');

  // Verify stdout shows skipped items and commands to run them later
  assert.match(res.stdout, /Sign in now\? \[y\/N\]/);
  assert.match(res.stdout, /Skipped/);
  assert.match(res.stdout, /To run skipped items later:/);
  assert.match(res.stdout, /xmemo account login/);
  assert.match(res.stdout, /xmemo profile install cursor/);
  assert.match(res.stdout, /xmemo mcp add cursor --write/);
  assert.match(res.stdout, /xmemo plugin install cursor/);

  // Verify quick-start memory walkthrough steps are present
  assert.match(res.stdout, /quick start:/i);
  assert.match(res.stdout, /1\. xmemo account login/);
  assert.match(res.stdout, /2\. xmemo memory add/);
  assert.match(res.stdout, /3\. xmemo memory search/);
  assert.match(res.stdout, /4\. xmemo context recall/);

  // Verify no secret tokens leaked
  assert.equal(res.stdout.includes(MOCK_SECRET_TOKEN), false);
  assert.equal(res.stderr.includes(MOCK_SECRET_TOKEN), false);
});

test('init --dry-run prints full plan and writes nothing with zero network requests', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-dry-run-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-dry-run-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  await fs.mkdir(env.LOCALAPPDATA, { recursive: true });
  await fs.mkdir(env.APPDATA, { recursive: true });
  await fs.mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await fs.mkdir(env.XMEMO_CONFIG_HOME, { recursive: true });

  await fs.mkdir(path.join(tempHome, '.cursor'), { recursive: true });
  await fs.writeFile(path.join(tempHome, 'canary.txt'), 'canary\n');
  await fs.writeFile(path.join(tempCwd, 'canary.txt'), 'canary\n');

  const homeBefore = await snapshotDirectory(tempHome);
  const cwdBefore = await snapshotDirectory(tempCwd);

  let networkCalls = 0;
  const mockFetch = async (url) => {
    networkCalls++;
    throw new Error(`Unexpected network call during dry-run: ${url}`);
  };

  const res = await invoke(['init', '--client', 'cursor', '--dry-run'], {
    env,
    cwd: tempCwd,
    fetch: mockFetch
  });

  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');
  assert.equal(networkCalls, 0, 'Dry-run must make zero network calls');

  const homeAfter = await snapshotDirectory(tempHome);
  const cwdAfter = await snapshotDirectory(tempCwd);
  assert.deepEqual(homeAfter, homeBefore, 'Dry-run must not write any files in home');
  assert.deepEqual(cwdAfter, cwdBefore, 'Dry-run must not write any files in cwd');

  assert.match(res.stdout, /dry-run mode/i);
  assert.match(res.stdout, /Would prompt/i);
  assert.match(res.stdout, /Mode: Dry Run/);
  assert.match(res.stdout, /quick start:/i);
});

test('init --yes applies all steps: sign-in, profile, and MCP config', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-yes-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-yes-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  await fs.mkdir(env.LOCALAPPDATA, { recursive: true });
  await fs.mkdir(env.APPDATA, { recursive: true });
  await fs.mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await fs.mkdir(env.XMEMO_CONFIG_HOME, { recursive: true });

  // Make cursor detected by candidate directory
  await fs.mkdir(path.join(tempHome, '.cursor'), { recursive: true });
  // Plant a package.json in tempCwd so isRepo is true for profile target
  await fs.writeFile(path.join(tempCwd, 'package.json'), JSON.stringify({ name: 'mock-repo' }));

  const mockFetch = createMockFetch(MOCK_SECRET_TOKEN);

  const res = await invoke(['init', '--client', 'cursor', '--yes'], {
    env,
    cwd: tempCwd,
    fetch: mockFetch
  });

  assert.equal(res.code, 0, `init --yes failed with stderr: ${res.stderr}`);

  // 1. Account sign-in should have stored the credential file
  const credFile = credentialsPath(env);
  const credContent = await fs.readFile(credFile, 'utf8');
  const parsedCred = JSON.parse(credContent);
  assert.equal(parsedCred.token, MOCK_SECRET_TOKEN);
  assert.equal(parsedCred.metadata?.account?.email, 'mockuser@example.test');

  // 2. Profile instruction should be written to profile target
  const profileFile = defaultProfileTarget('cursor', env, { cwd: tempCwd });
  const profileContent = await fs.readFile(profileFile, 'utf8');
  assert.match(profileContent, /## XMemo memory/);
  assert.match(profileContent, /_End of the XMemo memory section\._/);

  // 3. MCP config should be written to ~/.cursor/mcp.json
  const mcpConfigFile = path.join(tempHome, '.cursor', 'mcp.json');
  const mcpContent = await fs.readFile(mcpConfigFile, 'utf8');
  assert.match(mcpContent, /xmemo/i);

  // 4. Secret token must NOT be leaked to stdout or stderr
  assert.equal(res.stdout.includes(MOCK_SECRET_TOKEN), false, 'Token must not be printed in stdout');
  assert.equal(res.stderr.includes(MOCK_SECRET_TOKEN), false, 'Token must not be printed in stderr');

  // 5. Output summary shows completed items
  assert.match(res.stdout, /Completed:/);
  assert.match(res.stdout, /✓ Account sign-in/);
  assert.match(res.stdout, /✓ Agent instructions for Cursor/);
  assert.match(res.stdout, /✓ MCP config for Cursor/);
});

test('init --json outputs valid JSON schema under plan, dry-run, and executed modes', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-json-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-json-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  await fs.mkdir(env.LOCALAPPDATA, { recursive: true });
  await fs.mkdir(env.APPDATA, { recursive: true });
  await fs.mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await fs.mkdir(env.XMEMO_CONFIG_HOME, { recursive: true });
  await fs.mkdir(path.join(tempHome, '.cursor'), { recursive: true });

  // 1. init --dry-run --json
  const resDryJson = await invoke(['init', '--client', 'cursor', '--dry-run', '--json'], { env, cwd: tempCwd });
  assert.equal(resDryJson.code, 0);
  const parsedDry = JSON.parse(resDryJson.stdout);
  assert.equal(parsedDry.ok, true);
  assert.equal(parsedDry.command, 'init');
  assert.equal(parsedDry.data.dryRun, true);
  assert.equal(parsedDry.data.executed, false);
  assert.ok(Array.isArray(parsedDry.data.clients));
  assert.ok(Array.isArray(parsedDry.data.nextSteps));

  // 2. init --json (plan mode without --yes)
  const resPlanJson = await invoke(['init', '--client', 'cursor', '--json'], { env, cwd: tempCwd });
  assert.equal(resPlanJson.code, 0);
  const parsedPlan = JSON.parse(resPlanJson.stdout);
  assert.equal(parsedPlan.ok, true);
  assert.equal(parsedPlan.command, 'init');
  assert.equal(parsedPlan.data.dryRun, false);
  assert.equal(parsedPlan.data.executed, false);

  // 3. start --json (alias)
  const resStartJson = await invoke(['start', '--client', 'cursor', '--json'], { env, cwd: tempCwd });
  assert.equal(resStartJson.code, 0);
  const parsedStart = JSON.parse(resStartJson.stdout);
  assert.equal(parsedStart.ok, true);
  assert.equal(parsedStart.command, 'start');

  // 4. init --yes --json (executed mode with mock fetch)
  const mockFetch = createMockFetch(MOCK_SECRET_TOKEN);
  const resYesJson = await invoke(['init', '--client', 'cursor', '--yes', '--json'], {
    env,
    cwd: tempCwd,
    fetch: mockFetch
  });
  assert.equal(resYesJson.code, 0);
  const parsedYes = JSON.parse(resYesJson.stdout);
  assert.equal(parsedYes.ok, true);
  assert.equal(parsedYes.command, 'init');
  assert.equal(parsedYes.data.executed, true);
  assert.equal(parsedYes.data.account.signedIn, true);

  // No secret token in JSON output
  assert.equal(resYesJson.stdout.includes(MOCK_SECRET_TOKEN), false);
  assert.equal(resYesJson.stderr.includes(MOCK_SECRET_TOKEN), false);
});

test('init rejects unknown client option with error', async () => {
  const res = await invoke(['init', '--client', 'unknown-bogus-client'], { env: {} });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /Unknown client: "unknown-bogus-client"/);
});

test('init when already signed in reports existing account without prompting', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-signed-in-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-signed-in-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  const credPath = credentialsPath(env);
  await fs.mkdir(path.dirname(credPath), { recursive: true });
  await fs.writeFile(credPath, JSON.stringify({
    version: 1,
    token: MOCK_SECRET_TOKEN,
    metadata: {
      account: {
        id: 'usr_pre_signed',
        email: 'presigned@example.test',
        name: 'Pre Signed User'
      }
    }
  }));

  const res = await invoke(['init', '--client', 'cursor', '--dry-run'], {
    env,
    cwd: tempCwd
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /Already signed in \(Pre Signed User <presigned@example\.test>\)/);
  assert.equal(res.stdout.includes('Sign in now?'), false);
  assert.equal(res.stdout.includes(MOCK_SECRET_TOKEN), false);
});

test('init --yes creates .xmemo.bak backup when overwriting existing MCP config', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-bak-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-bak-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  const cursorDir = path.join(tempHome, '.cursor');
  await fs.mkdir(cursorDir, { recursive: true });

  const mcpConfigFile = path.join(cursorDir, 'mcp.json');
  const originalConfig = '{\n  "mcpServers": {\n    "preExistingServer": { "url": "https://pre.test" }\n  }\n}\n';
  await fs.writeFile(mcpConfigFile, originalConfig);

  const mockFetch = createMockFetch(MOCK_SECRET_TOKEN);

  const res = await invoke(['init', '--client', 'cursor', '--yes'], {
    env,
    cwd: tempCwd,
    fetch: mockFetch
  });

  assert.equal(res.code, 0);

  // Assert backup was created and matches original content
  const backupFile = `${mcpConfigFile}.xmemo.bak`;
  const backupContent = await fs.readFile(backupFile, 'utf8');
  assert.equal(backupContent, originalConfig);

  // Assert new config file has XMemo
  const newContent = await fs.readFile(mcpConfigFile, 'utf8');
  assert.match(newContent, /XMemo/i);
  assert.match(newContent, /preExistingServer/);
});

test('init handles multiple clients passed via repeated --client flags', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-multi-client-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-multi-client-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  await fs.mkdir(path.join(tempHome, '.cursor'), { recursive: true });
  await fs.mkdir(path.join(tempHome, '.codex'), { recursive: true });

  const res = await invoke(['init', '--client', 'cursor', '--client', 'codex', '--dry-run'], {
    env,
    cwd: tempCwd
  });

  assert.equal(res.code, 0);
  assert.match(res.stdout, /Cursor \(cursor\)/);
  assert.match(res.stdout, /Codex \(codex\)/);
  assert.match(res.stdout, /Cursor \(cursor\)[\s\S]*Agent Instructions/);
  assert.match(res.stdout, /Codex \(codex\)[\s\S]*Agent Instructions/);
});

