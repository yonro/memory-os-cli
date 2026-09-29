import { readdir, readFile, stat } from 'node:fs/promises';
import { spawn, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDirectory = path.join(repositoryRoot, 'test');
const testFiles = (await readdir(testDirectory))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDirectory, name));

if (testFiles.length === 0) {
  console.error(`No root CLI tests found in ${testDirectory}.`);
  process.exitCode = 1;
} else {
  // 1. Snapshot git status and pre-existing ignored files before tests
  const PROTECTED_ROOT_IGNORED_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
  async function computeFileHash(filePath) {
    try {
      const content = await readFile(filePath);
      return createHash('sha256').update(content).digest('hex');
    } catch {
      return null;
    }
  }

  const beforeHashes = new Map();
  for (const file of PROTECTED_ROOT_IGNORED_FILES) {
    const fullPath = path.join(repositoryRoot, file);
    const hash = await computeFileHash(fullPath);
    if (hash !== null) {
      beforeHashes.set(file, hash);
    }
  }

  function getStatusEntries() {
    try {
      const output = execSync('git status --porcelain --ignored', {
        cwd: repositoryRoot,
        encoding: 'utf8'
      });
      const entries = new Map();
      for (const line of output.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const status = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (file === 'node_modules/' || file.startsWith('node_modules/')) continue;
        entries.set(file, status);
      }
      return entries;
    } catch {
      return new Map();
    }
  }

  const beforeStatus = getStatusEntries();

  const child = spawn(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`Could not start the Node test runner: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', async (code, signal) => {
    let exitCode = signal ? 1 : (code ?? 0);

    // 2. Post-test cleanliness verification
    const afterStatus = getStatusEntries();
    const violations = [];

    // Check hashes of pre-existing protected root ignored files
    for (const [file, beforeHash] of beforeHashes.entries()) {
      const fullPath = path.join(repositoryRoot, file);
      const afterHash = await computeFileHash(fullPath);
      if (afterHash === null) {
        violations.push(`Pre-existing ignored file was deleted: ${file}`);
      } else if (afterHash !== beforeHash) {
        violations.push(`Pre-existing ignored file was modified: ${file}`);
      }
    }

    // Check newly created files (untracked ?? or ignored !!)
    for (const [file, status] of afterStatus.entries()) {
      if (!beforeStatus.has(file)) {
        violations.push(`New ${status === '!!' ? 'ignored' : 'untracked'} file or directory created: ${file}`);
      }
    }

    // Check known stray test directories
    const STRAY_DIRS = ['Python', 'xmemo-skill', 'xmemo-skill-test', 'custom-app-dir', '.kimi-code'];
    for (const dir of STRAY_DIRS) {
      try {
        const s = await stat(path.join(repositoryRoot, dir));
        if (s.isDirectory()) {
          violations.push(`Stray test directory left in repository: ${dir}`);
        }
      } catch {}
    }

    if (violations.length > 0) {
      console.error('\n❌ Test isolation violation: tests modified or left files in the repository:');
      for (const v of violations) {
        console.error(`  - ${v}`);
      }
      exitCode = 1;
    }

    process.exitCode = exitCode;
  });
}
