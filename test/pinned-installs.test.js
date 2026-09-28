import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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
  PINNED_OPENCLAW_SKILL_VERSION,
  PINNED_OPENCLAW_SKILL_NAME,
  PINNED_OPENCLAW_SKILL_SPEC,
  PINNED_HERMES_PLUGIN_VERSION,
  PINNED_SKILL_VERSION,
  PINNED_SKILL_INTEGRITY
} from '../src/core/pins.js';
import {
  computeTarballIntegrity,
  verifyTarballIntegrity
} from '../src/commands/skill.js';
import { buildSkillNpmPackage } from '../scripts/build-skill-npm-package.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const stdin = Readable.from([options.stdin ?? '']);
  if (options.isTTY !== undefined) {
    stdin.isTTY = options.isTTY;
  }

  const effectiveArgs = (args[0] === 'skill' && args[1] === 'install' && !args.includes('--client') && !args.includes('--dir') && !args.includes('--target') && !args.includes('--from') && !args.includes('-h') && !args.includes('--help'))
    ? [...args, '--dir', 'xmemo-skill']
    : args;

  const code = await run(effectiveArgs, {
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

function spawnStub(calls, { code = 0, stdout = '', stderr = '', error = null, tarballContent = null } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    if (error) {
      throw error;
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      let callStdout = stdout;
      let callCode = code;
      if (code === 0) {
        if (args.includes('view')) {
          callStdout = JSON.stringify('sha512-1+nfcHczdEM8YNyASWMu5ntJ2RQ5q+CvoJHwq6vObvHGkRSXe4tBFdYpooRW45NYp7xMjZIwrnRAiMZ/V+cgaw==');
        } else if (args.includes('pack')) {
          const destIdx = args.indexOf('--pack-destination');
          if (destIdx !== -1 && args[destIdx + 1]) {
            const destDir = args[destIdx + 1];
            const fixturePath = path.resolve(__dirname, 'fixtures', 'xmemo-skill-1.1.33.fixture');
            const tgzPath = path.join(destDir, 'xmemo-skill-1.1.33.tgz');
            try {
              if (tarballContent !== null) {
                fsSync.writeFileSync(tgzPath, tarballContent);
              } else {
                fsSync.copyFileSync(fixturePath, tgzPath);
              }
            } catch {}
          }
          callStdout = JSON.stringify([{ filename: 'xmemo-skill-1.1.33.tgz' }]);
        }
      }
      if (callStdout) {
        child.stdout.emit('data', callStdout);
      }
      if (stderr) {
        child.stderr.emit('data', stderr);
      }
      child.emit('close', callCode);
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
    assert.match(realRes.stdout, new RegExp(`Running: openclaw skills install ${PINNED_OPENCLAW_SKILL_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --version ${PINNED_OPENCLAW_SKILL_VERSION}`));
    assert.match(realRes.stdout, new RegExp(`Skill: ${PINNED_OPENCLAW_SKILL_NAME}`));
    assert.deepEqual(realCalls.map((c) => c.args), [
      ['plugins', 'install', PINNED_OPENCLAW_PLUGIN_SPEC],
      ['skills', 'install', PINNED_OPENCLAW_SKILL_NAME, '--version', PINNED_OPENCLAW_SKILL_VERSION],
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
      ['skills', 'install', PINNED_OPENCLAW_SKILL_NAME, '--version', PINNED_OPENCLAW_SKILL_VERSION, '--force'],
      ['xmemo', 'status', '--json']
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('setup hermes: prints exact command before running, uses hermes-xmemo==pinned without -U, and --dry-run exits without running', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-hermes-print_'));
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
    assert.doesNotMatch(dryRes.stdout, /\s-U(\s|$)/);

    // 2. Real run with hermes CLI available prints exact command before executing
    const realCalls = [];
    const realRes = await invoke(['setup', 'hermes', '--url', 'https://api.example.test', '--hermes-home', hermesHome], {
      env: { HOME: tempDir, USERPROFILE: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: spawnStub(realCalls)
    });
    assert.equal(realRes.code, 0);
    assert.match(realRes.stdout, /Running: hermes plugins install xmemo/);
    assert.deepEqual(realCalls.map((c) => c.args), [
      ['--version'],
      ['plugins', 'install', 'xmemo']
    ]);

    // 3. Fallback when hermes binary is absent: uses pip install hermes-xmemo==pinned
    const pipCalls = [];
    const pipRes = await invoke(['setup', 'hermes', '--url', 'https://api.example.test', '--hermes-home', hermesHome], {
      env: { HOME: tempDir, USERPROFILE: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: (command, args, options) => {
        pipCalls.push({ command, args, options });
        if (command === 'hermes') {
          const err = new Error('spawn hermes ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => {
          child.emit('close', 0);
        });
        return child;
      }
    });
    assert.equal(pipRes.code, 0);
    assert.match(pipRes.stdout, new RegExp(`Running: .*pip install hermes-xmemo==${PINNED_HERMES_PLUGIN_VERSION}`));
    assert.match(pipRes.stdout, /Running: hermes-xmemo install/);
    assert.deepEqual(pipCalls.map((c) => c.args), [
      ['--version'],
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
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args.includes(`@xmemo/skill@${PINNED_SKILL_VERSION}`));
  assert.ok(calls[1].args.includes('--offline'));
  assert.ok(calls[1].args.includes('--package'));

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
  assert.equal(latestCalls.length, 3);
  assert.ok(latestCalls[0].args.includes('view'));
  assert.ok(latestCalls[0].args.includes('@xmemo/skill@latest'));
  assert.ok(latestCalls[1].args.includes('pack'));
  assert.ok(latestCalls[1].args.includes('@xmemo/skill@latest'));
  assert.ok(latestCalls[2].args.includes('exec'));
  assert.ok(latestCalls[2].args.includes('--offline'));
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

test('setup openclaw: handles already installed plugin/skill gracefully and respects --force', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-openclaw-already-'));
  try {
    // 1. Re-run when openclaw reports plugin/skill already installed: exits 0 with clear message
    const alreadyInstalledCalls = [];
    const resAlready = await invoke(['setup', 'openclaw', '--url', 'https://api.example.test'], {
      env: { HOME: tempDir, XMEMO_CONFIG_HOME: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: (command, args, options) => {
        alreadyInstalledCalls.push({ command, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => {
          if (args[0] === 'plugins' && args[1] === 'install') {
            child.stderr.emit('data', 'Error: plugin already installed: @xmemo/openclaw-memory\n');
            child.emit('close', 1);
          } else if (args[0] === 'skills' && args[1] === 'install') {
            child.stderr.emit('data', 'Error: skill already exists: xmemo\n');
            child.emit('close', 1);
          } else if (args[0] === 'xmemo' && args[1] === 'status') {
            child.stdout.emit('data', JSON.stringify({ configured: true, connected: true }));
            child.emit('close', 0);
          } else {
            child.emit('close', 0);
          }
        });
        return child;
      }
    });

    assert.equal(resAlready.code, 0, `Expected exit code 0, got ${resAlready.code}`);
    assert.match(resAlready.stdout, /OpenClaw plugin is already installed\. Use --force to reinstall\./);
    assert.match(resAlready.stdout, /OpenClaw skill is already installed\. Use --force to reinstall\./);
    assert.match(resAlready.stdout, new RegExp(`Skill: ${PINNED_OPENCLAW_SKILL_NAME}`));

    // 2. In --json mode: returns alreadyInstalled: true
    const jsonCalls = [];
    const resJson = await invoke(['setup', 'openclaw', '--url', 'https://api.example.test', '--json'], {
      env: { HOME: tempDir, XMEMO_CONFIG_HOME: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: (command, args, options) => {
        jsonCalls.push({ command, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => {
          if (args[0] === 'plugins' && args[1] === 'install') {
            child.stderr.emit('data', 'Error: plugin already installed\n');
            child.emit('close', 1);
          } else if (args[0] === 'skills' && args[1] === 'install') {
            child.stderr.emit('data', 'Error: skill already installed\n');
            child.emit('close', 1);
          } else if (args[0] === 'xmemo' && args[1] === 'status') {
            child.stdout.emit('data', JSON.stringify({ configured: true, connected: true }));
            child.emit('close', 0);
          } else {
            child.emit('close', 0);
          }
        });
        return child;
      }
    });
    assert.equal(resJson.code, 0);
    const plan = JSON.parse(resJson.stdout);
    assert.equal(plan.selectedClient.nativePlugin.alreadyInstalled, true);
    assert.equal(plan.selectedClient.nativePlugin.installed, false);
    assert.match(plan.selectedClient.skill.command, /openclaw skills install/);
    assert.equal(plan.selectedClient.skill.alreadyInstalled, true);

    // 3. With --force: passes --force flag to reinstall
    const forceCalls = [];
    const resForce = await invoke(['setup', 'openclaw', '--url', 'https://api.example.test', '--force'], {
      env: { HOME: tempDir, XMEMO_CONFIG_HOME: tempDir, XMEMO_KEY: 'test-token' },
      fetch: discoveryFetch(),
      spawn: (command, args, options) => {
        forceCalls.push({ command, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => {
          if (args[0] === 'xmemo' && args[1] === 'status') {
            child.stdout.emit('data', JSON.stringify({ configured: true, connected: true }));
          }
          child.emit('close', 0);
        });
        return child;
      }
    });
    assert.equal(resForce.code, 0);
    assert.ok(forceCalls[0].args.includes('--force'));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('skill install default path verifies tarball against PINNED_SKILL_INTEGRITY and fails closed on tampered tarball', async () => {
  const calls = [];
  const tamperedContent = Buffer.from('this is a tampered malicious tarball');
  const res = await invoke(['skill', 'install'], {
    spawn: spawnStub(calls, { code: 0, tarballContent: tamperedContent })
  });
  assert.equal(res.code, 2, 'Must exit with non-zero code on integrity mismatch');
  assert.match(res.stderr, /Tarball integrity mismatch/);
  assert.match(res.stderr, /Refusing to extract/);
  // Verify npm pack was run, but installer was NOT run
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('pack'));
  assert.equal(calls.some((c) => c.args.includes('xmemo-skill')), false, 'Installer must not be executed when tarball is tampered');
});

test('skill install explicit --version queries registry dist.integrity and verifies downloaded tarball', async () => {
  const customVersion = '1.2.0';
  const customTarball = Buffer.from('content for custom version 1.2.0');
  const customIntegrity = computeTarballIntegrity(customTarball);

  // 1. Matched registry integrity succeeds
  const successCalls = [];
  const mockReport = {
    package: '@xmemo/skill',
    skillVersion: customVersion,
    target: path.resolve('xmemo-skill'),
    dryRun: false,
    installed: true
  };

  const resSuccess = await invoke(['skill', 'install', '--version', customVersion, '--json'], {
    spawn: (command, args, options) => {
      successCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        if (args.includes('view')) {
          child.stdout.emit('data', JSON.stringify(customIntegrity));
          child.emit('close', 0);
        } else if (args.includes('pack')) {
          const destIdx = args.indexOf('--pack-destination');
          const destDir = args[destIdx + 1];
          const tgzPath = path.join(destDir, `xmemo-skill-${customVersion}.tgz`);
          fsSync.writeFileSync(tgzPath, customTarball);
          child.stdout.emit('data', JSON.stringify([{ filename: `xmemo-skill-${customVersion}.tgz` }]));
          child.emit('close', 0);
        } else {
          child.stdout.emit('data', JSON.stringify(mockReport));
          child.emit('close', 0);
        }
      });
      return child;
    }
  });

  assert.equal(resSuccess.code, 0);
  assert.equal(successCalls.length, 3);
  assert.ok(successCalls[0].args.includes('view'), 'First call must query registry dist.integrity');
  assert.ok(successCalls[0].args.includes(`@xmemo/skill@${customVersion}`));
  assert.ok(successCalls[1].args.includes('pack'), 'Second call must pack tarball');
  assert.ok(successCalls[2].args.includes('exec'), 'Third call must execute installer');
  assert.ok(successCalls[2].args.includes('--offline'));

  // 2. Tampered tarball mismatching registry integrity fails closed
  const failCalls = [];
  const tamperedTarball = Buffer.from('corrupted custom tarball');
  const resFail = await invoke(['skill', 'install', '--version', customVersion, '--json'], {
    spawn: (command, args, options) => {
      failCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        if (args.includes('view')) {
          child.stdout.emit('data', JSON.stringify(customIntegrity));
          child.emit('close', 0);
        } else if (args.includes('pack')) {
          const destIdx = args.indexOf('--pack-destination');
          const destDir = args[destIdx + 1];
          const tgzPath = path.join(destDir, `xmemo-skill-${customVersion}.tgz`);
          fsSync.writeFileSync(tgzPath, tamperedTarball);
          child.stdout.emit('data', JSON.stringify([{ filename: `xmemo-skill-${customVersion}.tgz` }]));
          child.emit('close', 0);
        } else {
          child.stdout.emit('data', JSON.stringify(mockReport));
          child.emit('close', 0);
        }
      });
      return child;
    }
  });

  assert.equal(resFail.code, 2);
  assert.match(resFail.stderr, /Tarball integrity mismatch/);
  assert.equal(failCalls.length, 2, 'Installer must not be executed when integrity mismatches');
});

