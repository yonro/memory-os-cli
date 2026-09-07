import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.js';

function io(fetch, extra = {}) {
  const stream = () => ({ value: '', write(value) { this.value += value; } });
  return { env: { XMEMO_KEY: 'synthetic-safety-token', XMEMO_BASE_URL: 'https://api.example.test' }, fetch, stdout: stream(), stderr: stream(), stdin: { async *[Symbol.asyncIterator]() {} }, ...extra };
}

async function view(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-safety-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'view.json');
  await fs.writeFile(file, JSON.stringify({ meta: { readReceipt: { schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'knowledge-item:i1', scope: 'personal', displayedRevision: 'r1', latestRevision: 'r1', version: 1, itemStatus: 'draft', sourceType: 'user_created', ...overrides } } }));
  return file;
}

test('K03 rejects text/source conversion and another Document without network access', async (t) => {
  const from = await view(t, { sourceType: 'file', sourceRef: 'document:doc1' });
  let calls = 0;
  for (const source of [['--text', 'overwrite'], ['--document', 'doc2', '--document-version', '2']]) {
    const streams = io(async () => { calls++; return new Response('{}'); });
    assert.equal(await run(['knowledge', 'update', 'i1', '--from', from, ...source, '--json'], streams), 2);
  }
  assert.equal(calls, 0);
});

test('K04 missing post-content version is partial and never falls back to the old item version', async (t) => {
  const from = await view(t);
  const methods = [];
  const streams = io(async (_url, init) => { methods.push(init.method); return new Response(JSON.stringify({ current_revision_id: 'r2' })); });
  assert.equal(await run(['knowledge', 'update', 'i1', '--from', from, '--text', 'new', '--publish', '--yes', '--json'], streams), 12);
  assert.deepEqual(methods, ['PUT']);
  assert.equal(JSON.parse(streams.stdout.value).error.data.content.current_revision_id, 'r2');
});

test('K03 publish-only conflict is not falsely reported as partial completion', async (t) => {
  const from = await view(t);
  const streams = io(async () => new Response(JSON.stringify({ detail: 'stale' }), { status: 409 }));
  assert.equal(await run(['knowledge', 'update', 'i1', '--from', from, '--publish', '--yes', '--json'], streams), 6);
  assert.equal(JSON.parse(streams.stdout.value).error.code, 'CONFLICT');
});

test('C02 published view cannot overwrite a newer maintenance draft', async (t) => {
  const from = await view(t, { resource: 'cloud-skill:s1', latestRevision: 'r2', revisionKind: 'published', revisionStatus: 'published' });
  let calls = 0;
  const streams = io(async () => { calls++; return new Response('{}'); });
  assert.equal(await run(['cloud-skill', 'update', 's1', '--from', from, '--publish', '--yes', '--json'], streams), 2);
  assert.equal(calls, 0);
});

test('C05 insufficient execution HTTP budget fails before any request', async (t) => {
  const from = await view(t, { resource: 'cloud-skill:s1', revisionKind: 'published', revisionStatus: 'published' });
  let calls = 0;
  const streams = io(async () => { calls++; return new Response('{}'); }, { stdin: { async *[Symbol.asyncIterator]() { yield '{"input_args":{}}'; } } });
  assert.equal(await run(['cloud-skill', 'run', 's1', '--from', from, '--input', '-', '--timeout-ms', '1000', '--yes', '--json'], streams), 2);
  assert.equal(calls, 0);
});

test('D03 interruption during preview polling retains its resumable run ID', async () => {
  const controller = new AbortController();
  const streams = io(async (url) => {
    if (url.endsWith('/settings')) return new Response(JSON.stringify({ enabled: true, mode: 'preview_only' }));
    if (url.endsWith('/runs')) return new Response(JSON.stringify({ run: { id: 'run-recover' } }));
    controller.abort();
    throw Object.assign(new Error('interrupted'), { name: 'AbortError' });
  }, { signal: controller.signal });
  assert.equal(await run(['dream', 'preview', '--wait', '--json'], streams), 130);
  assert.equal(JSON.parse(streams.stdout.value).error.data.run_id, 'run-recover');
});

test('CLI-02 explicit domain doctor only reads and never claims write readiness', async () => {
  const methods = [];
  const streams = io(async (url, init) => { methods.push(init.method); return new Response(JSON.stringify(url.endsWith('/settings') ? { enabled: true, mode: 'preview_only', entitlement: { can_apply: false } } : [])); });
  assert.equal(await run(['doctor', '--services', '--json'], streams), 0);
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'GET']);
  assert.equal(JSON.parse(streams.stdout.value).data.writeReadiness, 'unknown (not tested)');
  const denied = io(async () => new Response('{"detail":"scope missing"}', { status: 403 }));
  assert.equal(await run(['doctor', '--services', '--json'], denied), 4);
  assert.equal(JSON.parse(denied.stdout.value).ok, false);
});
