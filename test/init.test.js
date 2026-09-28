import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { run } from '../src/cli.js';
import { credentialsPath } from '../src/network/auth.js';
import { defaultProfileTarget } from '../src/config/profile.js';
import { CLIENT_REGISTRY } from '../src/clients/registry.js';

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

async function populateAllClientsCandidates(env) {
  for (const client of CLIENT_REGISTRY) {
    const candidates = client.mcp?.configPathCandidates ? client.mcp.configPathCandidates(env) : [];
    for (const filePath of candidates) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, filePath.endsWith('.yaml') ? '' : filePath.endsWith('.toml') ? '' : '{}');
    }
  }
}

test('init all-Enter run with all 24 clients detected writes nothing and exits 0', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-all24-enter-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-all24-enter-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  await populateAllClientsCandidates(env);

  await fs.writeFile(path.join(tempHome, 'canary.txt'), 'home-unmodified\n');
  await fs.writeFile(path.join(tempCwd, 'canary.txt'), 'cwd-unmodified\n');

  const homeBefore = await snapshotDirectory(tempHome);
  const cwdBefore = await snapshotDirectory(tempCwd);

  const res = await invoke(['init'], {
    env,
    cwd: tempCwd,
    stdin: '\n'.repeat(300)
  });

  assert.equal(res.code, 0, `init failed with stderr: ${res.stderr}`);
  assert.equal(res.stderr, '');

  const homeAfter = await snapshotDirectory(tempHome);
  const cwdAfter = await snapshotDirectory(tempCwd);

  assert.deepEqual(homeAfter, homeBefore, 'tempHome must be completely unmodified by all-Enter run');
  assert.deepEqual(cwdAfter, cwdBefore, 'tempCwd must be completely unmodified by all-Enter run');

  assert.match(res.stdout, /Detected 24 clients:/);
  assert.match(res.stdout, /Copilot CLI \(copilot-cli\)/);
  assert.match(res.stdout, /xmemo mcp add copilot-cli --write/);
});

test('init --dry-run --json with all 24 clients detected outputs valid plan with zero writes', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-all24-dry-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-init-all24-dry-cwd-'));

  const env = makeIsolatedEnv(tempHome);
  await populateAllClientsCandidates(env);

  const homeBefore = await snapshotDirectory(tempHome);
  const cwdBefore = await snapshotDirectory(tempCwd);

  const res = await invoke(['init', '--dry-run', '--json'], {
    env,
    cwd: tempCwd
  });

  assert.equal(res.code, 0, `init --dry-run --json failed with stderr: ${res.stderr}`);
  assert.equal(res.stderr, '');

  const homeAfter = await snapshotDirectory(tempHome);
  const cwdAfter = await snapshotDirectory(tempCwd);

  assert.deepEqual(homeAfter, homeBefore, 'tempHome must be unmodified by dry-run');
  assert.deepEqual(cwdAfter, cwdBefore, 'tempCwd must be unmodified by dry-run');

  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, 'init');
  assert.equal(parsed.data.dryRun, true);
  assert.equal(parsed.data.executed, false);
  assert.equal(parsed.data.detectedClients.length, 24);
  assert.equal(parsed.data.clients.length, 24);

  const copilotEntry = parsed.data.clients.find((c) => c.id === 'copilot-cli');
  assert.ok(copilotEntry, 'copilot-cli must be in detected clients');
  assert.equal(copilotEntry.actions.mcp.available, true);
  assert.equal(copilotEntry.actions.mcp.proxyUrl, 'http://127.0.0.1:8765/mcp');
  assert.equal(copilotEntry.actions.mcp.requiresLocalCommand, 'xmemo mcp proxy --port 8765');
});

test('every registered client passes mcp config and setup --dry-run --json without crashing', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-client-iter-home-'));
  const env = makeIsolatedEnv(tempHome);
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { status: 'ok', discovery: { supportedClients: ['codex', 'copilot-cli', 'gemini-cli'] } };
    },
    async text() {
      return JSON.stringify(await this.json());
    }
  });

  for (const client of CLIENT_REGISTRY) {
    // 1. mcp config <id> --json
    const mcpConfigRes = await invoke(['mcp', 'config', client.id, '--json'], { env });
    assert.doesNotMatch(mcpConfigRes.stderr, /Unexpected error/, `mcp config ${client.id} threw unexpected error`);
    assert.ok(mcpConfigRes.code === 0 || mcpConfigRes.code === 2, `mcp config ${client.id} unexpected code: ${mcpConfigRes.code}`);

    // 2. mcp config <id> in human mode
    const mcpConfigHumanRes = await invoke(['mcp', 'config', client.id], { env });
    assert.doesNotMatch(mcpConfigHumanRes.stderr, /Unexpected error/, `mcp config human ${client.id} threw unexpected error`);
    assert.ok(mcpConfigHumanRes.code === 0 || mcpConfigHumanRes.code === 2);

    // 3. setup <id> --dry-run --json
    const setupRes = await invoke(['setup', client.id, '--dry-run', '--json'], { env, fetch: mockFetch });
    assert.doesNotMatch(setupRes.stderr, /Unexpected error/, `setup ${client.id} threw unexpected error`);
    assert.equal(setupRes.code, 0, `setup ${client.id} --dry-run --json failed: ${setupRes.stderr}`);
    const parsedSetup = JSON.parse(setupRes.stdout);
    assert.ok(parsedSetup.selectedClient || parsedSetup.discovery, `setup ${client.id} output missing selectedClient/discovery`);
  }
});

test('mcp add copilot-cli supports local proxy template, human mode, and write mode', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-mcp-add-copilot-home-'));
  const env = makeIsolatedEnv(tempHome);

  // 1. Human mode without --write: outputs local proxy template without crashing
  const humanRes = await invoke(['mcp', 'add', 'copilot-cli'], { env });
  assert.equal(humanRes.code, 0, `mcp add copilot-cli failed: ${humanRes.stderr}`);
  assert.equal(humanRes.stderr, '');
  assert.match(humanRes.stdout, /Add this to your Copilot CLI config/);
  assert.match(humanRes.stdout, /"url":\s*"http:\/\/127\.0\.0\.1:8765\/mcp"/);
  assert.match(humanRes.stdout, /xmemo mcp proxy --port 8765/);
  assert.match(humanRes.stdout, /xmemo mcp add copilot-cli --write/);

  // 2. JSON mode: returns local-proxy structure
  const jsonRes = await invoke(['mcp', 'add', 'copilot-cli', '--json'], { env });
  assert.equal(jsonRes.code, 0);
  const parsedJson = JSON.parse(jsonRes.stdout);
  assert.equal(parsedJson.client, 'copilot-cli');
  assert.equal(parsedJson.configKind, 'local-proxy');
  assert.equal(parsedJson.proxyUrl, 'http://127.0.0.1:8765/mcp');
  assert.equal(parsedJson.requiresLocalCommand, 'xmemo mcp proxy --port 8765');
  assert.equal(parsedJson.written, false);

  // 3. Write mode: writes local proxy URL to config file
  const writeRes = await invoke(['mcp', 'add', 'copilot-cli', '--write'], { env });
  assert.equal(writeRes.code, 0, `mcp add copilot-cli --write failed: ${writeRes.stderr}`);
  assert.match(writeRes.stdout, /Updated Copilot CLI MCP config:/);
  assert.match(writeRes.stdout, /Local proxy URL configured: http:\/\/127\.0\.0\.1:8765\/mcp/);
  assert.match(writeRes.stdout, /keep `xmemo mcp proxy --port 8765` running/);

  const copilotConfigPath = path.join(tempHome, '.copilot', 'mcp-config.json');
  const writtenContent = await fs.readFile(copilotConfigPath, 'utf8');
  const parsedWritten = JSON.parse(writtenContent);
  assert.equal(parsedWritten.mcpServers?.XMemo?.type, 'http');
  assert.equal(parsedWritten.mcpServers?.XMemo?.url, 'http://127.0.0.1:8765/mcp');
});

