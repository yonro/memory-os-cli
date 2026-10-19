import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  detectInstallChannel,
  getChannelInstructions,
  getSkillRoot,
} from '../skills/xmemo/scripts/commands/upgrade.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');

const entrypointContent = await fs.readFile(skillScript, 'utf8');
const versionMatch = entrypointContent.match(/const\s+SKILL_VERSION\s*=\s*['"]([^'"]+)['"]/);
const CURRENT_SKILL_VERSION = versionMatch ? versionMatch[1] : '1.1.45';
const semverParts = CURRENT_SKILL_VERSION.split('.').map(Number);
const NEWER_SKILL_VERSION = `${semverParts[0]}.${semverParts[1]}.${semverParts[2] + 1}`;
const NEWER_TAG = `skill-v${NEWER_SKILL_VERSION}`;

function runSkill(args, { homeDir, env = {}, stdin } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const childEnv = {
      ...process.env,
      HOME: homeDir || process.env.HOME,
      USERPROFILE: homeDir || process.env.USERPROFILE,
      XMEMO_FORCE_TTY: '0',
      XMEMO_NO_UPDATE_CHECK: '1',
      ...env,
    };

    const child = spawn(process.execPath, [skillScript, ...args], {
      env: childEnv,
      cwd: repoRoot,
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

test('detectInstallChannel accurately identifies 5 channels across platforms', async () => {
  const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-channel-test-'));
  try {
    const fakeHome = path.join(tempBase, 'home');
    const fakeCodexHome = path.join(tempBase, 'custom-codex');
    await fs.mkdir(fakeHome, { recursive: true });
    await fs.mkdir(fakeCodexHome, { recursive: true });

    const env = {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      CODEX_HOME: fakeCodexHome,
    };

    // 1. claude-code: ~/.claude/skills/xmemo
    const claudeGlobal = path.join(fakeHome, '.claude', 'skills', 'xmemo');
    assert.equal(detectInstallChannel(claudeGlobal, env, 'linux'), 'claude-code');
    assert.equal(detectInstallChannel(claudeGlobal, env, 'win32'), 'claude-code');

    // 2. codex: ${CODEX_HOME:-~/.codex}/skills/xmemo
    const codexCustom = path.join(fakeCodexHome, 'skills', 'xmemo');
    assert.equal(detectInstallChannel(codexCustom, env, 'linux'), 'codex');
    assert.equal(detectInstallChannel(codexCustom, env, 'win32'), 'codex');

    // 2b. codex fallback: ~/.codex/skills/xmemo
    const codexDefault = path.join(fakeHome, '.codex', 'skills', 'xmemo');
    assert.equal(detectInstallChannel(codexDefault, { HOME: fakeHome }, 'linux'), 'codex');

    // 3. openclaw: ~/.openclaw/skills/xmemo
    const openclawPath = path.join(fakeHome, '.openclaw', 'skills', 'xmemo');
    assert.equal(detectInstallChannel(openclawPath, env, 'linux'), 'openclaw');
    assert.equal(detectInstallChannel(openclawPath, env, 'win32'), 'openclaw');

    // 4. claude-code project: /workspace/project/.claude/skills/xmemo
    const claudeProject = path.join(tempBase, 'my-project', '.claude', 'skills', 'xmemo');
    assert.equal(detectInstallChannel(claudeProject, env, 'linux'), 'claude-code-project');
    assert.equal(detectInstallChannel(claudeProject, env, 'win32'), 'claude-code-project');

    // 5. manual: any other directory
    const manualPath = path.join(tempBase, 'custom-tools', 'xmemo');
    assert.equal(detectInstallChannel(manualPath, env, 'linux'), 'manual');
    assert.equal(detectInstallChannel(manualPath, env, 'win32'), 'manual');
  } finally {
    await fs.rm(tempBase, { recursive: true, force: true }).catch(() => {});
  }
});

test('getChannelInstructions produces correct commands and platform-specific fallbacks', () => {
  const dummyRoot = '/opt/xmemo-skill';

  // 1. claude-code
  const ccLinux = getChannelInstructions('claude-code', dummyRoot, 'linux');
  assert.equal(ccLinux.primary, 'xmemo skill update --client claude-code --yes');
  assert.match(ccLinux.fallback, /curl -fsSL https:\/\/xmemo\.dev\/skill\/install/);
  assert.match(ccLinux.fallback, /XMEMO_SKILL_AGENT=claude-code/);
  assert.match(ccLinux.reloadHint, /Restart your Claude Code/);
  assert.match(ccLinux.reloadHint, /doctor --anonymous/);

  const ccWin = getChannelInstructions('claude-code', 'C:\\skills\\xmemo', 'win32');
  assert.equal(ccWin.primary, 'xmemo skill update --client claude-code --yes');
  assert.match(ccWin.fallback, /\$env:XMEMO_SKILL_AGENT="claude-code"/);
  assert.match(ccWin.fallback, /install\.ps1/);

  // 2. codex
  const codexLinux = getChannelInstructions('codex', dummyRoot, 'linux');
  assert.equal(codexLinux.primary, 'xmemo skill update --client codex --yes');
  assert.match(codexLinux.fallback, /XMEMO_SKILL_AGENT=codex/);
  assert.match(codexLinux.reloadHint, /Restart your Codex/);

  const codexWin = getChannelInstructions('codex', 'C:\\skills\\xmemo', 'win32');
  assert.equal(codexWin.primary, 'xmemo skill update --client codex --yes');
  assert.match(codexWin.fallback, /\$env:XMEMO_SKILL_AGENT="codex"/);

  // 3. openclaw
  const openclawInst = getChannelInstructions('openclaw', dummyRoot, 'linux');
  assert.equal(openclawInst.primary, 'openclaw skills install @xmemo/xmemo --force');
  assert.equal(openclawInst.fallback, 'openclaw skills install @xmemo/xmemo');
  assert.match(openclawInst.reloadHint, /Restart your OpenClaw session/);

  // 4. claude-code-project
  const ccProjectLinux = getChannelInstructions('claude-code-project', dummyRoot, 'linux');
  assert.equal(ccProjectLinux.primary, 'xmemo skill update --client claude-code --project --yes');
  assert.match(ccProjectLinux.fallback, /XMEMO_SKILL_DIR/);
  assert.match(ccProjectLinux.reloadHint, /Restart your Claude Code session in this project/);

  const ccProjectWin = getChannelInstructions('claude-code-project', 'C:\\proj\\.claude\\skills\\xmemo', 'win32');
  assert.equal(ccProjectWin.primary, 'xmemo skill update --client claude-code --project --yes');
  assert.match(ccProjectWin.fallback, /\$env:XMEMO_SKILL_DIR/);

  // 5. manual
  const manualLinux = getChannelInstructions('manual', dummyRoot, 'linux');
  assert.match(manualLinux.primary, /https:\/\/github\.com\/yonro\/memory-os-cli\/releases\/latest\/download\/xmemo-skill\.tar\.gz/);
  assert.match(manualLinux.fallback, /tar -xzf xmemo-skill\.tar\.gz -C/);
  assert.equal(/--strip-components/.test(manualLinux.fallback), false);
  assert.match(manualLinux.reloadHint, /Restart your agent session/);

  const manualWin = getChannelInstructions('manual', 'C:\\custom\\xmemo', 'win32');
  assert.match(manualWin.fallback, /irm\s+"https:.*-OutFile\s+xmemo-skill\.tar\.gz/);
  assert.equal(/--strip-components/.test(manualWin.fallback), false);
});

test('getSkillRoot resolves directory without crashing', () => {
  const root = getSkillRoot();
  assert.ok(typeof root === 'string' && root.length > 0);
  assert.ok(root.includes('skills'));
});

test('upgrade command terminal and json output with mock server', async () => {
  let discoveryRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/.well-known/agent-discovery.json') {
      discoveryRequests++;
      assert.equal(req.headers.authorization, undefined, 'Must not send Authorization header');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        standalone_skill: {
          package: {
            version: NEWER_TAG,
          },
        },
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  try {
    // 1. JSON mode
    const jsonRes = await runSkill(['upgrade', '--json', '--base-url', `http://127.0.0.1:${port}`]);
    assert.equal(jsonRes.code, 0);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.installed, CURRENT_SKILL_VERSION);
    assert.equal(parsed.latest, NEWER_SKILL_VERSION);
    assert.equal(parsed.update_available, true);
    assert.equal(parsed.channel, 'manual');
    assert.ok(Array.isArray(parsed.commands));
    assert.ok(parsed.commands.length >= 1);
    assert.ok(parsed.reload_hint.includes('doctor --anonymous'));

    // 2. Terminal mode
    const termRes = await runSkill(['upgrade', '--terminal', '--base-url', `http://127.0.0.1:${port}`]);
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, new RegExp(`Installed version:\\s+${CURRENT_SKILL_VERSION.replace(/\\./g, '\\.')}`));
    assert.match(termRes.stdout, new RegExp(`Latest version:\\s+${NEWER_SKILL_VERSION.replace(/\\./g, '\\.')}`));
    assert.match(termRes.stdout, /Update available:\s+yes/);
    assert.match(termRes.stdout, /Installation channel:\s+manual/);
    assert.match(termRes.stdout, /Recommended update command:/);
    assert.match(termRes.stdout, /After updating:/);
    assert.match(termRes.stdout, /doctor --anonymous/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('latest fetch failure exits with code 0 and marks latest as unknown', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  try {
    // 1. JSON mode under 500
    const jsonRes = await runSkill(['upgrade', '--json', '--base-url', `http://127.0.0.1:${port}`]);
    assert.equal(jsonRes.code, 0, 'Exit code must be 0 even when remote version fetch fails');
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.installed, CURRENT_SKILL_VERSION);
    assert.equal(parsed.latest, 'unknown');
    assert.equal(parsed.update_available, false);
    assert.ok(parsed.commands.length >= 1);

    // 2. Terminal mode under 500
    const termRes = await runSkill(['upgrade', '--terminal', '--base-url', `http://127.0.0.1:${port}`]);
    assert.equal(termRes.code, 0);
    assert.match(termRes.stdout, /Latest version:\s+unknown/);
    assert.match(termRes.stdout, /Update available:\s+no/);
    assert.match(termRes.stdout, /Recommended update command:/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('upgrade command performs zero child_process calls and never mutates cache file', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-upgrade-cache-test-'));
  try {
    const dotXmemo = path.join(tempHome, '.xmemo');
    const cacheFile = path.join(dotXmemo, 'skill-update-check.json');
    const initialCache = {
      lastCheck: 1000,
      latestVersion: CURRENT_SKILL_VERSION,
      notifiedVersion: CURRENT_SKILL_VERSION,
      notifiedAt: 1000,
    };
    await fs.mkdir(dotXmemo, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(initialCache, null, 2) + '\n', 'utf8');

    const res = await runSkill(['upgrade', '--json'], { homeDir: tempHome });
    assert.equal(res.code, 0);

    // Assert cache was NOT updated or touched by upgrade command
    const afterContent = await fs.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(afterContent);
    assert.deepEqual(parsed, initialCache, 'Cache file must remain completely unmutated by upgrade command');

    // Static code inspection: upgrade.mjs must not import or use child_process
    const upgradeCode = await fs.readFile(path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'commands', 'upgrade.mjs'), 'utf8');
    assert.equal(/child_process/.test(upgradeCode), false, 'commands/upgrade.mjs must never import child_process');
    assert.equal(/exec|spawn|fork|execFile/.test(upgradeCode), false, 'commands/upgrade.mjs must never call execution primitives');
    assert.equal(/\b(writeFile|writeFileSync|unlink|unlinkSync|mkdir|mkdirSync)\b/.test(upgradeCode), false, 'commands/upgrade.mjs must never perform write I/O');
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
  }
});
