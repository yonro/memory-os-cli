import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.js';
import { writeLine } from '../src/core/io.js';
import {
  normalizeMemoryPath,
  matchesPathPrefix,
  unifyMemoryItem,
  rerankSearchResults
} from '../src/api/memory-schema.js';

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

// 1. Path Normalization Unit Tests
test('CLI-DOGFOOD 1-1: normalizeMemoryPath handles edge cases, [ROOT] prefix, spaces, and casing', () => {
  assert.equal(normalizeMemoryPath('[ROOT]/projects/xmemo/Plans'), 'projects/xmemo/plans');
  assert.equal(normalizeMemoryPath('Projects / Xmemo / Plans'), 'projects/xmemo/plans');
  assert.equal(normalizeMemoryPath('projects/xmemo/plans'), 'projects/xmemo/plans');
  assert.equal(normalizeMemoryPath('/projects/xmemo'), 'projects/xmemo');
  assert.equal(normalizeMemoryPath('[root] / Projects // Xmemo /// Plans /'), 'projects/xmemo/plans');
  assert.equal(normalizeMemoryPath('[ROOT]'), '');
  assert.equal(normalizeMemoryPath(''), '');
  assert.equal(normalizeMemoryPath(null), '');
  assert.equal(normalizeMemoryPath(undefined), '');
});

test('CLI-DOGFOOD 1-2: matchesPathPrefix handles normalized matching and --exact-path', () => {
  assert.equal(matchesPathPrefix('[ROOT]/projects/xmemo/Plans.md', 'projects/xmemo'), true);
  assert.equal(matchesPathPrefix('Projects / Xmemo / Plans.md', '[ROOT]/projects/xmemo'), true);
  assert.equal(matchesPathPrefix('projects/other/doc.md', 'projects/xmemo'), false);

  // Exact mode
  assert.equal(matchesPathPrefix('projects/xmemo/plans.md', 'projects/xmemo', true), true);
  assert.equal(matchesPathPrefix('Projects/xmemo/plans.md', 'projects/xmemo', true), false);
  assert.equal(matchesPathPrefix('[ROOT]/projects/xmemo', 'projects/xmemo', true), false);
});

// 2. Schema Unification & ID Stability Unit Tests
test('CLI-DOGFOOD 2-1: unifyMemoryItem preserves id and provides stable memory_id reference', () => {
  // Case A: item with existing id (e.g. from list)
  const itemWithId = { id: 'list-id-123', path: 'proj/a', content: 'hello', createdAt: '2026-09-28' };
  const unifiedA = unifyMemoryItem(itemWithId, { score: null });
  assert.equal(unifiedA.id, 'list-id-123');
  assert.equal(unifiedA.memory_id, 'list-id-123');
  assert.equal(unifiedA.path, 'proj/a');
  assert.equal(unifiedA.content, 'hello');
  assert.equal(unifiedA.created_at, '2026-09-28');
  assert.equal(unifiedA.score, null);

  // Case B: item with memory_id (e.g. from recall/search)
  const itemWithMemId = { memory_id: 'mem-456', path: 'proj/b', content: 'world', created_at: '2026-09-28', score: 0.95 };
  const unifiedB = unifyMemoryItem(itemWithMemId, { score: 0.95 });
  assert.equal(unifiedB.id, 'mem-456');
  assert.equal(unifiedB.memory_id, 'mem-456');
  assert.equal(unifiedB.score, 0.95);

  // Case C: item with both id and memory_id (preserve id, reference memory_id)
  const itemWithBoth = { id: 'record-1', memory_id: 'mem-1', content: 'test' };
  const unifiedC = unifyMemoryItem(itemWithBoth);
  assert.equal(unifiedC.id, 'record-1');
  assert.equal(unifiedC.memory_id, 'mem-1');
});

// 3. Search Boost Reranking Unit Tests
test('CLI-DOGFOOD 3-1: rerankSearchResults prioritizes exact phrase then keyword hits with stable tiebreaking', () => {
  const items = [
    { id: '1', content: 'general notes about architecture' },
    { id: '2', content: 'detailed devflow dogfood testing specification' },
    { id: '3', content: 'dogfood testing is important' },
    { id: '4', content: 'random entry' }
  ];

  // Search with exact phrase "devflow dogfood"
  const reranked = rerankSearchResults(items, { exact: 'devflow dogfood', keyword: 'dogfood testing' });
  assert.equal(reranked[0].id, '2'); // exact phrase match
  assert.equal(reranked[1].id, '3'); // 2 keyword hits ('dogfood', 'testing')
  assert.equal(reranked[2].id, '1'); // 0 keyword hits, but original index 0
  assert.equal(reranked[3].id, '4'); // 0 keyword hits, original index 3
});

// 4. Schema Unification in CLI: search, list, recall
test('CLI-DOGFOOD 4-1: memory search produces unified schema with data.items, data.results, and data[0]', async () => {
  const io = makeIo(async (url) => {
    assert.equal(new URL(url).pathname, '/api/v1/recall');
    return new Response(JSON.stringify({
      results: [
        { memory_id: 'm-search-1', path: 'projects/alpha/doc1', content: 'first search hit', similarity: 0.88, created_at: '2026-09-28T00:00:00Z' },
        { memory_id: 'm-search-2', path: 'projects/alpha/doc2', content: 'second search hit', similarity: 0.72, created_at: '2026-09-28T01:00:00Z' }
      ],
      coverage: { memory: true }
    }), { status: 200 });
  });

  const code = await run(['memory', 'search', 'query', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.ok, true);

  // Unified items
  assert.ok(Array.isArray(envelope.data.items));
  assert.equal(envelope.data.items.length, 2);
  assert.equal(envelope.data.items[0].memory_id, 'm-search-1');
  assert.equal(envelope.data.items[0].id, 'm-search-1');
  assert.equal(envelope.data.items[0].score, 0.88);
  assert.equal(envelope.data.items[0].path, 'projects/alpha/doc1');
  assert.equal(envelope.data.items[0].content, 'first search hit');

  // Backward compatibility
  assert.ok(Array.isArray(envelope.data.results));
  assert.equal(envelope.data.results[0].memory_id, 'm-search-1');
  assert.equal(envelope.data[0].memory_id, 'm-search-1');
  assert.equal(envelope.data.coverage.memory, true);
});

test('CLI-DOGFOOD 4-2: context recall produces unified schema with data.items, data.memories, and data[0]', async () => {
  const io = makeIo(async (url) => {
    assert.equal(new URL(url).pathname, '/api/v1/recall/context');
    return new Response(JSON.stringify({
      items: [
        { memory_id: 'm-recall-1', path: 'projects/beta/plan', content: 'recall content', score: 0.91 }
      ]
    }), { status: 200 });
  });

  const code = await run(['context', 'recall', 'query', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.ok, true);

  // Unified items
  assert.ok(Array.isArray(envelope.data.items));
  assert.equal(envelope.data.items[0].memory_id, 'm-recall-1');
  assert.equal(envelope.data.items[0].score, 0.91);

  // Backward compatibility
  assert.ok(Array.isArray(envelope.data.memories));
  assert.equal(envelope.data.memories[0].memory_id, 'm-recall-1');
  assert.equal(envelope.data[0].memory_id, 'm-recall-1');
});

test('CLI-DOGFOOD 4-3: memory list produces unified schema with data.items, data.memories, data.total, and data[0]', async () => {
  const io = makeIo(async (url) => {
    assert.equal(new URL(url).pathname, '/v1/memories');
    return new Response(JSON.stringify({
      memories: [
        { id: 'list-rec-1', memory_id: 'mem-list-1', path: 'projects/gamma/notes', content: 'listed note', created_at: '2026-09-28' }
      ],
      total: 1
    }), { status: 200 });
  });

  const code = await run(['memory', 'list', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.ok, true);

  // Unified items
  assert.ok(Array.isArray(envelope.data.items));
  assert.equal(envelope.data.items[0].id, 'list-rec-1');
  assert.equal(envelope.data.items[0].memory_id, 'mem-list-1');
  assert.equal(envelope.data.items[0].score, null);
  assert.equal(envelope.data.total, 1);

  // Backward compatibility
  assert.ok(Array.isArray(envelope.data.memories));
  assert.equal(envelope.data.memories[0].id, 'list-rec-1');
  assert.equal(envelope.data[0].id, 'list-rec-1');
});

// 5. Memory List Filters & Path Normalization
test('CLI-DOGFOOD 5-1: memory list --project maps to normalized projects/<name> prefix', async () => {
  let requestedPrefix = null;
  const io = makeIo(async (url) => {
    const parsed = new URL(url);
    requestedPrefix = parsed.searchParams.get('path_prefix');
    return new Response(JSON.stringify({ memories: [{ id: 'm1', path: 'projects/demo/item' }], total: 1 }), { status: 200 });
  });

  const code = await run(['memory', 'list', '--project', 'Demo', '--json'], io);
  assert.equal(code, 0);
  assert.equal(requestedPrefix, 'projects/demo');
});

test('CLI-DOGFOOD 5-2: memory list --exact-path keeps literal prefix and disables normalization', async () => {
  let requestedPrefix = null;
  const io = makeIo(async (url) => {
    const parsed = new URL(url);
    requestedPrefix = parsed.searchParams.get('path_prefix');
    return new Response(JSON.stringify({ memories: [{ id: 'm1', path: '[ROOT]/Projects/Demo' }], total: 1 }), { status: 200 });
  });

  const code = await run(['memory', 'list', '--exact-path', '--path-prefix', '[ROOT]/Projects/Demo', '--json'], io);
  assert.equal(code, 0);
  assert.equal(requestedPrefix, '[ROOT]/Projects/Demo');
});

test('CLI-DOGFOOD 5-3: memory list falls back to bounded paging and client matching when fast try returns 0', async () => {
  let requestCount = 0;
  const io = makeIo(async (url) => {
    const parsed = new URL(url);
    requestCount += 1;
    if (parsed.searchParams.has('path_prefix')) {
      // Fast try with prefix returns 0 results
      return new Response(JSON.stringify({ memories: [], total: 0 }), { status: 200 });
    }
    // Fallback scan returns memories with varying casing/ROOT
    return new Response(JSON.stringify({
      memories: [
        { id: '1', path: '[ROOT]/Projects / Xmemo / Spec.md', content: 'Architecture' },
        { id: '2', path: 'other/path', content: 'Other' }
      ],
      total: 2
    }), { status: 200 });
  });

  const code = await run(['memory', 'list', '--path-prefix', 'projects/xmemo', '--json'], io);
  assert.equal(code, 0);
  assert.equal(requestCount, 2); // 1 fast try + 1 fallback request
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.data.items.length, 1);
  assert.equal(envelope.data.items[0].id, '1');
});

test('CLI-DOGFOOD 5-4: memory list --query and --type filter results client-side', async () => {
  const io = makeIo(async () => {
    return new Response(JSON.stringify({
      memories: [
        { id: '1', path: 'a', content: 'important dogfood note', memory_type: 'working' },
        { id: '2', path: 'b', content: 'unrelated note', memory_type: 'working' },
        { id: '3', path: 'c', content: 'dogfood note in fact memory', memory_type: 'fact' }
      ],
      total: 3
    }), { status: 200 });
  });

  // Filter by query and type
  const code = await run(['memory', 'list', '--query', 'dogfood', '--type', 'working', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.data.items.length, 1);
  assert.equal(envelope.data.items[0].id, '1');
});

test('CLI-DOGFOOD 5-5: memory list rejects conflicting options', async () => {
  const ioA = makeIo(async () => new Response('{}', { status: 200 }));
  const codeA = await run(['memory', 'list', '--path-prefix', 'a', '--project', 'b', '--json'], ioA);
  assert.notEqual(codeA, 0);
  assert.match(JSON.parse(ioA.stdout.value).error.message, /Cannot supply both --path-prefix and --project/);

  const ioB = makeIo(async () => new Response('{}', { status: 200 }));
  const codeB = await run(['memory', 'list', '--query', 'foo', '--filter', 'bar', '--json'], ioB);
  assert.notEqual(codeB, 0);
  assert.match(JSON.parse(ioB.stdout.value).error.message, /Cannot supply both --query and --filter/);
});

// 6. Memory List Auto-Paging (--all)
test('CLI-DOGFOOD 6-1: memory list --all auto-pages with page size 500 up to cap and reports progress on stderr in human mode', async () => {
  let callCount = 0;
  const ioHuman = makeIo(async (url) => {
    const parsed = new URL(url);
    callCount += 1;
    const offset = parseInt(parsed.searchParams.get('offset') || '0', 10);
    assert.equal(parsed.searchParams.get('limit'), '500');
    if (offset === 0) {
      const page1 = Array.from({ length: 500 }, (_, i) => ({ id: `mem-${i}`, path: 'p', content: `item ${i}` }));
      return new Response(JSON.stringify({ memories: page1, total: 600 }), { status: 200 });
    }
    const page2 = Array.from({ length: 100 }, (_, i) => ({ id: `mem-${500 + i}`, path: 'p', content: `item ${500 + i}` }));
    return new Response(JSON.stringify({ memories: page2, total: 600 }), { status: 200 });
  });

  const code = await run(['memory', 'list', '--all'], ioHuman);
  assert.equal(code, 0);
  assert.equal(callCount, 2);
  assert.match(ioHuman.stderr.value, /Fetching memories/);

  // In JSON mode, stderr must not receive progress
  const ioJson = makeIo(async (url) => {
    const parsed = new URL(url);
    const offset = parseInt(parsed.searchParams.get('offset') || '0', 10);
    if (offset === 0) {
      return new Response(JSON.stringify({ memories: [{ id: '1', path: 'p', content: 'c' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ memories: [] }), { status: 200 });
  });

  const codeJson = await run(['memory', 'list', '--all', '--json'], ioJson);
  assert.equal(codeJson, 0);
  assert.equal(ioJson.stderr.value, '');
});

// 7. Search Boost CLI Execution
test('CLI-DOGFOOD 7-1: memory search --keyword and --exact apply deterministic client reranking', async () => {
  const io = makeIo(async () => {
    return new Response(JSON.stringify({
      results: [
        { memory_id: 'm1', content: 'contains only testing keyword' },
        { memory_id: 'm2', content: 'contains the exact phrase for dogfood here' },
        { memory_id: 'm3', content: 'contains both dogfood and testing keywords' }
      ]
    }), { status: 200 });
  });

  const code = await run(['memory', 'search', 'test', '--keyword', 'dogfood testing', '--exact', 'exact phrase for dogfood', '--json'], io);
  assert.equal(code, 0);
  const envelope = JSON.parse(io.stdout.value);
  assert.equal(envelope.data.items[0].memory_id, 'm2'); // exact phrase
  assert.equal(envelope.data.items[1].memory_id, 'm3'); // 2 keyword hits
  assert.equal(envelope.data.items[2].memory_id, 'm1'); // 1 keyword hit
});

// 8. EPIPE Safety
test('CLI-DOGFOOD 8-1: writeLine suppresses EPIPE cleanly', () => {
  const brokenStream = {
    write() {
      const err = new Error('broken pipe');
      err.code = 'EPIPE';
      throw err;
    }
  };
  assert.doesNotThrow(() => writeLine(brokenStream, 'test'));
});
