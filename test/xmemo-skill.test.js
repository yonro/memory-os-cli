import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exitCodeForError, EXIT_CODE } from '../skills/xmemo/scripts/lib/core.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

test('XMemo Skill describes standalone CLI-backed runtime selection', async () => {
  const skill = (await readFile(path.join(repoRoot, 'skills/xmemo/SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');
  const memoryOps = (await readFile(path.join(repoRoot, 'skills/xmemo/references/memory-operations.md'), 'utf8')).replace(/\r\n/g, '\n');

  assert.match(skill, /^---\nname: xmemo-memory\ndescription: .+\n---\n/);
  assert.match(skill, /Runtime Selection/);
  assert.match(skill, /First Successful Run/);
  assert.match(skill, /After ClawHub installs this Skill/);
  assert.match(skill, /doctor --anonymous/);
  assert.match(skill, /auth status --verify/);
  assert.match(skill, /managed\n+   secret store/);
  assert.match(skill, /scripts\/xmemo-skill\.mjs/);
  assert.doesNotMatch(skill, /node skills\/xmemo\/scripts\/xmemo-skill\.mjs/);
  assert.match(skill, /xmemo-skill\.mjs login/);
  assert.match(skill, /auth add --from-stdin/);
  assert.match(skill, /XMEMO_KEY/);
  assert.match(skill, /--allow-plaintext/);
  assert.match(skill, /unencrypted/i);
  assert.match(skill, /remember/);
  assert.match(skill, /recall/);
  assert.match(skill, /recall-context/);
  assert.match(skill, /--include_knowledge true/);
  assert.match(skill, /knowledge:read/);
  assert.match(skill, /not retroactive/i);
  assert.match(skill, /search/);
  assert.match(skill, /save-state/);
  assert.match(skill, /restore-state/);
  assert.match(skill, /restart-snapshot/);
  assert.match(skill, /restart-restore/);
  assert.match(skill, /Hosted Discovery Boundary/);
  assert.match(skill, /standalone_skill\.operations/);
  assert.match(skill, /\/v1\/restart\/snapshot/);
  assert.match(skill, /temporary-agent manifest/i);
  assert.match(skill, /create_restart_snapshot/);
  assert.match(skill, /restore_restart_snapshot/);
  assert.match(skill, /todo-add/);
  assert.match(skill, /expense-add/);
  assert.match(skill, /--compact/);
  assert.match(skill, /--timeout-ms/);
  assert.match(skill, /doctor --anonymous/);
  assert.match(skill, /--revoke-environment-token/);
  assert.match(skill, /PowerShell/);
  assert.match(skill, /register --reason/);
  assert.match(skill, /auth claim-confirm/);
  assert.match(skill, /auth claim-deny/);
  assert.match(skill, /auth-status/);
  assert.match(skill, /100 items/);
  assert.match(skill, /14 days/);
  assert.match(skill, /30 days/);
  assert.match(skill, /`forget`/);
  assert.match(skill, /references\/memory-operations\.md/);
  assert.match(skill, /references\/ledger-operations\.md/);
  assert.match(skill, /references\/runtime-operations\.md/);
  assert.match(skill, /references\/troubleshooting\.md/);
  assert.match(skill, /Do not simulate a successful memory read or write/i);
  assert.doesNotMatch(skill, /mos_[A-Za-z0-9_-]+:r-[A-Za-z0-9_-]+/);
  assert.match(memoryOps, /## Discovery boundary/);
  assert.match(memoryOps, /generic `POST \/v1\/skill\/operations` dispatcher/);
  assert.match(memoryOps, /unauthenticated `401` only\nproves that the protected route is reachable/);
  assert.match(memoryOps, /`recall-context`/);
  assert.match(memoryOps, /Knowledge/);
  assert.match(memoryOps, /knowledge:read/);
});

test('npm package excludes bundled skills and excludes build-skill-npm-package script', async () => {
  assert.equal(packageJson.files.includes('skills'), false);
  assert.ok(packageJson.files.includes('plugins/xmemo'));
  assert.ok(packageJson.files.includes('!scripts/build-skill-npm-package.mjs'));
});

test('standalone Skill installers remain HTTPS-only and package the expected entrypoint', async () => {
  const [posix, powershell] = await Promise.all([
    readFile(path.join(repoRoot, 'skills/install.sh'), 'utf8'),
    readFile(path.join(repoRoot, 'skills/install.ps1'), 'utf8'),
  ]);

  assert.match(posix, /XMEMO_BASE_URL:-https:\/\/xmemo\.dev/);
  assert.match(posix, /--proto '=https'/);
  assert.match(posix, /--proto-redir '=https'/);
  assert.match(posix, /scripts\/xmemo-skill\.mjs/);
  assert.doesNotMatch(posix, /XMEMO_KEY|Authorization/);

  assert.match(powershell, /https:\/\/xmemo\.dev/);
  assert.match(powershell, /AllowAutoRedirect = \$false/);
  assert.match(powershell, /Refusing a non-HTTPS redirect/);
  assert.match(powershell, /scripts\\xmemo-skill\.mjs/);
  assert.doesNotMatch(powershell, /XMEMO_KEY|Authorization/);

  // The installers download the published Skill archive, so keeping them inside
  // the Skill root would package them into the archive they fetch and copy them
  // into every install destination.
  for (const skillRootPath of ['skills/xmemo/install.sh', 'skills/xmemo/install.ps1']) {
    await assert.rejects(access(path.join(repoRoot, skillRootPath)), { code: 'ENOENT' });
  }
});

export async function getSkillDirectoryFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const res = path.join(dir, entry.name);
      return entry.isDirectory() ? getSkillDirectoryFiles(res) : res;
    })
  );
  return files.flat();
}

export function isSensitivePathSegment(segment) {
  const lower = segment.toLowerCase();
  if (lower.startsWith('.env')) return true;
  return /(secret|token|key|credential)/i.test(lower);
}

export function validateSkillPathAllowlist(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  const baseAllowed = new Set([
    'CHANGELOG.md',
    'SKILL.md',
    'skill-card.md',
    'references/memory-operations.md',
    'references/ledger-operations.md',
    'references/runtime-operations.md',
    'references/troubleshooting.md',
    'scripts/xmemo-skill.mjs',
  ]);
  if (baseAllowed.has(normalized)) {
    return true;
  }
  if (/^scripts\/lib\/[a-zA-Z0-9_-]+\.mjs$/.test(normalized)) {
    return true;
  }
  if (/^scripts\/commands\/[a-zA-Z0-9_-]+\.mjs$/.test(normalized)) {
    return true;
  }
  return false;
}

export const FORBIDDEN_SECURITY_PATTERNS = [
  { pattern: /child_process/, name: 'child_process', codeOnly: false },
  { pattern: /\beval\s*\(/, name: 'eval()', codeOnly: false },
  { pattern: /\bnew\s+Function\b/, name: 'new Function', codeOnly: false },
  { pattern: /\bimport\s*\(/, name: 'dynamic import()', codeOnly: true },
];

export async function assertSkillDirectoryIntegrity(skillDir) {
  const requiredFiles = [
    'CHANGELOG.md',
    'SKILL.md',
    'references/memory-operations.md',
    'references/ledger-operations.md',
    'references/runtime-operations.md',
    'references/troubleshooting.md',
    'scripts/xmemo-skill.mjs',
  ];

  const allFiles = await getSkillDirectoryFiles(skillDir);
  const relPaths = allFiles.map((f) => path.relative(skillDir, f).split(path.sep).join('/')).sort();

  for (const req of requiredFiles) {
    assert.ok(relPaths.includes(req), `Required file missing from skill package: ${req}`);
  }

  for (const filePath of allFiles) {
    const relPath = path.relative(skillDir, filePath).split(path.sep).join('/');
    const segments = relPath.split('/');

    for (const segment of segments) {
      if (isSensitivePathSegment(segment)) {
        throw new Error(`C3 violation: sensitive path segment "${segment}" in "${relPath}"`);
      }
    }

    if (!validateSkillPathAllowlist(relPath)) {
      throw new Error(`Allowlist violation: unexpected file "${relPath}" in skill package`);
    }

    const isCodeFile = /\.(m?js|cjs)$/.test(relPath);
    const content = await readFile(filePath, 'utf8');
    for (const { pattern, name, codeOnly } of FORBIDDEN_SECURITY_PATTERNS) {
      if (codeOnly && !isCodeFile) {
        continue;
      }
      if (pattern.test(content)) {
        throw new Error(`Security violation: forbidden pattern "${name}" found in "${relPath}"`);
      }
    }

    if (isCodeFile && relPath.startsWith('scripts/')) {
      const versionMatches = [...content.matchAll(/(?<![\d.])\b\d+\.\d+\.\d+\b(?![\d.])/g)];
      if (relPath === 'scripts/xmemo-skill.mjs') {
        assert.equal(versionMatches.length, 1, `Expected entrypoint to declare single version literal, found ${versionMatches.length}`);
        assert.match(content, /const\s+SKILL_VERSION\s*=\s*['"]\d+\.\d+\.\d+['"]/);
      } else if (versionMatches.length > 0) {
        throw new Error(`Single source of truth violation: unexpected version literal "${versionMatches[0][0]}" found in "${relPath}". Entrypoint SKILL_VERSION is the only permitted version literal under scripts.`);
      }
    }
  }
}

test('skills/xmemo package directory strictly adheres to allowlist and security rules', async () => {
  const skillDir = path.join(repoRoot, 'skills/xmemo');
  await assertSkillDirectoryIntegrity(skillDir);
});

async function withTempSkillDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-guard-'));
  try {
    await cp(path.join(repoRoot, 'skills/xmemo'), tempDir, { recursive: true });
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

test('skills/xmemo security guard rejects C3 sensitive file/dir names (negative tests)', async () => {
  await withTempSkillDir(async (tempSkillDir) => {
    // Negative 1: file named token.mjs in scripts/lib/
    const tempLibDir = path.join(tempSkillDir, 'scripts', 'lib');
    const tempTokenFile = path.join(tempLibDir, 'token.mjs');
    await mkdir(tempLibDir, { recursive: true });
    await writeFile(tempTokenFile, 'export const token = "abc";\n', 'utf8');
    await assert.rejects(
      async () => {
        await assertSkillDirectoryIntegrity(tempSkillDir);
      },
      /C3 violation: sensitive path segment "token\.mjs"/
    );
    await rm(tempTokenFile, { force: true });

    // Negative 2: directory named secret_dir
    const tempSecretDir = path.join(tempSkillDir, 'secret_dir');
    const tempInSecret = path.join(tempSecretDir, 'dummy.mjs');
    await mkdir(tempSecretDir, { recursive: true });
    await writeFile(tempInSecret, 'export const x = 1;\n', 'utf8');
    await assert.rejects(
      async () => {
        await assertSkillDirectoryIntegrity(tempSkillDir);
      },
      /C3 violation: sensitive path segment "secret_dir"/
    );
    await rm(tempSecretDir, { recursive: true, force: true });

    // Negative 3: .env file
    const tempEnvFile = path.join(tempSkillDir, '.env.local');
    await writeFile(tempEnvFile, 'VAR=1\n', 'utf8');
    await assert.rejects(
      async () => {
        await assertSkillDirectoryIntegrity(tempSkillDir);
      },
      /C3 violation: sensitive path segment "\.env\.local"/
    );
    await rm(tempEnvFile, { force: true });
  });
});

test('skills/xmemo security guard rejects disallowed file paths and extensions (negative tests)', async () => {
  await withTempSkillDir(async (tempSkillDir) => {
    // Negative 1: text file in scripts/lib
    const tempLibDir = path.join(tempSkillDir, 'scripts', 'lib');
    const tempTxtFile = path.join(tempLibDir, 'extra.txt');
    await mkdir(tempLibDir, { recursive: true });
    await writeFile(tempTxtFile, 'text content\n', 'utf8');
    await assert.rejects(
      async () => {
        await assertSkillDirectoryIntegrity(tempSkillDir);
      },
      /Allowlist violation: unexpected file "scripts\/lib\/extra\.txt"/
    );
    await rm(tempTxtFile, { force: true });

    // Negative 2: rogue file at root
    const rogueFile = path.join(tempSkillDir, 'rogue.mjs');
    await writeFile(rogueFile, 'export const rogue = true;\n', 'utf8');
    await assert.rejects(
      async () => {
        await assertSkillDirectoryIntegrity(tempSkillDir);
      },
      /Allowlist violation: unexpected file "rogue\.mjs"/
    );
    await rm(rogueFile, { force: true });
  });
});

test('skills/xmemo security guard rejects dangerous code patterns (negative tests)', async () => {
  await withTempSkillDir(async (tempSkillDir) => {
    const tempLibDir = path.join(tempSkillDir, 'scripts', 'lib');
    await mkdir(tempLibDir, { recursive: true });

    const dangerousCases = [
      {
        file: 'bad-cp.mjs',
        content: "import cp from 'child_process';\n",
        patternName: 'child_process',
      },
      {
        file: 'bad-eval.mjs',
        content: 'export function run(x) { return eval(x); }\n',
        patternName: 'eval()',
      },
      {
        file: 'bad-func.mjs',
        content: 'export const fn = new Function("a", "return a");\n',
        patternName: 'new Function',
      },
      {
        file: 'bad-dyn-import.mjs',
        content: 'export async function load(m) { return import(m); }\n',
        patternName: 'dynamic import()',
      },
    ];

    for (const { file, content, patternName } of dangerousCases) {
      const targetPath = path.join(tempLibDir, file);
      await writeFile(targetPath, content, 'utf8');
      await assert.rejects(
        async () => {
          await assertSkillDirectoryIntegrity(tempSkillDir);
        },
        new RegExp(`Security violation: forbidden pattern "${patternName.replace('(', '\\(').replace(')', '\\)')}"`)
      );
      await rm(targetPath, { force: true });
    }
  });
});

test('exitCodeForError matches HTTP 401 and 403 as whole numbers without false positives on ports or ids', () => {
  // Whole numbers should match AUTH_ERROR
  assert.equal(exitCodeForError(new Error('HTTP 401')), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForError(new Error('status 403 Forbidden')), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForError(new Error('error 401')), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForError(new Error('error 403')), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForError(new Error('Request failed with [401]')), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForError(new Error('status: 403')), EXIT_CODE.AUTH_ERROR);

  // Numbers embedded in ports, ids, or strings must NOT match AUTH_ERROR
  assert.equal(exitCodeForError(new Error('connect ECONNREFUSED 127.0.0.1:54013')), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForError(new Error('cannot connect to http://127.0.0.1:54013/v1')), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForError(new Error('memory id 14032 not found')), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForError(new Error('entity_4010_missing')), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForError(new Error('item 24031')), EXIT_CODE.USER_ERROR);
});

