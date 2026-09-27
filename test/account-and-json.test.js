import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { run } from '../src/cli.js';

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
    sleep: options.sleep,
    cwd: options.cwd
  });

  return { code, stdout, stderr };
}

test('account help forms output help text and zero errors', async () => {
  const forms = [
    ['account'],
    ['account', '--help'],
    ['account', '-h'],
    ['help', 'account'],
    ['account', 'login', '--help'],
    ['account', 'logout', '--help'],
    ['account', 'status', '--help'],
    ['account', 'token', '--help']
  ];

  for (const cmd of forms) {
    const res = await invoke(cmd, { env: {} });
    assert.equal(res.code, 0, `Command ${cmd.join(' ')} should exit 0`);
    assert.equal(res.stderr, '', `Command ${cmd.join(' ')} should have empty stderr`);
    assert.match(res.stdout, /account|login|logout|status|token/i);
  }
});

test('account and subcommands output valid JSON overview with --json', async () => {
  const jsonForms = [
    ['account', '--json'],
    ['account', 'help', '--json'],
    ['help', 'account', '--json'],
    ['account', 'token', '--json'],
    ['account', 'token', 'help', '--json']
  ];

  for (const cmd of jsonForms) {
    const res = await invoke(cmd, { env: {} });
    assert.equal(res.code, 0, `Command ${cmd.join(' ')} should exit 0`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.data);
  }
});

test('account logout when already logged out', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-logout-empty-'));
  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    XMEMO_CONFIG_HOME: path.join(tempHome, '.config', 'xmemo')
  };

  // Human mode
  const resHuman = await invoke(['account', 'logout'], { env });
  assert.equal(resHuman.code, 0);
  assert.match(resHuman.stdout, /Already logged out/i);
  assert.match(resHuman.stdout, /Client MCP configurations and agent-managed OAuth sessions were not modified/i);

  // JSON mode
  const resJson = await invoke(['account', 'logout', '--json'], { env });
  assert.equal(resJson.code, 0);
  const parsed = JSON.parse(resJson.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.removed, false);
  assert.equal(parsed.clientConfigsPreserved, true);
});

test('account logout prompts [y/N] in interactive human mode and cancels on n/Enter/EOF', async () => {
  const secretToken = 'xmemo_secret_token_1234567890_abcdef';
  const cancelInputs = ['n\n', 'no\n', '\n', 'something-else\n', ''];

  for (const cancelInput of cancelInputs) {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-logout-cancel-'));
    const configDir = path.join(tempHome, '.config', 'xmemo');
    await fs.mkdir(configDir, { recursive: true });
    const credFile = path.join(configDir, 'credentials.json');
    await fs.writeFile(credFile, JSON.stringify({ token: secretToken, version: 1 }));

    // Also plant a dummy client MCP config to verify preservation
    const dummyClientDir = path.join(tempHome, '.cursor');
    await fs.mkdir(dummyClientDir, { recursive: true });
    const dummyConfigFile = path.join(dummyClientDir, 'mcp.json');
    await fs.writeFile(dummyConfigFile, '{"mcpServers":{}}');

    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_CONFIG_HOME: configDir
    };

    const res = await invoke(['account', 'logout'], { env, stdin: cancelInput });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Logout cancelled/i);
    assert.doesNotMatch(res.stdout, new RegExp(secretToken));
    assert.doesNotMatch(res.stderr, new RegExp(secretToken));

    // File should still exist
    const credStat = await fs.stat(credFile).catch(() => null);
    assert.ok(credStat && credStat.isFile(), 'Credential file must still exist after cancel');

    // MCP config should still exist
    const clientStat = await fs.stat(dummyConfigFile).catch(() => null);
    assert.ok(clientStat && clientStat.isFile(), 'Client MCP config must still exist');
  }
});

test('account logout removes credential file on confirmed y or --yes', async () => {
  const secretToken = 'xmemo_secret_token_1234567890_abcdef';

  // Confirmed with 'y\n'
  {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-logout-confirm-'));
    const configDir = path.join(tempHome, '.config', 'xmemo');
    await fs.mkdir(configDir, { recursive: true });
    const credFile = path.join(configDir, 'credentials.json');
    await fs.writeFile(credFile, JSON.stringify({ token: secretToken, version: 1 }));

    const dummyClientDir = path.join(tempHome, '.cursor');
    await fs.mkdir(dummyClientDir, { recursive: true });
    const dummyConfigFile = path.join(dummyClientDir, 'mcp.json');
    await fs.writeFile(dummyConfigFile, '{"mcpServers":{"preserved":true}}');

    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_CONFIG_HOME: configDir
    };

    const res = await invoke(['account', 'logout'], { env, stdin: 'y\n' });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Logged out of XMemo account/i);
    assert.match(res.stdout, /Client MCP configurations and agent-managed OAuth sessions were not modified/i);
    assert.doesNotMatch(res.stdout, new RegExp(secretToken));

    // Credential file removed
    const credStat = await fs.stat(credFile).catch(() => null);
    assert.equal(credStat, null, 'Credential file must be deleted');

    // MCP config preserved
    const clientContent = await fs.readFile(dummyConfigFile, 'utf8');
    assert.equal(clientContent, '{"mcpServers":{"preserved":true}}');
  }

  // With --yes flag
  {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-logout-yes-'));
    const configDir = path.join(tempHome, '.config', 'xmemo');
    await fs.mkdir(configDir, { recursive: true });
    const credFile = path.join(configDir, 'credentials.json');
    await fs.writeFile(credFile, JSON.stringify({ token: secretToken, version: 1 }));

    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_CONFIG_HOME: configDir
    };

    const res = await invoke(['account', 'logout', '--yes'], { env });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Logged out of XMemo account/i);
    const credStat = await fs.stat(credFile).catch(() => null);
    assert.equal(credStat, null, 'Credential file must be deleted');
  }

  // With --yes --json
  {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-logout-yes-json-'));
    const configDir = path.join(tempHome, '.config', 'xmemo');
    await fs.mkdir(configDir, { recursive: true });
    const credFile = path.join(configDir, 'credentials.json');
    await fs.writeFile(credFile, JSON.stringify({ token: secretToken, version: 1 }));

    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_CONFIG_HOME: configDir
    };

    const res = await invoke(['account', 'logout', '--yes', '--json'], { env });
    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, 'account.logout');
    assert.equal(parsed.removed, true);
    assert.equal(parsed.clientConfigsPreserved, true);
    assert.doesNotMatch(res.stdout, new RegExp(secretToken));

    const credStat = await fs.stat(credFile).catch(() => null);
    assert.equal(credStat, null, 'Credential file must be deleted');
  }
});

test('account logout requires --yes when run with --json and credential exists', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-logout-json-noyes-'));
  const configDir = path.join(tempHome, '.config', 'xmemo');
  await fs.mkdir(configDir, { recursive: true });
  const credFile = path.join(configDir, 'credentials.json');
  await fs.writeFile(credFile, JSON.stringify({ token: 'test_token_1234567890', version: 1 }));

  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    XMEMO_CONFIG_HOME: configDir
  };

  const res = await invoke(['account', 'logout', '--json'], { env });
  assert.equal(res.code, 2, 'Should fail with exit code 2 (INPUT_ERROR)');
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'INPUT_ERROR');
  assert.match(parsed.error.message, /requires --yes/i);

  // Credential must NOT be deleted
  const credStat = await fs.stat(credFile).catch(() => null);
  assert.ok(credStat && credStat.isFile());
});

test('legacy aliases emit deprecation hints in human mode but stay quiet on --json and --help', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-alias-deprecations-'));
  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    XMEMO_CONFIG_HOME: path.join(tempHome, '.config', 'xmemo')
  };

  // 1. Human mode aliases emit deprecation hints on stderr
  const resAuthStatus = await invoke(['auth', 'status'], { env });
  assert.match(resAuthStatus.stderr, /Note: 'xmemo auth status' is deprecated/i);

  const resAuthStatusHyphen = await invoke(['auth-status'], { env });
  assert.match(resAuthStatusHyphen.stderr, /Note: 'xmemo auth-status' is deprecated/i);

  const resTokenStatus = await invoke(['token', 'status'], { env });
  assert.match(resTokenStatus.stderr, /Note: 'xmemo token status' is deprecated/i);

  // 2. --json mode aliases NEVER emit deprecation hints on stderr
  const resAuthStatusJson = await invoke(['auth', 'status', '--json'], { env });
  assert.equal(resAuthStatusJson.stderr, '');
  const parsedAuthStatus = JSON.parse(resAuthStatusJson.stdout);
  assert.equal(parsedAuthStatus.loggedIn, false);

  const resAuthStatusHyphenJson = await invoke(['auth-status', '--json'], { env });
  assert.equal(resAuthStatusHyphenJson.stderr, '');
  const parsedHyphen = JSON.parse(resAuthStatusHyphenJson.stdout);
  assert.equal(parsedHyphen.loggedIn, false);

  const resTokenStatusJson = await invoke(['token', 'status', '--json'], { env });
  assert.equal(resTokenStatusJson.stderr, '');
  const parsedToken = JSON.parse(resTokenStatusJson.stdout);
  assert.equal(parsedToken.loggedIn, false);

  // 3. Help mode NEVER emits deprecation hints on stderr
  const resAuthHelp = await invoke(['auth', '--help'], { env });
  assert.equal(resAuthHelp.stderr, '');

  const resTokenHelp = await invoke(['token', '--help'], { env });
  assert.equal(resTokenHelp.stderr, '');

  const resLoginHelp = await invoke(['login', '--help'], { env });
  assert.equal(resLoginHelp.stderr, '');
});

test('every registered command and subcommand produces valid JSON with --json', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-json-matrix-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-json-matrix-cwd-'));

  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    XMEMO_CONFIG_HOME: path.join(tempHome, '.config', 'xmemo'),
    XMEMO_URL: 'https://mock.example.test',
    XMEMO_BASE_URL: 'https://mock.example.test'
  };

  const COMMAND_TEST_LIST = [
    // Top-level commands
    ['help'],
    ['version'],
    ['init'],
    ['start'],
    ['privacy'],
    ['env'],
    ['env', 'example'],
    ['account'],
    ['account', 'status'],
    ['account', 'token'],
    ['account', 'token', 'status'],
    ['mcp'],
    ['mcp', 'list'],
    ['mcp', 'config', '--client', 'cursor'],
    ['profile'],
    ['profile', 'status'],
    ['plugin'],
    ['plugin', 'list'],
    ['plugin', 'info', 'openclaw'],
    ['plugin', 'status'],
    ['skill'],
    ['skill', 'status'],
    ['uninstall', '--dry-run', '--all'],
    ['update', '--dry-run']
  ];

  for (const cmd of COMMAND_TEST_LIST) {
    const res = await invoke([...cmd, '--json'], { env, cwd: tempCwd });
    assert.doesNotThrow(() => {
      JSON.parse(res.stdout);
    }, `Command "${cmd.join(' ')} --json" must produce valid JSON on stdout. Output was:\n${res.stdout}`);
  }
});

test('failure under --json outputs structured failure envelope and non-zero exit code', async () => {
  const res = await invoke(['nonexistent-command-xyz', '--json'], { env: {} });
  assert.equal(res.code, 2);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'INPUT_ERROR');
  assert.match(parsed.error.message, /Unknown command: nonexistent-command-xyz/);
});
