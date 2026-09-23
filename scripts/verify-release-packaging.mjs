#!/usr/bin/env node
/**
 * scripts/verify-release-packaging.mjs
 *
 * Simulates and verifies the release archive packaging logic from
 * .github/workflows/release-xmemo-skill.yml.
 * Covers both positive verification against `skills/xmemo` and negative
 * verification against forbidden filenames (e.g., `lib/token.mjs`, `.env`).
 *
 * Usage:
 *   node scripts/verify-release-packaging.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export function isSensitiveName(name) {
  const lower = name.toLowerCase();
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('key') ||
    lower.includes('credential')
  );
}

export function isPathSensitive(relPath) {
  const parts = relPath.split(/[/\\]/);
  return parts.some((p) => isSensitiveName(p));
}

export async function packageSkillDirectory(sourceDir, targetArtifactDir) {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-pack-stage-'));
  try {
    // 1. Check entrypoint exists
    await fs.access(path.join(sourceDir, 'scripts', 'xmemo-skill.mjs'));

    // 2. Walk source files
    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const res = path.join(dir, entry.name);
          return entry.isDirectory() ? walk(res) : res;
        })
      );
      return files.flat();
    }

    const allSourceFiles = await walk(sourceDir);
    const sourceRelativeFiles = allSourceFiles
      .map((f) => path.relative(sourceDir, f).split(path.sep).join('/'))
      .sort();

    // 3. Stage and check sensitive names
    const excludedFiles = [];
    for (const relPath of sourceRelativeFiles) {
      if (isPathSensitive(relPath)) {
        excludedFiles.push(relPath);
        continue;
      }
      const dest = path.join(stagingDir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(sourceDir, relPath), dest);
    }

    if (excludedFiles.length > 0) {
      throw new Error(
        `Release packaging rejected: ${excludedFiles.length} file(s) matched sensitive name rules: ${excludedFiles.join(', ')}`
      );
    }

    // 4. Verify 1:1 manifest parity
    const stagedFiles = (await walk(stagingDir))
      .map((f) => path.relative(stagingDir, f).split(path.sep).join('/'))
      .sort();

    assert.deepEqual(
      sourceRelativeFiles,
      stagedFiles,
      'Release packaging rejected: source files and staged archive files do not match'
    );

    // 5. Verify no installers packaged
    for (const forbidden of ['install.sh', 'install.ps1']) {
      await assert.rejects(fs.access(path.join(stagingDir, forbidden)), { code: 'ENOENT' });
    }

    return {
      ok: true,
      fileCount: stagedFiles.length,
      files: stagedFiles,
    };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

export async function runDrill() {
  console.log('Running Release Packaging Simulation & Drill...');

  // --- Positive Test: Current skills/xmemo directory ---
  const skillDir = path.join(repoRoot, 'skills', 'xmemo');
  const positiveResult = await packageSkillDirectory(skillDir);
  assert.equal(positiveResult.ok, true);
  assert.equal(positiveResult.fileCount, 5);
  console.log(`✓ Positive test passed: ${positiveResult.fileCount} files packaged cleanly:`);
  for (const f of positiveResult.files) {
    console.log(`   - ${f}`);
  }

  // --- Negative Test 1: File named lib/token.mjs ---
  const mockDir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-neg-token-'));
  try {
    await fs.cp(skillDir, mockDir1, { recursive: true });
    const forbiddenTokenFile = path.join(mockDir1, 'scripts', 'lib', 'token.mjs');
    await fs.mkdir(path.dirname(forbiddenTokenFile), { recursive: true });
    await fs.writeFile(forbiddenTokenFile, '// forbidden token module');

    await assert.rejects(
      packageSkillDirectory(mockDir1),
      (err) => {
        assert.match(err.message, /Release packaging rejected/);
        assert.match(err.message, /matched sensitive name rules: scripts\/lib\/token\.mjs/);
        return true;
      }
    );
    console.log('✓ Negative test 1 passed: lib/token.mjs correctly rejected with hard failure');
  } finally {
    await fs.rm(mockDir1, { recursive: true, force: true });
  }

  // --- Negative Test 2: File named .env.local ---
  const mockDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-neg-env-'));
  try {
    await fs.cp(skillDir, mockDir2, { recursive: true });
    const forbiddenEnvFile = path.join(mockDir2, '.env.local');
    await fs.writeFile(forbiddenEnvFile, 'SECRET=123');

    await assert.rejects(
      packageSkillDirectory(mockDir2),
      (err) => {
        assert.match(err.message, /Release packaging rejected/);
        assert.match(err.message, /\.env\.local/);
        return true;
      }
    );
    console.log('✓ Negative test 2 passed: .env.local correctly rejected with hard failure');
  } finally {
    await fs.rm(mockDir2, { recursive: true, force: true });
  }

  // --- Negative Test 3: Subdirectory named secret_keys/ ---
  const mockDir3 = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-neg-dir-'));
  try {
    await fs.cp(skillDir, mockDir3, { recursive: true });
    const forbiddenSubdirFile = path.join(mockDir3, 'scripts', 'secret_helpers', 'helper.mjs');
    await fs.mkdir(path.dirname(forbiddenSubdirFile), { recursive: true });
    await fs.writeFile(forbiddenSubdirFile, '// helper');

    await assert.rejects(
      packageSkillDirectory(mockDir3),
      (err) => {
        assert.match(err.message, /Release packaging rejected/);
        assert.match(err.message, /secret_helpers\/helper\.mjs/);
        return true;
      }
    );
    console.log('✓ Negative test 3 passed: secret directory correctly rejected with hard failure');
  } finally {
    await fs.rm(mockDir3, { recursive: true, force: true });
  }

  console.log('All release packaging verification drills passed successfully.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runDrill().catch((err) => {
    console.error('Packaging drill failed:', err);
    process.exit(1);
  });
}
