import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function findShell() {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\bin\\sh.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    ];
    for (const c of candidates) {
      try {
        await access(c);
        return c;
      } catch {}
    }
  }
  return 'sh';
}

function findPowerShell() {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }
  try {
    execFileSync('pwsh', ['-v'], { stdio: 'ignore' });
    return 'pwsh';
  } catch {
    return null;
  }
}

function runScript(bin, scriptPath, args = [], env = {}, cwd = repoRoot) {
  return new Promise((resolve) => {
    // Sanitize calling environment to isolate agent detection variables
    const baseEnv = { ...process.env };
    delete baseEnv.CLAUDECODE;
    delete baseEnv.CODEX_HOME;
    delete baseEnv.CODEX_THREAD_ID;
    delete baseEnv.CODEX_SESSION_ID;
    delete baseEnv.XMEMO_SKILL_AGENT;
    delete baseEnv.XMEMO_SKILL_DIR;
    delete baseEnv.XMEMO_SKILL_FORCE;
    delete baseEnv.XMEMO_SKILL_RESOLVE_ONLY;

    const child = spawn(bin, [...args, scriptPath], {
      cwd,
      env: {
        ...baseEnv,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

test('skills/install.sh target resolution rules (POSIX sh)', async (t) => {
  const shellBin = await findShell();
  const scriptPath = path.join(repoRoot, 'skills', 'install.sh');

  await t.test('Rule a: XMEMO_SKILL_DIR takes precedence over other rules', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const customPath = path.join(tempDir, 'my-custom-skill');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: tempDir.replace(/\\/g, '/'),
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        XMEMO_SKILL_DIR: customPath.replace(/\\/g, '/'),
        XMEMO_SKILL_AGENT: 'claude-code',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), customPath.replace(/\\/g, '/'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule b: explicit XMEMO_SKILL_AGENT=claude-code', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const posixTemp = tempDir.replace(/\\/g, '/');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        XMEMO_SKILL_AGENT: 'claude-code',
      });
      assert.equal(res.code, 0);
      assert.ok(res.stdout.trim().endsWith('/.claude/skills/xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule b: explicit XMEMO_SKILL_AGENT=codex', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const posixTemp = tempDir.replace(/\\/g, '/');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        XMEMO_SKILL_AGENT: 'codex',
      });
      assert.equal(res.code, 0);
      assert.ok(res.stdout.trim().endsWith('/.codex/skills/xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule b: XMEMO_SKILL_AGENT=openclaw prints guidance and exits 1', async () => {
    const res = await runScript(shellBin, scriptPath, [], {
      XMEMO_SKILL_AGENT: 'openclaw',
      XMEMO_SKILL_RESOLVE_ONLY: '1',
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /For OpenClaw run: openclaw skills install xmemo/);
  });

  await t.test('Rule b: unknown XMEMO_SKILL_AGENT exits 1', async () => {
    const res = await runScript(shellBin, scriptPath, [], {
      XMEMO_SKILL_AGENT: 'unsupported-agent',
      XMEMO_SKILL_RESOLVE_ONLY: '1',
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /unknown XMEMO_SKILL_AGENT/);
  });

  await t.test('Rule c: auto-detects Claude Code from CLAUDECODE=1', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const posixTemp = tempDir.replace(/\\/g, '/');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        CLAUDECODE: '1',
      });
      assert.equal(res.code, 0);
      assert.ok(res.stdout.trim().endsWith('/.claude/skills/xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule c: auto-detects Codex from CODEX_HOME', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const codexHome = path.join(tempDir, 'custom-codex');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: tempDir.replace(/\\/g, '/'),
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        CODEX_HOME: codexHome.replace(/\\/g, '/'),
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), `${codexHome.replace(/\\/g, '/')}/skills/xmemo-memory`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule c: auto-detects Codex from CODEX_THREAD_ID and CODEX_SESSION_ID', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const posixTemp = tempDir.replace(/\\/g, '/');
      const resThread = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        CODEX_THREAD_ID: 'thread_test_123',
      });
      assert.equal(resThread.code, 0);
      assert.ok(resThread.stdout.trim().endsWith('/.codex/skills/xmemo-memory'));

      const resSession = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        CODEX_SESSION_ID: 'session_test_456',
      });
      assert.equal(resSession.code, 0);
      assert.ok(resSession.stdout.trim().endsWith('/.codex/skills/xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule d: selects claude-code when only ~/.claude directory exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      await mkdir(path.join(tempDir, '.claude'));
      const posixTemp = tempDir.replace(/\\/g, '/');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
      });
      assert.equal(res.code, 0);
      assert.ok(res.stdout.trim().endsWith('/.claude/skills/xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule d: selects codex when only ~/.codex directory exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      await mkdir(path.join(tempDir, '.codex'));
      const posixTemp = tempDir.replace(/\\/g, '/');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
      });
      assert.equal(res.code, 0);
      assert.ok(res.stdout.trim().endsWith('/.codex/skills/xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule e: fallback to xmemo-skill with warning when neither agent dir exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const posixTemp = tempDir.replace(/\\/g, '/');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), 'xmemo-skill');
      assert.match(res.stderr, /Warning: Installing to \.\/xmemo-skill/);
      assert.match(res.stderr, /npx -y @xmemo\/client skill install --client <id>/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule e: fallback to xmemo-skill with warning when both ~/.claude and ~/.codex exist', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      await mkdir(path.join(tempDir, '.claude'));
      await mkdir(path.join(tempDir, '.codex'));
      const posixTemp = tempDir.replace(/\\/g, '/');
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixTemp,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), 'xmemo-skill');
      assert.match(res.stderr, /Warning: Installing to \.\/xmemo-skill/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Destination already exists: fails without XMEMO_SKILL_FORCE=1', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    try {
      const targetDir = path.join(tempDir, 'existing-skill');
      await mkdir(targetDir, { recursive: true });
      const posixTarget = targetDir.replace(/\\/g, '/');

      const res = await runScript(shellBin, scriptPath, [], {
        XMEMO_SKILL_DIR: posixTarget,
      });
      assert.equal(res.code, 1);
      assert.match(res.stderr, /destination already exists/);
      assert.match(res.stderr, /XMEMO_SKILL_FORCE=1/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Temporary extract directory is created in system temp and never under target parent directory', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    const customSysTemp = await mkdtemp(path.join(os.tmpdir(), 'installer-system-temp-'));
    try {
      const posixHome = tempDir.replace(/\\/g, '/');
      const posixSysTemp = customSysTemp.replace(/\\/g, '/');
      const skillsDir = path.join(tempDir, '.claude', 'skills');
      await mkdir(skillsDir, { recursive: true });

      // Point XMEMO_BASE_URL to an unreachable HTTPS endpoint so download fails
      const res = await runScript(shellBin, scriptPath, [], {
        HOME: posixHome,
        TMPDIR: posixSysTemp,
        TMP: posixSysTemp,
        TEMP: posixSysTemp,
        XMEMO_SKILL_AGENT: 'claude-code',
        XMEMO_BASE_URL: 'https://127.0.0.1:9',
      });

      assert.notEqual(res.code, 0);

      // Verify that no *.tmp.* or temporary directory was ever created under .claude or .claude/skills
      const skillsEntries = await readdir(skillsDir);
      assert.deepEqual(skillsEntries, [], 'no temporary files or folders should exist in target skills directory');

      const claudeEntries = await readdir(path.join(tempDir, '.claude'));
      assert.ok(!claudeEntries.some((e) => e.includes('.tmp.') || e.includes('tmp')), 'no tmp entries in .claude directory');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(customSysTemp, { recursive: true, force: true });
    }
  });
});

test('skills/install.ps1 target resolution and backup rules (PowerShell)', async (t) => {
  const pwshBin = findPowerShell();
  if (!pwshBin) {
    t.skip('PowerShell executable not found on this platform');
    return;
  }
  const scriptPath = path.join(repoRoot, 'skills', 'install.ps1');
  const baseArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];

  await t.test('Rule a: XMEMO_SKILL_DIR takes precedence', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      const customPath = path.join(tempDir, 'ps1-custom-skill');
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        XMEMO_SKILL_DIR: customPath,
        XMEMO_SKILL_AGENT: 'claude-code',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), customPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule b: explicit XMEMO_SKILL_AGENT=claude-code', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        XMEMO_SKILL_AGENT: 'claude-code',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), path.join(tempDir, '.claude', 'skills', 'xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule b: explicit XMEMO_SKILL_AGENT=codex', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        XMEMO_SKILL_AGENT: 'codex',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), path.join(tempDir, '.codex', 'skills', 'xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule b: XMEMO_SKILL_AGENT=openclaw prints guidance and exits 1', async () => {
    const res = await runScript(pwshBin, scriptPath, baseArgs, {
      XMEMO_SKILL_AGENT: 'openclaw',
      XMEMO_SKILL_RESOLVE_ONLY: '1',
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /For OpenClaw run: openclaw skills install xmemo/);
  });

  await t.test('Rule c: auto-detects Claude Code from CLAUDECODE=1', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        CLAUDECODE: '1',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), path.join(tempDir, '.claude', 'skills', 'xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule c: auto-detects Codex from CODEX_HOME', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      const codexHome = path.join(tempDir, 'my-codex-home');
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
        CODEX_HOME: codexHome,
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), path.join(codexHome, 'skills', 'xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule d: selects claude-code when only ~/.claude exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      await mkdir(path.join(tempDir, '.claude'));
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), path.join(tempDir, '.claude', 'skills', 'xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule d: selects codex when only ~/.codex exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      await mkdir(path.join(tempDir, '.codex'));
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), path.join(tempDir, '.codex', 'skills', 'xmemo-memory'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Rule e: fallback to xmemo-skill with warning when neither exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_RESOLVE_ONLY: '1',
      });
      assert.equal(res.code, 0);
      assert.equal(res.stdout.trim(), 'xmemo-skill');
      assert.match(res.stderr, /Warning: Installing to \.\/xmemo-skill/);
      assert.match(res.stderr, /npx -y @xmemo\/client skill install --client <id>/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Destination already exists: fails without XMEMO_SKILL_FORCE=1', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    try {
      const targetDir = path.join(tempDir, 'existing-skill');
      await mkdir(targetDir, { recursive: true });

      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        XMEMO_SKILL_DIR: targetDir,
      });
      assert.equal(res.code, 1);
      assert.match(res.stderr, /Destination already exists/);
      assert.match(res.stderr, /XMEMO_SKILL_FORCE=1/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('Temporary extract directory is created in system temp and never under target parent directory', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ps1-test-'));
    const customSysTemp = await mkdtemp(path.join(os.tmpdir(), 'ps1-system-temp-'));
    try {
      const skillsDir = path.join(tempDir, '.claude', 'skills');
      await mkdir(skillsDir, { recursive: true });

      const res = await runScript(pwshBin, scriptPath, baseArgs, {
        HOME: tempDir,
        USERPROFILE: tempDir,
        TEMP: customSysTemp,
        TMP: customSysTemp,
        XMEMO_SKILL_AGENT: 'claude-code',
        XMEMO_BASE_URL: 'https://127.0.0.1:9',
      });

      assert.notEqual(res.code, 0);

      // Verify that no *.tmp.* or temporary directory was ever created under .claude or .claude/skills
      const skillsEntries = await readdir(skillsDir);
      assert.deepEqual(skillsEntries, [], 'no temporary files or folders should exist in target skills directory');

      const claudeEntries = await readdir(path.join(tempDir, '.claude'));
      assert.ok(!claudeEntries.some((e) => e.includes('.tmp.') || e.includes('tmp')), 'no tmp entries in .claude directory');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(customSysTemp, { recursive: true, force: true });
    }
  });
});

test('release packaging invariants: install.sh and install.ps1 stay strictly outside published skill', async () => {
  for (const rootRelativePath of ['skills/xmemo/install.sh', 'skills/xmemo/install.ps1']) {
    await assert.rejects(access(path.join(repoRoot, rootRelativePath)), { code: 'ENOENT' });
  }

  // Verify that the files exist at skills/ root
  await access(path.join(repoRoot, 'skills', 'install.sh'));
  await access(path.join(repoRoot, 'skills', 'install.ps1'));
});
