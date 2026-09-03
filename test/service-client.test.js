import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createServiceClient, assertServiceOrigin } from '../src/api/client.js';
import { ContractRequiredError, InterruptedError, UnknownOutcomeError } from '../src/api/errors.js';
import { rejectInputFlagConflicts, readJsonInput } from '../src/api/input.js';
import { createReadReceipt, readAndValidateReceipt } from '../src/api/read-receipt.js';
import { serviceHelpSchema } from '../src/api/contracts/help-schema.js';
import { serviceContext } from '../src/api/service-context.js';
import { collectSkillFiles } from '../src/api/upload-input.js';

function ioWith(fetch) {
  return { fetch, env: {}, stdin: { async *[Symbol.asyncIterator]() {} } };
}

test('CLI-01 accepts HTTPS and loopback HTTP only', () => {
  assert.equal(assertServiceOrigin('https://api.example.test/'), 'https://api.example.test');
  assert.equal(assertServiceOrigin('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.throws(() => assertServiceOrigin('http://api.example.test'), /HTTPS/);
  assert.throws(() => assertServiceOrigin('https://api.example.test/?target=other'), /query parameters/);
  assert.throws(() => assertServiceOrigin('https://api.example.test/#fragment'), /fragments/);
});

test('CLI-01 sends auth only to the configured origin and parses one JSON response', async () => {
  const requests = [];
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    io: ioWith(async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ memory_id: 'mem-1', content: 'synthetic' }), { status: 201 });
    })
  });
  const result = await client.request({ method: 'POST', path: '/api/v1/remember', body: { content: 'synthetic', path: 'test' }, sideEffect: true });
  assert.equal(result.status, 201);
  assert.equal(result.data.memory_id, 'mem-1');
  assert.equal(new URL(requests[0].url).origin, 'https://api.example.test');
  assert.equal(requests[0].init.headers.authorization, 'Bearer synthetic-token-value');
  assert.equal(requests[0].init.redirect, 'error');
});

test('CLI-01 retries bounded read-only POST requests but never side effects', async () => {
  let calls = 0;
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    io: ioWith(async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ detail: 'busy' }), { status: 503 })
        : new Response(JSON.stringify({ results: [] }), { status: 200 });
    })
  });
  const result = await client.request({ method: 'POST', path: '/api/v1/knowledge/search', body: { query: 'test' }, sideEffect: false, retry: 'bounded' });
  assert.deepEqual(result.data, { results: [] });
  assert.equal(calls, 2);
});

test('CLI-02 rejects credential-file origin mismatch and provides migration boundary', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-origin-'));
  await fs.writeFile(path.join(tempDir, 'credentials.json'), JSON.stringify({
    token: 'synthetic-token-value',
    metadata: { baseUrl: 'https://trusted.example.test' }
  }));
  await assert.rejects(
    () => serviceContext(['--base-url', 'https://attacker.example.test'], {
      env: { XMEMO_CONFIG_HOME: tempDir },
      fetch: async () => new Response('{}')
    }),
    (error) => error.code === 'CREDENTIAL_ORIGIN_MISMATCH' && error.httpStatus === 401
  );
});

test('CLI-01 does not retry a side-effect request and reports unknown outcome on timeout', async () => {
  let calls = 0;
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    timeoutMs: 5,
    io: ioWith(async (_url, init) => {
      calls += 1;
      await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    })
  });
  await assert.rejects(
    client.request({ method: 'POST', path: '/api/v1/remember', body: {}, sideEffect: true }),
    (error) => error instanceof UnknownOutcomeError && error.outcome === 'unknown'
  );
  assert.equal(calls, 1);
});

test('CLI-01 treats server errors after a side-effect request as an unknown outcome', async () => {
  let calls = 0;
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    io: ioWith(async () => {
      calls += 1;
      return new Response(JSON.stringify({ detail: 'upstream failed after dispatch' }), { status: 503 });
    })
  });
  await assert.rejects(
    client.request({ method: 'POST', path: '/api/v1/remember', body: {}, sideEffect: true, retry: 'bounded' }),
    (error) => error instanceof UnknownOutcomeError && error.httpStatus === 503 && error.outcome === 'unknown'
  );
  assert.equal(calls, 1);
});

test('CLI-02 rejects malformed stored credential origins without sending a token', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-invalid-origin-'));
  await fs.writeFile(path.join(tempDir, 'credentials.json'), JSON.stringify({
    token: 'synthetic-token-value',
    metadata: { baseUrl: 'not-a-service-url' }
  }));
  let calls = 0;
  await assert.rejects(
    () => serviceContext([], {
      env: { XMEMO_CONFIG_HOME: tempDir },
      fetch: async () => { calls += 1; return new Response('{}'); }
    }),
    (error) => error.code === 'CREDENTIAL_ORIGIN_INVALID' && error.httpStatus === 401
  );
  assert.equal(calls, 0);
});

test('CLI-01 distinguishes a local read interruption from an unknown write outcome', async () => {
  const controller = new AbortController();
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    io: { ...ioWith(async (_url, init) => {
      await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }), signal: controller.signal }
  });
  const request = client.request({ method: 'GET', path: '/api/v1/recall', sideEffect: false });
  controller.abort();
  await assert.rejects(request, (error) => error instanceof InterruptedError && error.code === 'INTERRUPTED');
});

test('CLI-01 marks a missing contract without falling back to legacy write routes', async () => {
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    io: ioWith(async () => new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
  });
  await assert.rejects(
    client.request({ method: 'POST', path: '/v1/skills/create', body: {}, sideEffect: true, operation: { contractRequired: true, name: 'cloud-skill.add' } }),
    (error) => error instanceof ContractRequiredError && error.code === 'SERVER_CONTRACT_REQUIRED'
  );
});

test('CLI-01 recursively redacts sensitive fields in service error data', async () => {
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    io: ioWith(async () => new Response(JSON.stringify({ detail: { message: 'denied', nested: { access_token: 'do-not-leak', safe: 'keep' } }, items: [{ secret: 'also-hide', id: 'item-1' }] }), { status: 403 }))
  });
  await assert.rejects(
    client.request({ method: 'GET', path: '/api/v1/recall' }),
    (error) => error.data.detail.nested.access_token === undefined
      && error.data.detail.nested.safe === 'keep'
      && error.data.items[0].secret === undefined
  );
});

test('CLI-01 gives document scope failures a precise reauthorization action', async () => {
  const client = createServiceClient({
    baseUrl: 'https://api.example.test',
    token: 'synthetic-token-value',
    io: ioWith(async () => new Response(JSON.stringify({ detail: { code: 'memory_write_scope_required', message: 'document upload requires memory:write' } }), { status: 403 }))
  });
  await assert.rejects(
    client.request({ method: 'POST', path: '/api/v1/documents', body: {}, sideEffect: true }),
    (error) => error.nextAction === '重新授权：xmemo login --scopes knowledge:write,memory:write。'
  );
});

test('CLI-01 rejects duplicate flag and JSON input fields', () => {
  assert.throws(() => rejectInputFlagConflicts({ title: 'from-json' }, [['--title', 'title']]), /conflicts/);
});

test('CLI-01 accepts UTF-8 BOM JSON input', async () => {
  const io = { stdin: { async *[Symbol.asyncIterator]() { yield '\ufeff{"query":"中文"}'; } } };
  assert.deepEqual(await readJsonInput(['--input', '-'], io), { query: '中文' });
});

test('CLI-01 accepts Windows PowerShell UTF-16LE JSON files and receipts', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-utf16-'));
  const inputPath = path.join(tempDir, 'input.json');
  const receiptPath = path.join(tempDir, 'view.json');
  await fs.writeFile(inputPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"query":"中文"}', 'utf16le')]));
  await fs.writeFile(receiptPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify({ schemaVersion: '1', serviceOrigin: 'https://api.example.test', resource: 'item-1', scope: 'personal', displayedRevision: 'rev-1' }), 'utf16le')]));
  assert.deepEqual(await readJsonInput(['--input', inputPath], { stdin: null }), { query: '中文' });
  const receipt = await readAndValidateReceipt(receiptPath, { baseUrl: 'https://api.example.test', resource: 'item-1', scope: 'personal' });
  assert.equal(receipt.schemaVersion, '1');
});

test('CLI-07 Cloud Skill directory input rejects secret-looking and binary files', async () => {
  const secretDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-secret-skill-'));
  await fs.writeFile(path.join(secretDir, 'SKILL.md'), '# Safe root\n');
  await fs.writeFile(path.join(secretDir, '.env'), 'TOKEN=must-not-leave-disk\n');
  await assert.rejects(() => collectSkillFiles(secretDir), /sensitive-looking/);

  const binaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-cli-binary-skill-'));
  await fs.writeFile(path.join(binaryDir, 'SKILL.md'), '# Safe root\n');
  await fs.writeFile(path.join(binaryDir, 'asset.bin'), Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(() => collectSkillFiles(binaryDir), /valid UTF-8/);
});

test('CLI-01 receipt binds origin and resource without credentials', async () => {
  const receipt = createReadReceipt({ baseUrl: 'https://api.example.test', resource: 'item-1', scope: 'personal', revision: 'rev-1', content: 'synthetic' });
  assert.equal(receipt.serviceOrigin, 'https://api.example.test');
  assert.equal(receipt.resource, 'item-1');
  assert.equal(Object.hasOwn(receipt, 'token'), false);
  await assert.rejects(() => readAndValidateReceipt('missing-receipt.json', { baseUrl: 'https://api.example.test' }), /Could not read receipt/);
});

test('CLI-01 help schema exposes registry metadata without advanced command menus', () => {
  const schema = serviceHelpSchema('knowledge.search');
  assert.equal(schema.sideEffect, false);
  assert.equal(schema.path, '/api/v1/knowledge/search');
  assert.equal(schema.options['--json'].type, 'boolean');
  assert.equal(serviceHelpSchema('revision.list'), null);
});

test('CLI-01 knowledge document help declares its conditional memory scope', () => {
  const schema = serviceHelpSchema('knowledge.add');
  assert.deepEqual(schema.conditionalScopes, ['memory:write', 'memory:read', 'knowledge:read']);
  assert.match(schema.scopeNotes[0], /Document upload/);
});
