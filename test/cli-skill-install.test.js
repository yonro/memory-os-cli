import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { run } from '../src/cli.js';
import { buildSkillNpmPackage } from '../scripts/build-skill-npm-package.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

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

test('CLI skill install: default delegates to @xmemo/skill@latest without shell', async () => {
  const calls = [];
  const mockReport = {
    package: '@xmemo/skill',
    skillVersion: '1.1.25',
    target: path.resolve('xmemo-skill'),
    dryRun: true,
    force: false,
    replaced: false,
    installed: false,
    networkUsed: false,
    tokenSent: false
  };

  const result = await invoke(['skill', 'install', '--dry-run', '--json'], {
    spawn: spawnStub(calls, { code: 0, stdout: JSON.stringify(mockReport) }),
    env: { XMEMO_KEY: 'secret-token-must-not-pass', OTHER_ENV: 'allowed' }
  });

  assert.equal(result.code, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /^npm(\.cmd)?$/);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args, [
    'exec',
    '--yes',
    '--package',
    '@xmemo/skill@latest',
    '--',
    'xmemo-skill',
    'install',
    '--dry-run',
    '--json'
  ]);

  // Assert secret env is scrubbed
  assert.equal(calls[0].options.env.XMEMO_KEY, undefined);
  assert.equal(calls[0].options.env.OTHER_ENV, 'allowed');

  const report = JSON.parse(result.stdout);
  assert.equal(report.source, 'npm');
  assert.equal(report.spec, 'latest');
  assert.equal(report.networkUsed, true);
  assert.equal(report.tokenSent, false);
  assert.equal(report.package, '@xmemo/skill');
});

test('CLI skill install: --version validates strict semver and passes to npm package spec', async () => {
  const calls = [];
  const mockReport = {
    package: '@xmemo/skill',
    skillVersion: '1.1.25',
    target: path.resolve('custom-target'),
    dryRun: false,
    force: true,
    replaced: false,
    installed: true,
    networkUsed: false,
    tokenSent: false
  };

  const result = await invoke(['skill', 'install', '--version', '1.1.25', '--target', 'custom-target', '--force', '--json'], {
    spawn: spawnStub(calls, { code: 0, stdout: JSON.stringify(mockReport) })
  });

  assert.equal(result.code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [
    'exec',
    '--yes',
    '--package',
    '@xmemo/skill@1.1.25',
    '--',
    'xmemo-skill',
    'install',
    '--target',
    path.resolve('custom-target'),
    '--force',
    '--json'
  ]);

  const report = JSON.parse(result.stdout);
  assert.equal(report.source, 'npm');
  assert.equal(report.spec, '1.1.25');
  assert.equal(report.networkUsed, true);
  assert.equal(report.tokenSent, false);
  assert.equal(report.installed, true);
  assert.equal(report.force, true);
});

test('CLI skill install: rejects invalid --version formats', async () => {
  for (const badVersion of ['^1.0.0', '~1.1.0', '>=1.0.0', 'latest', 'v1.1.25', '1.x', 'alpha', 'http://example.com/pkg.tgz']) {
    const result = await invoke(['skill', 'install', '--version', badVersion]);
    assert.equal(result.code, 2, `Expected code 2 for bad version: ${badVersion}`);
    assert.match(result.stderr, /Invalid --version/);
  }
});

test('CLI skill install: rejects simultaneous --version and --from', async () => {
  const result = await invoke(['skill', 'install', '--version', '1.1.25', '--from', './some-dir']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Cannot specify both --version and --from/);
});

test('CLI skill install: clear error when npm is missing from PATH', async () => {
  const notFoundError = new Error('spawn npm ENOENT');
  notFoundError.code = 'ENOENT';

  const result = await invoke(['skill', 'install'], {
    spawn: spawnStub([], { error: notFoundError })
  });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /npm is not installed or not available on PATH/);
  assert.match(result.stderr, /Use --from <dir\|tgz> to install offline/);
});

test('CLI skill install: clear error when npm registry is unreachable', async () => {
  const calls = [];
  const result = await invoke(['skill', 'install'], {
    spawn: spawnStub(calls, {
      code: 1,
      stderr: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@xmemo%2fskill - Not found'
    })
  });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /Failed to reach npm registry/);
  assert.match(result.stderr, /Use --from <dir\|tgz> to install offline without network access/);
});

test('CLI skill install: non-JSON human readable output', async () => {
  const calls = [];
  const mockReport = {
    package: '@xmemo/skill',
    skillVersion: '1.1.25',
    target: path.resolve('xmemo-skill'),
    dryRun: false,
    force: false,
    replaced: false,
    installed: true,
    networkUsed: false,
    tokenSent: false
  };

  const result = await invoke(['skill', 'install'], {
    spawn: spawnStub(calls, { code: 0, stdout: JSON.stringify(mockReport) })
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Installed XMemo Skill 1\.1\.25 to/);
  assert.match(result.stdout, /Source: npm \(@xmemo\/skill@latest\) \(no credential used\)/);
});

test('CLI skill install: end-to-end with --from <dir> installs byte-identical skill', async () => {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-from-dir-'));
  const pkgDir = path.join(tmpBase, 'package');
  const installTarget = path.join(tmpBase, 'installed-skill');

  try {
    // 1. Build the standalone package into pkgDir
    await buildSkillNpmPackage({ outDir: pkgDir });

    // 2. Run xmemo skill install --from <pkgDir> --target <installTarget> --json
    const result = await invoke(['skill', 'install', '--from', pkgDir, '--target', installTarget, '--json']);
    assert.equal(result.code, 0, `Failed with stderr: ${result.stderr}`);

    const report = JSON.parse(result.stdout);
    assert.equal(report.installed, true);
    assert.equal(report.source, 'local');
    assert.equal(report.networkUsed, false);
    assert.equal(report.tokenSent, false);

    // 3. Verify installed files match skills/xmemo exactly
    const sourceSkillDir = path.join(repoRoot, 'skills', 'xmemo');
    async function getRelativeFiles(dir) {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) => path.relative(dir, path.join(e.parentPath || e.path, e.name)).replace(/\\/g, '/'))
        .sort();
    }

    const sourceFiles = await getRelativeFiles(sourceSkillDir);
    const installedFiles = await getRelativeFiles(installTarget);
    assert.deepEqual(installedFiles, sourceFiles);

    for (const relFile of sourceFiles) {
      const srcBuf = await fs.readFile(path.join(sourceSkillDir, relFile));
      const instBuf = await fs.readFile(path.join(installTarget, relFile));
      assert.deepEqual(instBuf, srcBuf, `Content mismatch in ${relFile}`);
    }
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
});

test('CLI skill install: --from <dir> human-readable output', async () => {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-from-dir-human-'));
  const pkgDir = path.join(tmpBase, 'package');
  const installTarget = path.join(tmpBase, 'installed-skill');

  try {
    await buildSkillNpmPackage({ outDir: pkgDir });

    const result = await invoke(['skill', 'install', '--from', pkgDir, '--target', installTarget, '--dry-run']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Would install XMemo Skill/);
    assert.match(result.stdout, /Source: local \(/);
    assert.match(result.stdout, /offline; no credential used/);
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
});

test('CLI skill install: end-to-end with --from <file.tgz> installs byte-identical skill', async () => {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-from-tgz-'));
  const pkgDir = path.join(tmpBase, 'package');
  const installTarget = path.join(tmpBase, 'installed-skill');

  try {
    const { execSync } = await import('node:child_process');
    await buildSkillNpmPackage({ outDir: pkgDir });
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packOut = execSync(`${npmCmd} pack`, { cwd: pkgDir, encoding: 'utf8' });
    const tgzName = packOut.trim().split('\n').pop().trim();
    const tgzPath = path.join(pkgDir, tgzName);

    const result = await invoke(['skill', 'install', '--from', tgzPath, '--target', installTarget, '--json']);
    assert.equal(result.code, 0, `Failed with stderr: ${result.stderr}`);

    const report = JSON.parse(result.stdout);
    assert.equal(report.installed, true);
    assert.equal(report.source, 'local');
    assert.equal(report.networkUsed, false);
    assert.equal(report.tokenSent, false);

    const sourceSkillDir = path.join(repoRoot, 'skills', 'xmemo');
    async function getRelativeFiles(dir) {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) => path.relative(dir, path.join(e.parentPath || e.path, e.name)).replace(/\\/g, '/'))
        .sort();
    }

    const sourceFiles = await getRelativeFiles(sourceSkillDir);
    const installedFiles = await getRelativeFiles(installTarget);
    assert.deepEqual(installedFiles, sourceFiles);

    for (const relFile of sourceFiles) {
      const srcBuf = await fs.readFile(path.join(sourceSkillDir, relFile));
      const instBuf = await fs.readFile(path.join(installTarget, relFile));
      assert.deepEqual(instBuf, srcBuf, `Content mismatch in ${relFile}`);
    }
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
});

test('CLI skill install: rejects invalid --from directory or missing files', async () => {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-bad-from-'));
  try {
    // Missing directory
    const res1 = await invoke(['skill', 'install', '--from', path.join(tmpBase, 'does-not-exist')]);
    assert.equal(res1.code, 2);
    assert.match(res1.stderr, /does not exist/);

    // Empty directory
    const emptyDir = path.join(tmpBase, 'empty');
    await fs.mkdir(emptyDir);
    const res2 = await invoke(['skill', 'install', '--from', emptyDir]);
    assert.equal(res2.code, 2);
    assert.match(res2.stderr, /missing or invalid package\.json/);

    // Bad package.json name
    await fs.writeFile(path.join(emptyDir, 'package.json'), JSON.stringify({ name: 'not-xmemo-skill' }));
    const res3 = await invoke(['skill', 'install', '--from', emptyDir]);
    assert.equal(res3.code, 2);
    assert.match(res3.stderr, /name must be "@xmemo\/skill"/);

    // Non-tgz file
    const textFile = path.join(tmpBase, 'file.txt');
    await fs.writeFile(textFile, 'hello');
    const res4 = await invoke(['skill', 'install', '--from', textFile]);
    assert.equal(res4.code, 2);
    assert.match(res4.stderr, /Must be an npm package tarball/);
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
});
