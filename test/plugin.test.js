import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { run } from '../src/cli.js';
import {
  allPlugins,
  getPlugin,
  isValidPluginId,
  supportedPluginIds
} from '../src/plugins/registry.js';
import { CLIENT_REGISTRY } from '../src/clients/registry.js';

function discoveryFetch() {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/.well-known/memory-os.json') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            service: 'memory-os',
            urls: {
              mcp: 'https://mcp.example.test/mcp',
              onboarding_status: 'https://api.example.test/v1/onboarding/status',
              token_portal: 'https://app.example.test/tokens'
            }
          };
        }
      };
    }
    if (parsed.pathname === '/v1/onboarding/status') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            onboarding_complete: true,
            account_ready: true,
            mcp_ready: true
          };
        }
      };
    }
    return {
      ok: false,
      status: 404,
      async json() {
        return { error: 'not_found' };
      }
    };
  };
}

function createMockIo(options = {}) {
  let stdout = '';
  let stderr = '';
  const spawned = [];
  const openedUrls = [];

  const defaultHome = options.home ?? path.join(os.tmpdir(), 'xmemo-mock-home');
  const env = {
    HOME: defaultHome,
    USERPROFILE: defaultHome,
    XMEMO_URL: 'https://api.example.test',
    MEMORY_OS_URL: 'https://api.example.test',
    XMEMO_KEY: 'test-secret-token',
    MEMORY_OS_MCP_TOKEN: 'another-secret-token',
    XMEMO_TOKEN: 'yet-another-token',
    ...(options.env ?? {})
  };

  const stdin = Readable.from(options.stdinLines ? options.stdinLines.map(l => l + '\n') : []);

  const io = {
    env,
    cwd: options.cwd ?? 'C:\\mock\\cwd',
    stdin,
    fetch: options.fetch ?? discoveryFetch(),
    stdout: {
      write: (chunk) => {
        stdout += chunk;
      }
    },
    stderr: {
      write: (chunk) => {
        stderr += chunk;
      }
    },
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      if (options.spawnHandler) {
        return options.spawnHandler(cmd, args, opts);
      }
      return {
        stdout: Readable.from(['mock output']),
        stderr: Readable.from([]),
        on: (event, cb) => {
          if (event === 'close') setTimeout(() => cb(0), 1);
        }
      };
    },
    openBrowser: async (url) => {
      openedUrls.push(url);
    }
  };

  return {
    io,
    getStdout: () => stdout,
    getStderr: () => stderr,
    getSpawned: () => spawned,
    getOpenedUrls: () => openedUrls
  };
}

test('Plugin Index: all 13 plugins exist with valid schema and pinned commits', () => {
  const plugins = allPlugins({ includeLegacy: true });
  assert.equal(plugins.length, 13, 'Expected exactly 13 plugins in the index');

  const supportedIds = supportedPluginIds();
  assert.equal(supportedIds.length, 11, 'Expected 11 active plugins (excluding 2 legacy)');

  const validKinds = new Set(['native-cli', 'git-dir', 'marketplace', 'manual', 'mcp']);
  const validStatuses = new Set(['stable', 'preview', 'legacy']);
  const knownClientIds = new Set(CLIENT_REGISTRY.map((c) => c.id));

  for (const p of plugins) {
    assert.ok(typeof p.id === 'string' && /^[a-z0-9-]+$/.test(p.id), `Invalid plugin id: ${p.id}`);
    assert.ok(typeof p.platform === 'string' && p.platform.length > 0, `Missing platform for ${p.id}`);
    assert.ok(typeof p.label === 'string' && p.label.length > 0, `Missing label for ${p.id}`);
    assert.ok(typeof p.repo === 'string' && p.repo.startsWith('yonro/'), `Expected repo starting with yonro/ for ${p.id}`);
    assert.ok(validKinds.has(p.kind), `Invalid kind "${p.kind}" for ${p.id}`);
    assert.ok(validStatuses.has(p.status), `Invalid status "${p.status}" for ${p.id}`);

    // Commit must be a 40-character hex SHA
    assert.ok(
      typeof p.commit === 'string' && /^[0-9a-f]{40}$/i.test(p.commit),
      `Plugin ${p.id} must have a 40-character commit SHA, got: ${p.commit}`
    );

    // Install must be an array of arguments, never a string/shell command
    if (p.install !== null) {
      assert.ok(Array.isArray(p.install), `Install for ${p.id} must be an array or null`);
      assert.ok(p.install.every((arg) => typeof arg === 'string'), `Install args for ${p.id} must be strings`);
    }

    // Docs must be a valid URL
    assert.ok(typeof p.docs === 'string' && p.docs.startsWith('https://'), `Docs for ${p.id} must be https URL`);

    // ClientId must match a known client in CLIENT_REGISTRY if not null
    if (p.clientId !== null) {
      assert.ok(knownClientIds.has(p.clientId), `Plugin ${p.id} clientId "${p.clientId}" not found in CLIENT_REGISTRY`);
    }
  }

  // Legacy plugins are marked legacy
  assert.equal(getPlugin('xmemo-hermes-plugin')?.status, 'legacy');
  assert.equal(getPlugin('xmemo-skills')?.status, 'legacy');
});

test('plugin list: lists active plugins by default, and legacy with --all', async () => {
  const { io, getStdout } = createMockIo();
  const code = await run(['plugin', 'list'], io);
  assert.equal(code, 0);
  const out = getStdout();
  assert.match(out, /Available XMemo plugins:/);
  assert.match(out, /openclaw/);
  assert.match(out, /hermes/);
  assert.match(out, /claude-code/);
  assert.doesNotMatch(out, /xmemo-hermes-plugin/);
  assert.doesNotMatch(out, /xmemo-skills/);

  // With --all
  const { io: ioAll, getStdout: getStdoutAll } = createMockIo();
  const codeAll = await run(['plugin', 'list', '--all'], ioAll);
  assert.equal(codeAll, 0);
  const outAll = getStdoutAll();
  assert.match(outAll, /Available XMemo plugins:/);
  assert.match(outAll, /xmemo-hermes-plugin/);
  assert.match(outAll, /xmemo-skills/);

  // With --json
  const { io: ioJson, getStdout: getStdoutJson } = createMockIo();
  const codeJson = await run(['plugin', 'list', '--json'], ioJson);
  assert.equal(codeJson, 0);
  const parsed = JSON.parse(getStdoutJson());
  assert.equal(parsed.length, 11);
  assert.equal(parsed[0].id, 'openclaw');
});

test('plugin info: displays details for valid plugin and rejects invalid IDs / URLs', async () => {
  const { io, getStdout } = createMockIo();
  const code = await run(['plugin', 'info', 'claude-code'], io);
  assert.equal(code, 0);
  const out = getStdout();
  assert.match(out, /Plugin: Claude Code XMemo Plugin \(claude-code\)/);
  assert.match(out, /Kind:\s+git-dir/);
  assert.match(out, /Commit:\s+5d0d2802daaf431eb31b038511f34a00b625ec9f/);

  // JSON mode
  const { io: ioJson, getStdout: getStdoutJson } = createMockIo();
  const codeJson = await run(['plugin', 'info', 'claude-code', '--json'], ioJson);
  assert.equal(codeJson, 0);
  const parsed = JSON.parse(getStdoutJson());
  assert.equal(parsed.id, 'claude-code');
  assert.equal(parsed.kind, 'git-dir');

  // Missing ID
  const { io: ioMissing, getStderr: getStderrMissing } = createMockIo();
  const codeMissing = await run(['plugin', 'info'], ioMissing);
  assert.equal(codeMissing, 2);
  assert.match(getStderrMissing(), /plugin info requires <id>/);

  // Unknown ID
  const { io: ioUnknown, getStderr: getStderrUnknown } = createMockIo();
  const codeUnknown = await run(['plugin', 'info', 'nonexistent-plugin'], ioUnknown);
  assert.equal(codeUnknown, 2);
  assert.match(getStderrUnknown(), /Unknown plugin: "nonexistent-plugin"/);

  // URL rejection
  const { io: ioUrl, getStderr: getStderrUrl } = createMockIo();
  const codeUrl = await run(['plugin', 'info', 'https://github.com/yonro/xmemo-claude-plugin'], ioUrl);
  assert.equal(codeUrl, 2);
  assert.match(getStderrUrl(), /Invalid plugin ID: URLs are not supported/);
});

test('plugin install: MCP kind directs to setup command', async () => {
  const { io, getStdout } = createMockIo();
  const code = await run(['plugin', 'install', 'codex'], io);
  assert.equal(code, 0);
  assert.match(getStdout(), /xmemo setup codex/);
});

test('plugin install: marketplace/manual prints instructions and handles --open', async () => {
  const { io, getStdout, getOpenedUrls } = createMockIo();
  const code = await run(['plugin', 'install', 'cursor', '--open'], io);
  assert.equal(code, 0);
  assert.match(getStdout(), /Marketplace integration/);
  assert.equal(getOpenedUrls().length, 1);
  assert.equal(getOpenedUrls()[0], 'https://github.com/yonro/xmemo-cursor-plugin');
});

test('plugin install: native-cli dry-run and consent prompting', async () => {
  // Dry run writes/executes nothing
  const { io: ioDry, getStdout: getStdoutDry, getSpawned: getSpawnedDry } = createMockIo();
  const codeDry = await run(['plugin', 'install', 'openclaw', '--dry-run'], ioDry);
  assert.equal(codeDry, 0);
  assert.match(getStdoutDry(), /Install plan for OpenClaw Memory Plugin:/);
  assert.match(getStdoutDry(), /Command not executed\./);
  assert.equal(getSpawnedDry().length, 0);

  // Prompt defaults to cancel on empty input
  const { io: ioCancel, getStdout: getStdoutCancel, getSpawned: getSpawnedCancel } = createMockIo({
    stdinLines: ['']
  });
  const codeCancel = await run(['plugin', 'install', 'openclaw'], ioCancel);
  assert.equal(codeCancel, 0);
  assert.match(getStdoutCancel(), /Installation cancelled\./);
  assert.equal(getSpawnedCancel().length, 0);

  // --yes executes without prompting, sanitizing tokens from child env
  const { io: ioYes, getStdout: getStdoutYes, getSpawned: getSpawnedYes } = createMockIo();
  const codeYes = await run(['plugin', 'install', 'openclaw', '--yes'], ioYes);
  assert.equal(codeYes, 0);
  assert.match(getStdoutYes(), /OpenClaw Memory Plugin installed successfully\./);
  assert.equal(getSpawnedYes().length, 1);
  assert.equal(getSpawnedYes()[0].cmd, 'openclaw');
  assert.deepEqual(getSpawnedYes()[0].args, [
    'plugins',
    'install',
    'clawhub:@xmemo/openclaw-memory@1.0.18'
  ]);
  // Verify token scrub
  const childEnv = getSpawnedYes()[0].opts.env;
  assert.equal(childEnv.XMEMO_KEY, undefined);
  assert.equal(childEnv.MEMORY_OS_MCP_TOKEN, undefined);
  assert.equal(childEnv.XMEMO_TOKEN, undefined);
});

test('plugin install: git-dir performs clone and verifies commit', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-gitdir-test-'));
  const targetDir = path.join(tempDir, 'claude-plugin');

  let gitCallCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    gitCallCount++;
    if (args[0] === 'clone') {
      return {
        stdout: Readable.from(['Cloning into directory...']),
        stderr: Readable.from([]),
        on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
      };
    }
    if (args[0] === 'rev-parse') {
      // Return matching commit
      return {
        stdout: Readable.from(['5d0d2802daaf431eb31b038511f34a00b625ec9f\n']),
        stderr: Readable.from([]),
        on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
      };
    }
    return {
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
    };
  };

  const { io, getStdout, getSpawned } = createMockIo({
    spawnHandler: mockSpawn
  });

  const code = await run(['plugin', 'install', 'claude-code', '--yes', '--dir', targetDir], io);
  assert.equal(code, 0);
  assert.match(getStdout(), /Claude Code XMemo Plugin cloned and commit verified/);
  assert.equal(getSpawned().length, 2);
  assert.equal(getSpawned()[0].args[0], 'clone');
  assert.equal(getSpawned()[1].args[0], 'rev-parse');

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('plugin install: git-dir rolls back when commit does not match', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-gitdir-mismatch-'));
  const targetDir = path.join(tempDir, 'claude-plugin');

  const mockSpawn = (cmd, args, opts) => {
    if (args[0] === 'clone') {
      // Simulate directory created during clone
      fs.mkdir(targetDir, { recursive: true }).catch(() => {});
      return {
        stdout: Readable.from(['Cloning...']),
        stderr: Readable.from([]),
        on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
      };
    }
    if (args[0] === 'rev-parse') {
      // Return wrong commit
      return {
        stdout: Readable.from(['deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n']),
        stderr: Readable.from([]),
        on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
      };
    }
    return {
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
    };
  };

  const { io, getStderr } = createMockIo({
    spawnHandler: mockSpawn
  });

  const code = await run(['plugin', 'install', 'claude-code', '--yes', '--dir', targetDir], io);
  assert.equal(code, 2);
  assert.match(getStderr(), /Commit verification failed for claude-code/);

  // Verify rollback removed directory
  const exists = await fs.access(targetDir).then(() => true).catch(() => false);
  assert.equal(exists, false, 'Expected target directory to be removed on commit mismatch');

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('plugin status: returns status for single and all plugins', async () => {
  const { io, getStdout } = createMockIo();
  const code = await run(['plugin', 'status', 'codex'], io);
  assert.equal(code, 0);
  assert.match(getStdout(), /Plugin status:/);
  assert.match(getStdout(), /codex\s+Codex XMemo Plugin/);

  // Status with --json
  const { io: ioJson, getStdout: getStdoutJson } = createMockIo();
  const codeJson = await run(['plugin', 'status', 'codex', '--json'], ioJson);
  assert.equal(codeJson, 0);
  const parsed = JSON.parse(getStdoutJson());
  assert.equal(parsed.id, 'codex');
  assert.equal(typeof parsed.installed, 'boolean');
});

test('setup client integration: prints Plugin available when registry links pluginId', async () => {
  const { io, getStdout, getStderr } = createMockIo();
  const code = await run(['setup', 'cursor', '--dry-run'], io);
  assert.equal(code, 0, `Failed with stderr: ${getStderr()}`);
  const out = getStdout();
  assert.match(out, /Plugin available: xmemo plugin install cursor/);

  // Claude Code
  const { io: ioClaude, getStdout: getStdoutClaude } = createMockIo();
  const codeClaude = await run(['setup', 'claude-code', '--dry-run'], ioClaude);
  assert.equal(codeClaude, 0);
  const outClaude = getStdoutClaude();
  assert.match(outClaude, /Plugin available: xmemo plugin install claude-code/);

  // OpenClaw (has dedicated plugin section, does not duplicate generic line)
  const { io: ioOpenClaw, getStdout: getStdoutOpenClaw } = createMockIo();
  const codeOpenClaw = await run(['setup', 'openclaw', '--dry-run'], ioOpenClaw);
  assert.equal(codeOpenClaw, 0);
  const outOpenClaw = getStdoutOpenClaw();
  assert.match(outOpenClaw, /Plugin: clawhub:@xmemo\/openclaw-memory@1\.0\.18/);
  assert.doesNotMatch(outOpenClaw, /Plugin available: xmemo plugin install openclaw/);
});
