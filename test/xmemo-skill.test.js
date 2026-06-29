import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

test('XMemo Skill describes standalone CLI-backed runtime selection', async () => {
  const skill = (await readFile(path.join(repoRoot, 'skills/xmemo/SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');

  assert.match(skill, /^---\nname: xmemo-memory\ndescription: .+\n---\n/);
  assert.match(skill, /Runtime Selection/);
  assert.match(skill, /skills\/xmemo\/scripts\/xmemo-skill\.mjs/);
  assert.match(skill, /xmemo-skill\.mjs login/);
  assert.match(skill, /auth add --from-stdin/);
  assert.match(skill, /remember/);
  assert.match(skill, /recall/);
  assert.match(skill, /search/);
  assert.match(skill, /save-state/);
  assert.match(skill, /restore-state/);
  assert.match(skill, /todo-add/);
  assert.match(skill, /expense-add/);
  assert.match(skill, /references\/operations\.md/);
  assert.match(skill, /references\/troubleshooting\.md/);
  assert.match(skill, /Do not simulate a successful memory read or write/i);
  assert.doesNotMatch(skill, /mos_[A-Za-z0-9_-]+:r-[A-Za-z0-9_-]+/);
});

test('npm package includes the XMemo Skill, script, and references', async () => {
  assert.ok(packageJson.files.includes('skills'));
  assert.ok(packageJson.files.includes('plugins/xmemo'));
});
