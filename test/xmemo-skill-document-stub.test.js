import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

import {
  isDocumentStub,
  buildNextCommand,
  processDocumentStubs,
  MAX_EXPAND_DOCUMENTS,
  MAX_EXPAND_CHARS,
} from '../skills/xmemo/scripts/lib/document-stub.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');

function createMockServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      });
      handler(req, res, requests[requests.length - 1]);
    });
  });

  return {
    requests,
    start: () => new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      server.on('error', reject);
    }),
    stop: () => new Promise(resolve => server.close(resolve)),
  };
}

async function runCli(args, { homeDir, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const childEnv = {
      ...process.env,
      HOME: homeDir || process.env.HOME,
      USERPROFILE: homeDir || process.env.USERPROFILE,
      XMEMO_FORCE_TTY: '1',
      ...env,
    };

    const child = spawn(process.execPath, [skillScript, ...args], {
      env: childEnv,
      cwd: repoRoot,
    });

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('document-stub: isDocumentStub correctly identifies stubs and ignores non-stubs', () => {
  // 1. metadata.document_ref as object
  assert.equal(isDocumentStub({
    id: 'm1',
    content: 'Title',
    metadata: { document_ref: { doc_id: 'd1' } },
  }), true);

  // 2. metadata.document_ref as JSON string
  assert.equal(isDocumentStub({
    id: 'm2',
    content: 'Title',
    metadata: JSON.stringify({ document_ref: { doc_id: 'd2' } }),
  }), true);

  // 3. Fallback: content starts with "Document-backed memory:"
  assert.equal(isDocumentStub({
    id: 'm3',
    content: 'Document-backed memory: architecture overview',
  }), true);

  // 4. Regular non-stub memory
  assert.equal(isDocumentStub({
    id: 'm4',
    content: 'Always prefer LF line endings in repo.',
    metadata: { tags: ['conventions'] },
  }), false);

  // 5. Edge cases: null, undefined, primitives
  assert.equal(isDocumentStub(null), false);
  assert.equal(isDocumentStub(undefined), false);
  assert.equal(isDocumentStub('Document-backed memory: foo'), false);
  assert.equal(isDocumentStub({}), false);
  assert.equal(isDocumentStub({ metadata: 'invalid-json' }), false);
});

test('document-stub: buildNextCommand generates exact read command', () => {
  assert.equal(buildNextCommand({ id: 'doc_123' }), 'node scripts/xmemo-skill.mjs read --id doc_123');
  assert.equal(buildNextCommand({ memory_id: 'mem_456' }), 'node scripts/xmemo-skill.mjs read --id mem_456');
});

test('CLI recall: terminal output prints Full document line for document stubs', async () => {
  const mockServer = createMockServer((req, res, reqInfo) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: [
          {
            id: 'stub_1',
            memory_id: 'mem_1',
            path: 'docs/design.md',
            content: 'Document-backed memory: System Architecture',
            metadata: { document_ref: { doc_id: 'doc_1' } },
          },
          {
            id: 'norm_2',
            memory_id: 'mem_2',
            path: 'notes/tip.md',
            content: 'Use npm test to run the suite.',
            metadata: {},
          },
        ],
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-test-'));

  try {
    const res = await runCli([
      'recall',
      '--query', 'architecture',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: 'test-token-formal' },
    });

    assert.equal(res.code, 0);
    assert.match(res.stdout, /\[1\] ID: stub_1 \| Path: docs\/design\.md/);
    assert.match(res.stdout, /Content: Document-backed memory: System Architecture/);
    assert.match(res.stdout, /Full document: node scripts\/xmemo-skill\.mjs read --id stub_1/);

    assert.match(res.stdout, /\[2\] ID: norm_2 \| Path: notes\/tip\.md/);
    assert.match(res.stdout, /Content: Use npm test to run the suite\./);
    // Non-stub should NOT have Full document:
    const linesAfterNorm2 = res.stdout.slice(res.stdout.indexOf('[2] ID: norm_2'));
    assert.doesNotMatch(linesAfterNorm2, /Full document:/);
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('CLI search --json: augments stubs with document_backed and next_command while preserving server fields', async () => {
  const mockServer = createMockServer((req, res) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: [
          {
            id: 'stub_1',
            memory_id: 'mem_1',
            path: 'docs/spec.md',
            content: 'Document-backed memory: Functional Spec',
            score: 0.95,
            metadata: { document_ref: { doc_id: 'spec_1' } },
          },
          {
            id: 'plain_2',
            memory_id: 'mem_2',
            path: 'notes/general.md',
            content: 'Just general notes.',
            score: 0.80,
          },
        ],
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-json-test-'));

  try {
    const res = await runCli([
      'search',
      '--query', 'spec',
      '--json',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: 'test-token-formal' },
    });

    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(Array.isArray(parsed.result), true);
    assert.equal(parsed.result.length, 2);

    const [stub, plain] = parsed.result;
    assert.equal(stub.id, 'stub_1');
    assert.equal(stub.memory_id, 'mem_1');
    assert.equal(stub.path, 'docs/spec.md');
    assert.equal(stub.score, 0.95);
    assert.equal(stub.document_backed, true);
    assert.equal(stub.next_command, 'node scripts/xmemo-skill.mjs read --id stub_1');

    assert.equal(plain.id, 'plain_2');
    assert.equal(plain.document_backed, undefined);
    assert.equal(plain.next_command, undefined);
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('CLI recall --expand-documents: replaces stub content with full text and marks expanded: true', async () => {
  const fullDocumentText = 'This is the comprehensive full text of the architecture specification document.';
  let explainCalled = false;

  const mockServer = createMockServer((req, res) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: [
          {
            id: 'stub_exp',
            path: 'docs/arch.md',
            content: 'Document-backed memory: Architecture',
            metadata: { document_ref: { doc_id: 'doc_arch' } },
          },
        ],
      }));
      return;
    }

    if (req.url.startsWith('/v1/memories/stub_exp/explain') && req.method === 'GET') {
      explainCalled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        memory: {
          id: 'stub_exp',
          content: fullDocumentText,
        },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-expand-'));

  try {
    const res = await runCli([
      'recall',
      '--query', 'architecture',
      '--expand-documents',
      '--json',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: 'test-token-formal' },
    });

    assert.equal(res.code, 0);
    assert.equal(explainCalled, true);
    const parsed = JSON.parse(res.stdout);
    const item = parsed.result[0];

    assert.equal(item.content, fullDocumentText);
    assert.equal(item.expanded, true);
    assert.equal(item.document_backed, true);
    assert.equal(item.next_command, undefined);
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('CLI recall --expand-documents: caps document content at 20,000 characters and retains next_command', async () => {
  const hugeDocumentText = 'A'.repeat(25000);

  const mockServer = createMockServer((req, res) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: [
          {
            id: 'stub_huge',
            path: 'docs/huge.md',
            content: 'Document-backed memory: Huge Document',
            metadata: { document_ref: { doc_id: 'huge_1' } },
          },
        ],
      }));
      return;
    }

    if (req.url.startsWith('/v1/memories/stub_huge/explain') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        record: {
          id: 'stub_huge',
          content: hugeDocumentText,
        },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-huge-'));

  try {
    const res = await runCli([
      'recall',
      '--query', 'huge',
      '--expand-documents',
      '--json',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: 'test-token-formal' },
    });

    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    const item = parsed.result[0];

    assert.equal(item.expanded, true);
    assert.equal(item.content_truncated, true);
    assert.equal(item.content.length, MAX_EXPAND_CHARS);
    assert.equal(item.next_command, 'node scripts/xmemo-skill.mjs read --id stub_huge');
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('CLI recall --expand-documents: limits expansion to MAX_EXPAND_DOCUMENTS (3)', async () => {
  let explainCount = 0;

  const mockServer = createMockServer((req, res) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      const items = [1, 2, 3, 4, 5].map(n => ({
        id: `stub_${n}`,
        content: `Document-backed memory: Document ${n}`,
        metadata: { document_ref: { doc_id: `doc_${n}` } },
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: items }));
      return;
    }

    if (req.url.startsWith('/v1/memories/stub_') && req.method === 'GET') {
      explainCount++;
      const idMatch = req.url.match(/\/v1\/memories\/(stub_\d+)\/explain/);
      const id = idMatch ? idMatch[1] : 'stub';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        record: { id, content: `Full text of ${id}` },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-max-'));

  try {
    const res = await runCli([
      'recall',
      '--query', 'multi',
      '--expand-documents',
      '--json',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: 'test-token-formal' },
    });

    assert.equal(res.code, 0);
    assert.equal(explainCount, MAX_EXPAND_DOCUMENTS);

    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.result.length, 5);

    // First 3 are expanded
    for (let i = 0; i < 3; i++) {
      assert.equal(parsed.result[i].expanded, true);
      assert.equal(parsed.result[i].content, `Full text of stub_${i + 1}`);
      assert.equal(parsed.result[i].next_command, undefined);
    }

    // 4th and 5th remain unexpanded stubs
    for (let i = 3; i < 5; i++) {
      assert.equal(parsed.result[i].expanded, undefined);
      assert.equal(parsed.result[i].document_backed, true);
      assert.equal(parsed.result[i].next_command, `node scripts/xmemo-skill.mjs read --id stub_${i + 1}`);
    }
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('CLI recall --expand-documents: retains stub and records expand_error on read failure (e.g. 404)', async () => {
  const mockServer = createMockServer((req, res) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: [
          {
            id: 'stub_missing',
            content: 'Document-backed memory: Missing Doc',
            metadata: { document_ref: { doc_id: 'missing_1' } },
          },
        ],
      }));
      return;
    }

    if (req.url.startsWith('/v1/memories/stub_missing/explain') && req.method === 'GET') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: { code: 'not_found', message: 'Document not found' },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-err-'));

  try {
    const res = await runCli([
      'recall',
      '--query', 'missing',
      '--expand-documents',
      '--json',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: 'test-token-formal' },
    });

    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    const item = parsed.result[0];

    // Original stub retained
    assert.equal(item.content, 'Document-backed memory: Missing Doc');
    assert.equal(item.document_backed, true);
    assert.equal(item.next_command, 'node scripts/xmemo-skill.mjs read --id stub_missing');
    assert.equal(item.expanded, undefined);
    assert.equal(item.expand_error, 'not_found');
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('CLI recall: detects stub from fallback content prefix without metadata.document_ref', async () => {
  const mockServer = createMockServer((req, res) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: [
          {
            id: 'stub_prefix_only',
            path: 'docs/guide.md',
            content: 'Document-backed memory: Guide to Microservices',
            metadata: null,
          },
        ],
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-pfx-'));

  try {
    const res = await runCli([
      'recall',
      '--query', 'guide',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: 'test-token-formal' },
    });

    assert.equal(res.code, 0);
    assert.match(res.stdout, /Full document: node scripts\/xmemo-skill\.mjs read --id stub_prefix_only/);
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('CLI recall (temporary credential): processDocumentStubs runs under temporary credential path', async () => {
  const mockServer = createMockServer((req, res) => {
    if (req.url === '/v1/skill/operations' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: [
          {
            id: 'stub_temp',
            path: 'docs/sandbox.md',
            content: 'Document-backed memory: Sandbox Documentation',
            metadata: { document_ref: { doc_id: 'sandbox_doc' } },
          },
        ],
      }));
      return;
    }

    if (req.url.startsWith('/v1/memories/stub_temp/explain') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        memory: {
          id: 'stub_temp',
          content: 'Full sandbox document content text.',
        },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
  });

  const port = await mockServer.start();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-stub-temp-cred-'));
  const credPath = path.join(tempHome, '.xmemo', 'skill-credentials.json');
  await fs.mkdir(path.dirname(credPath), { recursive: true });
  await fs.writeFile(credPath, JSON.stringify({
    schema_version: 1,
    storage: 'unencrypted_file_fallback',
    token: 'temp-sandbox-token',
    type: 'temporary',
  }), 'utf8');

  try {
    const res = await runCli([
      'recall',
      '--query', 'sandbox',
      '--expand-documents',
      '--json',
      '--base-url', `http://127.0.0.1:${port}`,
    ], {
      homeDir: tempHome,
      env: { XMEMO_KEY: '' },
    });

    assert.equal(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.result[0].expanded, true);
    assert.equal(parsed.result[0].content, 'Full sandbox document content text.');
    assert.equal(parsed.result[0].next_command, undefined);
  } finally {
    await mockServer.stop();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});
