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

test('memory search without time filters leaves request unchanged', async () => {
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ memory_id: 'mem-1', content: 'note' }]), { status: 200 });
  });

  const code = await run(['memory', 'search', 'plain query', '--limit', '10', '--json'], io);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  const parsedUrl = new URL(calls[0].url);
  assert.equal(parsedUrl.pathname, '/api/v1/recall');
  assert.equal(parsedUrl.searchParams.get('query'), 'plain query');
  assert.equal(parsedUrl.searchParams.get('limit'), '10');
  assert.equal(parsedUrl.searchParams.has('since'), false);
  assert.equal(parsedUrl.searchParams.has('until'), false);
  assert.equal(parsedUrl.searchParams.has('time_order'), false);
  assert.equal(parsedUrl.searchParams.has('owner_timezone'), false);
  assert.equal(parsedUrl.searchParams.has('reference_time'), false);
});

test('context recall without time filters leaves request unchanged', async () => {
  let request;
  const io = makeIo(async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ context_text: 'sample', items: [] }), { status: 200 });
  });

  const code = await run(['context', 'recall', 'plain recall', '--max-items', '5', '--json'], io);
  assert.equal(code, 0);
  assert.ok(request);
  const body = JSON.parse(request.init.body);
  assert.equal(body.query, 'plain recall');
  assert.equal(body.max_items, 5);
  assert.equal(body.include_knowledge, undefined);
  assert.equal(body.since, undefined);
  assert.equal(body.until, undefined);
  assert.equal(body.time_order, undefined);
  assert.equal(body.owner_timezone, undefined);
  assert.equal(body.reference_time, undefined);
  assert.equal(body.hypothetical_answer, undefined);
});

test('memory search forwards time filter options to recall GET query', async () => {
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ memory_id: 'mem-1', content: 'synthetic note' }]), { status: 200 });
  });

  const code = await run([
    'memory', 'search', 'query text',
    '--since', '2026-09-01T00:00:00Z',
    '--until', '2026-09-10T23:59:59+09:00',
    '--time-order', 'desc',
    '--owner-timezone', 'Asia/Tokyo',
    '--reference-time', '2026-09-15T12:00:00Z',
    '--json'
  ], io);

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  const parsedUrl = new URL(calls[0].url);
  assert.equal(parsedUrl.pathname, '/api/v1/recall');
  assert.equal(parsedUrl.searchParams.get('query'), 'query text');
  assert.equal(parsedUrl.searchParams.get('since'), '2026-09-01T00:00:00Z');
  assert.equal(parsedUrl.searchParams.get('until'), '2026-09-10T23:59:59+09:00');
  assert.equal(parsedUrl.searchParams.get('time_order'), 'desc');
  assert.equal(parsedUrl.searchParams.get('owner_timezone'), 'Asia/Tokyo');
  assert.equal(parsedUrl.searchParams.get('reference_time'), '2026-09-15T12:00:00Z');
});

test('memory search accepts snake_case aliases for time filter options', async () => {
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ memory_id: 'mem-2', content: 'note' }]), { status: 200 });
  });

  const code = await run([
    'memory', 'search', 'query text',
    '--time_order', 'asc',
    '--owner_timezone', 'UTC',
    '--reference_time', '2026-10-01T00:00:00Z',
    '--json'
  ], io);

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  const parsedUrl = new URL(calls[0].url);
  assert.equal(parsedUrl.searchParams.get('time_order'), 'asc');
  assert.equal(parsedUrl.searchParams.get('owner_timezone'), 'UTC');
  assert.equal(parsedUrl.searchParams.get('reference_time'), '2026-10-01T00:00:00Z');
});

test('memory search passes arbitrary reference-time string through without RFC 3339 constraint', async () => {
  const calls = [];
  const io = makeIo(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([]), { status: 200 });
  });

  const code = await run(['memory', 'search', 'query', '--reference-time', 'yesterday', '--json'], io);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('reference_time'), 'yesterday');
});

test('memory search reads time filter options from JSON input', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-time-input-'));
  const inputPath = path.join(tempDir, 'search-input.json');
  try {
    await fs.writeFile(inputPath, JSON.stringify({
      query: 'search from input',
      since: '2026-08-01T00:00:00Z',
      until: '2026-08-15T00:00:00Z',
      time_order: 'desc',
      owner_timezone: 'America/New_York',
      reference_time: '2026-08-20T00:00:00Z'
    }));

    const calls = [];
    const io = makeIo(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const code = await run(['memory', 'search', '--input', inputPath, '--json'], io);
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    const parsedUrl = new URL(calls[0].url);
    assert.equal(parsedUrl.searchParams.get('query'), 'search from input');
    assert.equal(parsedUrl.searchParams.get('since'), '2026-08-01T00:00:00Z');
    assert.equal(parsedUrl.searchParams.get('until'), '2026-08-15T00:00:00Z');
    assert.equal(parsedUrl.searchParams.get('time_order'), 'desc');
    assert.equal(parsedUrl.searchParams.get('owner_timezone'), 'America/New_York');
    assert.equal(parsedUrl.searchParams.get('reference_time'), '2026-08-20T00:00:00Z');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('memory search rejects invalid RFC 3339 timestamps locally without network', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('[]'); });

  // Missing offset
  const code1 = await run(['memory', 'search', 'query', '--since', '2026-09-01T00:00:00', '--json'], io);
  assert.equal(code1, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /must be an RFC 3339 timestamp with a timezone offset/);

  // Invalid leap day (2025 is not leap year)
  io.stdout.value = '';
  const code2 = await run(['memory', 'search', 'query', '--until', '2025-02-29T00:00:00Z', '--json'], io);
  assert.equal(code2, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /must be an RFC 3339 timestamp with a timezone offset/);
});

test('memory search rejects until equal to or earlier than since', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('[]'); });

  // until earlier than since
  const code1 = await run([
    'memory', 'search', 'query',
    '--since', '2026-09-10T00:00:00Z',
    '--until', '2026-09-01T00:00:00Z',
    '--json'
  ], io);
  assert.equal(code1, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--until must be later than --since/);

  // until equal to since
  io.stdout.value = '';
  const code2 = await run([
    'memory', 'search', 'query',
    '--since', '2026-09-10T00:00:00Z',
    '--until', '2026-09-10T00:00:00Z',
    '--json'
  ], io);
  assert.equal(code2, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--until must be later than --since/);
});

test('memory search rejects invalid time_order value', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('[]'); });

  const code = await run(['memory', 'search', 'query', '--time-order', 'invalid-order', '--json'], io);
  assert.equal(code, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--time_order must be desc or asc/);
});

test('memory search rejects empty owner-timezone or reference-time', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('[]'); });

  const code1 = await run(['memory', 'search', 'query', '--owner-timezone', '   ', '--json'], io);
  assert.equal(code1, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--owner-timezone cannot be empty/);

  io.stdout.value = '';
  const code2 = await run(['memory', 'search', 'query', '--reference-time', '   ', '--json'], io);
  assert.equal(code2, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--reference-time cannot be empty/);
});

test('memory search rejects simultaneous camel and snake flag aliases', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('[]'); });

  const code1 = await run([
    'memory', 'search', 'query',
    '--time_order', 'desc',
    '--time-order', 'asc',
    '--json'
  ], io);
  assert.equal(code1, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Cannot specify both --time_order and --time-order/);

  io.stdout.value = '';
  const code2 = await run([
    'memory', 'search', 'query',
    '--owner_timezone', 'UTC',
    '--owner-timezone', 'Asia/Tokyo',
    '--json'
  ], io);
  assert.equal(code2, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Cannot specify both --owner_timezone and --owner-timezone/);

  io.stdout.value = '';
  const code3 = await run([
    'memory', 'search', 'query',
    '--reference_time', 'now',
    '--reference-time', 'yesterday',
    '--json'
  ], io);
  assert.equal(code3, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Cannot specify both --reference_time and --reference-time/);
});

test('memory search rejects conflict between CLI option and input field', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-conflict-'));
  const inputPath = path.join(tempDir, 'conflict.json');
  try {
    await fs.writeFile(inputPath, JSON.stringify({ time_order: 'desc' }));
    let calls = 0;
    const io = makeIo(async () => { calls += 1; return new Response('[]'); });

    const code = await run(['memory', 'search', 'query', '--time-order', 'asc', '--input', inputPath, '--json'], io);
    assert.equal(code, 2);
    assert.equal(calls, 0);
    assert.match(JSON.parse(io.stdout.value).error.message, /conflicts with command option/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('memory search rejects hypothetical-answer option', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('[]'); });

  const code = await run(['memory', 'search', 'query', '--hypothetical-answer', 'text', '--json'], io);
  assert.equal(code, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Unsupported option: --hypothetical-answer/);
});

test('context recall forwards all 6 time filter fields in POST body', async () => {
  let request;
  const io = makeIo(async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ context_text: 'sample context', items: [] }), { status: 200 });
  });

  const code = await run([
    'context', 'recall', 'query text',
    '--since', '2026-09-01T00:00:00Z',
    '--until', '2026-09-10T23:59:59+09:00',
    '--time-order', 'desc',
    '--owner-timezone', 'Asia/Tokyo',
    '--reference-time', 'arbitrary reference time text',
    '--hypothetical-answer', 'A likely memory about project setup.',
    '--json'
  ], io);

  assert.equal(code, 0);
  assert.ok(request);
  assert.equal(new URL(request.url).pathname, '/api/v1/recall/context');
  const body = JSON.parse(request.init.body);
  assert.equal(body.query, 'query text');
  assert.equal(body.since, '2026-09-01T00:00:00Z');
  assert.equal(body.until, '2026-09-10T23:59:59+09:00');
  assert.equal(body.time_order, 'desc');
  assert.equal(body.owner_timezone, 'Asia/Tokyo');
  assert.equal(body.reference_time, 'arbitrary reference time text');
  assert.equal(body.hypothetical_answer, 'A likely memory about project setup.');
});

test('context recall normalizes kebab-case input fields and removes them from body', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-context-kebab-'));
  const inputPath = path.join(tempDir, 'context.json');
  try {
    await fs.writeFile(inputPath, JSON.stringify({
      query: 'recall query',
      'time-order': 'asc',
      'owner-timezone': 'UTC',
      'reference-time': '2026-10-01T00:00:00Z',
      'hypothetical-answer': 'Guiding hypothesis text.'
    }));

    let request;
    const io = makeIo(async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ context_text: 'sample', items: [] }), { status: 200 });
    });

    const code = await run(['context', 'recall', '--input', inputPath, '--json'], io);
    assert.equal(code, 0);
    assert.ok(request);
    const body = JSON.parse(request.init.body);
    assert.equal(body.time_order, 'asc');
    assert.equal(body.owner_timezone, 'UTC');
    assert.equal(body.reference_time, '2026-10-01T00:00:00Z');
    assert.equal(body.hypothetical_answer, 'Guiding hypothesis text.');
    // Kebab keys must be stripped for server Pydantic extra=forbid compatibility
    assert.equal(body['time-order'], undefined);
    assert.equal(body['owner-timezone'], undefined);
    assert.equal(body['reference-time'], undefined);
    assert.equal(body['hypothetical-answer'], undefined);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('context recall negative validation rejects invalid inputs locally with zero network calls', async () => {
  let calls = 0;
  const io = makeIo(async () => { calls += 1; return new Response('{}'); });

  // 1. Invalid RFC 3339 on --since
  const code1 = await run(['context', 'recall', 'query', '--since', '2026-09-01T00:00:00', '--json'], io);
  assert.equal(code1, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /must be an RFC 3339 timestamp with a timezone offset/);

  // 2. Invalid leap day on --until
  io.stdout.value = '';
  const code2 = await run(['context', 'recall', 'query', '--until', '2025-02-29T00:00:00Z', '--json'], io);
  assert.equal(code2, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /must be an RFC 3339 timestamp with a timezone offset/);

  // 3. until earlier than since
  io.stdout.value = '';
  const code3 = await run([
    'context', 'recall', 'query',
    '--since', '2026-09-10T00:00:00Z',
    '--until', '2026-09-01T00:00:00Z',
    '--json'
  ], io);
  assert.equal(code3, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--until must be later than --since/);

  // 4. until equal to since
  io.stdout.value = '';
  const code4 = await run([
    'context', 'recall', 'query',
    '--since', '2026-09-10T00:00:00Z',
    '--until', '2026-09-10T00:00:00Z',
    '--json'
  ], io);
  assert.equal(code4, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--until must be later than --since/);

  // 5. Invalid time_order
  io.stdout.value = '';
  const code5 = await run(['context', 'recall', 'query', '--time-order', 'random-order', '--json'], io);
  assert.equal(code5, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--time_order must be desc or asc/);

  // 6. Empty owner-timezone
  io.stdout.value = '';
  const code6 = await run(['context', 'recall', 'query', '--owner-timezone', '   ', '--json'], io);
  assert.equal(code6, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--owner-timezone cannot be empty/);

  // 7. Empty reference-time
  io.stdout.value = '';
  const code7 = await run(['context', 'recall', 'query', '--reference-time', '   ', '--json'], io);
  assert.equal(code7, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--reference-time cannot be empty/);

  // 8. Empty hypothetical-answer
  io.stdout.value = '';
  const code8 = await run(['context', 'recall', 'query', '--hypothetical-answer', '   ', '--json'], io);
  assert.equal(code8, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /--hypothetical-answer cannot be empty/);

  // 9. Simultaneous camel and snake hypothetical answer flags
  io.stdout.value = '';
  const code9 = await run([
    'context', 'recall', 'query',
    '--hypothetical-answer', 'first',
    '--hypothetical_answer', 'second',
    '--json'
  ], io);
  assert.equal(code9, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Cannot specify both --hypothetical_answer and --hypothetical-answer/);

  // 10. Simultaneous time-order and time_order
  io.stdout.value = '';
  const code10 = await run([
    'context', 'recall', 'query',
    '--time_order', 'desc',
    '--time-order', 'asc',
    '--json'
  ], io);
  assert.equal(code10, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Cannot specify both --time_order and --time-order/);

  // 11. Simultaneous owner-timezone and owner_timezone
  io.stdout.value = '';
  const code11 = await run([
    'context', 'recall', 'query',
    '--owner_timezone', 'UTC',
    '--owner-timezone', 'Asia/Tokyo',
    '--json'
  ], io);
  assert.equal(code11, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Cannot specify both --owner_timezone and --owner-timezone/);

  // 12. Simultaneous reference-time and reference_time
  io.stdout.value = '';
  const code12 = await run([
    'context', 'recall', 'query',
    '--reference_time', 'now',
    '--reference-time', 'yesterday',
    '--json'
  ], io);
  assert.equal(code12, 2);
  assert.equal(calls, 0);
  assert.match(JSON.parse(io.stdout.value).error.message, /Cannot specify both --reference_time and --reference-time/);
});

test('context recall rejects conflict between CLI option and input field', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-context-conflict-'));
  const inputPath = path.join(tempDir, 'conflict.json');
  try {
    await fs.writeFile(inputPath, JSON.stringify({ hypothetical_answer: 'from json' }));
    let calls = 0;
    const io = makeIo(async () => { calls += 1; return new Response('{}'); });

    const code = await run(['context', 'recall', 'query', '--hypothetical-answer', 'from cli', '--input', inputPath, '--json'], io);
    assert.equal(code, 2);
    assert.equal(calls, 0);
    assert.match(JSON.parse(io.stdout.value).error.message, /conflicts with command option/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
