import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { run } from '../src/cli.js';
import {
  PINNED_OPENCLAW_PLUGIN_VERSION,
  PINNED_OPENCLAW_PLUGIN_SPEC,
  PINNED_HERMES_PLUGIN_VERSION,
  PINNED_SKILL_VERSION,
  PINNED_SKILL_INTEGRITY
} from '../src/core/pins.js';
import {
  computeTarballIntegrity,
  verifyTarballIntegrity
} from '../src/commands/skill.js';
import { buildSkillNpmPackage } from '../scripts/build-skill-npm-package.mjs';

const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const stdin = Readable.from([options.stdin ?? '']);
  if (options.isTTY !== undefined) {
    stdin.isTTY = options.isTTY;
  }

  const code = await run(args, {
    env: options.env !== undefined ? options.env : process.env,
    stdin,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    fetch: options.fetch,
    spawn: options.spawn,
    sleep: options.sleep,
    confirm: options.confirm,
    nodeVersion: options.nodeVersion,
    cwd: options.cwd
  });

  return { code, stdout, stderr };
}

function spawnStub(calls, { code = 0, stdout = '', stderr = '', error = null } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    if (error) {
      throw error;
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) {
        child.stdout.emit('data', stdout);
      }
      if (stderr) {
        child.stderr.emit('data', stderr);
      }
      child.emit('close', code);
    });
    return child;
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

function discoveryFetch() {
  return async (url) => {
    if (url.endsWith('/.well-known/memory-os.json')) {
      return jsonResponse({
        service: 'memory-os',
        urls: {
          api_base: 'https://api.example.test',
          mcp: 'https://mcp.example.test/mcp',
          token_portal: 'https://console.example.test/tokens',
          onboarding_status: 'https://api.example.test/v1/onboarding/status'
        },
        auth: {
          token_env_var: 'XMEMO_KEY'
        }
      });
    }

    return jsonResponse({ ready: true });
  };
}

test('pins module: all constants are defined and follow strict semver', () => {
  assert.ok(STRICT_SEMVER_REGEX.test(PINNED_OPENCLAW_PLUGIN_VERSION), 'OpenClaw version must be valid semver');
  assert.equal(PINNED_OPENCLAW_PLUGIN_SPEC, `clawhub:@xmemo/openclaw-memory@${PINNED_OPENCLAW_PLUGIN_VERSION}`);
  assert.doesNotMatch(PINNED_OPENCLAW_PLUGIN_SPEC, /latest/i);
  assert.doesNotMatch(PINNED_OPENCLAW_PLUGIN_SPEC, /-U/);

  assert.ok(STRICT_SEMVER_REGEX.test(PINNED_HERMES_PLUGIN_VERSION), 'Hermes version must be valid semver');
  assert.doesNotMatch(PINNED_HERMES_PLUGIN_VERSION, /latest/i);
  assert.doesNotMatch(PINNED_HERMES_PLUGIN_VERSION, /-U/);

  assert.ok(STRICT_SEMVER_REGEX.test(PINNED_SKILL_VERSION), 'Skill version must be valid semver');
  assert.doesNotMatch(PINNED_SKILL_VERSION, /latest/i);
  assert.doesNotMatch(PINNED_SKILL_VERSION, /-U/);

  assert.match(PINNED_SKILL_INTEGRITY, /^sha512-[A-Za-z0-9+/=]+$/, 'Skill integrity must be a valid sha512 SRI string');
});

test('pin guard: no default install path uses latest or -U', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-pin-guard-'));
  try {
    // 1. OpenClaw default setup
    const openclawCalls = [];
    const openclawRes = await invoke(['setup', 'openclaw', '--url', 'https://api.example.test', '--json'], {
      env: { HOME: tempDir, XMEMO_CONFIG_HOME: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(openclawCalls, {
        stdout: JSON.stringify({ configured: true, connected: true })
      })
    });
    assert.equal(openclawRes.code, 0);
    for (const call of openclawCalls) {
      for (const arg of call.args) {
        assert.notEqual(arg, 'latest', `OpenClaw default install must not contain 'latest': ${call.args.join(' ')}`);
        assert.notEqual(arg, '-U', `OpenClaw default install must not contain '-U': ${call.args.join(' ')}`);
      }
    }
    const openclawPlan = JSON.parse(openclawRes.stdout);
    assert.doesNotMatch(openclawPlan.selectedClient.nativePlugin.package, /latest/i);
    assert.doesNotMatch(openclawPlan.selectedClient.nativePlugin.command, /-U/);
    assert.doesNotMatch(openclawPlan.selectedClient.nativePlugin.command, /latest/i);
    assert.doesNotMatch(openclawPlan.selectedClient.nativePlugin.command, /--force/, 'OpenClaw default must not have --force');

    // 2. Hermes default setup
    const hermesCalls = [];
    const hermesHome = path.join(tempDir, '.hermes');
    const hermesRes = await invoke(['setup', 'hermes', '--url', 'https://api.example.test', '--hermes-home', hermesHome, '--json'], {
      env: { HOME: tempDir, USERPROFILE: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(hermesCalls)
    });
    assert.equal(hermesRes.code, 0);
    for (const call of hermesCalls) {
      for (const arg of call.args) {
        assert.notEqual(arg, 'latest', `Hermes default install must not contain 'latest': ${call.args.join(' ')}`);
        assert.notEqual(arg, '-U', `Hermes default install must not contain '-U': ${call.args.join(' ')}`);
      }
    }
    const hermesPlan = JSON.parse(hermesRes.stdout);
    assert.doesNotMatch(hermesPlan.selectedClient.nativePlugin.installCommand, /-U/, 'Hermes default installCommand must not have -U');
    assert.doesNotMatch(hermesPlan.selectedClient.nativePlugin.installCommand, /latest/i);

    // 3. Skill default install
    const skillCalls = [];
    const mockSkillReport = {
      package: '@xmemo/skill',
      skillVersion: PINNED_SKILL_VERSION,
      target: path.resolve('xmemo-skill'),
      dryRun: true,
      installed: false
    };
    const skillRes = await invoke(['skill', 'install', '--dry-run', '--json'], {
      env: { HOME: tempDir },
      spawn: spawnStub(skillCalls, { code: 0, stdout: JSON.stringify(mockSkillReport) })
    });
    assert.equal(skillRes.code, 0);
    for (const call of skillCalls) {
      for (const arg of call.args) {
        assert.notEqual(arg, 'latest', `Skill default install must not contain 'latest': ${call.args.join(' ')}`);
        assert.notEqual(arg, '-U', `Skill default install must not contain '-U': ${call.args.join(' ')}`);
        assert.notEqual(arg, '@xmemo/skill@latest', `Skill default install must not use @xmemo/skill@latest: ${call.args.join(' ')}`);
      }
    }
    const skillPlan = JSON.parse(skillRes.stdout);
    assert.notEqual(skillPlan.spec, 'latest', 'Skill default report spec must not be latest');
    assert.equal(skillPlan.spec, PINNED_SKILL_VERSION);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('setup openclaw: prints exact command before running, respects --force, and --dry-run exits without running', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-openclaw-print-'));
  try {
    // 1. Dry run exits without running
    const dryCalls = [];
    const dryRes = await invoke(['setup', 'openclaw', '--url', 'https://api.example.test', '--dry-run'], {
      env: { HOME: tempDir, XMEMO_CONFIG_HOME: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(dryCalls)
    });
    assert.equal(dryRes.code, 0);
    assert.equal(dryCalls.length, 0, 'dry-run must not spawn openclaw');
    assert.match(dryRes.stdout, /Dry run commands:/);
    assert.match(dryRes.stdout, new RegExp(`openclaw plugins install ${PINNED_OPENCLAW_PLUGIN_SPEC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    // 2. Real run prints exact command before executing
    const realCalls = [];
    const realRes = await invoke(['setup', 'openclaw', '--url', 'https://api.example.test'], {
      env: { HOME: tempDir, XMEMO_CONFIG_HOME: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(realCalls, {
        stdout: JSON.stringify({ configured: true, connected: true })
      })
    });
    assert.equal(realRes.code, 0);
    assert.match(realRes.stdout, new RegExp(`Running: openclaw plugins install ${PINNED_OPENCLAW_PLUGIN_SPEC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(realRes.stdout, /Running: openclaw skills install xmemo/);
    assert.deepEqual(realCalls.map((c) => c.args), [
      ['plugins', 'install', PINNED_OPENCLAW_PLUGIN_SPEC],
      ['skills', 'install', 'xmemo'],
      ['xmemo', 'status', '--json']
    ]);

    // 3. Explicit --force passes --force
    const forceCalls = [];
    const forceRes = await invoke(['setup', 'openclaw', '--url', 'https://api.example.test', '--force'], {
      env: { HOME: tempDir, XMEMO_CONFIG_HOME: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(forceCalls, {
        stdout: JSON.stringify({ configured: true, connected: true })
      })
    });
    assert.equal(forceRes.code, 0);
    assert.match(forceRes.stdout, new RegExp(`Running: openclaw plugins install ${PINNED_OPENCLAW_PLUGIN_SPEC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --force`));
    assert.deepEqual(forceCalls.map((c) => c.args), [
      ['plugins', 'install', PINNED_OPENCLAW_PLUGIN_SPEC, '--force'],
      ['skills', 'install', 'xmemo', '--force'],
      ['xmemo', 'status', '--json']
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('setup hermes: prints exact command before running, uses hermes-xmemo==pinned without -U, and --dry-run exits without running', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-hermes-print-'));
  const hermesHome = path.join(tempDir, '.hermes');
  try {
    // 1. Dry run exits without running
    const dryCalls = [];
    const dryRes = await invoke(['setup', 'hermes', '--url', 'https://api.example.test', '--hermes-home', hermesHome, '--dry-run'], {
      env: { HOME: tempDir, USERPROFILE: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(dryCalls)
    });
    assert.equal(dryRes.code, 0);
    assert.equal(dryCalls.length, 0, 'dry-run must not spawn python or hermes-xmemo');
    assert.match(dryRes.stdout, /Dry run actions:/);
    assert.match(dryRes.stdout, new RegExp(`pip install hermes-xmemo==${PINNED_HERMES_PLUGIN_VERSION}`));
    assert.doesNotMatch(dryRes.stdout, /-U/);

    // 2. Real run prints exact command before executing
    const realCalls = [];
    const realRes = await invoke(['setup', 'hermes', '--url', 'https://api.example.test', '--hermes-home', hermesHome], {
      env: { HOME: tempDir, USERPROFILE: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(realCalls)
    });
    assert.equal(realRes.code, 0);
    assert.match(realRes.stdout, new RegExp(`Running: .*pip install hermes-xmemo==${PINNED_HERMES_PLUGIN_VERSION}`));
    assert.match(realRes.stdout, /Running: hermes-xmemo install/);
    assert.deepEqual(realCalls.map((c) => c.args), [
      ['-m', 'pip', 'install', `hermes-xmemo==${PINNED_HERMES_PLUGIN_VERSION}`],
      ['install', '--hermes-home', hermesHome]
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('skill install: defaults to pinned version, allows explicit --version latest, and prints command', async () => {
  const calls = [];
  const mockReport = {
    package: '@xmemo/skill',
    skillVersion: PINNED_SKILL_VERSION,
    target: path.resolve('xmemo-skill'),
    dryRun: true,
    installed: false
  };

  // 1. Default install uses pinned version and prints command in human-readable mode
  const res1 = await invoke(['skill', 'install', '--dry-run'], {
    spawn: spawnStub(calls, { code: 0, stdout: JSON.stringify(mockReport) })
  });
  assert.equal(res1.code, 0);
  assert.match(res1.stdout, new RegExp(`Would run: .*@xmemo/skill@${PINNED_SKILL_VERSION}`));
  assert.match(res1.stdout, new RegExp(`Source: npm \\(@xmemo/skill@${PINNED_SKILL_VERSION}\\)`));
  const pkgArg = calls[0].args.find((_, idx) => calls[0].args[idx - 1] === '--package');
  assert.equal(pkgArg, `@xmemo/skill@${PINNED_SKILL_VERSION}`);

  // 2. Explicit --version latest is accepted and passes latest
  const latestCalls = [];
  const mockLatestReport = {
    package: '@xmemo/skill',
    skillVersion: '1.2.0',
    target: path.resolve('xmemo-skill'),
    dryRun: true,
    installed: false
  };
  const resLatest = await invoke(['skill', 'install', '--version', 'latest', '--dry-run', '--json'], {
    spawn: spawnStub(latestCalls, { code: 0, stdout: JSON.stringify(mockLatestReport) })
  });
  assert.equal(resLatest.code, 0);
  const latestReport = JSON.parse(resLatest.stdout);
  assert.equal(latestReport.spec, 'latest');
  const latestPkgArg = latestCalls[0].args.find((_, idx) => latestCalls[0].args[idx - 1] === '--package');
  assert.equal(latestPkgArg, '@xmemo/skill@latest');
});

test('skill integrity verification: compute and verify integrity with fail-closed behavior', async () => {
  const sampleData = Buffer.from('hello xmemo skill package content');
  const computedIntegrity = computeTarballIntegrity(sampleData);
  assert.match(computedIntegrity, /^sha512-/);

  // Exact match succeeds
  assert.equal(verifyTarballIntegrity(sampleData, computedIntegrity), true);

  // Mismatch fails closed
  const badIntegrity = 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  assert.throws(
    () => verifyTarballIntegrity(sampleData, badIntegrity),
    /Tarball integrity mismatch/
  );

  // CLI test with --from <tgz> and --integrity flag
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-integrity-test-'));
  const pkgDir = path.join(tmpBase, 'package');
  const installTarget = path.join(tmpBase, 'installed');

  try {
    const { execSync } = await import('node:child_process');
    await buildSkillNpmPackage({ outDir: pkgDir });
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packOut = execSync(`${npmCmd} pack`, { cwd: pkgDir, encoding: 'utf8' });
    const tgzName = packOut.trim().split('\n').pop().trim();
    const tgzPath = path.join(pkgDir, tgzName);

    const tgzBytes = await fs.readFile(tgzPath);
    const validIntegrity = computeTarballIntegrity(tgzBytes);

    // Mismatched integrity fails closed with code 2
    const failRes = await invoke([
      'skill', 'install',
      '--from', tgzPath,
      '--target', installTarget,
      '--integrity', badIntegrity,
      '--json'
    ]);
    assert.equal(failRes.code, 2);
    assert.match(failRes.stderr, /Tarball integrity mismatch/);

    // Matched integrity succeeds
    const passRes = await invoke([
      'skill', 'install',
      '--from', tgzPath,
      '--target', installTarget,
      '--integrity', validIntegrity,
      '--json'
    ]);
    assert.equal(passRes.code, 0);
    const report = JSON.parse(passRes.stdout);
    assert.equal(report.installed, true);
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
});
