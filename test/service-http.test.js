import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServiceClient } from '../src/api/client.js';
import { COMMAND_REGISTRY } from '../src/api/contracts/command-registry.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.join(root, 'bin/memory-os.js');
const syntheticToken = 'synthetic-http-fixture-token';

async function fixture(t, handler) {
  const errors = [];
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${syntheticToken}`);
      let text = '';
      for await (const chunk of req) text += chunk;
      const record = { method: req.method, url: new URL(req.url, 'http://fixture'), body: text ? JSON.parse(text) : null };
      requests.push(record);
      await handler(record, res);
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(errors, []);
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}

function respond(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-service-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function child(executable, args, { cwd, env, input = '' }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Fixture child exceeded 30s.')); }, 30000);
    proc.on('error', (error) => { clearTimeout(timer); reject(error); });
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.stdin.on('error', () => {});
    proc.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    proc.stdin.end(input);
  });
}

function environment(directory, origin) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(XMEMO|MEMORY_OS)_/.test(key)) delete env[key];
  return { ...env, XMEMO_KEY: syntheticToken, XMEMO_BASE_URL: origin, XMEMO_CONFIG_HOME: path.join(directory, 'config'), XMEMO_SKILL_CONFIG_HOME: path.join(directory, 'skill-config') };
}

test('CLI-09 actual HTTP + child CLI exercise all 19 frozen commands and pinned workflows', async (t) => {
  const directory = await temp(t);
  let knowledgeRevision = 'k1', knowledgeVersion = 1;
  const api = await fixture(t, (r, res) => {
    const p = r.url.pathname, b = r.body;
    if (p === '/api/v1/remember') { assert.equal(b.content, '中文 synthetic'); return respond(res, { memory_id: 'm1' }, 201); }
    if (p === '/api/v1/recall') return respond(res, [{ memory_id: 'm1', content: '中文 synthetic' }]);
    if (p === '/api/v1/memories/m1/explain') return respond(res, { memory: { memory_id: 'm1', content: '中文 synthetic', version: 1 } });
    if (p === '/api/v1/recall/context') { assert.equal(b.max_items, 3); assert.equal(b.memory_limit, undefined); return respond(res, { items: [{ memory_id: 'm1' }] }); }
    if (p === '/api/v1/update_state') return respond(res, { state_key: b.state_key, content: b.content });
    if (p === '/api/v1/skill/operations') { assert.equal(b.operation, 'state-restore'); return respond(res, { state_key: 'active_task' }); }
    if (p === '/api/v1/restart/snapshot') return respond(res, { snapshot_id: 'snap1' });
    if (p === '/api/v1/restart/restore') return respond(res, { snapshot_id: b.snapshot_id });
    if (p === '/api/v1/knowledge-bases/b1/items') { assert.equal(b.status, 'draft'); return respond(res, { knowledge_item_id: 'i1', version: 1, status: 'draft' }, 201); }
    if (p === '/api/v1/knowledge/search') { assert.equal(b.cursor, ''); return respond(res, { items: [{ citation: { revision_id: 'k1' }, indexing_pending: false }], next_cursor: 'cursor-2' }); }
    if (p === '/api/v1/knowledge-items/i1' && r.method === 'GET') return respond(res, { knowledge_item_id: 'i1', current_revision_id: knowledgeRevision, version: knowledgeVersion, status: 'draft', source_type: 'text' });
    if (p.includes('/revisions/')) { assert.ok(p.endsWith('/k1')); return respond(res, { knowledge_revision_id: 'k1', canonical_content: r.url.searchParams.get('offset') === '2' ? 'second page' : 'first page', source_ref: 'manual' }); }
    if (p.endsWith('/i1/content')) { assert.equal(b.expected_current_revision_id, 'k1'); knowledgeRevision = 'k2'; knowledgeVersion = 2; return respond(res, { version: 2, current_revision_id: 'k2' }); }
    if (p === '/api/v1/knowledge-items/i1' && r.method === 'PATCH') { assert.equal(b.expected_version, 2); return respond(res, { version: 3, status: 'published' }); }
    if (p.endsWith('/dream/settings')) return respond(res, { enabled: true, mode: 'confirm_each_run', entitlement: { can_preview: true, can_apply: true } });
    if (p.endsWith('/dream/runs')) { assert.deepEqual(Object.keys(b).sort(), ['idempotency_key', 'window_days']); assert.equal(r.url.searchParams.get('team_id'), 't1'); return respond(res, { run: { id: 'r1', status: 'queued' } }, 201); }
    if (p.endsWith('/dream/runs/r1')) return respond(res, { run: { id: 'r1', status: 'succeeded', confirmation_version: 'sha256:run1', settings_version: 3 }, items: [{ id: 'd1', generated_content: 'synthetic' }] });
    if (p.endsWith('/dream/runs/r1/confirm')) { assert.equal(b.expected_run_version, 'sha256:run1'); assert.equal(b.item_id, 'd1'); return respond(res, { created: true, memory_id: 'm2' }); }
    if (p === '/v1/skills/create') { assert.equal(b.publish, false); return respond(res, { skill_id: 's1', revision_id: 'srev1', status: 'draft' }, 201); }
    if (p === '/v1/skills') return respond(res, [{ skill_id: 's1' }]);
    if (p === '/v1/skills/s1') return respond(res, { skill: { skill_id: 's1' }, latest_revision: { revision_id: 'srev1', status: 'published' }, published_revision: { revision_id: 'srev1', status: 'published' } });
    if (p === '/v1/skills/s1/components') { assert.equal(r.url.searchParams.get('revision_id'), 'srev1'); return respond(res, [{ type: 'script', logical_path: 'scripts/run.py' }]); }
    if (p === '/v1/skills/s1/content') { assert.equal(b.expected_revision_id, 'srev1'); return respond(res, { revision_id: 'srev2', status: 'draft' }); }
    if (p === '/v1/skills/s1/execute') { assert.equal(b.revision_id, 'srev1'); assert.equal(b.timeout_seconds, 30); assert.deepEqual(b.input_args, { text: 'synthetic' }); return respond(res, { status: 'success', exit_code: 0, execution_id: 'e1', stdout: 'ok', stderr: '' }); }
    throw new Error(`Unexpected fixture request: ${r.method} ${p}`);
  });
  const env = environment(directory, api.origin), completed = new Set();
  async function call(args, input, expected = 0) {
    const result = await child(process.execPath, [binary, ...args, ...(input === undefined ? [] : ['--input', '-']), '--json'], { cwd: directory, env, input: input === undefined ? '' : JSON.stringify(input) });
    assert.equal(result.code, expected, result.stderr + result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, expected === 0);
    assert.ok(!result.stdout.includes(syntheticToken));
    if (expected === 0) completed.add(output.command);
    return output;
  }
  await call(['memory', 'add'], { content: '中文 synthetic', path: 'fixture/test' });
  await call(['memory', 'search', '中文']);
  await call(['memory', 'read', 'm1']);
  await call(['context', 'recall'], { query: 'synthetic', max_items: 3 });
  await call(['state', 'save'], { state_key: 'active_task', content: 'synthetic' });
  await call(['state', 'restore']);
  await call(['restart', 'snapshot']);
  await call(['restart', 'restore', '--preview'], { snapshot_id: 'snap1' });
  await call(['knowledge', 'add', '--base', 'b1', '--text', 'synthetic']);
  assert.equal((await call(['knowledge', 'search', 'synthetic'])).meta.nextCursor, 'cursor-2');
  const knowledgeView = path.join(directory, 'knowledge view 中文.json');
  await fs.writeFile(knowledgeView, JSON.stringify(await call(['knowledge', 'read', 'i1'])));
  await call(['knowledge', 'update', 'i1', '--from', knowledgeView, '--text', 'new', '--publish', '--yes']);
  const pinnedPage = await call(['knowledge', 'read', 'i1', '--from', knowledgeView, '--offset', '2']);
  assert.equal(pinnedPage.meta.readReceipt.displayedRevision, 'k1');
  assert.equal(api.requests.filter((r) => r.method === 'GET' && r.url.pathname === '/api/v1/knowledge-items/i1').length, 1);
  await call(['dream', 'preview'], { window_days: 7, wait: true, wait_timeout: 3000, team_id: 't1' });
  const dreamView = path.join(directory, 'dream.json');
  await fs.writeFile(dreamView, JSON.stringify(await call(['dream', 'show', 'r1'])));
  await call(['dream', 'apply', 'r1', '--item', 'd1', '--from', dreamView, '--yes']);
  const source = path.join(directory, 'SKILL.md');
  await fs.writeFile(source, '# Synthetic skill\n');
  const created = await call(['cloud-skill', 'add', '--file', source]);
  assert.equal(created.meta.uploadManifest.included[0].path, 'SKILL.md');
  assert.equal(created.meta.uploadManifest.included[0].sha256.length, 64);
  await call(['cloud-skill', 'list']);
  const skillView = path.join(directory, 'skill.json');
  await fs.writeFile(skillView, JSON.stringify(await call(['cloud-skill', 'show', 's1'])));
  await call(['cloud-skill', 'update', 's1', '--from', skillView, '--file', source]);
  await call(['cloud-skill', 'run', 's1', '--from', skillView, '--yes'], { input_args: { text: 'synthetic' } });
  assert.deepEqual([...completed].sort(), COMMAND_REGISTRY.map((r) => r.command).sort());
  const count = api.requests.length;
  await call(['dream', 'preview'], { wait: 'not-boolean' }, 2);
  await call(['dream', 'preview', '--wait-timeout', 'invalid'], undefined, 2);
  await call(['knowledge', 'read', 'i1', '--offset', '2'], undefined, 2);
  await call(['memory', 'search', 'q', '--limit', '2', '--limit', '3'], undefined, 2);
  assert.equal(api.requests.length, count, 'invalid local input must not send HTTP requests');
  for (const spec of COMMAND_REGISTRY) {
    const help = await child(process.execPath, [binary, ...spec.command.split('.'), '--help', '--json'], { cwd: directory, env });
    assert.equal(help.code, 0);
    const schema = JSON.parse(help.stdout);
    assert.equal(schema.command, spec.command);
    assert.ok(schema.inputSchema.examples.length);
    const failure = await child(process.execPath, [binary, ...spec.command.split('.'), '--json'], { cwd: directory, env: { ...env, XMEMO_KEY: '' } });
    const commandsWithNoRequiredLocalInput = new Set(['state.restore', 'restart.snapshot', 'dream.preview', 'cloud-skill.list']);
    assert.equal(failure.code, commandsWithNoRequiredLocalInput.has(spec.command) ? 3 : 2, failure.stdout);
    assert.equal(JSON.parse(failure.stdout).ok, false);
  }
  assert.equal(api.requests.length, count, 'help and missing credentials must not send HTTP requests');
});

test('CLI-09 real HTTP covers delayed body, unknown writes, redaction and missing HTML contract', async (t) => {
  const api = await fixture(t, (r, res) => {
    if (r.url.pathname === '/slow') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); return; }
    if (r.url.pathname === '/invalid') { res.writeHead(200); return res.end('broken JSON'); }
    if (r.url.pathname === '/secret') return respond(res, { detail: `denied Bearer ${syntheticToken}`, access_token: syntheticToken }, 403);
    res.writeHead(405, { 'content-type': 'text/html' }); res.end('<html>Method not allowed</html>');
  });
  const client = createServiceClient({ baseUrl: api.origin, token: syntheticToken, io: { fetch }, timeoutMs: 150 });
  await assert.rejects(client.request({ method: 'GET', path: '/slow' }), (e) => e.code === 'REQUEST_TIMEOUT');
  for (const route of ['/slow', '/invalid']) await assert.rejects(client.request({ method: 'POST', path: route, sideEffect: true, retry: 'bounded' }), (e) => e.outcome === 'unknown');
  assert.equal(api.requests.filter((r) => r.method === 'POST').length, 2);
  await assert.rejects(client.request({ method: 'GET', path: '/secret' }), (e) => !JSON.stringify({ message: e.message, data: e.data }).includes(syntheticToken));
  await assert.rejects(client.request({ method: 'POST', path: '/v1/skills/create', sideEffect: true, operation: { contractRequired: true } }), (e) => e.code === 'SERVER_CONTRACT_REQUIRED');
});

test('CLI-09 actual npm archive runs outside repo with CLI and independent Skill separated', async (t) => {
  const directory = await temp(t);
  const env = environment(directory, 'http://127.0.0.1:1');
  const npmCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  let npm;
  for (const candidate of npmCandidates) {
    try {
      await fs.access(candidate);
      npm = candidate;
      break;
    } catch {}
  }
  assert.ok(npm, `Could not locate npm-cli.js from: ${npmCandidates.join(', ')}`);
  const packed = await child(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', directory, '--cache', path.join(directory, 'npm-cache')], { cwd: root, env });
  assert.equal(packed.code, 0, packed.stderr);
  const info = JSON.parse(packed.stdout)[0];
  assert.ok(info.files.some((f) => f.path === 'src/api/client.js'));
  assert.ok(!info.files.some((f) => /credentials\.json|\.env$|npm-cache-review|\.progress/.test(f.path)));
  const unpacked = path.join(directory, 'unpacked');
  await fs.mkdir(unpacked);
  const extraction = await child('tar', ['-xf', path.join(directory, info.filename), '-C', unpacked], { cwd: directory, env });
  assert.equal(extraction.code, 0, extraction.stderr);
  const cliOnly = path.join(directory, 'cli only'), skillOnly = path.join(directory, 'skill only');
  await fs.mkdir(cliOnly);
  for (const entry of ['bin', 'src', 'package.json']) await fs.cp(path.join(unpacked, 'package', entry), path.join(cliOnly, entry), { recursive: true });
  await fs.cp(path.join(unpacked, 'package/skills/xmemo'), skillOnly, { recursive: true });
  await assert.rejects(fs.access(path.join(cliOnly, 'skills')));
  await assert.rejects(fs.access(path.join(skillOnly, 'src')));
  const api = await fixture(t, (_r, res) => respond(res, [{ memory_id: 'packaged', content: 'synthetic' }]));
  const isolatedEnv = environment(directory, api.origin);
  const cli = await child(process.execPath, [path.join(cliOnly, 'bin/memory-os.js'), 'memory', 'search', 'synthetic', '--json'], { cwd: cliOnly, env: isolatedEnv });
  assert.equal(cli.code, 0, cli.stderr + cli.stdout);
  assert.equal(JSON.parse(cli.stdout).data[0].memory_id, 'packaged');
  const skill = await child(process.execPath, [path.join(skillOnly, 'scripts/xmemo-skill.mjs'), 'recall', '--query', 'synthetic', '--json'], { cwd: skillOnly, env: isolatedEnv });
  assert.equal(skill.code, 0, skill.stderr + skill.stdout);
  assert.ok(JSON.parse(skill.stdout));
});
