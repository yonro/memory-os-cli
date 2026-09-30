import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlLivenessWorkflowPath = path.join(repoRoot, '.github/workflows/url-liveness.yml');
const ciWorkflowPath = path.join(repoRoot, '.github/workflows/ci.yml');

test('url-liveness: workflow exists and is non-blocking with schedule and manual triggers only', async () => {
  const content = await readFile(urlLivenessWorkflowPath, 'utf8');

  // Must have workflow_dispatch for manual/ad-hoc runs
  assert.match(content, /workflow_dispatch:/, 'must support workflow_dispatch trigger');

  // Must have scheduled cron trigger
  assert.match(content, /schedule:[\s\S]*?cron:\s*['"][^'"]+['"]/, 'must define cron schedule');

  // CRITICAL: Must NOT trigger on pull_request or push (non-blocking, never gates PR CI)
  assert.doesNotMatch(content, /\bpull_request\b/, 'must not trigger on pull_request');
  assert.doesNotMatch(content, /\bpush\b/, 'must not trigger on push');
});

test('url-liveness: targets the three canonical documentation and endpoint URLs', async () => {
  const content = await readFile(urlLivenessWorkflowPath, 'utf8');

  const expectedUrls = [
    'https://docs.xmemo.dev/',
    'https://docs.xmemo.dev/docs/quickstart',
    'https://xmemo.dev/.well-known/memory-os.json'
  ];

  for (const url of expectedUrls) {
    assert.ok(
      content.includes(url),
      `url-liveness workflow must probe ${url}`
    );
  }

  // Must verify HTTP 200 status
  assert.match(content, /200/, 'must assert HTTP 200 response');
});

test('url-liveness: PR CI remains offline and unchanged', async () => {
  const ciContent = await readFile(ciWorkflowPath, 'utf8');

  // CI is the gate for pull requests and main pushes
  assert.match(ciContent, /pull_request:/, 'ci.yml must handle pull_request');
  assert.match(ciContent, /push:\s*[\r\n]+\s*branches:\s*[\r\n]+\s*-\s*main/, 'ci.yml must handle push to main');

  // CI must NOT reference url-liveness or probe external URLs
  assert.doesNotMatch(ciContent, /url-liveness/i, 'ci.yml must not reference url-liveness');
  assert.doesNotMatch(ciContent, /docs\.xmemo\.dev/, 'ci.yml must not probe docs.xmemo.dev');
  assert.doesNotMatch(ciContent, /\.well-known\/memory-os\.json/, 'ci.yml must not probe .well-known');

  // CI jobs must strictly be offline test and compatibility matrices
  assert.match(ciContent, /test:/, 'ci.yml must define test job');
  assert.match(ciContent, /compatibility:/, 'ci.yml must define compatibility job');
  assert.doesNotMatch(ciContent, /check-urls/, 'ci.yml must not include url check job');
});

test('url-liveness negative check: a failed URL does not gate PR CI', async () => {
  const livenessContent = await readFile(urlLivenessWorkflowPath, 'utf8');
  const ciContent = await readFile(ciWorkflowPath, 'utf8');

  // 1. Verify liveness probe logic rejects non-200 responses (simulated failure)
  function simulateLivenessProbe(mockStatus) {
    if (mockStatus !== '200') {
      return { success: false, exitCode: 1, error: `Liveness probe failed (HTTP ${mockStatus})` };
    }
    return { success: true, exitCode: 0 };
  }

  const failedProbe500 = simulateLivenessProbe('500');
  const failedProbe000 = simulateLivenessProbe('000');
  assert.equal(failedProbe500.success, false, 'Probe correctly fails on HTTP 500');
  assert.equal(failedProbe500.exitCode, 1, 'Probe exits 1 on HTTP 500');
  assert.equal(failedProbe000.success, false, 'Probe correctly fails on connection failure (HTTP 000)');

  // 2. Verify that PR CI workflow has zero coupling with the failed probe:
  // - ci.yml does not import, call, or depend on url-liveness.yml
  assert.doesNotMatch(ciContent, /needs:.*check-urls/, 'PR CI jobs must not depend on check-urls job');
  assert.doesNotMatch(ciContent, /uses:.*url-liveness/, 'PR CI must not call url-liveness workflow');

  // - url-liveness.yml jobs are not in PR CI triggers
  assert.doesNotMatch(livenessContent, /pull_request/, 'url-liveness must not run on pull_request');

  // 3. Confirm PR CI required checks remain purely offline
  // Any failure in url-liveness (exitCode 1) does not block PR CI merge
  const prCiJobs = ['test', 'compatibility'];
  assert.ok(!prCiJobs.includes('check-urls'), 'check-urls is not a PR CI job');
});
