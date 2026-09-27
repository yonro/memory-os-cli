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
  CLIENT_REGISTRY,
  supportedSkillClientIds,
  supportedSkillClients
} from '../src/clients/registry.js';
import { isXMemoSkillDirectory, extractSkillVersionFromDirectory } from '../src/commands/skill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
              fsSync.copyFileSync(fixturePath, tgzPath);
            } catch {}
          }
          callStdout = JSON.stringify([{ filename: 'xmemo-skill-1.1.33.tgz' }]);
        } else if (args.includes('install')) {
          const targetIdx = args.indexOf('--target');
          const targetPath = targetIdx !== -1 ? args[targetIdx + 1] : path.resolve('xmemo-skill');
          // Fake child installer writing minimal valid skill files
          try {
            fsSync.mkdirSync(path.join(targetPath, 'scripts'), { recursive: true });
            fsSync.writeFileSync(
              path.join(targetPath, 'SKILL.md'),
              '# XMemo Skill\nVersion: 1.1.33\nXMemo memory assistant.\n'
            );
            fsSync.writeFileSync(
              path.join(targetPath, 'scripts', 'xmemo-skill.mjs'),
              "const SKILL_VERSION = '1.1.33';\n"
            );
            fsSync.writeFileSync(
              path.join(targetPath, 'package.json'),
              JSON.stringify({ name: '@xmemo/skill', version: '1.1.33' })
            );
          } catch {}
          callStdout = JSON.stringify({
            package: '@xmemo/skill',
            skillVersion: '1.1.33',
            target: targetPath,
            installed: true,
            replaced: args.includes('--force')
          });
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

test('skill registry: only claude-code, codex, and openclaw have non-null skillDir', () => {
  const supported = supportedSkillClientIds();
  assert.deepEqual(supported.sort(), ['claude-code', 'codex', 'openclaw'].sort());

  for (const client of CLIENT_REGISTRY) {
    if (['claude-code', 'codex', 'openclaw'].includes(client.id)) {
      assert.equal(typeof client.skillDir, 'function');
    } else {
      assert.equal(client.skillDir, null, `Client ${client.id} must have skillDir: null`);
    }
  }

  const clients = supportedSkillClients();
  const claude = clients.find((c) => c.id === 'claude-code');
  assert.equal(claude.supportsProjectSkill, true);
  const codex = clients.find((c) => c.id === 'codex');
  assert.equal(codex.supportsProjectSkill, false);
  const openclaw = clients.find((c) => c.id === 'openclaw');
  assert.equal(openclaw.supportsProjectSkill, false);
});

test('skill install argument validation: rejects invalid clients, flags, and combinations', async () => {
  // Unknown client
  const res1 = await invoke(['skill', 'install', '--client', 'unknown-client', '--yes']);
  assert.equal(res1.code, 2);
  assert.match(res1.stderr, /Unknown client: "unknown-client"/);

  // Client without skillDir
  const res2 = await invoke(['skill', 'install', '--client', 'cursor', '--yes']);
  assert.equal(res2.code, 2);
  assert.match(res2.stderr, /does not support skill installation/);

  // Project flag on client without project support
  const res3 = await invoke(['skill', 'install', '--client', 'codex', '--project', '--yes']);
  assert.equal(res3.code, 2);
  assert.match(res3.stderr, /does not support project-level skills/);

  // Project flag without --client
  const res4 = await invoke(['skill', 'install', '--project', '--yes']);
  assert.equal(res4.code, 2);
  assert.match(res4.stderr, /--project requires --client <id>/);

  // Incompatible options
  const res5 = await invoke(['skill', 'install', '--client', 'codex', '--all']);
  assert.equal(res5.code, 2);
  assert.match(res5.stderr, /Cannot specify both --client and --all/);

  const res6 = await invoke(['skill', 'install', '--client', 'codex', '--dir', 'my-dir']);
  assert.equal(res6.code, 2);
  assert.match(res6.stderr, /Cannot specify both --client and --dir/);
});

test('skill install --client: consent prompt required unless --yes or --dry-run', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-consent-'));
  const env = { USERPROFILE: tmpHome, HOME: tmpHome };

  try {
    // 1. --json without --yes returns consentRequired: true and writes nothing
    const resJson = await invoke(['skill', 'install', '--client', 'codex', '--json'], { env });
    assert.equal(resJson.code, 0);
    const parsed = JSON.parse(resJson.stdout);
    assert.equal(parsed.consentRequired, true);
    assert.equal(parsed.installed, false);
    const expectedDir = path.join(tmpHome, '.codex', 'skills', 'xmemo-memory');
    assert.equal(fsSync.existsSync(expectedDir), false);

    // 2. Interactive without --yes and EOF / 'n' aborts
    const resNo = await invoke(['skill', 'install', '--client', 'codex'], { env, stdin: 'n\n' });
    assert.equal(resNo.code, 0);
    assert.match(resNo.stdout, /Installation cancelled/);
    assert.equal(fsSync.existsSync(expectedDir), false);

    // 3. Dry run does not prompt and writes nothing
    const calls = [];
    const resDry = await invoke(['skill', 'install', '--client', 'codex', '--dry-run', '--json'], {
      env,
      spawn: spawnStub(calls)
    });
    assert.equal(resDry.code, 0);
    const dryParsed = JSON.parse(resDry.stdout);
    assert.equal(dryParsed.dryRun, true);
    assert.equal(fsSync.existsSync(expectedDir), false);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('skill install --client: installs to correct agent skill folders for codex, claude-code, and openclaw', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-client-install-'));
  const tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-client-cwd-'));
  const env = { USERPROFILE: tmpHome, HOME: tmpHome };

  try {
    // 1. Install for codex
    const calls1 = [];
    const res1 = await invoke(['skill', 'install', '--client', 'codex', '--yes', '--json'], {
      env,
      cwd: tmpCwd,
      spawn: spawnStub(calls1)
    });
    assert.equal(res1.code, 0);
    const report1 = JSON.parse(res1.stdout);
    assert.equal(report1.client, 'codex');
    assert.equal(report1.installed, true);
    const codexSkillDir = path.join(tmpHome, '.codex', 'skills', 'xmemo-memory');
    assert.equal(report1.target, codexSkillDir);
    assert.equal(fsSync.existsSync(path.join(codexSkillDir, 'SKILL.md')), true);

    // 2. Install for claude-code (user level)
    const calls2 = [];
    const res2 = await invoke(['skill', 'install', '--client', 'claude-code', '--yes', '--json'], {
      env,
      cwd: tmpCwd,
      spawn: spawnStub(calls2)
    });
    assert.equal(res2.code, 0);
    const report2 = JSON.parse(res2.stdout);
    assert.equal(report2.client, 'claude-code');
    const claudeUserDir = path.join(tmpHome, '.claude', 'skills', 'xmemo-memory');
    assert.equal(report2.target, claudeUserDir);
    assert.equal(fsSync.existsSync(path.join(claudeUserDir, 'SKILL.md')), true);

    // 3. Install for claude-code (project level)
    const calls3 = [];
    const res3 = await invoke(['skill', 'install', '--client', 'claude-code', '--project', '--yes', '--json'], {
      env,
      cwd: tmpCwd,
      spawn: spawnStub(calls3)
    });
    assert.equal(res3.code, 0);
    const report3 = JSON.parse(res3.stdout);
    assert.equal(report3.client, 'claude-code');
    const claudeProjDir = path.join(tmpCwd, '.claude', 'skills', 'xmemo-memory');
    assert.equal(report3.target, claudeProjDir);
    assert.equal(fsSync.existsSync(path.join(claudeProjDir, 'SKILL.md')), true);

    // 4. Install for openclaw
    const calls4 = [];
    const res4 = await invoke(['skill', 'install', '--client', 'openclaw', '--yes', '--json'], {
      env,
      cwd: tmpCwd,
      spawn: spawnStub(calls4)
    });
    assert.equal(res4.code, 0);
    const report4 = JSON.parse(res4.stdout);
    assert.equal(report4.client, 'openclaw');
    const openclawDir = path.join(tmpHome, '.openclaw', 'skills', 'xmemo-memory');
    assert.equal(report4.target, openclawDir);
    assert.equal(fsSync.existsSync(path.join(openclawDir, 'SKILL.md')), true);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpCwd, { recursive: true, force: true });
  }
});

test('skill install --client: existing directory refuses without --force and backs up with --force', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-force-backup-'));
  const env = { USERPROFILE: tmpHome, HOME: tmpHome };
  const targetDir = path.join(tmpHome, '.codex', 'skills', 'xmemo-memory');

  try {
    // Pre-create an existing skill directory
    await fs.mkdir(path.join(targetDir, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(targetDir, 'SKILL.md'), '# XMemo Skill v1.0.0\nxmemo');
    await fs.writeFile(path.join(targetDir, 'scripts', 'xmemo-skill.mjs'), "const SKILL_VERSION = '1.0.0';");
    await fs.writeFile(path.join(targetDir, 'existing-custom.txt'), 'preserve me in backup');

    // 1. Refusal without --force
    const resRefuse = await invoke(['skill', 'install', '--client', 'codex', '--yes'], { env });
    assert.equal(resRefuse.code, 2);
    assert.match(resRefuse.stderr, /Skill destination already exists.*Use --force to replace/);

    // 2. Replacement with --force creates .xmemo.bak backup
    const calls = [];
    const resForce = await invoke(['skill', 'install', '--client', 'codex', '--force', '--yes', '--json'], {
      env,
      spawn: spawnStub(calls)
    });
    assert.equal(resForce.code, 0);
    const report = JSON.parse(resForce.stdout);
    assert.equal(report.installed, true);
    assert.equal(report.backup, `${targetDir}.xmemo.bak`);

    // Verify backup exists and contains preserved file
    const backupFile = path.join(`${targetDir}.xmemo.bak`, 'existing-custom.txt');
    assert.equal(fsSync.existsSync(backupFile), true);
    assert.equal(await fs.readFile(backupFile, 'utf8'), 'preserve me in backup');
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('skill status: checks installed path and version for clients', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-status-'));
  const tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-status-cwd-'));
  const env = { USERPROFILE: tmpHome, HOME: tmpHome };

  try {
    // Initial status: not installed
    const res1 = await invoke(['skill', 'status', '--client', 'codex', '--json'], { env });
    assert.equal(res1.code, 0);
    const parsed1 = JSON.parse(res1.stdout);
    assert.equal(parsed1.targets[0].installed, false);
    assert.equal(parsed1.targets[0].version, null);

    // Install codex skill
    const targetDir = path.join(tmpHome, '.codex', 'skills', 'xmemo-memory');
    await fs.mkdir(path.join(targetDir, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(targetDir, 'SKILL.md'), '# XMemo Skill v1.1.33\nxmemo');
    await fs.writeFile(path.join(targetDir, 'scripts', 'xmemo-skill.mjs'), "const SKILL_VERSION = '1.1.33';");

    // Status after install
    const res2 = await invoke(['skill', 'status', '--client', 'codex', '--json'], { env });
    assert.equal(res2.code, 0);
    const parsed2 = JSON.parse(res2.stdout);
    assert.equal(parsed2.targets[0].installed, true);
    assert.equal(parsed2.targets[0].version, '1.1.33');

    // Status --all
    const resAll = await invoke(['skill', 'status', '--all', '--json'], { env, cwd: tmpCwd });
    assert.equal(resAll.code, 0);
    const parsedAll = JSON.parse(resAll.stdout);
    assert.equal(Array.isArray(parsedAll.targets), true);
    // Codex, OpenClaw, Claude Code (user), Claude Code (project) => 4 targets
    assert.equal(parsedAll.targets.length, 4);

    // Status human output
    const resHuman = await invoke(['skill', 'status', '--client', 'codex'], { env });
    assert.equal(resHuman.code, 0);
    assert.match(resHuman.stdout, /Client: Codex \(codex\) \[user\]/);
    assert.match(resHuman.stdout, /Status: installed/);
    assert.match(resHuman.stdout, /Version: 1\.1\.33/);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpCwd, { recursive: true, force: true });
  }
});

test('skill remove: removes installed skill, handles consent, and refuses foreign folders', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-remove-'));
  const env = { USERPROFILE: tmpHome, HOME: tmpHome };
  const targetDir = path.join(tmpHome, '.codex', 'skills', 'xmemo-memory');

  try {
    // 1. Remove when not installed
    const resNotInst = await invoke(['skill', 'remove', '--client', 'codex', '--yes', '--json'], { env });
    assert.equal(resNotInst.code, 0);
    const parsedNotInst = JSON.parse(resNotInst.stdout);
    assert.equal(parsedNotInst.removed, false);
    assert.equal(parsedNotInst.reason, 'not_installed');

    // 2. Refusal on foreign folder (e.g. arbitrary folder without xmemo SKILL.md/script)
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'foreign.txt'), 'some third-party data');
    const resForeign = await invoke(['skill', 'remove', '--client', 'codex', '--yes'], { env });
    assert.equal(resForeign.code, 2);
    assert.match(resForeign.stderr, /Refusing to remove.*directory is not an XMemo skill/);

    // 3. Make it a legitimate XMemo skill folder
    await fs.mkdir(path.join(targetDir, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(targetDir, 'SKILL.md'), '# XMemo Skill\nxmemo');
    await fs.writeFile(path.join(targetDir, 'scripts', 'xmemo-skill.mjs'), "const SKILL_VERSION = '1.1.33';");

    // 4. Prompt without --yes: 'n' cancels removal
    const resCancel = await invoke(['skill', 'remove', '--client', 'codex'], { env, stdin: 'n\n' });
    assert.equal(resCancel.code, 0);
    assert.match(resCancel.stdout, /Removal cancelled/);
    assert.equal(fsSync.existsSync(targetDir), true);

    // 5. Successful removal with --yes
    const resRemove = await invoke(['skill', 'remove', '--client', 'codex', '--yes', '--json'], { env });
    assert.equal(resRemove.code, 0);
    const parsedRemove = JSON.parse(resRemove.stdout);
    assert.equal(parsedRemove.removed, true);
    assert.equal(fsSync.existsSync(targetDir), false);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('skill update: aliases to skill install --force', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-update-'));
  const env = { USERPROFILE: tmpHome, HOME: tmpHome };
  const targetDir = path.join(tmpHome, '.codex', 'skills', 'xmemo-memory');

  try {
    // Pre-create existing skill
    await fs.mkdir(path.join(targetDir, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(targetDir, 'SKILL.md'), '# XMemo Skill v1.0.0\nxmemo');
    await fs.writeFile(path.join(targetDir, 'scripts', 'xmemo-skill.mjs'), "const SKILL_VERSION = '1.0.0';");

    const calls = [];
    const res = await invoke(['skill', 'update', '--client', 'codex', '--yes', '--json'], {
      env,
      spawn: spawnStub(calls)
    });
    assert.equal(res.code, 0);
    const report = JSON.parse(res.stdout);
    assert.equal(report.installed, true);
    assert.equal(report.force, true);
    assert.equal(report.backup, `${targetDir}.xmemo.bak`);
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});
