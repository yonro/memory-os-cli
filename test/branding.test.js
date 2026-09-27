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
    'docs/assets/logo.png'
  ];
  const hashes = await Promise.all(
    logoPaths.map(async (relativePath) => {
      const content = await readFile(path.join(root, relativePath));
      assert.ok(content.length > 10_000, `${relativePath} should contain the product mark`);
      return createHash('sha256').update(content).digest('hex');
    })
  );

  assert.equal(new Set(hashes).size, 1);

  const [lobeManifest, readme] = await Promise.all([
    readJson('lhm.plugin.json'),
    readFile(path.join(root, 'README.md'), 'utf8')
  ]);

  assert.equal(lobeManifest.icon, 'https://xmemo.dev/xmemo-claude-connector-icon.png');
  assert.match(readme, /docs\/assets\/logo\.png/);

  await assert.rejects(access(path.join(root, 'docs/assets/logo.svg')));
});

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}
