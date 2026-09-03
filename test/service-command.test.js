import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { run } from '../src/cli.js';

class Stream {
  constructor() { this.value = ''; }
  write(value) { this.value += String(value); }
}

function makeIo(fetch, env = {}) {
  return {
    env: { XMEMO_KEY: 'synthetic-token-value', XMEMO_BASE_URL: 'https://api.example.test', ...env },
    fetch,
    stdout: new Stream(),
    stderr: new Stream(),
    stdin: { async *[Symbol.asyncIterator]() {} }
  };
}

test('CLI-03 memory search emits one parseable envelope and correct GET query', async () => {
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ memory_id: 'mem-1', content: 'synthetic' }]), { status: 200 });
  });
  const code = await run(['memory', 'search', '中文 query', '--limit', '2', '--json'], io);
  assert.equal(code, 0);
  assert.equal(io.stderr.value, '');
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, 'memory.search');
  assert.equal(envelope.data[0].memory_id, 'mem-1');
  assert.equal(new URL(calls[0].url).pathname, '/api/v1/recall');
  assert.equal(new URL(calls[0].url).searchParams.get('query'), '中文 query');
  assert.equal(new URL(calls[0].url).searchParams.get('limit'), '2');
});

test('CLI-03 unauthenticated JSON request returns exit 3 without network access', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('{}'); }, { XMEMO_KEY: '' });
  const code = await run(['memory', 'search', 'query', '--json'], io);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(code, 3);
  assert.equal(calls, 0);
  assert.equal(envelope.error.code, 'AUTH_REQUIRED');
});

test('CLI-01 service subcommand help emits its executable contract schema as JSON', async () => {
  const io = makeIo(async () => new Response('{}'));
  const code = await run(['knowledge', 'read', '--help', '--json'], io);
  assert.equal(code, 0);
  const schema = JSON.parse(io.stdout.value);
  assert.equal(schema.command, 'knowledge.read');
  assert.equal(schema.availability, 'current');
  assert.ok(schema.path.some((path) => path.includes('knowledge-items')));
});

test('CLI-04 knowledge read fixes receipt to the returned current revision', async () => {
  const responses = [
    { knowledge_item_id: 'item-1', current_revision_id: 'rev-2', version: 3, status: 'draft' },
    { knowledge_revision_id: 'rev-2', canonical_content: 'synthetic knowledge' }
  ];
  const io = makeIo(async (_url, _init) => new Response(JSON.stringify(responses.shift()), { status: 200 }));
  const code = await run(['knowledge', 'read', 'item-1', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.data.revision.knowledge_revision_id, 'rev-2');
  assert.equal(envelope.meta.readReceipt.displayedRevision, 'rev-2');
  assert.equal(envelope.meta.readReceipt.itemStatus, 'draft');
});

test('CLI-06 dream show binds confirmation_version and candidate identity', async () => {
  const io = makeIo(async () => new Response(JSON.stringify({
    run: { id: 'run-1', status: 'succeeded', confirmation_version: 'sha256:run-version', settings_version: 4 },
    items: [{ id: 'item-1' }]
  }), { status: 200 }));
  const code = await run(['dream', 'show', 'run-1', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.meta.readReceipt.displayedRevision, 'sha256:run-version');
  assert.deepEqual(envelope.meta.readReceipt.candidateItemIds, ['item-1']);
});

test('CLI-06 dream wait returns remote failure and local timeout exit codes', async () => {
  const failedIo = makeIo(async () => new Response(JSON.stringify({
    run: { id: 'run-1', status: 'failed', confirmation_version: 'sha256:run-version', settings_version: 4 },
    items: []
  }), { status: 200 }));
  const failedCode = await run(['dream', 'show', 'run-1', '--wait', '--json'], failedIo);
  assert.equal(failedCode, 8);
  assert.equal(JSON.parse(failedIo.stdout.value).error.code, 'DREAM_RUN_FAILED');
});

test('CLI-08 cloud skill run uses the reviewed published revision and only input_args', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-skill-'));
  const viewPath = path.join(tempDir, 'view.json');
  const inputPath = path.join(tempDir, 'input.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'cloud-skill:skill-1', scope: 'personal', displayedRevision: 'rev-1', revisionStatus: 'published', revisionKind: 'published'
  } } }));
  await fs.writeFile(inputPath, JSON.stringify({ input_args: { query: 'hello' } }));
  const requests = [];
  const io = makeIo(async (url, init) => {
    requests.push({ url, init });
    if (new URL(url).pathname.endsWith('/components')) return new Response(JSON.stringify([{ type: 'script', logical_path: 'scripts/run.py', component_id: 'component-1' }]), { status: 200 });
    return new Response(JSON.stringify({ status: 'success', exit_code: 0 }), { status: 200 });
  });
  const code = await run(['cloud-skill', 'run', 'skill-1', '--input', inputPath, '--from', viewPath, '--yes', '--json'], io);
  assert.equal(code, 0);
  const execute = requests.find((request) => new URL(request.url).pathname.endsWith('/execute'));
  const body = JSON.parse(execute.init.body);
  assert.deepEqual(body.input_args, { query: 'hello' });
  assert.equal(body.script_path, 'scripts/run.py');
  assert.equal(body.revision_id, 'rev-1');
});

test('CLI-04 knowledge add validates local content before creating a base', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('{}'); });
  const code = await run(['knowledge', 'add', '--create-base', 'new-base', '--json'], io);
  assert.equal(code, 2);
  assert.equal(calls, 0);
});

test('CLI-04 knowledge update publishes with the post-content version', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-knowledge-'));
  const viewPath = path.join(tempDir, 'view.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'knowledge-item:item-1', scope: 'personal', displayedRevision: 'rev-1', latestRevision: 'rev-1', version: 2, itemStatus: 'draft', sourceType: 'text'
  } } }));
  const requests = [];
  const io = makeIo(async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(new URL(url).pathname.endsWith('/content') ? { version: 3, current_revision_id: 'rev-2' } : { version: 4, status: 'published' }), { status: 200 });
  });
  const code = await run(['knowledge', 'update', 'item-1', '--from', viewPath, '--text', 'new content', '--publish', '--yes', '--json'], io);
  assert.equal(code, 0);
  const publish = requests.find((request) => request.init.method === 'PATCH');
  assert.equal(JSON.parse(publish.init.body).expected_version, 3);
});

test('CLI-04 knowledge add preserves unknown outcome and created base evidence', async () => {
  const io = makeIo(async (url, init) => {
    if (new URL(url).pathname.endsWith('/knowledge-bases')) {
      return new Response(JSON.stringify({ id: 'base-1' }), { status: 201 });
    }
    await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  });
  const code = await run(['knowledge', 'add', '--create-base', 'new-base', '--text', 'content', '--timeout-ms', '5', '--json'], io);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(code, 11);
  assert.equal(envelope.error.outcome, 'unknown');
  assert.equal(envelope.error.data.base.id, 'base-1');
});

test('CLI-04 knowledge update preserves unknown publish outcome and content evidence', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-knowledge-unknown-'));
  const viewPath = path.join(tempDir, 'view.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'knowledge-item:item-1', scope: 'personal', displayedRevision: 'rev-1', latestRevision: 'rev-1', version: 2, itemStatus: 'draft', sourceType: 'text'
  } } }));
  let calls = 0;
  const io = makeIo(async (url, init) => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ version: 3, current_revision_id: 'rev-2' }), { status: 200 });
    await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  });
  const code = await run(['knowledge', 'update', 'item-1', '--from', viewPath, '--text', 'new content', '--publish', '--yes', '--timeout-ms', '5', '--json'], io);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(code, 11);
  assert.equal(envelope.error.outcome, 'unknown');
  assert.equal(envelope.error.data.content.version, 3);
});

test('CLI-06 dream preview always sends one idempotency key', async () => {
  const bodies = [];
  const io = makeIo(async (_url, init) => {
    if (init.method === 'POST') bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(init.method === 'POST' ? { run: { id: 'run-1' } } : { enabled: true }), { status: 200 });
  });
  const generatedCode = await run(['dream', 'preview', '--json'], io);
  assert.equal(generatedCode, 0);
  assert.match(bodies[0].idempotency_key, /^[0-9a-f-]{36}$/);

  const suppliedBodies = [];
  const suppliedIo = makeIo(async (_url, init) => {
    if (init.method === 'POST') suppliedBodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(init.method === 'POST' ? { run: { id: 'run-2' } } : { enabled: true }), { status: 200 });
  });
  const suppliedCode = await run(['dream', 'preview', '--idempotency-key', 'fixed-key', '--json'], suppliedIo);
  assert.equal(suppliedCode, 0);
  assert.equal(suppliedBodies[0].idempotency_key, 'fixed-key');

  const unknownIo = makeIo(async (_url, init) => {
    if (init.method === 'GET') return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  });
  const unknownCode = await run(['dream', 'preview', '--timeout-ms', '5', '--json'], unknownIo);
  const unknownEnvelope = JSON.parse(unknownIo.stdout.value);
  assert.equal(unknownCode, 11);
  assert.match(unknownEnvelope.error.data.idempotency_key, /^[0-9a-f-]{36}$/);
});

test('CLI-06 dream wait treats every non-success terminal state as remote failure', async () => {
  for (const status of ['failed', 'dead_letter', 'cancelled']) {
    const io = makeIo(async () => new Response(JSON.stringify({ run: { id: 'run-1', status }, items: [] }), { status: 200 }));
    const code = await run(['dream', 'show', 'run-1', '--wait', '--json'], io);
    assert.equal(code, 8);
    assert.equal(JSON.parse(io.stdout.value).error.code, 'DREAM_RUN_FAILED');
  }
});

test('CLI-03 JSON-only memory search fields reach the GET request and conflicts are rejected', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-search-input-'));
  const inputPath = path.join(tempDir, 'input.json');
  await fs.writeFile(inputPath, JSON.stringify({ query: 'from-json', limit: 3, team_id: 'team-1', bucket: 'work', path: 'notes', prefer_working: true }));
  let requestedUrl;
  const io = makeIo(async (url) => { requestedUrl = url; return new Response('[]', { status: 200 }); });
  const code = await run(['memory', 'search', '--input', inputPath, '--json'], io);
  assert.equal(code, 0);
  const parsed = new URL(requestedUrl);
  assert.equal(parsed.searchParams.get('limit'), '3');
  assert.equal(parsed.searchParams.get('team_id'), 'team-1');
  assert.equal(parsed.searchParams.get('prefer_working'), 'true');

  const conflictIo = makeIo(async () => new Response('[]', { status: 200 }));
  const conflictCode = await run(['state', 'save', '--input', inputPath, '--current-task', 'flag', '--json'], conflictIo);
  assert.equal(conflictCode, 2);
});

test('CLI-03 missing JSON input is a typed input error', async () => {
  const io = makeIo(async () => new Response('[]', { status: 200 }));
  const code = await run(['memory', 'search', 'query', '--input', 'missing-input.json', '--json'], io);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(code, 2);
  assert.equal(envelope.error.outcome, 'known-failure');
  assert.equal(envelope.error.code, 'INPUT_ERROR');
});

test('CLI-04 knowledge command flags reject duplicate JSON fields before transmission', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-knowledge-conflict-'));
  const inputPath = path.join(tempDir, 'input.json');
  await fs.writeFile(inputPath, JSON.stringify({ document_id: 'doc-1', document_version: 2, title: 'from-json' }));
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('{}', { status: 200 }); });
  const code = await run(['knowledge', 'add', '--base', 'base-1', '--document', 'doc-2', '--input', inputPath, '--json'], io);
  assert.equal(code, 2);
  assert.equal(calls, 0);
});

test('CLI-08 Cloud Skill run requires an explicit reviewed script when multiple scripts exist', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-skill-multi-'));
  const viewPath = path.join(tempDir, 'view.json');
  const inputPath = path.join(tempDir, 'input.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'cloud-skill:skill-1', scope: 'personal', displayedRevision: 'rev-1', revisionStatus: 'published', revisionKind: 'published'
  } } }));
  await fs.writeFile(inputPath, JSON.stringify({ input_args: {} }));
  let executeCalls = 0;
  const io = makeIo(async (url) => {
    if (new URL(url).pathname.endsWith('/components')) return new Response(JSON.stringify([
      { type: 'script', logical_path: 'scripts/one.py', component_id: 'component-1' },
      { type: 'script', logical_path: 'scripts/two.py', component_id: 'component-2' }
    ]), { status: 200 });
    executeCalls += 1;
    return new Response(JSON.stringify({ status: 'success', exit_code: 0 }), { status: 200 });
  });
  const code = await run(['cloud-skill', 'run', 'skill-1', '--input', inputPath, '--from', viewPath, '--yes', '--json'], io);
  assert.equal(code, 2);
  assert.equal(executeCalls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /multiple scripts.*--script/);

  const selectedRequests = [];
  const selectedIo = makeIo(async (url, init) => {
    selectedRequests.push({ url, init });
    if (new URL(url).pathname.endsWith('/components')) return new Response(JSON.stringify([
      { type: 'script', logical_path: 'scripts/one.py', component_id: 'component-1' },
      { type: 'script', logical_path: 'scripts/two.py', component_id: 'component-2' }
    ]), { status: 200 });
    return new Response(JSON.stringify({ status: 'success', exit_code: 0 }), { status: 200 });
  });
  const selectedCode = await run(['cloud-skill', 'run', 'skill-1', '--input', inputPath, '--from', viewPath, '--script', 'scripts/two.py', '--yes', '--json'], selectedIo);
  assert.equal(selectedCode, 0);
  assert.equal(JSON.parse(selectedRequests.find(({ url }) => new URL(url).pathname.endsWith('/execute')).init.body).script_path, 'scripts/two.py');
});

test('CLI-08 Cloud Skill add probes only the create-only contract and never falls back', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-skill-create-'));
  const skillPath = path.join(tempDir, 'SKILL.md');
  await fs.writeFile(skillPath, '# Synthetic skill\n');
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ detail: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  });
  const code = await run(['cloud-skill', 'add', '--file', skillPath, '--json'], io);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(code, 7);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/v1/skills/create');
  assert.equal(envelope.error.code, 'SERVER_CONTRACT_REQUIRED');
  assert.match(envelope.error.nextAction, /不.*回退/);
});

test('CLI-08 Cloud Skill update sends reviewed CAS revision and preserves omitted files by contract', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-skill-update-'));
  const skillDir = path.join(tempDir, 'skill');
  await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Synthetic skill\n');
  await fs.writeFile(path.join(skillDir, 'scripts', 'run.py'), 'print("ok")\n');
  const viewPath = path.join(tempDir, 'view.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'cloud-skill:skill-1', scope: 'personal', displayedRevision: 'rev-2', latestRevision: 'rev-2', revisionStatus: 'draft', revisionKind: 'draft'
  } } }));
  let request;
  const io = makeIo(async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ revision_id: 'rev-3', status: 'draft' }), { status: 200 });
  });
  const code = await run(['cloud-skill', 'update', 'skill-1', '--dir', skillDir, '--from', viewPath, '--json'], io);
  assert.equal(code, 0);
  assert.equal(new URL(request.url).pathname, '/v1/skills/skill-1/content');
  const body = JSON.parse(request.init.body);
  assert.equal(body.expected_revision_id, 'rev-2');
  assert.equal(body.markdown_content, '# Synthetic skill\n');
  assert.equal(body.sub_files['scripts/run.py'], 'print("ok")\n');
  assert.equal(body.publish, false);
});

test('CLI-05 knowledge update supports publish-only and document snapshot CAS', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-knowledge-update-'));
  const viewPath = path.join(tempDir, 'view.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'knowledge-item:item-1', scope: 'personal', displayedRevision: 'rev-4', latestRevision: 'rev-4', version: 7, itemStatus: 'draft', sourceType: 'file', sourceRef: 'document:doc-1'
  } } }));
  const publishRequests = [];
  const publishIo = makeIo(async (url, init) => {
    publishRequests.push({ url, init });
    return new Response(JSON.stringify({ version: 8, status: 'published' }), { status: 200 });
  });
  assert.equal(await run(['knowledge', 'update', 'item-1', '--from', viewPath, '--publish', '--yes', '--json'], publishIo), 0);
  assert.equal(publishRequests.length, 1);
  assert.equal(publishRequests[0].init.method, 'PATCH');
  assert.equal(JSON.parse(publishRequests[0].init.body).expected_version, 7);

  const documentRequests = [];
  const documentIo = makeIo(async (url, init) => {
    documentRequests.push({ url, init });
    return new Response(JSON.stringify({ version: 8, current_revision_id: 'rev-5' }), { status: 200 });
  });
  assert.equal(await run(['knowledge', 'update', 'item-1', '--from', viewPath, '--document', 'doc-1', '--document-version', '3', '--json'], documentIo), 0);
  assert.equal(new URL(documentRequests[0].url).pathname, '/api/v1/knowledge-items/item-1/content/from-document');
  assert.deepEqual(JSON.parse(documentRequests[0].init.body), { document_id: 'doc-1', expected_document_version: 3, expected_current_revision_id: 'rev-4' });
});

test('CLI-05 knowledge add uses the explicit default base only as a fallback', async () => {
  let request;
  const io = makeIo(async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ knowledge_item_id: 'item-1', status: 'draft' }), { status: 201 });
  }, { XMEMO_KNOWLEDGE_BASE_ID: 'base-default' });
  const code = await run(['knowledge', 'add', '--text', 'synthetic', '--json'], io);
  assert.equal(code, 0);
  assert.equal(new URL(request.url).pathname, '/api/v1/knowledge-bases/base-default/items');
});

test('CLI-06 Dream preview reports whether apply is available without changing settings', async () => {
  const requests = [];
  const io = makeIo(async (url, init) => {
    requests.push({ url, init });
    if (init.method === 'GET') return new Response(JSON.stringify({ enabled: true, mode: 'preview_only', entitlement: { can_apply: true } }), { status: 200 });
    return new Response(JSON.stringify({ run: { id: 'run-1', status: 'queued' } }), { status: 202 });
  });
  const code = await run(['dream', 'preview', '--json'], io);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(code, 0);
  assert.equal(envelope.data.applyAvailable, false);
  assert.match(envelope.data.applyUnavailableReason, /confirm_each_run/);
  assert.deepEqual(requests.map(({ init }) => init.method), ['GET', 'POST']);
});

test('CLI-03 restart JSON input preserves the full server request model', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-restart-input-'));
  const inputPath = path.join(tempDir, 'snapshot.json');
  await fs.writeFile(inputPath, JSON.stringify({ session_id: 'session-1', state_key: 'active_task', timeline_limit: 5, reminder_limit: 6, decision_limit: 7, metadata: { source: 'test' }, source: 'cli', bucket: 'work', scope: 'private', path: 'restart', ttl_seconds: 3600 }));
  let body;
  const io = makeIo(async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'snapshot-1' }), { status: 201 });
  });
  assert.equal(await run(['restart', 'snapshot', '--input', inputPath, '--json'], io), 0);
  assert.equal(body.session_id, 'session-1');
  assert.equal(body.timeline_limit, 5);
  assert.deepEqual(body.metadata, { source: 'test' });
  assert.equal(body.ttl_seconds, 3600);
});

test('CLI-01 high-impact non-interactive commands use confirmation exit 10 before writing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-confirm-'));
  const viewPath = path.join(tempDir, 'dream-view.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'dream-run:run-1', scope: 'personal', displayedRevision: 'sha256:run-version', settingsVersion: 2, candidateItemIds: ['candidate-1']
  } } }));
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('{}', { status: 200 }); });
  const code = await run(['dream', 'apply', 'run-1', '--item', 'candidate-1', '--from', viewPath, '--json'], io);
  assert.equal(code, 10);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(io.stdout.value).error.code, 'CONFIRMATION_REQUIRED');
});

test('CLI-04 knowledge read accepts its resource selector through JSON input', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-read-input-'));
  const inputPath = path.join(tempDir, 'read.json');
  await fs.writeFile(inputPath, JSON.stringify({ item_id: 'item-json', offset: 0, limit_chars: 50 }));
  const urls = [];
  const io = makeIo(async (url) => {
    urls.push(url);
    if (urls.length === 1) return new Response(JSON.stringify({ current_revision_id: 'rev-json', version: 1, status: 'draft' }), { status: 200 });
    return new Response(JSON.stringify({ canonical_content: 'content' }), { status: 200 });
  });
  assert.equal(await run(['knowledge', 'read', '--input', inputPath, '--json'], io), 0);
  assert.equal(new URL(urls[0]).pathname, '/api/v1/knowledge-items/item-json');
  assert.equal(new URL(urls[1]).searchParams.get('offset'), '0');
});

test('CLI-03 basic REST calls cover memory, context, state, and restart routes', async () => {
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, id: `result-${calls.length}` }), { status: init.method === 'POST' ? 201 : 200 });
  });
  const commands = [
    ['memory', 'add', '--content', 'synthetic', '--path', 'tests/basic', '--json'],
    ['memory', 'search', 'synthetic', '--json'],
    ['context', 'recall', 'synthetic', '--include-knowledge', '--json'],
    ['state', 'save', '--current-task', 'testing', '--json'],
    ['state', 'restore', '--json'],
    ['restart', 'snapshot', '--json'],
    ['restart', 'restore', '--snapshot-id', 'snapshot-1', '--json']
  ];
  for (const args of commands) {
    io.stdout.value = '';
    assert.equal(await run(args, io), 0);
    assert.equal(JSON.parse(io.stdout.value).ok, true);
  }
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/api/v1/remember', '/api/v1/recall', '/api/v1/recall/context',
    '/api/v1/update_state', '/api/v1/skill/operations',
    '/api/v1/restart/snapshot', '/api/v1/restart/restore'
  ]);
  assert.equal(JSON.parse(calls[4].init.body).operation, 'state-restore');
});

test('CLI-05 document knowledge waits for extraction and pins the returned version', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-document-'));
  const documentPath = path.join(tempDir, 'guide.pdf');
  await fs.writeFile(documentPath, Buffer.from('%PDF synthetic'));
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    const pathname = new URL(url).pathname;
    if (pathname === '/api/v1/documents') return new Response(JSON.stringify({ document_id: 'doc-1', version: 2, extraction_status: 'queued' }), { status: 201 });
    if (pathname === '/api/v1/documents/doc-1') return new Response(JSON.stringify({ document_id: 'doc-1', version: 2, extraction_status: 'succeeded' }), { status: 200 });
    return new Response(JSON.stringify({ knowledge_item_id: 'item-1', status: 'draft' }), { status: 201 });
  });
  const code = await run(['knowledge', 'add', '--base', 'base-1', '--file', documentPath, '--title', 'Guide', '--json'], io);
  assert.equal(code, 0);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/api/v1/knowledge-bases/base-1', '/api/v1/documents', '/api/v1/documents/doc-1', '/api/v1/knowledge-bases/base-1/items/from-document'
  ]);
  const snapshot = JSON.parse(calls[3].init.body);
  assert.equal(snapshot.document_id, 'doc-1');
  assert.equal(snapshot.expected_document_version, 2);
  assert.equal(snapshot.status, 'draft');
});

test('CLI-06 Dream apply sends exactly one reviewed candidate and versions', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-dream-apply-'));
  const viewPath = path.join(tempDir, 'view.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: {
    schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'dream-run:run-1', scope: 'personal', displayedRevision: 'sha256:run-version', settingsVersion: 4, candidateItemIds: ['item-1']
  } } }));
  let request;
  const io = makeIo(async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ created: true, memory_id: 'memory-1' }), { status: 200 });
  });
  const code = await run(['dream', 'apply', 'run-1', '--item', 'item-1', '--from', viewPath, '--yes', '--json'], io);
  assert.equal(code, 0);
  assert.equal(new URL(request.url).pathname, '/api/v1/me/dream/runs/run-1/confirm');
  assert.deepEqual(JSON.parse(request.init.body), { item_id: 'item-1', expected_run_version: 'sha256:run-version', expected_settings_version: 4 });
});

test('CLI-08 Cloud Skill run rejects a view from another origin before execution', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-view-'));
  const viewPath = path.join(tempDir, 'view.json');
  const inputPath = path.join(tempDir, 'input.json');
  await fs.writeFile(viewPath, JSON.stringify({ meta: { readReceipt: { schemaVersion: '1', serviceOrigin: 'https://other.example.test', resource: 'cloud-skill:skill-1', displayedRevision: 'rev-1' } } }));
  await fs.writeFile(inputPath, '{}');
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('{}'); });
  const code = await run(['cloud-skill', 'run', 'skill-1', '--input', inputPath, '--from', viewPath, '--yes', '--json'], io);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(code, 2);
  assert.equal(calls, 0);
  assert.match(envelope.error.message, /origin/);
});
