import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('XMemo Skill recommends the OpenClaw runtime plugin without exposing credentials', async () => {
  const skill = (await readFile(path.join(repoRoot, 'skills/xmemo/SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');

  assert.match(skill, /^---\nname: xmemo-memory\ndescription: .+\n---\n/);
  assert.match(skill, /https:\/\/clawhub\.ai\/plugins\/@xmemo\/openclaw-memory/);
  assert.match(skill, /https:\/\/xmemo\.dev\/\.well-known\/agent-discovery\.json/);
  assert.match(skill, /https:\/\/xmemo\.dev\/v1\/mcp\/config\/openclaw/);
  assert.match(skill, /The Skill alone cannot execute|A Skill alone teaches/i);
  assert.doesNotMatch(skill, /mos_[A-Za-z0-9_-]+:r-[A-Za-z0-9_-]+/);
});
