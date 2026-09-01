import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
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
  assert.doesNotMatch(skill, /`forget`/);
  assert.match(skill, /references\/operations\.md/);
  assert.match(skill, /references\/troubleshooting\.md/);
  assert.match(skill, /Do not simulate a successful memory read or write/i);
  assert.doesNotMatch(skill, /mos_[A-Za-z0-9_-]+:r-[A-Za-z0-9_-]+/);
  assert.match(operations, /## Discovery boundary/);
  assert.match(operations, /generic `POST \/v1\/skill\/operations` dispatcher/);
  assert.match(operations, /unauthenticated `401` only\nproves that the protected route is reachable/);
  assert.match(operations, /`recall-context`/);
  assert.match(operations, /Knowledge/);
  assert.match(operations, /knowledge:read/);
});

test('npm package includes the XMemo Skill, script, and references', async () => {
  assert.ok(packageJson.files.includes('skills'));
  assert.ok(packageJson.files.includes('plugins/xmemo'));
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
