import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from '../src/cli.js';
import { skillCommand } from '../src/commands/skill.js';

test('skill install dry-run reports the bundled source without writing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-command-dry-'));
  try {
    const io = captureIo({ cwd: tempDir });
    const code = await run(['skill', 'install', '--json', '--dry-run'], io);
    const report = JSON.parse(io.stdout.text);

    assert.equal(code, 0);
    assert.equal(report.dryRun, true);
    assert.equal(report.installed, false);
    assert.equal(report.networkUsed, false);
    assert.equal(report.tokenSent, false);
    await assert.rejects(fs.access(path.join(tempDir, 'xmemo-skill')), { code: 'ENOENT' });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('skill install copies the npm-bundled Skill and refuses implicit overwrite', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-command-install-'));
  try {
    const io = captureIo({ cwd: tempDir });
    const code = await skillCommand(['install', '--json'], io);
    const targetDir = path.join(tempDir, 'xmemo-skill');

    assert.equal(code, 0);
    assert.equal(JSON.parse(io.stdout.text).installed, true);
    assert.match(await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf8'), /^---/);
    await assert.rejects(
      skillCommand(['install'], captureIo({ cwd: tempDir })),
      /destination already exists/i
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('skill install --force replaces stale destination content', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-command-force-'));
  const targetDir = path.join(tempDir, 'custom-skill');
  try {
    await fs.mkdir(targetDir);
    await fs.writeFile(path.join(targetDir, 'stale.txt'), 'stale');
    const io = captureIo({ cwd: tempDir });
    const code = await skillCommand(['install', '--target', targetDir, '--force', '--json'], io);

    assert.equal(code, 0);
    assert.equal(JSON.parse(io.stdout.text).replaced, true);
    await assert.rejects(fs.access(path.join(targetDir, 'stale.txt')), { code: 'ENOENT' });
    assert.match(await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf8'), /^---/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function captureIo({ cwd }) {
  const stdout = memoryStream();
  const stderr = memoryStream();
  return {
    cwd,
    env: {},
    stdout,
    stderr
  };
}

function memoryStream() {
  return {
    text: '',
    write(chunk) {
      this.text += String(chunk);
    }
  };
}
