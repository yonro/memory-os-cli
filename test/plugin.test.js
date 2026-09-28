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

    // Steps, if present, must be an array of non-empty strings
    if (p.steps !== undefined) {
      assert.ok(Array.isArray(p.steps), `steps for ${p.id} must be an array`);
      assert.ok(p.steps.every((s) => typeof s === 'string' && s.length > 0), `all steps for ${p.id} must be non-empty strings`);
    }

    // Docs must be a valid URL
    assert.ok(typeof p.docs === 'string' && p.docs.startsWith('https://'), `Docs for ${p.id} must be https URL`);

    // ClientId must match a known client in CLIENT_REGISTRY if not null
    if (p.clientId !== null) {
      assert.ok(knownClientIds.has(p.clientId), `Plugin ${p.id} clientId "${p.clientId}" not found in CLIENT_REGISTRY`);
    }
  }

  // Marketplace and manual plugins must provide installation steps
  const marketplaceAndManual = ['cursor', 'kiro', 'vscode', 'chatgpt-codex', 'cindy'];
  for (const id of marketplaceAndManual) {
    const p = getPlugin(id);
    assert.ok(Array.isArray(p?.steps) && p.steps.length > 0, `Plugin ${id} must provide steps`);
  }

  // Gemini CLI host note
  assert.match(getPlugin('gemini-cli')?.note, /pinned to commit 39e25b185b5157490d1683e4ca8c5c5fb1312a88 via --ref/);

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
  assert.match(out, /gemini-cli.*\(pinned to commit 39e25b185b5157490d1683e4ca8c5c5fb1312a88 via --ref\)/);
  assert.doesNotMatch(out, /xmemo-hermes-plugin/);
  assert.doesNotMatch(out, /xmemo-skills/);

  // Reject unexpected positional arguments with exit 2
  const { io: ioExtra, getStderr: getStderrExtra } = createMockIo();
  const codeExtra = await run(['plugin', 'list', 'extra-arg'], ioExtra);
  assert.equal(codeExtra, 2);
  assert.match(getStderrExtra(), /plugin list does not accept positional arguments/);

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

  // Pinned note displayed for gemini-cli
  const { io: ioGemini, getStdout: getStdoutGemini } = createMockIo();
  const codeGemini = await run(['plugin', 'info', 'gemini-cli'], ioGemini);
  assert.equal(codeGemini, 0);
  assert.match(getStdoutGemini(), /Note:\s+pinned to commit 39e25b185b5157490d1683e4ca8c5c5fb1312a88 via --ref/);

  // Steps displayed for marketplace plugin
  const { io: ioCursor, getStdout: getStdoutCursor } = createMockIo();
  const codeCursor = await run(['plugin', 'info', 'cursor'], ioCursor);
  assert.equal(codeCursor, 0);
  const outCursor = getStdoutCursor();
  assert.match(outCursor, /Installation steps:/);
  assert.match(outCursor, /1\. Open Cursor Settings/);

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

  // Multiple arguments
  const { io: ioMultiple, getStderr: getStderrMultiple } = createMockIo();
  const codeMultiple = await run(['plugin', 'info', 'claude-code', 'extra'], ioMultiple);
  assert.equal(codeMultiple, 2);
  assert.match(getStderrMultiple(), /plugin info accepts only one <id>/);

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

  // JSON failure envelope on unknown ID
  const { io: ioJsonErr, getStdout: getStdoutJsonErr } = createMockIo();
  const codeJsonErr = await run(['plugin', 'info', 'evil', '--json'], ioJsonErr);
  assert.equal(codeJsonErr, 2);
  const parsedErr = JSON.parse(getStdoutJsonErr());
  assert.equal(parsedErr.ok, false);
  assert.equal(parsedErr.error.code, 'INPUT_ERROR');
  assert.match(parsedErr.error.message, /Unknown plugin: "evil"/);
});

test('plugin install: rejects missing ID, unknown IDs, URLs, and multiple args with exit 2', async () => {
  // Missing ID
  const { io: ioMissing, getStderr: getStderrMissing } = createMockIo();
  const codeMissing = await run(['plugin', 'install'], ioMissing);
  assert.equal(codeMissing, 2);
  assert.match(getStderrMissing(), /plugin install requires <id>/);

  // Unknown ID
  const { io: ioUnknown, getStderr: getStderrUnknown } = createMockIo();
  const codeUnknown = await run(['plugin', 'install', 'evil'], ioUnknown);
  assert.equal(codeUnknown, 2);
  assert.match(getStderrUnknown(), /Unknown plugin: "evil"/);

  // URL rejection
  const { io: ioUrl, getStderr: getStderrUrl } = createMockIo();
  const codeUrl = await run(['plugin', 'install', 'https://github.com/x/y'], ioUrl);
  assert.equal(codeUrl, 2);
  assert.match(getStderrUrl(), /Invalid plugin ID: URLs are not supported/);

  // Multiple arguments
  const { io: ioMultiple, getStderr: getStderrMultiple } = createMockIo();
  const codeMultiple = await run(['plugin', 'install', 'openclaw', 'extra'], ioMultiple);
  assert.equal(codeMultiple, 2);
  assert.match(getStderrMultiple(), /plugin install accepts only one <id>/);

  // Missing ID with --json
  const { io: ioJsonMissing, getStdout: getStdoutJsonMissing } = createMockIo();
  const codeJsonMissing = await run(['plugin', 'install', '--json'], ioJsonMissing);
  assert.equal(codeJsonMissing, 2);
  const parsedMissing = JSON.parse(getStdoutJsonMissing());
  assert.equal(parsedMissing.ok, false);
  assert.equal(parsedMissing.error.code, 'INPUT_ERROR');
  assert.match(parsedMissing.error.message, /plugin install requires <id>/);

  // Unknown ID with --json
  const { io: ioJsonUnknown, getStdout: getStdoutJsonUnknown } = createMockIo();
  const codeJsonUnknown = await run(['plugin', 'install', 'evil', '--json'], ioJsonUnknown);
  assert.equal(codeJsonUnknown, 2);
  const parsedUnknown = JSON.parse(getStdoutJsonUnknown());
  assert.equal(parsedUnknown.ok, false);
  assert.equal(parsedUnknown.error.code, 'INPUT_ERROR');
  assert.match(parsedUnknown.error.message, /Unknown plugin: "evil"/);

  // URL rejection with --json
  const { io: ioJsonUrl, getStdout: getStdoutJsonUrl } = createMockIo();
  const codeJsonUrl = await run(['plugin', 'install', 'https://github.com/x/y', '--json'], ioJsonUrl);
  assert.equal(codeJsonUrl, 2);
  const parsedUrl = JSON.parse(getStdoutJsonUrl());
  assert.equal(parsedUrl.ok, false);
  assert.equal(parsedUrl.error.code, 'INPUT_ERROR');
  assert.match(parsedUrl.error.message, /URLs are not supported/);
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
  const out = getStdout();
  assert.match(out, /Marketplace integration/);
  assert.match(out, /Documentation: https:\/\/github\.com\/yonro\/xmemo-cursor-plugin/);
  assert.match(out, /Installation steps:/);
  assert.match(out, /1\. Open Cursor Settings/);
  assert.equal(getOpenedUrls().length, 1);
  assert.equal(getOpenedUrls()[0], 'https://github.com/yonro/xmemo-cursor-plugin');

  // JSON mode returns steps
  const { io: ioJson, getStdout: getStdoutJson } = createMockIo();
  const codeJson = await run(['plugin', 'install', 'cursor', '--json'], ioJson);
  assert.equal(codeJson, 0);
  const parsed = JSON.parse(getStdoutJson());
  assert.equal(parsed.id, 'cursor');
  assert.ok(Array.isArray(parsed.steps) && parsed.steps.length === 3);
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

test('plugin install: git-dir defaults to ~/.xmemo/plugins/<id> and verifies commit', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-gitdir-home-'));
  const expectedDefaultDir = path.join(tempHome, '.xmemo', 'plugins', 'claude-code');

  const mockSpawn = (cmd, args, opts) => {
    if (args[0] === 'clone') {
      return {
        stdout: Readable.from(['Cloning into directory...']),
        stderr: Readable.from([]),
        on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
      };
    }
    if (args[0] === 'rev-parse') {
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
    home: tempHome,
    spawnHandler: mockSpawn
  });

  const code = await run(['plugin', 'install', 'claude-code', '--yes'], io);
  assert.equal(code, 0);
  const out = getStdout();
  assert.match(out, /Claude Code XMemo Plugin cloned and commit verified/);
  assert.match(out, /claude --plugin-dir/);
  assert.equal(getSpawned().length, 2);
  assert.equal(getSpawned()[0].args[0], 'clone');
  assert.equal(getSpawned()[0].args[getSpawned()[0].args.length - 1], expectedDefaultDir);
  assert.equal(getSpawned()[1].args[0], 'rev-parse');

  await fs.rm(tempHome, { recursive: true, force: true });
});

test('plugin install: git-dir supports --dir override', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-gitdir-override-'));
  const targetDir = path.join(tempDir, 'custom-claude');

  const mockSpawn = (cmd, args, opts) => {
    if (args[0] === 'clone') {
      return {
        stdout: Readable.from(['Cloning...']),
        stderr: Readable.from([]),
        on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
      };
    }
    if (args[0] === 'rev-parse') {
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
  assert.equal(getSpawned()[0].args[getSpawned()[0].args.length - 1], targetDir);

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

test('plugin status: returns status for single and all plugins, detects claude-code at home, and rejects unknown id', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-status-home-'));
  const claudeHomeDir = path.join(tempHome, '.xmemo', 'plugins', 'claude-code');
  await fs.mkdir(claudeHomeDir, { recursive: true });

  const mockSpawn = (cmd, args, opts) => {
    if (cmd === 'git' && args[0] === 'rev-parse') {
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

  const { io, getStdout } = createMockIo({
    home: tempHome,
    spawnHandler: mockSpawn
  });
  const code = await run(['plugin', 'status', 'claude-code', '--json'], io);
  assert.equal(code, 0);
  const parsed = JSON.parse(getStdout());
  assert.equal(parsed.id, 'claude-code');
  assert.equal(parsed.installed, true);
  assert.match(parsed.detail, /verified clone at/);

  // Status for codex
  const { io: ioCodex, getStdout: getStdoutCodex } = createMockIo();
  const codeCodex = await run(['plugin', 'status', 'codex'], ioCodex);
  assert.equal(codeCodex, 0);
  assert.match(getStdoutCodex(), /Plugin status:/);
  assert.match(getStdoutCodex(), /codex\s+Codex XMemo Plugin/);

  // Unknown ID rejects with exit 2
  const { io: ioUnknown, getStderr: getStderrUnknown } = createMockIo();
  const codeUnknown = await run(['plugin', 'status', 'evil'], ioUnknown);
  assert.equal(codeUnknown, 2);
  assert.match(getStderrUnknown(), /Unknown plugin: "evil"/);

  // Unknown ID with --json returns failure envelope with exit 2
  const { io: ioJsonErr, getStdout: getStdoutJsonErr } = createMockIo();
  const codeJsonErr = await run(['plugin', 'status', 'evil', '--json'], ioJsonErr);
  assert.equal(codeJsonErr, 2);
  const parsedErr = JSON.parse(getStdoutJsonErr());
  assert.equal(parsedErr.ok, false);
  assert.equal(parsedErr.error.code, 'INPUT_ERROR');

  // Multiple arguments rejects with exit 2
  const { io: ioMulti, getStderr: getStderrMulti } = createMockIo();
  const codeMulti = await run(['plugin', 'status', 'codex', 'extra'], ioMulti);
  assert.equal(codeMulti, 2);
  assert.match(getStderrMulti(), /plugin status accepts at most one <id>/);

  await fs.rm(tempHome, { recursive: true, force: true });
});

test('plugin subcommand: unknown subcommand exits with code 2', async () => {
  const { io, getStderr } = createMockIo();
  const code = await run(['plugin', 'nonexistent'], io);
  assert.equal(code, 2);
  assert.match(getStderr(), /Unknown plugin subcommand: "nonexistent"/);

  // With --json
  const { io: ioJson, getStdout: getStdoutJson } = createMockIo();
  const codeJson = await run(['plugin', 'nonexistent', '--json'], ioJson);
  assert.equal(codeJson, 2);
  const parsed = JSON.parse(getStdoutJson());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'INPUT_ERROR');
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

test('plugin install: gemini-cli includes --ref commit in command', async () => {
  const { io, getStdout, getSpawned } = createMockIo();
  const code = await run(['plugin', 'install', 'gemini-cli', '--yes'], io);
  assert.equal(code, 0);
  assert.match(getStdout(), /Gemini CLI XMemo Extension installed successfully/);
  assert.equal(getSpawned().length, 1);
  assert.equal(getSpawned()[0].cmd, 'gemini');
  assert.deepEqual(getSpawned()[0].args, [
    'extensions',
    'install',
    'https://github.com/yonro/xmemo-gemini-cli',
    '--ref',
    '39e25b185b5157490d1683e4ca8c5c5fb1312a88'
  ]);
});

test('plugin install: openclaw already installed triggers update with consent', async () => {
  let callCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    callCount++;
    if (callCount === 1) {
      // First call is openclaw plugins install, fails with "already installed"
      return {
        stdout: Readable.from(['']),
        stderr: Readable.from(['Error: plugin already installed: @xmemo/openclaw-memory\n']),
        on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(1), 1); }
      };
    }
    // Second call is openclaw plugins update, succeeds
    return {
      stdout: Readable.from(['Plugin @xmemo/openclaw-memory updated to 1.0.18\n']),
      stderr: Readable.from(['']),
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
    };
  };

  const { io, getStdout } = createMockIo({
    spawnHandler: mockSpawn,
    stdinLines: ['y', 'y']
  });
  const code = await run(['plugin', 'install', 'openclaw'], io);
  assert.equal(code, 0);
  const out = getStdout();
  assert.match(out, /OpenClaw reports @xmemo\/openclaw-memory is already installed/);
  assert.match(out, /Update plan: openclaw plugins update @xmemo\/openclaw-memory/);
  assert.match(out, /OpenClaw Memory Plugin updated successfully/);
  assert.equal(callCount, 2);
});

test('plugin install: hermes selects hermes CLI route when available, pip fallback when absent', async () => {
  // Case 1: hermes binary present
  let hermesCalls = [];
  const mockSpawnPresent = (cmd, args, opts) => {
    hermesCalls.push({ cmd, args });
    return {
      stdout: Readable.from(['hermes 0.5.0\n']),
      stderr: Readable.from(['']),
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
    };
  };
  const { io: ioPresent, getStdout: getStdoutPresent } = createMockIo({
    spawnHandler: mockSpawnPresent
  });
  const codePresent = await run(['plugin', 'install', 'hermes', '--yes'], ioPresent);
  assert.equal(codePresent, 0);
  assert.match(getStdoutPresent(), /Route: Hermes CLI \(official catalog entry "xmemo"\)/);
  assert.match(getStdoutPresent(), /Hermes XMemo Memory Provider installed successfully via Hermes CLI/);
  assert.deepEqual(hermesCalls[1].args, ['plugins', 'install', 'xmemo']);

  // Case 2: hermes binary absent -> falls back to pip
  let pipCalls = [];
  const mockSpawnAbsent = (cmd, args, opts) => {
    pipCalls.push({ cmd, args });
    if (cmd === 'hermes') {
      const err = new Error('spawn hermes ENOENT');
      err.code = 'ENOENT';
      const child = {
        stdout: Readable.from([]),
        stderr: Readable.from([]),
        on: (ev, cb) => {
          if (ev === 'error') setTimeout(() => cb(err), 1);
        }
      };
      return child;
    }
    return {
      stdout: Readable.from(['Successfully installed hermes-xmemo-1.1.3\n']),
      stderr: Readable.from(['']),
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
    };
  };
  const { io: ioAbsent, getStdout: getStdoutAbsent } = createMockIo({
    spawnHandler: mockSpawnAbsent
  });
  const codeAbsent = await run(['plugin', 'install', 'hermes', '--yes'], ioAbsent);
  assert.equal(codeAbsent, 0);
  assert.match(getStdoutAbsent(), /Route: pip fallback \(hermes binary not found on PATH\)/);
  assert.match(getStdoutAbsent(), /Hermes XMemo Memory Provider installed successfully via pip fallback/);
  assert.deepEqual(pipCalls[1].args.slice(0, 4), ['-m', 'pip', 'install', 'hermes-xmemo==1.1.3']);
});

test('plugin install: deepseek-dsh requires --profile and constructs correct dsh argv', async () => {
  // Case 1: missing --profile fails with exit code 2
  const { io: ioNoProfile, getStderr: getStderrNoProfile } = createMockIo();
  const codeNoProfile = await run(['plugin', 'install', 'deepseek-dsh'], ioNoProfile);
  assert.equal(codeNoProfile, 2);
  assert.match(getStderrNoProfile(), /deepseek-dsh requires --profile <name>/);

  // Case 2: with --profile executes dsh plugin --profile <name> add dsh-xmemo
  const calls = [];
  const mockSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args });
    return {
      stdout: Readable.from(['Plugin dsh-xmemo added\n']),
      stderr: Readable.from([]),
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
    };
  };

  const { io: ioProfile, getStdout: getStdoutProfile } = createMockIo({
    spawnHandler: mockSpawn
  });
  const codeProfile = await run(['plugin', 'install', 'deepseek-dsh', '--profile', 'dev-profile', '--yes'], ioProfile);
  assert.equal(codeProfile, 0);
  assert.match(getStdoutProfile(), /Command: dsh plugin --profile dev-profile add dsh-xmemo/);
  assert.deepEqual(calls[0].cmd, 'dsh');
  assert.deepEqual(calls[0].args, ['plugin', '--profile', 'dev-profile', 'add', 'dsh-xmemo']);

  // Case 3: with --profile and --force appends --force
  const forceCalls = [];
  const mockForceSpawn = (cmd, args, opts) => {
    forceCalls.push({ cmd, args });
    return {
      stdout: Readable.from(['Plugin dsh-xmemo forced\n']),
      stderr: Readable.from([]),
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 1); }
    };
  };
  const { io: ioForce } = createMockIo({ spawnHandler: mockForceSpawn });
  const codeForce = await run(['plugin', 'install', 'deepseek-dsh', '--profile', 'prod', '--force', '--yes'], ioForce);
  assert.equal(codeForce, 0);
  assert.deepEqual(forceCalls[0].args, ['plugin', '--profile', 'prod', 'add', 'dsh-xmemo', '--force']);
});


