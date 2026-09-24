import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.js';

function ioFor(handler) {
  const stream = () => ({ value: '', write(s) { this.value += s; } });
  return { env: { XMEMO_KEY: 'synthetic', XMEMO_BASE_URL: 'https://example.test' },
    stdout: stream(), stderr: stream(), stdin: {}, fetch: async (url, init) => new Response(JSON.stringify(await handler(url, init)), { status: 200 }) };
}

test('literal list prefix and bounded pagination use public API', async () => {
  const io = ioFor((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/v1/memories');
    assert.equal(parsed.searchParams.get('path_prefix'), '中文_%\\');
    assert.equal(parsed.searchParams.get('offset'), '2');
    return { memories: [], total: 2 };
  });
  assert.equal(await run(['memory','list','--path-prefix','中文_%\\','--offset','2','--json'], io), 0);
});

test('xmemo memory export is rejected as unknown subcommand with zero network requests', async () => {
  const io = ioFor(() => { throw new Error('must not call network'); });
  const code = await run(['memory', 'export', '--json'], io);
  assert.equal(code, 2);
  const output = JSON.parse(io.stdout.value);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'INPUT_ERROR');
  assert.match(output.error.message, /Unknown memory command: export/);
});

test('import preserves dry-run and idempotency across pages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr179-'));
  const file = path.join(dir, 'memories.jsonl');
  try {
    await fs.writeFile(file, '{"content":"中文"}\n{"content":"second"}\n');
    let count = 0;
    const io = ioFor((url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.dry_run, true);
      assert.equal(body.bucket, 'private');
      assert.equal(body.idempotency_key, 'test-import');
      assert.equal(body.cursor, count);
      return { next_cursor: count++ === 0 ? 1 : null, errors: [] };
    });
    assert.equal(await run(['memory','import','--file',file,'--dry-run','--idempotency-key','test-import','--json'], io), 0);
    assert.equal(count, 2);
    await fs.writeFile(file, '{broken');
    assert.notEqual(await run(['memory','import','--file',file,'--dry-run','--json'], ioFor(() => { throw Error('must not call'); })), 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('nonadvancing cursor fails rather than looping', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr179-'));
  const file = path.join(dir, 'memories.jsonl');
  try {
    await fs.writeFile(file, '{"content":"test"}\n');
    const io = ioFor(() => ({ next_cursor: 0, errors: [] }));
    assert.notEqual(await run(['memory','import','--file',file,'--dry-run','--json'], io), 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('ledger deletion sends exact alias and requires confirmation', async () => {
  const io = ioFor((url, init) => {
    assert.equal(new URL(url).pathname, '/v1/skill/operations');
    assert.deepEqual(JSON.parse(init.body), { operation: 'ledger-delete', arguments: { id: '00000000-0000-4000-8000-000000000001' } });
    return { ok: true, result: { status: 'deleted' } };
  });
  assert.equal(await run(['memory','ledger-delete','--id','00000000-0000-4000-8000-000000000001','--yes','--json'], io), 0);
});
