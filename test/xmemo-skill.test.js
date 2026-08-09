import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

test('XMemo Skill describes standalone CLI-backed runtime selection', async () => {
  const skill = (await readFile(path.join(repoRoot, 'skills/xmemo/SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');
  const operations = (await readFile(path.join(repoRoot, 'skills/xmemo/references/operations.md'), 'utf8')).replace(/\r\n/g, '\n');

  assert.match(skill, /^---\nname: xmemo-memory\ndescription: .+\n---\n/);
  assert.match(skill, /Runtime Selection/);
  assert.match(skill, /scripts\/xmemo-skill\.mjs/);
  assert.doesNotMatch(skill, /node skills\/xmemo\/scripts\/xmemo-skill\.mjs/);
  assert.match(skill, /xmemo-skill\.mjs login/);
  assert.match(skill, /auth add --from-stdin/);
  assert.match(skill, /XMEMO_KEY/);
  assert.match(skill, /--allow-plaintext/);
  assert.match(skill, /unencrypted/i);
  assert.match(skill, /remember/);
  assert.match(skill, /recall/);
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
  assert.doesNotMatch(skill, /`forget`/);
  assert.match(skill, /references\/operations\.md/);
  assert.match(skill, /references\/troubleshooting\.md/);
  assert.match(skill, /Do not simulate a successful memory read or write/i);
  assert.doesNotMatch(skill, /mos_[A-Za-z0-9_-]+:r-[A-Za-z0-9_-]+/);
  assert.match(operations, /## Discovery boundary/);
  assert.match(operations, /generic `POST \/v1\/skill\/operations` dispatcher/);
  assert.match(operations, /unauthenticated `401` only\nproves that the protected route is reachable/);
});

test('npm package includes the XMemo Skill, script, and references', async () => {
  assert.ok(packageJson.files.includes('skills'));
  assert.ok(packageJson.files.includes('plugins/xmemo'));
});
