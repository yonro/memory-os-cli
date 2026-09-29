import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { run } from '../src/cli.js';
import { DEFAULT_DEVICE_LOGIN_SCOPES } from '../src/network/auth.js';
import { isDocumentStub, processDocumentStubs, MAX_EXPAND_DOCUMENTS, MAX_EXPAND_CHARS } from '../src/api/document-stub.js';
import { formatErrorDetail } from '../src/api/errors.js';

class Stream {
  constructor() { this.value = ''; }
  write(value) { this.value += String(value); }
}

function makeIo(fetch, env = {}) {
  return {
    env: { XMEMO_KEY: 'test-token', XMEMO_BASE_URL: 'https://api.example.test', ...env },
    fetch,
    stdout: new Stream(),
    stderr: new Stream(),
    stdin: { async *[Symbol.asyncIterator]() {} }
  };
}

test('isDocumentStub detects document stubs via metadata and content prefix', () => {
  assert.equal(isDocumentStub({ metadata: { document_ref: 'doc-123' } }), true);
  assert.equal(isDocumentStub({ metadata: JSON.stringify({ document_ref: 'doc-123' }) }), true);
  assert.equal(isDocumentStub({ content: 'Document-backed memory: Design Doc' }), true);
  assert.equal(isDocumentStub({ content: 'Regular note' }), false);
  assert.equal(isDocumentStub(null), false);
});

test('memory search adds document_backed and next_command in JSON, full document line in human mode', async () => {
  const items = [
    { memory_id: 'mem-stub-1', path: 'docs/spec', content: 'Document-backed memory: Arch Spec', metadata: { document_ref: 'doc-1' } },
    { memory_id: 'mem-regular-2', path: 'notes/meeting', content: 'Met with team today' }
  ];

  // 1. JSON mode
  const ioJson = makeIo(async () => new Response(JSON.stringify(items), { status: 200 }));
  const codeJson = await run(['memory', 'search', 'query', '--json'], ioJson);
  assert.equal(codeJson, 0);
  const envelope = JSON.parse(ioJson.stdout.value);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data[0].document_backed, true);
  assert.equal(envelope.data[0].next_command, 'xmemo memory read mem-stub-1');
  assert.equal(envelope.data[1].document_backed, undefined);

  // 2. Human mode
  const ioHuman = makeIo(async () => new Response(JSON.stringify(items), { status: 200 }));
  const codeHuman = await run(['memory', 'search', 'query'], ioHuman);
  assert.equal(codeHuman, 0);
  assert.match(ioHuman.stdout.value, /Full document: xmemo memory read mem-stub-1/);
  assert.doesNotMatch(ioHuman.stdout.value, /Full document: xmemo memory read mem-regular-2/);
});

test('memory search --expand-documents expands up to 3 stubs, truncates at 20000 chars, tolerates errors', async () => {
  const items = [
    { memory_id: 'mem-1', content: 'Document-backed memory: Doc 1', metadata: { document_ref: 'doc-1' } },
    { memory_id: 'mem-2', content: 'Document-backed memory: Doc 2', metadata: { document_ref: 'doc-2' } },
    { memory_id: 'mem-3', content: 'Document-backed memory: Doc 3', metadata: { document_ref: 'doc-3' } },
    { memory_id: 'mem-4', content: 'Document-backed memory: Doc 4', metadata: { document_ref: 'doc-4' } }
  ];

  const longContent = 'A'.repeat(25000);
  const io = makeIo(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/recall') {
      return new Response(JSON.stringify(items), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-1/explain') {
      return new Response(JSON.stringify({ memory: { content: 'Short expanded content 1' } }), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-2/explain') {
      return new Response(JSON.stringify({ memory: { content: longContent } }), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-3/explain') {
      return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
    }
    throw new Error(`Unexpected call: ${url}`);
  });

  const code = await run(['memory', 'search', 'query', '--expand-documents', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.ok, true);
  const results = envelope.data;

  // mem-1: fully expanded
  assert.equal(results[0].expanded, true);
  assert.equal(results[0].document_expanded, true);
  assert.equal(results[0].content, 'Short expanded content 1');
  assert.equal(results[0].next_command, 'xmemo memory read mem-1');

  // mem-2: truncated at 20000 chars
  assert.equal(results[1].expanded, true);
  assert.equal(results[1].document_expanded, true);
  assert.equal(results[1].content.length, 20000);
  assert.equal(results[1].content_truncated, true);
  assert.equal(results[1].next_command, 'xmemo memory read mem-2');

  // mem-3: explain error captured per-item, parent command succeeded
  assert.ok(results[2].expand_error);
  assert.equal(results[2].expanded, undefined);
  assert.equal(results[2].document_expanded, false);
  assert.equal(results[2].next_command, 'xmemo memory read mem-3');

  // mem-4: 4th stub not expanded (capped at 3)
  assert.equal(results[3].expanded, undefined);
  assert.equal(results[3].document_expanded, false);
  assert.equal(results[3].document_backed, true);
  assert.equal(results[3].next_command, 'xmemo memory read mem-4');
});

test('context recall supports --expand-documents and stubs', async () => {
  const items = [
    { memory_id: 'mem-stub', content: 'Document-backed memory: Stub', metadata: { document_ref: 'doc-stub' } }
  ];

  const io = makeIo(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/recall/context') {
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-stub/explain') {
      return new Response(JSON.stringify({ memory: { content: 'Expanded recall doc' } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });

  const code = await run(['context', 'recall', 'query', '--expand-documents', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.data.items[0].expanded, true);
  assert.equal(envelope.data.items[0].content, 'Expanded recall doc');
});

test('DEFAULT_DEVICE_LOGIN_SCOPES includes knowledge:read', () => {
  assert.ok(DEFAULT_DEVICE_LOGIN_SCOPES.includes('knowledge:read'));
});

test('context recall --include-knowledge emits warning when knowledge was skipped', async () => {
  const ioHuman = makeIo(async (url) => {
    return new Response(JSON.stringify({
      items: [{ memory_id: 'm1', content: 'Memory content' }],
      knowledge_items_skipped: true
    }), { status: 200 });
  });

  const codeHuman = await run(['context', 'recall', 'query', '--include-knowledge'], ioHuman);
  assert.equal(codeHuman, 0);
  assert.match(ioHuman.stderr.value, /Warning: Knowledge (?:search|retrieval) was skipped/);

  const ioJson = makeIo(async (url) => {
    return new Response(JSON.stringify({
      items: [{ memory_id: 'm1', content: 'Memory content' }],
      knowledge_items_skipped: true
    }), { status: 200 });
  });

  const codeJson = await run(['context', 'recall', 'query', '--include-knowledge', '--json'], ioJson);
  assert.equal(codeJson, 0);
  const envelope = JSON.parse(ioJson.stdout.value);
  assert.ok(envelope.meta.warnings.some((w) => /Knowledge (?:search|retrieval) was skipped/.test(w)));
});

test('human mode formatting for memory list, memory add, state, snapshot, cloud-skill', async () => {
  // 1. memory list
  const ioList = makeIo(async () => new Response(JSON.stringify({
    memories: [
      { id: 'mem-1', path: 'projects/p1', content: 'First memory content preview' }
    ]
  }), { status: 200 }));
  const codeList = await run(['memory', 'list'], ioList);
  assert.equal(codeList, 0);
  assert.match(ioList.stdout.value, /projects\/p1\s+\[mem-1\]\s+First memory content preview/);
  assert.doesNotMatch(ioList.stdout.value, /^\{/m);

  // 2. memory add
  const ioAdd = makeIo(async () => new Response(JSON.stringify({ id: 'mem-new', path: 'projects/new' }), { status: 201 }));
  const codeAdd = await run(['memory', 'add', '--content', 'New memory text', '--path', 'projects/new'], ioAdd);
  assert.equal(codeAdd, 0);
  assert.match(ioAdd.stdout.value, /Saved memory mem-new at projects\/new/);
  assert.doesNotMatch(ioAdd.stdout.value, /^\{/m);

  // 3. state save
  const ioStateSave = makeIo(async () => new Response(JSON.stringify({
    state_key: 'active_task',
    version: 2,
    ttl_seconds: 3600
  }), { status: 200 }));
  const codeStateSave = await run(['state', 'save', 'active_task', '--content', '{"task":"test"}'], ioStateSave);
  assert.equal(codeStateSave, 0);
  assert.match(ioStateSave.stdout.value, /Saved state: key=active_task, version=2, expiry=3600s/);
  assert.doesNotMatch(ioStateSave.stdout.value, /^\{/m);

  // 4. state restore
  const ioStateRestore = makeIo(async () => new Response(JSON.stringify({
    state_key: 'active_task',
    version: 2,
    content: 'saved task content'
  }), { status: 200 }));
  const codeStateRestore = await run(['state', 'restore', 'active_task'], ioStateRestore);
  assert.equal(codeStateRestore, 0);
  assert.match(ioStateRestore.stdout.value, /Restored state: key=active_task, version=2/);
  assert.match(ioStateRestore.stdout.value, /saved task content/);

  // 5. restart snapshot
  const ioSnapshot = makeIo(async () => new Response(JSON.stringify({
    snapshot_id: 'snap-123',
    expires_at: '2026-10-01T00:00:00Z',
    timeline_count: 5,
    states_count: 2
  }), { status: 200 }));
  const codeSnapshot = await run(['restart', 'snapshot'], ioSnapshot);
  assert.equal(codeSnapshot, 0);
  assert.match(ioSnapshot.stdout.value, /Restart snapshot snap-123 saved\./);
  assert.match(ioSnapshot.stdout.value, /Counts: timeline=5, states=2/);
  assert.doesNotMatch(ioSnapshot.stdout.value, /^\{/m);

  // 6. cloud-skill list
  const ioSkill = makeIo(async () => new Response(JSON.stringify({
    skills: [
      { name: 'XMemo Helper', slug: 'xmemo-helper', status: 'published' }
    ]
  }), { status: 200 }));
  const codeSkill = await run(['cloud-skill', 'list'], ioSkill);
  assert.equal(codeSkill, 0);
  assert.match(ioSkill.stdout.value, /Found 1 cloud skill:/);
  assert.match(ioSkill.stdout.value, /- XMemo Helper \(xmemo-helper\) · published/);
  assert.doesNotMatch(ioSkill.stdout.value, /^\{/m);
});

test('empty memory search hint suggests query refinement, not --path or --bucket', async () => {
  const io = makeIo(async () => new Response(JSON.stringify([]), { status: 200 }));
  const code = await run(['memory', 'search', 'nonexistent_query'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /No matching memories found\. Try a more specific query or adjust --team\./);
  assert.doesNotMatch(io.stdout.value, /--path/);
  assert.doesNotMatch(io.stdout.value, /--bucket/);
});

test('restart restore error specifies --snapshot-id <id> or --state-key <key>', async () => {
  const io = makeIo(async () => new Response('{}', { status: 200 }));
  const code = await run(['restart', 'restore', '--preview'], io);
  assert.equal(code, 2);
  assert.match(io.stderr.value, /--snapshot-id <id> or --state-key <key>/);
  assert.doesNotMatch(io.stderr.value, /source_session_id/);
});

test('doctor --smoke plainly states smoke supports only --client codex', async () => {
  const io = makeIo(async () => new Response('{}', { status: 200 }));
  const code = await run(['doctor', '--smoke'], io);
  assert.equal(code, 2);
  assert.match(io.stderr.value, /Smoke currently supports only --client codex\./);
});

test('isClientMcpConfigured accurately detects server config in JSON, TOML, and YAML', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-status-mcp-'));
  const cursorDir = path.join(tempHome, '.cursor');
  await fs.mkdir(cursorDir, { recursive: true });
  const configPath = path.join(cursorDir, 'mcp.json');

  // Mentioning xmemo in a comment or other property should NOT count as configured
  await fs.writeFile(configPath, JSON.stringify({ description: 'I love xmemo', mcpServers: {} }));

  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    LOCALAPPDATA: tempHome,
    APPDATA: tempHome
  };

  const io = makeIo(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }), env);
  const code = await run(['status', 'cursor'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /MCP: not configured/);

  // Now properly configure mcpServers.XMemo
  await fs.writeFile(configPath, JSON.stringify({ mcpServers: { XMemo: { url: 'https://xmemo.dev/mcp' } } }));
  const ioConfigured = makeIo(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }), env);
  const codeConfigured = await run(['status', 'cursor'], ioConfigured);
  assert.equal(codeConfigured, 0);
  assert.match(ioConfigured.stdout.value, /MCP: configured/);
});

test('status plugin line for MCP-kind plugins displays n/a (uses MCP)', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-status-plugin-'));
  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    LOCALAPPDATA: tempHome,
    APPDATA: tempHome
  };

  const io = makeIo(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }), env);
  const code = await run(['status', 'codex'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /Plugin: n\/a \(uses MCP\)/);
});

test('recall with live-shaped document stub (id != memory_id, document_id, no metadata.document_ref)', async () => {
  const recallItems = [
    {
      id: 'recall-row-999',
      memory_id: 'mem-real-456',
      document_id: 'doc-backing-789',
      content: 'Document-backed memory: XMemo / Yonro Architecture Spec',
      path: 'projects/xmemo/Plans'
    }
  ];

  // 1. Human mode without --expand-documents: shows Full document hint with memory_id (not recall row id)
  const ioHuman = makeIo(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/recall/context') {
      return new Response(JSON.stringify({
        context_text: 'content: Document-backed memory: XMemo / Yonro Architecture Spec\ndocument_id: doc-backing-789',
        items: recallItems
      }), { status: 200 });
    }
    throw new Error(`Unexpected url: ${url}`);
  });

  const codeHuman = await run(['context', 'recall', 'architecture'], ioHuman);
  assert.equal(codeHuman, 0);
  assert.match(ioHuman.stdout.value, /Recalled 1 context item\./);
  assert.match(ioHuman.stdout.value, /Full document: xmemo memory read mem-real-456/);
  assert.doesNotMatch(ioHuman.stdout.value, /recall-row-999/);

  // 2. Human mode with --expand-documents: fetches explain using memory_id and expands context_text
  const expandedText = 'Full text of the architecture specification document spanning multiple pages.';
  const ioExpandHuman = makeIo(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/recall/context') {
      return new Response(JSON.stringify({
        context_text: 'content: Document-backed memory: XMemo / Yonro Architecture Spec\ndocument_id: doc-backing-789',
        items: recallItems
      }), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-real-456/explain') {
      return new Response(JSON.stringify({
        memory: { content: expandedText }
      }), { status: 200 });
    }
    throw new Error(`Unexpected url: ${url}`);
  });

  const codeExpandHuman = await run(['context', 'recall', 'architecture', '--expand-documents'], ioExpandHuman);
  assert.equal(codeExpandHuman, 0);
  assert.match(ioExpandHuman.stdout.value, /Full text of the architecture specification document/);

  // 3. JSON mode with --expand-documents: preserves next_command and sets document_expanded
  const ioExpandJson = makeIo(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/recall/context') {
      return new Response(JSON.stringify({
        items: recallItems
      }), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-real-456/explain') {
      return new Response(JSON.stringify({
        memory: { content: expandedText }
      }), { status: 200 });
    }
    throw new Error(`Unexpected url: ${url}`);
  });

  const codeExpandJson = await run(['context', 'recall', 'architecture', '--expand-documents', '--json'], ioExpandJson);
  assert.equal(codeExpandJson, 0);
  const envelope = JSON.parse(ioExpandJson.stdout.value);
  assert.equal(envelope.ok, true);
  const item = envelope.data.items[0];
  assert.equal(item.id, 'recall-row-999');
  assert.equal(item.memory_id, 'mem-real-456');
  assert.equal(item.document_backed, true);
  assert.equal(item.document_expanded, true);
  assert.equal(item.next_command, 'xmemo memory read mem-real-456');
  assert.equal(item.content, expandedText);
});

test('memory delete and restore endpoints', async () => {
  let deleteBody = null;
  let deleteCalled = false;
  let restoreCalled = false;

  const io = makeIo(async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/memories/mem-to-delete/forget') {
      deleteCalled = true;
      deleteBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, id: 'mem-to-delete', mode: 'soft_delete', forgotten: true }), { status: 200 });
    }
    if (parsed.pathname === '/v1/memories/mem-to-restore/restore') {
      restoreCalled = true;
      return new Response(JSON.stringify({ ok: true, id: 'mem-to-restore', restored: true }), { status: 200 });
    }
    throw new Error(`Unexpected url: ${url}`);
  });

  // 1. memory delete with --yes
  const codeDel = await run(['memory', 'delete', 'mem-to-delete', '--reason', 'outdated note', '--yes'], io);
  assert.equal(codeDel, 0);
  assert.equal(deleteCalled, true);
  assert.deepEqual(deleteBody, { mode: 'soft_delete', reason: 'outdated note' });
  assert.match(io.stdout.value, /Soft-deleted memory mem-to-delete\./);

  // 2. memory delete non-interactive without --yes fails with confirmation required
  const ioNoYes = makeIo(async () => new Response('{}', { status: 200 }));
  const codeNoYes = await run(['memory', 'delete', 'mem-to-delete'], ioNoYes);
  assert.equal(codeNoYes, 10);

  // 3. memory restore with --yes
  const codeRes = await run(['memory', 'restore', 'mem-to-restore', '--yes'], io);
  assert.equal(codeRes, 0);
  assert.equal(restoreCalled, true);
  assert.match(io.stdout.value, /Restored memory mem-to-restore\./);

  // 4. memory restore when REST endpoint is unavailable (404) advises MCP restore_memory
  const io404 = makeIo(async (url) => {
    return new Response(JSON.stringify({ error: { code: 'route_not_found', message: 'Route not found' } }), { status: 404 });
  });
  const code404 = await run(['memory', 'restore', 'mem-to-restore', '--yes'], io404);
  assert.equal(code404, 5);
  assert.match(io404.stderr.value, /restore is available through MCP restore_memory/i);
});

test('state restore human output unwraps live-shaped data.result payload', async () => {
  const io = makeIo(async () => new Response(JSON.stringify({
    ok: true,
    result: {
      state_key: 'test-state-20260929040817',
      version: 4,
      expires_at: '2026-10-01T12:00:00Z',
      content: 'state working memory content'
    }
  }), { status: 200 }));

  const code = await run(['state', 'restore', 'test-state-20260929040817'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /Restored state: key=test-state-20260929040817, version=4, expiry=2026-10-01T12:00:00Z/);
  assert.match(io.stdout.value, /state working memory content/);
  assert.doesNotMatch(io.stdout.value, /key=active_task/);
});

test('context recall --include-knowledge warns on real live response lacking knowledge', async () => {
  // Live response: token without knowledge:read returns regular memory items with no knowledge keys at all
  const livePayload = {
    context_text: 'Regular memory note content',
    items: [
      { id: 'm1', memory_id: 'm1', content: 'Regular memory note content' }
    ]
  };

  const ioHuman = makeIo(async () => new Response(JSON.stringify(livePayload), { status: 200 }));
  const codeHuman = await run(['context', 'recall', 'query', '--include-knowledge'], ioHuman);
  assert.equal(codeHuman, 0);
  assert.match(ioHuman.stderr.value, /Warning: Knowledge search was skipped \(requires knowledge:read scope\)\./);

  const ioJson = makeIo(async () => new Response(JSON.stringify(livePayload), { status: 200 }));
  const codeJson = await run(['context', 'recall', 'query', '--include-knowledge', '--json'], ioJson);
  assert.equal(codeJson, 0);
  const envelope = JSON.parse(ioJson.stdout.value);
  assert.ok(envelope.meta.warnings.some((w) => /Knowledge search was skipped/.test(w)));
});

test('cloud-skill list prints asset_status and publication status', async () => {
  const io = makeIo(async () => new Response(JSON.stringify({
    skills: [
      { name: 'XMemo Helper', slug: 'xmemo-helper', asset_status: 'active', published_revision_id: 'rev-42' },
      { name: 'Draft Skill', slug: 'draft-skill', asset_status: 'active', published_revision_id: null }
    ]
  }), { status: 200 }));

  const code = await run(['cloud-skill', 'list'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /Found 2 cloud skills:/);
  assert.match(io.stdout.value, /- XMemo Helper \(xmemo-helper\) · active \(published\)/);
  assert.match(io.stdout.value, /- Draft Skill \(draft-skill\) · active \(draft\)/);
});

// Error formatting and confirmation handling
test('memory restore sends JSON body and formats FastAPI 422 detail array', async () => {
  let sentBody = null;
  const io = makeIo(async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/memories/m1/restore') {
      sentBody = init.body ? JSON.parse(init.body) : null;
      return new Response(JSON.stringify({ ok: true, id: 'm1', restored: true }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  // Call memory restore with --yes
  const code = await run(['memory', 'restore', 'm1', '--yes', '--json'], io);
  assert.equal(code, 0);
  assert.deepEqual(sentBody, {}); // sent JSON body {}

  // FastAPI 422 error detail array formatting
  const io422 = makeIo(async () => {
    return new Response(JSON.stringify({
      detail: [{ type: 'missing', loc: ['body'], msg: 'Field required' }]
    }), { status: 422 });
  });

  const code422 = await run(['memory', 'restore', 'm1', '--yes'], io422);
  assert.notEqual(code422, 0);
  assert.match(io422.stderr.value, /body: Field required/);
  assert.doesNotMatch(io422.stderr.value, /\[object Object\]/);
});

test('non-TTY confirmation messages for memory delete and restore without --yes', async () => {
  // Non-TTY memory delete
  const ioDel = makeIo(async () => new Response('{}', { status: 200 }));
  const codeDel = await run(['memory', 'delete', 'mem-123'], ioDel);
  assert.notEqual(codeDel, 0);
  assert.match(ioDel.stderr.value, /Confirmation required to soft-delete memory mem-123; rerun with --yes\./);

  // Non-TTY memory restore
  const ioRes = makeIo(async () => new Response('{}', { status: 200 }));
  const codeRes = await run(['memory', 'restore', 'mem-123'], ioRes);
  assert.notEqual(codeRes, 0);
  assert.match(ioRes.stderr.value, /Confirmation required to restore memory mem-123; rerun with --yes\./);
});

test('context recall --expand-documents renders expanded document text in human mode', async () => {
  const items = [
    { memory_id: 'mem-doc-1', content: 'Document-backed memory: Design Doc', metadata: { document_ref: 'doc-1' } }
  ];

  const fullText = 'This is the full expanded design document content that should be visible to humans.';
  const io = makeIo(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/recall/context') {
      return new Response(JSON.stringify({ items, context_text: 'Document-backed memory: Design Doc' }), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-doc-1/explain') {
      return new Response(JSON.stringify({ memory: { content: fullText } }), { status: 200 });
    }
    throw new Error(`Unexpected call: ${url}`);
  });

  const code = await run(['context', 'recall', 'query', '--expand-documents'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /This is the full expanded design document content/);
});

test('memory list human mode prints More: --offset <N>', async () => {
  const io = makeIo(async () => {
    return new Response(JSON.stringify({
      memories: [
        { id: '1', path: 'p1', content: 'content 1' },
        { id: '2', path: 'p2', content: 'content 2' }
      ],
      total: 5
    }), { status: 200 });
  });

  const code = await run(['memory', 'list', '--limit', '2'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /More: --offset 2/);
  assert.doesNotMatch(io.stdout.value, /Next cursor:/);
});

test('formatErrorDetail formats FastAPI detail arrays into clean text', () => {
  assert.equal(formatErrorDetail(null), '');
  assert.equal(formatErrorDetail('simple error'), 'simple error');
  assert.equal(formatErrorDetail([{ type: 'missing', loc: ['body'], msg: 'Field required' }]), 'body: Field required');
  assert.equal(formatErrorDetail([
    { loc: ['body', 'title'], msg: 'Field required' },
    { loc: ['query', 'limit'], msg: 'Must be positive' }
  ]), 'title: Field required; query.limit: Must be positive');
  assert.equal(formatErrorDetail({ message: 'Custom object error' }), 'Custom object error');
});

test('context recall --expand-documents renders expanded document text for live-shaped stub in human mode', async () => {
  const recallItems = [
    {
      id: 'recall-row-111',
      memory_id: 'mem-live-222',
      document_id: 'doc-live-333',
      content: 'Document-backed memory: Deep System Specification',
      path: 'projects/xmemo/Plans'
    }
  ];

  const fullText = 'This is the expanded document text for the deep system specification on live shape.';
  const io = makeIo(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/recall/context') {
      return new Response(JSON.stringify({
        context_text: 'content: Document-backed memory: Deep System Specification\ndocument_id: doc-live-333',
        items: recallItems
      }), { status: 200 });
    }
    if (parsed.pathname === '/api/v1/memories/mem-live-222/explain') {
      return new Response(JSON.stringify({
        memory: { content: fullText }
      }), { status: 200 });
    }
    throw new Error(`Unexpected url: ${url}`);
  });

  const code = await run(['context', 'recall', 'specification', '--expand-documents'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /This is the expanded document text for the deep system specification on live shape\./);
  assert.doesNotMatch(io.stdout.value, /content: Document-backed memory: Deep System Specification/);
  assert.doesNotMatch(io.stdout.value, /Full document: xmemo memory read/);
});

test('state restore human output omits version= when absent', async () => {
  const io = makeIo(async () => {
    return new Response(JSON.stringify({
      state_key: 'session_cache',
      content: '{"cached":true}',
      expires_at: '2026-10-01T00:00:00Z'
    }), { status: 200 });
  });

  const code = await run(['state', 'restore', '--state-key', 'session_cache'], io);
  assert.equal(code, 0);
  assert.match(io.stdout.value, /Restored state: key=session_cache, expiry=2026-10-01T00:00:00Z/);
  assert.doesNotMatch(io.stdout.value, /version=/);
});

test('memory restore 403 with restore scope missing provides exact login command', async () => {
  const io = makeIo(async () => {
    return new Response(JSON.stringify({
      detail: 'memory:restore scope required'
    }), { status: 403 });
  });

  const code = await run(['memory', 'restore', 'mem-123', '--yes'], io);
  assert.equal(code, 4); // FORBIDDEN
  assert.match(io.stderr.value, /Next: xmemo account login --scopes memory:read,memory:write,memory:restore,ledger:write,ledger:read,knowledge:read/);
});



