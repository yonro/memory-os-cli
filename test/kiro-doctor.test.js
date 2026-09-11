import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { jsonClientServerConfig } from '../src/mcp/formats/json.js';
const identity = { agentId: 'kiro', agentInstanceId: 'xmemo-test-instance' };
async function invoke(args, env = {}) {
  let stdout = '', stderr = '';
  const code = await run(args, { stdout: { write: s => { stdout += s; } }, stderr: { write: s => { stderr += s; } }, env, fetch: async () => { throw Error('Offline test must not fetch'); } });
  return { code, stdout, stderr };
}
async function fixture(t, entry) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-kiro-doctor-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'mcp.json');
  const config = { mcpServers: { XMemo: entry, Other: { command: 'other', env: { SECRET: 'unrelated-secret' } } }, powers: { mcpServers: {} }, custom: 7 };
  await fs.writeFile(file, JSON.stringify(config));
  return { dir, file, config };
}
const legacy = { command: 'npx', args: ['-y', 'mcp-remote', 'https://xmemo.dev/mcp', '--header', 'Authorization:Bearer ${XMEMO_KEY}'], env: { XMEMO_KEY: '${env:XMEMO_KEY}', XMEMO_AGENT_INSTANCE_ID: 'stable-instance' }, autoApprove: ['recall'], disabled: true, timeout: 12345 };

test('Kiro native OAuth and Key templates are separate and never embed credentials', async () => {
  for (const auth of ['oauth', 'key']) {
    const r = await invoke(['mcp', 'config', '--client', 'kiro', '--auth', auth, '--json'], { XMEMO_KEY: 'secret-sentinel' });
    assert.equal(r.code, 0, r.stderr);
    const template = JSON.parse(r.stdout), s = template.snippet.mcpServers.XMemo;
    assert.equal(s.url, 'https://xmemo.dev/mcp');
    assert.equal(s.command, undefined); assert.equal(s.env, undefined);
    assert.doesNotMatch(r.stdout, /secret-sentinel|mcp-remote|env:XMEMO_KEY/);
    if (auth === 'oauth') { assert.equal(s.headers.Authorization, undefined); assert.deepEqual(template.requiresEnv, []); }
    else { assert.equal(s.headers.Authorization, 'Bearer ${XMEMO_KEY}'); assert.equal(s.oauth, undefined); assert.deepEqual(template.requiresEnv, ['XMEMO_KEY']); }
  }
});
test('mcp add kiro writes native Key config with matching guidance', async t => {
  const { dir, file } = await fixture(t, legacy);
  const r = await invoke(['mcp', 'add', 'kiro', '--auth', 'key', '--write', '--force', '--config', file], { HOME: dir, USERPROFILE: dir, XMEMO_KEY: 'secret-sentinel' });
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(await fs.readFile(file)).mcpServers.XMemo;
  assert.equal(s.headers.Authorization, 'Bearer ${XMEMO_KEY}'); assert.equal(s.command, undefined);
  assert.match(r.stdout, /read XMEMO_KEY/); assert.doesNotMatch(r.stdout, /secret-sentinel/);
});
test('doctor detects legacy auth loop offline, backs up and repairs only XMemo, then is idempotent', async t => {
  const { file, config } = await fixture(t, legacy);
  const before = await fs.readFile(file, 'utf8');
  let r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--json']);
  assert.equal(r.code, 1); assert.match(r.stdout, /legacy_mcp_remote|unsupported_key_interpolation/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout); assert.equal(report.fixed, true); assert.equal(report.authenticationVerified, false);
  assert.equal(await fs.readFile(report.backupPath, 'utf8'), before);
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(after.mcpServers.Other, config.mcpServers.Other); assert.deepEqual(after.powers, config.powers); assert.equal(after.custom, 7);
  assert.equal(after.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], 'stable-instance');
  for (const field of ['autoApprove', 'disabled', 'timeout']) assert.deepEqual(after.mcpServers.XMemo[field], legacy[field]);
  assert.equal(after.mcpServers.XMemo.command, undefined); assert.equal(after.mcpServers.XMemo.headers.Authorization, undefined);
  assert.doesNotMatch(r.stdout, /unrelated-secret/);
  r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix', '--json']);
  assert.equal(r.code, 0); assert.equal(JSON.parse(r.stdout).fixed, false);
});
test('doctor explicit Key repair removes OAuth and unsupported interpolation', async t => {
  const { file } = await fixture(t, { url: 'https://xmemo.dev/mcp', oauth: { oauthScopes: ['memory:read'] }, headers: { authorization: 'Bearer ${env:XMEMO_KEY}' } });
  const r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix', '--auth', 'key', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(await fs.readFile(file)).mcpServers.XMemo;
  assert.equal(s.oauth, undefined); assert.equal(s.headers.Authorization, 'Bearer ${XMEMO_KEY}'); assert.equal(s.headers.authorization, undefined);
});
test('doctor refuses malformed, custom-command and unsafe endpoint repairs without mutation', async t => {
  for (const entry of [{ command: 'custom' }, { ...legacy, args: ['mcp-remote', 'https://user:secret@xmemo.dev/mcp'] }, { url: 'http://xmemo.dev/mcp' }]) {
    const { file } = await fixture(t, entry), before = await fs.readFile(file, 'utf8');
    const r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix', '--json']);
    assert.notEqual(r.code, 0); assert.equal(await fs.readFile(file, 'utf8'), before); assert.doesNotMatch(r.stdout + r.stderr, /user:secret/);
  }
  const { file } = await fixture(t, legacy); await fs.writeFile(file, '{"secret":"hidden",');
  const r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix']);
  assert.notEqual(r.code, 0); assert.doesNotMatch(r.stderr, /hidden/);
});
test('doctor native OAuth passes without requesting a Key or network', async t => {
  const { file } = await fixture(t, jsonClientServerConfig('kiro', 'https://xmemo.dev/mcp', identity));
  const r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--json']);
  assert.equal(r.code, 0); assert.equal(JSON.parse(r.stdout).networkUsed, false);
});

test('doctor rejects unknown options and malformed auth objects without touching files', async t => {
  const { file } = await fixture(t, legacy);
  const before = await fs.readFile(file, 'utf8');
  const r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix', '--dry-run']);
  assert.notEqual(r.code, 0); assert.equal(await fs.readFile(file, 'utf8'), before);
  const bad = { mcpServers: { XMemo: { url: 'https://xmemo.dev/mcp', headers: 'secret-invalid-header' } } };
  await fs.writeFile(file, JSON.stringify(bad));
  const r2 = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix']);
  assert.notEqual(r2.code, 0); assert.doesNotMatch(r2.stderr, /secret-invalid-header/);
  assert.deepEqual(JSON.parse(await fs.readFile(file)), bad);
});
test('doctor preserves existing OAuth write scopes while removing conflicting auth header', async t => {
  const scopes = ['memory:read', 'memory:write', 'knowledge:read', 'knowledge:write'];
  const { file } = await fixture(t, { url: 'https://xmemo.dev/mcp', oauth: { oauthScopes: scopes }, headers: { Authorization: 'Bearer secret-sentinel', 'X-Custom': 'keep' } });
  const r = await invoke(['doctor', '--client', 'kiro', '--config', file, '--fix', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(await fs.readFile(file)).mcpServers.XMemo;
  assert.deepEqual(s.oauth.oauthScopes, scopes); assert.equal(s.headers.Authorization, undefined); assert.equal(s.headers['X-Custom'], 'keep');
  assert.doesNotMatch(r.stdout + r.stderr, /secret-sentinel/);
});
