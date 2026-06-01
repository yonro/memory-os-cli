import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function readText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('Cursor plugin marketplace manifest points to XMemo plugin', async () => {
  const marketplace = await readJson('.cursor-plugin/marketplace.json');
  assert.equal(marketplace.name, 'xmemo-cursor-plugins');
  assert.equal(marketplace.owner.name, 'XMemo');
  assert.equal(marketplace.owner.email, 'support@xmemo.dev');
  assert.deepEqual(marketplace.plugins, [
    {
      name: 'xmemo',
      source: 'plugins/xmemo',
      description: "Connect Cursor to XMemo's hosted, user-owned memory layer through OAuth-backed MCP."
    }
  ]);
});

test('Cursor plugin manifest references committed assets', async () => {
  const manifest = await readJson('plugins/xmemo/.cursor-plugin/plugin.json');
  assert.equal(manifest.name, 'xmemo');
  assert.equal(manifest.displayName, 'XMemo');
  assert.equal(manifest.author.email, 'support@xmemo.dev');
  assert.equal(manifest.repository, 'https://github.com/yonro/memory-os-cli');
  assert.equal(manifest.mcpServers, 'mcp.json');
  assert.deepEqual(manifest.rules, ['rules/xmemo-memory.mdc']);
  assert.deepEqual(manifest.skills, ['skills/xmemo-memory/SKILL.md']);

  for (const assetPath of [manifest.logo, manifest.mcpServers, ...manifest.rules, ...manifest.skills]) {
    const content = await readText(path.join('plugins/xmemo', assetPath));
    assert.ok(content.length > 0, `${assetPath} should be committed`);
  }
});

test('Cursor plugin MCP config is OAuth-first and secret-free', async () => {
  const mcpConfig = await readJson('plugins/xmemo/mcp.json');
  assert.equal(mcpConfig.mcpServers.XMemo.url, 'https://xmemo.dev/mcp');

  const serialized = JSON.stringify(mcpConfig);
  assert.ok(!serialized.includes('Authorization'));
  assert.ok(!serialized.includes('Bearer'));
  assert.ok(!serialized.includes('XMEMO_KEY'));
});

test('Cursor plugin rule and skill include required frontmatter', async () => {
  const rule = (await readText('plugins/xmemo/rules/xmemo-memory.mdc')).replace(/\r\n/g, '\n');
  assert.match(rule, /^---\ndescription: .+\n---\n/);

  const skill = (await readText('plugins/xmemo/skills/xmemo-memory/SKILL.md')).replace(/\r\n/g, '\n');
  assert.match(skill, /^---\nname: xmemo-memory\ndescription: .+\n---\n/);
});
