import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildSkillNpmPackage,
  collectSourceFiles,
  extractSkillVersion,
  isSensitiveName,
} from '../scripts/build-skill-npm-package.mjs';
import { atomicInstall } from '../packages/skill-installer/install.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSkillDir = path.join(repoRoot, 'skills', 'xmemo');
const builderScriptPath = path.join(repoRoot, 'scripts', 'build-skill-npm-package.mjs');

async function runChildProcess(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...options.env },
    });
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function getAllFilesRelative(dir, currentSubdir = '') {
  const dirPath = currentSubdir ? path.join(dir, currentSubdir) : dir;
  const entries = await readdir(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const rel = currentSubdir ? path.join(currentSubdir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      results.push(...(await getAllFilesRelative(dir, rel)));
    } else if (entry.isFile()) {
      results.push(rel.split(path.sep).join('/'));
    }
  }
  return results.sort();
}

test('builder script: derives SKILL_VERSION matching entrypoint', async () => {
  const version = await extractSkillVersion(path.join(sourceSkillDir, 'scripts', 'xmemo-skill.mjs'));
  assert.match(version, /^\d+\.\d+\.\d+$/);

  const entrypoint = await readFile(path.join(sourceSkillDir, 'scripts', 'xmemo-skill.mjs'), 'utf8');
  assert.ok(entrypoint.includes(`const SKILL_VERSION = '${version}';`));
});

test('builder script: rejects sensitive naming patterns in helper', () => {
  assert.equal(isSensitiveName('.env'), true);
  assert.equal(isSensitiveName('.env.local'), true);
  assert.equal(isSensitiveName('.env.production'), true);
  assert.equal(isSensitiveName('my_secret_token.txt'), true);
  assert.equal(isSensitiveName('api_key.json'), true);
  assert.equal(isSensitiveName('credentials.json'), true);
  assert.equal(isSensitiveName('TOKEN.mjs'), true);
  assert.equal(isSensitiveName('SECRET_KEY'), true);

  assert.equal(isSensitiveName('xmemo-skill.mjs'), false);
  assert.equal(isSensitiveName('SKILL.md'), false);
  assert.equal(isSensitiveName('muse-vault.mjs'), false);
  assert.equal(isSensitiveName('openclaw-egress.mjs'), false);
});

test('builder script: builds standalone @xmemo/skill npm package with verified manifest and byte identity', async () => {
  const tmpOut = await mkdtemp(path.join(os.tmpdir(), 'xmemo-npm-build-test-'));
  try {
    const buildResult = await buildSkillNpmPackage({ outDir: tmpOut });
    assert.equal(buildResult.package, '@xmemo/skill');

    // 1. Check top-level package files
    const topEntries = (await readdir(tmpOut)).sort();
    assert.deepEqual(topEntries, ['LICENSE', 'README.md', 'bin', 'package.json', 'skill']);

    // 2. Check package.json contents
    const pkgJson = JSON.parse(await readFile(path.join(tmpOut, 'package.json'), 'utf8'));
    assert.equal(pkgJson.name, '@xmemo/skill');
    assert.equal(pkgJson.version, buildResult.version);
    assert.equal(pkgJson.type, 'module');
    assert.deepEqual(pkgJson.bin, { 'xmemo-skill': 'bin/install.mjs' });
    assert.deepEqual(pkgJson.files, ['bin', 'skill', 'README.md', 'LICENSE']);
    assert.equal(pkgJson.engines?.node, '>=20.0.0');
    assert.equal(pkgJson.license, 'MIT');
    assert.equal(pkgJson.dependencies, undefined);
    assert.equal(pkgJson.devDependencies, undefined);

    // 3. Check README.md and LICENSE
    const readme = await readFile(path.join(tmpOut, 'README.md'), 'utf8');
    assert.match(readme, /# @xmemo\/skill/);
    assert.match(readme, /npx @xmemo\/skill install/);
    assert.match(readme, /Zero dependencies/);

    const license = await readFile(path.join(tmpOut, 'LICENSE'), 'utf8');
    const repoLicense = await readFile(path.join(repoRoot, 'LICENSE'), 'utf8');
    assert.equal(license, repoLicense);

    // 4. Check bin/install.mjs
    const binFile = path.join(tmpOut, 'bin', 'install.mjs');
    const binStat = await lstat(binFile);
    assert.ok(binStat.isFile());
    const binContent = await readFile(binFile, 'utf8');
    assert.ok(binContent.startsWith('#!/usr/bin/env node'));

    // 5. Compare skill/ against skills/xmemo manifest and bytes
    const sourceFiles = await getAllFilesRelative(sourceSkillDir);
    const stagedFiles = await getAllFilesRelative(path.join(tmpOut, 'skill'));
    assert.deepEqual(stagedFiles, sourceFiles);
    assert.ok(stagedFiles.includes('references/auth-setup.md'), 'references/auth-setup.md must be included in staged npm package');
    assert.ok(stagedFiles.includes('references/command-details.md'), 'references/command-details.md must be included in staged npm package');

    for (const relFile of sourceFiles) {
      const srcBuf = await readFile(path.join(sourceSkillDir, relFile));
      const dstBuf = await readFile(path.join(tmpOut, 'skill', relFile));
      assert.ok(
        srcBuf.equals(dstBuf),
        `Byte mismatch between skills/xmemo/${relFile} and staged package skill/${relFile}`,
      );
    }
  } finally {
    await rm(tmpOut, { recursive: true, force: true });
  }
});

test('builder script: CLI execution builds package and handles --help', async () => {
  const helpRes = await runChildProcess(process.execPath, [builderScriptPath, '--help']);
  assert.equal(helpRes.code, 0);
  assert.match(helpRes.stdout, /Usage: node scripts\/build-skill-npm-package\.mjs --out <directory>/);

  const tmpOut = await mkdtemp(path.join(os.tmpdir(), 'xmemo-npm-cli-build-'));
  try {
    const buildRes = await runChildProcess(process.execPath, [builderScriptPath, '--out', tmpOut]);
    assert.equal(buildRes.code, 0);
    assert.match(buildRes.stdout, /Successfully built @xmemo\/skill@\d+\.\d+\.\d+/);

    const stat = await access(path.join(tmpOut, 'package.json'));
    assert.equal(stat, undefined);
  } finally {
    await rm(tmpOut, { recursive: true, force: true });
  }
});

test('builder script: refuses non-empty output directory', async () => {
  const tmpOut = await mkdtemp(path.join(os.tmpdir(), 'xmemo-npm-non-empty-'));
  try {
    await writeFile(path.join(tmpOut, 'pre-existing.txt'), 'do not overwrite', 'utf8');

    await assert.rejects(
      async () => {
        await buildSkillNpmPackage({ outDir: tmpOut });
      },
      /Output directory is not empty/,
    );

    const cliRes = await runChildProcess(process.execPath, [builderScriptPath, '--out', tmpOut]);
    assert.equal(cliRes.code, 1);
    assert.match(cliRes.stderr, /Output directory is not empty/);
  } finally {
    await rm(tmpOut, { recursive: true, force: true });
  }
});

test('builder script: rejects C3 sensitive files and symlinks in source', async () => {
  const tmpSource = await mkdtemp(path.join(os.tmpdir(), 'xmemo-npm-source-'));
  const tmpOut = await mkdtemp(path.join(os.tmpdir(), 'xmemo-npm-out-'));
  try {
    await cp(sourceSkillDir, tmpSource, { recursive: true });

    // Negative 1: sensitive file named .env.local
    const envFile = path.join(tmpSource, '.env.local');
    await writeFile(envFile, 'SECRET=123\n', 'utf8');
    await assert.rejects(
      async () => {
        await buildSkillNpmPackage({ outDir: tmpOut, sourceDir: tmpSource });
      },
      /Sensitive-looking file found in skill source: \.env\.local/,
    );
    await rm(envFile, { force: true });

    // Negative 2: sensitive file named secret.key in a subdirectory
    const subSecret = path.join(tmpSource, 'scripts', 'lib', 'secret.key');
    await writeFile(subSecret, 'key-data\n', 'utf8');
    await assert.rejects(
      async () => {
        await buildSkillNpmPackage({ outDir: tmpOut, sourceDir: tmpSource });
      },
      /Sensitive-looking file found in skill source/,
    );
    await rm(subSecret, { force: true });

    // Negative 3: symlink inside source
    const symlinkTarget = path.join(tmpSource, 'SKILL.md');
    const symlinkPath = path.join(tmpSource, 'symlink-test.md');
    let canSymlink = true;
    try {
      await symlink(symlinkTarget, symlinkPath);
    } catch {
      canSymlink = false; // Non-admin on Windows may not support symlink creation
    }

    if (canSymlink) {
      await assert.rejects(
        async () => {
          await buildSkillNpmPackage({ outDir: tmpOut, sourceDir: tmpSource });
        },
        /Refusing to package symlinks/,
      );
      await rm(symlinkPath, { force: true });
    }
  } finally {
    await rm(tmpSource, { recursive: true, force: true });
    await rm(tmpOut, { recursive: true, force: true });
  }
});

test('installer: version and help commands', async () => {
  const tmpPackage = await mkdtemp(path.join(os.tmpdir(), 'xmemo-pkg-cmds-'));
  try {
    await buildSkillNpmPackage({ outDir: tmpPackage });
    const installBin = path.join(tmpPackage, 'bin', 'install.mjs');
    const expectedVersion = await extractSkillVersion(path.join(sourceSkillDir, 'scripts', 'xmemo-skill.mjs'));

    // version
    const verRes = await runChildProcess(process.execPath, [installBin, 'version']);
    assert.equal(verRes.code, 0);
    assert.equal(verRes.stdout.trim(), expectedVersion);

    // version --json
    const verJsonRes = await runChildProcess(process.execPath, [installBin, 'version', '--json']);
    assert.equal(verJsonRes.code, 0);
    const verObj = JSON.parse(verJsonRes.stdout);
    assert.equal(verObj.package, '@xmemo/skill');
    assert.equal(verObj.version, expectedVersion);
    assert.equal(verObj.skillVersion, expectedVersion);

    // help
    const helpRes = await runChildProcess(process.execPath, [installBin, 'help']);
    assert.equal(helpRes.code, 0);
    assert.match(helpRes.stdout, /XMemo Skill installer \(@xmemo\/skill\)/);
    assert.match(helpRes.stdout, /xmemo-skill install/);

    // --help and -h
    const flagHelpRes = await runChildProcess(process.execPath, [installBin, '--help']);
    assert.equal(flagHelpRes.code, 0);
    assert.match(flagHelpRes.stdout, /xmemo-skill install/);
  } finally {
    await rm(tmpPackage, { recursive: true, force: true });
  }
});

test('installer: dry-run mode outputs JSON report and creates no files', async () => {
  const tmpPackage = await mkdtemp(path.join(os.tmpdir(), 'xmemo-pkg-dryrun-'));
  const tmpTargetDir = await mkdtemp(path.join(os.tmpdir(), 'xmemo-pkg-dryrun-dest-'));
  const tmpTarget = path.join(tmpTargetDir, 'dryrun-target');
  try {
    await buildSkillNpmPackage({ outDir: tmpPackage });
    const installBin = path.join(tmpPackage, 'bin', 'install.mjs');

    const dryRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      tmpTarget,
      '--dry-run',
      '--json',
    ]);
    assert.equal(dryRes.code, 0);
    const report = JSON.parse(dryRes.stdout);
    assert.equal(report.package, '@xmemo/skill');
    assert.equal(report.dryRun, true);
    assert.equal(report.force, false);
    assert.equal(report.replaced, false);
    assert.equal(report.installed, false);
    assert.equal(report.networkUsed, false);
    assert.equal(report.tokenSent, false);
    assert.equal(report.target, path.resolve(tmpTarget));

    // Assert target was NOT created
    await assert.rejects(access(tmpTarget), { code: 'ENOENT' });
  } finally {
    await rm(tmpPackage, { recursive: true, force: true });
    await rm(tmpTargetDir, { recursive: true, force: true });
  }
});

test('installer: installs byte-identical skill tree without bin/ or package wrapper', async () => {
  const tmpPackage = await mkdtemp(path.join(os.tmpdir(), 'xmemo-pkg-install-'));
  const tmpTarget = await mkdtemp(path.join(os.tmpdir(), 'xmemo-installed-skill-'));
  try {
    // Clean target dir so installer installs into a new dir
    await rm(tmpTarget, { recursive: true, force: true });

    await buildSkillNpmPackage({ outDir: tmpPackage });
    const installBin = path.join(tmpPackage, 'bin', 'install.mjs');

    const installRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      tmpTarget,
      '--json',
    ]);
    assert.equal(installRes.code, 0);
    const report = JSON.parse(installRes.stdout);
    assert.equal(report.package, '@xmemo/skill');
    assert.equal(report.dryRun, false);
    assert.equal(report.force, false);
    assert.equal(report.replaced, false);
    assert.equal(report.installed, true);
    assert.equal(report.networkUsed, false);
    assert.equal(report.tokenSent, false);

    // 1. Assert installed tree is byte-identical to skills/xmemo
    const sourceFiles = await getAllFilesRelative(sourceSkillDir);
    const installedFiles = await getAllFilesRelative(tmpTarget);
    assert.deepEqual(installedFiles, sourceFiles);

    for (const relFile of sourceFiles) {
      const srcBuf = await readFile(path.join(sourceSkillDir, relFile));
      const instBuf = await readFile(path.join(tmpTarget, relFile));
      assert.ok(
        srcBuf.equals(instBuf),
        `Byte mismatch on installed file ${relFile}`,
      );
    }

    // 2. Assert no installer wrapper files were copied into destination
    await assert.rejects(access(path.join(tmpTarget, 'bin')), { code: 'ENOENT' });
    await assert.rejects(access(path.join(tmpTarget, 'package.json')), { code: 'ENOENT' });
    await assert.rejects(access(path.join(tmpTarget, 'install.sh')), { code: 'ENOENT' });
    await assert.rejects(access(path.join(tmpTarget, 'install.ps1')), { code: 'ENOENT' });
  } finally {
    await rm(tmpPackage, { recursive: true, force: true });
    await rm(tmpTarget, { recursive: true, force: true });
  }
});

test('installer: refuses existing target without --force, succeeds and replaces with --force', async () => {
  const tmpPackage = await mkdtemp(path.join(os.tmpdir(), 'xmemo-pkg-force-'));
  const tmpTarget = await mkdtemp(path.join(os.tmpdir(), 'xmemo-target-dir-'));
  try {
    await buildSkillNpmPackage({ outDir: tmpPackage });
    const installBin = path.join(tmpPackage, 'bin', 'install.mjs');

    // 1. Initial install
    await rm(tmpTarget, { recursive: true, force: true });
    const firstRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      tmpTarget,
    ]);
    assert.equal(firstRes.code, 0);
    assert.match(firstRes.stdout, /Installed XMemo Skill/);

    // 2. Attempt install again without --force (must fail)
    const refusedRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      tmpTarget,
    ]);
    assert.equal(refusedRes.code, 1);
    assert.match(refusedRes.stderr, /Skill destination already exists.*Use --force to replace it\./);

    // 3. Mutate installed destination (add an unexpected file)
    await writeFile(path.join(tmpTarget, 'modified.txt'), 'extra file', 'utf8');

    // 4. Install with --force (must succeed and replace completely)
    const forceRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      tmpTarget,
      '--force',
      '--json',
    ]);
    assert.equal(forceRes.code, 0);
    const report = JSON.parse(forceRes.stdout);
    assert.equal(report.installed, true);
    assert.equal(report.replaced, true);
    assert.equal(report.force, true);

    // modified.txt should no longer exist
    await assert.rejects(access(path.join(tmpTarget, 'modified.txt')), { code: 'ENOENT' });

    // Installed files match source exactly
    const sourceFiles = await getAllFilesRelative(sourceSkillDir);
    const installedFiles = await getAllFilesRelative(tmpTarget);
    assert.deepEqual(installedFiles, sourceFiles);
  } finally {
    await rm(tmpPackage, { recursive: true, force: true });
    await rm(tmpTarget, { recursive: true, force: true });
  }
});

test('installer: refuses filesystem root and target inside package', async () => {
  const tmpPackage = await mkdtemp(path.join(os.tmpdir(), 'xmemo-pkg-safe-'));
  try {
    await buildSkillNpmPackage({ outDir: tmpPackage });
    const installBin = path.join(tmpPackage, 'bin', 'install.mjs');

    // 1. Refuse root
    const rootPath = path.parse(process.cwd()).root;
    const rootRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      rootPath,
      '--force',
    ]);
    assert.equal(rootRes.code, 1);
    assert.match(rootRes.stderr, /Refusing to install a Skill into a filesystem root\./);

    // 2. Refuse target inside package root
    const insidePkg = path.join(tmpPackage, 'skill');
    const insidePkgRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      insidePkg,
      '--force',
    ]);
    assert.equal(insidePkgRes.code, 1);
    assert.match(insidePkgRes.stderr, /Skill destination cannot be the (package root|skill source) or a directory inside it\./);

    const insideNested = path.join(tmpPackage, 'skill', 'nested');
    const nestedRes = await runChildProcess(process.execPath, [
      installBin,
      'install',
      '--target',
      insideNested,
      '--force',
    ]);
    assert.equal(nestedRes.code, 1);
    assert.match(nestedRes.stderr, /Skill destination cannot be the (package root|skill source) or a directory inside it\./);
  } finally {
    await rm(tmpPackage, { recursive: true, force: true });
  }
});

test('installer: rollback preserves pre-existing target on atomic install failure', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'xmemo-rollback-test-'));
  const target = path.join(tmpDir, 'target');
  const source = path.join(tmpDir, 'source');
  try {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'canary.txt'), 'original target content', 'utf8');

    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'new.txt'), 'new content', 'utf8');

    // Simulate failure during staging rename (after target was renamed to backup)
    let renameCount = 0;
    const mockRename = async (from, to) => {
      renameCount += 1;
      // First rename is target -> backup (succeeds)
      if (renameCount === 1) {
        const { rename } = await import('node:fs/promises');
        return rename(from, to);
      }
      // Second rename is staging -> target (fails)
      if (renameCount === 2) {
        throw new Error('Simulated failure during staging -> target rename');
      }
      // Subsequent rename is rollback backup -> target (succeeds)
      const { rename } = await import('node:fs/promises');
      return rename(from, to);
    };

    await assert.rejects(
      async () => {
        await atomicInstall(source, target, true, { rename: mockRename });
      },
      /Simulated failure during staging -> target rename/,
    );

    // Verify target was restored with canary.txt intact
    const canary = await readFile(path.join(target, 'canary.txt'), 'utf8');
    assert.equal(canary, 'original target content');

    // Verify staging and backup directories cleaned up
    const entries = await readdir(tmpDir);
    const stagingOrBackup = entries.filter((name) => name.includes('xmemo-staging') || name.includes('xmemo-backup'));
    assert.deepEqual(stagingOrBackup, []);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('installer: fails closed when bundled skill directory is missing', async () => {
  const tmpPackage = await mkdtemp(path.join(os.tmpdir(), 'xmemo-pkg-missing-skill-'));
  try {
    await buildSkillNpmPackage({ outDir: tmpPackage });
    const installBin = path.join(tmpPackage, 'bin', 'install.mjs');
    await rm(path.join(tmpPackage, 'skill'), { recursive: true, force: true });

    const res = await runChildProcess(process.execPath, [installBin, 'install']);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Could not locate bundled skill directory/);
  } finally {
    await rm(tmpPackage, { recursive: true, force: true });
  }
});
