import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('standalone Skill installers remain HTTPS-only and package the expected entrypoint', async () => {
  const [posix, powershell] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'skills/xmemo/install.sh'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'skills/xmemo/install.ps1'), 'utf8'),
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
});
