import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('official XMemo logo is consistent across published integrations', async () => {
  const logoPaths = [
    'plugins/xmemo/assets/logo.png',
    'extensions/vscode/media/icon.png'
  ];
  const hashes = await Promise.all(
    logoPaths.map(async (relativePath) => {
      const content = await readFile(path.join(root, relativePath));
      assert.ok(content.length > 10_000, `${relativePath} should contain the product mark`);
      return createHash('sha256').update(content).digest('hex');
    })
  );

  assert.equal(new Set(hashes).size, 1);

  const [cursorManifest, lobeManifest, readme] = await Promise.all([
    readJson('plugins/xmemo/.cursor-plugin/plugin.json'),
    readJson('lhm.plugin.json'),
    readFile(path.join(root, 'README.md'), 'utf8')
  ]);

  assert.equal(cursorManifest.logo, 'assets/logo.png');
  assert.match(lobeManifest.icon, /plugins\/xmemo\/assets\/logo\.png$/);
  assert.match(readme, /plugins\/xmemo\/assets\/logo\.png/);

  await assert.rejects(access(path.join(root, 'plugins/xmemo/assets/logo.svg')));
});

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}
