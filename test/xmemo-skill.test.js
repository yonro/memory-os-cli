import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exitCodeForError, exitCodeForErrorCode, exitCodeForHttpStatus, EXIT_CODE } from '../skills/xmemo/scripts/lib/core.mjs';
import { getStoredCredential } from '../skills/xmemo/scripts/lib/auth-state.mjs';
import { sanitizeTerminalText } from '../skills/xmemo/scripts/lib/api.mjs';
import { looksLikeOpenClawSentinel } from '../skills/xmemo/scripts/lib/openclaw-egress.mjs';
import { resolveCredentialSource, formatAuthErrorHint } from '../skills/xmemo/scripts/lib/auth-hint.mjs';
import {
  readStdin,
  readStdinContent,
  readBoundedFile,
  MAX_STDIN_INPUT_BYTES,
} from '../skills/xmemo/scripts/lib/bounded-read.mjs';
import {
  readStdin as cliReadStdin,
  readStdinContent as cliReadStdinContent,
  readBoundedFile as cliReadBoundedFile,
} from '../skills/xmemo/scripts/lib/cli-input.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

test('XMemo Skill describes standalone CLI-backed runtime selection', async () => {
  const skill = (await readFile(path.join(repoRoot, 'skills/xmemo/SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');
  const memoryOps = (await readFile(path.join(repoRoot, 'skills/xmemo/references/memory-operations.md'), 'utf8')).replace(/\r\n/g, '\n');
  const authSetup = (await readFile(path.join(repoRoot, 'skills/xmemo/references/auth-setup.md'), 'utf8')).replace(/\r\n/g, '\n');

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
  assert.match(authSetup, /Hosted Discovery Boundary/);
  assert.match(authSetup, /standalone_skill\.operations/);
  assert.match(authSetup, /\/v1\/restart\/snapshot/);
  assert.match(authSetup, /temporary-agent manifest/i);
  assert.match(skill, /create_restart_snapshot/);
  assert.match(skill, /restore_restart_snapshot/);
  assert.match(skill, /todo-add/);
  assert.match(skill, /expense-add/);
  assert.match(skill, /--compact/);
  assert.match(skill, /--timeout-ms/);
  assert.match(skill, /doctor --anonymous/);
  assert.match(skill, /--revoke-environment-token/);
  assert.match(authSetup, /PowerShell/);
  assert.match(skill, /register --reason/);
  assert.match(skill, /auth claim-confirm/);
  assert.match(skill, /auth claim-deny/);
  assert.match(skill, /auth-status/);
  assert.match(skill, /100 items/);
  assert.match(skill, /14 days/);
  assert.match(skill, /30 days/);
  assert.match(skill, /`forget`/);
  assert.match(skill, /references\/auth-setup\.md/);
  assert.match(skill, /references\/command-details\.md/);
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
    'references/auth-setup.md',
    'references/command-details.md',
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
    'references/auth-setup.md',
    'references/command-details.md',
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

test('bounded-read module exports expected functions and bounded constants', () => {
  assert.equal(typeof readStdin, 'function');
  assert.equal(typeof readStdinContent, 'function');
  assert.equal(typeof readBoundedFile, 'function');
  assert.equal(MAX_STDIN_INPUT_BYTES, 65536);

  assert.equal(typeof cliReadStdin, 'function');
  assert.equal(typeof cliReadStdinContent, 'function');
  assert.equal(typeof cliReadBoundedFile, 'function');
});

test('R1: getStoredCredential trims XMEMO_KEY and treats empty/whitespace as unset', async () => {
  const origKey = process.env.XMEMO_KEY;
  try {
    process.env.XMEMO_KEY = 'my-token\n';
    const cred1 = await getStoredCredential();
    assert.deepEqual(cred1, {
      token: 'my-token',
      credential_type: 'environment',
      storage: 'environment',
    });

    process.env.XMEMO_KEY = '   my-token   ';
    const cred2 = await getStoredCredential();
    assert.deepEqual(cred2, {
      token: 'my-token',
      credential_type: 'environment',
      storage: 'environment',
    });

    process.env.XMEMO_KEY = '   \n\t  ';
    const cred3 = await getStoredCredential();
    assert.equal(cred3, null);
  } finally {
    if (origKey !== undefined) {
      process.env.XMEMO_KEY = origKey;
    } else {
      delete process.env.XMEMO_KEY;
    }
  }
});

test('R2: exitCodeForErrorCode regex /^http 40[13](?!\\d)/ matches 401/403 and falls back for 4010/4031', () => {
  assert.equal(exitCodeForErrorCode('http 401'), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForErrorCode('http 403 forbidden'), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForErrorCode('http 4010'), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForErrorCode('http 4031'), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForErrorCode('http 500'), EXIT_CODE.SERVER_ERROR);
});

test('R3: sanitizeTerminalText strips ANSI escape sequences and control characters', () => {
  assert.equal(sanitizeTerminalText('\x1b[31mRed Text\x1b[0m'), 'Red Text');
  assert.equal(sanitizeTerminalText('Line1\x00\x08NullBell'), 'Line1NullBell');
  assert.equal(sanitizeTerminalText(null), '');
  assert.equal(sanitizeTerminalText(undefined), '');
  assert.equal(sanitizeTerminalText(12345), '12345');
});

test('R4: exitCodeForHttpStatus maps 401/403 to AUTH_ERROR, 4xx to USER_ERROR, 5xx to SERVER_ERROR', () => {
  assert.equal(exitCodeForHttpStatus(401), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForHttpStatus(403), EXIT_CODE.AUTH_ERROR);
  assert.equal(exitCodeForHttpStatus(404), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(429), EXIT_CODE.USER_ERROR);
  assert.equal(exitCodeForHttpStatus(500), EXIT_CODE.SERVER_ERROR);
  assert.equal(exitCodeForHttpStatus(503), EXIT_CODE.SERVER_ERROR);
});

test('Part A: looksLikeOpenClawSentinel identifies sentinels and look-alikes', () => {
  assert.equal(looksLikeOpenClawSentinel('oc-sent-v2.abc.end'), true);
  assert.equal(looksLikeOpenClawSentinel('oc-sent-v3.abc.end'), true);
  assert.equal(looksLikeOpenClawSentinel('OC-SENT-v2.x'), true);
  assert.equal(looksLikeOpenClawSentinel('  oc-sent-v2.trimmed  '), true);
  assert.equal(looksLikeOpenClawSentinel('oc-sent-v2.bad!.end'), true);
  assert.equal(looksLikeOpenClawSentinel('token_regular_123'), false);
  assert.equal(looksLikeOpenClawSentinel('hsurr:abc'), false);
  assert.equal(looksLikeOpenClawSentinel(''), false);
  assert.equal(looksLikeOpenClawSentinel(null), false);
  assert.equal(looksLikeOpenClawSentinel(undefined), false);
});

test('Part B: resolveCredentialSource and formatAuthErrorHint map credential sources correctly', () => {
  assert.equal(resolveCredentialSource({ storage: 'openclaw-secret' }), 'openclaw-secret');
  assert.equal(resolveCredentialSource({ storage: 'vault' }), 'vault');
  assert.equal(resolveCredentialSource({ storage: 'environment' }), 'environment');
  assert.equal(resolveCredentialSource({ storage: 'plaintext' }), 'file');
  assert.equal(resolveCredentialSource({ storage: 'unknown' }), 'file');
  assert.equal(resolveCredentialSource(null), 'file');
  assert.equal(resolveCredentialSource(undefined), 'file');

  assert.equal(
    formatAuthErrorHint({ storage: 'environment' }),
    'Credential source: environment. Run `node scripts/xmemo-skill.mjs auth status --verify` to check it.'
  );
  assert.equal(
    formatAuthErrorHint({ storage: 'file' }),
    'Credential source: file. Run `node scripts/xmemo-skill.mjs auth status --verify` to check it.'
  );
  assert.equal(
    formatAuthErrorHint({ storage: 'openclaw-secret' }),
    'Credential source: openclaw-secret. Run `node scripts/xmemo-skill.mjs auth status --verify` to check it.'
  );
  assert.equal(
    formatAuthErrorHint({ storage: 'vault' }),
    'Credential source: vault. Run `node scripts/xmemo-skill.mjs auth status --verify` to check it.'
  );
});

test('SKILL.md retains standalone first-run and daily-use command lines and exit code table', async () => {
  const skill = (await readFile(path.join(repoRoot, 'skills/xmemo/SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');

  // First run: doctor --anonymous, login --allow-plaintext, auth status --verify
  assert.match(skill, /node scripts\/xmemo-skill\.mjs doctor --anonymous/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs login --allow-plaintext/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs auth status --verify/);

  // Daily use: recall, search, recall-context, remember, read, update, forget,
  // save-state, restore-state, restart-snapshot, restart-restore, todo-add,
  // todo-list, todo-done, expense-add, ledger-list, ledger-summary, overview,
  // activity, stats, doctor
  assert.match(skill, /node scripts\/xmemo-skill\.mjs recall --query/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs search --query/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs recall-context --query/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs remember --content/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs remember --content -/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs remember --file/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs read --id/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs update --id/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs forget --id/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs save-state --key/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs restore-state --key/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs restart-snapshot/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs restart-restore/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs todo-add --content/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs todo-list/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs todo-done --id/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs expense-add --item/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs ledger-list/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs ledger-summary/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs overview/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs activity/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs stats/);
  assert.match(skill, /node scripts\/xmemo-skill\.mjs doctor/);

  // Failure handling and exit codes table
  assert.match(skill, /\| Exit Code \| Classification \| Conditions & Semantics \| Next Action \|/);
  assert.match(skill, /\| `0` \| Success \|/);
  assert.match(skill, /\| `1` \| User Error \|/);
  assert.match(skill, /\| `2` \| Auth Error \|/);
  assert.match(skill, /\| `3` \| Server \/ Network Error \|/);
  assert.match(skill, /No XMemo credential found/);
});

test('Skill package includes references/auth-setup.md and references/command-details.md in builder output and release package manifest', async () => {
  const allFiles = await getSkillDirectoryFiles(path.join(repoRoot, 'skills', 'xmemo'));
  const relPaths = allFiles.map((f) => path.relative(path.join(repoRoot, 'skills', 'xmemo'), f).split(path.sep).join('/'));
  assert.ok(relPaths.includes('references/auth-setup.md'), 'skills/xmemo source directory must include references/auth-setup.md');
  assert.ok(relPaths.includes('references/command-details.md'), 'skills/xmemo source directory must include references/command-details.md');
});
