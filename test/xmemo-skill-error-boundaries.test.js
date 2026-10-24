import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseJsonResponse } from '../skills/xmemo/scripts/lib/api.mjs';
import { exitCodeForError } from '../skills/xmemo/scripts/lib/core.mjs';

const script = new URL('../skills/xmemo/scripts/xmemo-skill.mjs', import.meta.url);

async function withServer(handler, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, body: body ? JSON.parse(body) : null });
      handler(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function runSkill(baseUrl, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(script), ...args], {
      env: { ...process.env, XMEMO_KEY: 'synthetic-boundary-test', XMEMO_BASE_URL: baseUrl, XMEMO_NO_UPDATE_CHECK: '1' },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('response parsing errors never exit successfully and preserve HTTP error classes', () => {
  for (const [statusCode, expected] of [[200, 3], [201, 3], [204, 3], [400, 1], [401, 2], [403, 2], [500, 3]]) {
    for (const body of ['', '<html>upstream failure</html>']) {
      assert.throws(() => parseJsonResponse({ statusCode, body }, 'probe'), (error) => {
        assert.equal(exitCodeForError(error), expected);
        return true;
      });
    }
  }
});

test('malformed HTTP 200 bodies fail actual memory and Cloud Skill commands', async () => {
  for (const body of ['', '<html>upstream failure</html>']) {
    await withServer((_req, res) => res.end(body), async (baseUrl) => {
      for (const args of [['recall', '--query', 'probe'], ['read', '--id', 'probe'], ['cloud-skill-list']]) {
        const result = await runSkill(baseUrl, [...args, '--json']);
        assert.equal(result.code, 3, JSON.stringify(result));
        assert.doesNotMatch(result.stdout, /"ok":true/);
        assert.match(result.stderr, /empty response|non-JSON response/);
      }
    });
  }
});

test('Cloud Skill components preserve failures and only accept valid empty arrays', async () => {
  const cases = [
    [401, { error: { code: 'unauthorized', message: 'denied' } }, 2],
    [403, { error: { code: 'forbidden', message: 'denied' } }, 2],
    [404, { detail: 'missing' }, 1],
    [500, { error: { code: 'internal_error', message: 'failed' } }, 3],
    [200, '', 3], [200, '<html>bad</html>', 3], [200, {}, 3],
    [200, { components: null }, 3], [200, [], 0], [200, { components: [] }, 0],
  ];
  for (const [status, data, expected] of cases) {
    await withServer((req, res) => {
      if (req.url.endsWith('/components')) {
        res.writeHead(status);
        res.end(typeof data === 'string' ? data : JSON.stringify(data));
      } else res.end(JSON.stringify({ skill: { id: 'probe', name: 'Probe' } }));
    }, async (baseUrl) => {
      for (const mode of ['--json', '--terminal']) {
        const result = await runSkill(baseUrl, ['cloud-skill-show', '--id', 'probe', mode]);
        assert.equal(result.code, expected, JSON.stringify({ status, data, result }));
        if (expected) assert.doesNotMatch(result.stdout, /"ok":true|Cloud Skill: Probe/);
        else if (mode === '--json') assert.deepEqual(JSON.parse(result.stdout).components, []);
      }
    });
  }
});

test('ledger amount validation rejects invalid ranges before network and preserves valid decimals', async () => {
  await withServer((_req, res) => res.end(JSON.stringify({ ok: true, result: { transactions: [] } })), async (baseUrl, requests) => {
    for (const flag of ['--min-amount', '--max-amount']) {
      for (const value of ['Infinity', '1e309', 'NaN', '-1']) {
        const result = await runSkill(baseUrl, ['ledger-list', flag, value, '--json']);
        assert.equal(result.code, 1, JSON.stringify(result));
      }
    }
    const reversed = await runSkill(baseUrl, ['ledger-list', '--min-amount', '2', '--max-amount', '1']);
    assert.equal(reversed.code, 1);
    assert.equal(requests.length, 0);
    for (const [min, max] of [['0', '0'], ['0.25', '12.5']]) {
      const result = await runSkill(baseUrl, ['ledger-list', '--min-amount', min, '--max-amount', max, '--json']);
      assert.equal(result.code, 0, JSON.stringify(result));
      assert.equal(requests.at(-1).body.arguments.min_amount, Number(min));
      assert.equal(requests.at(-1).body.arguments.max_amount, Number(max));
    }
  });
});
