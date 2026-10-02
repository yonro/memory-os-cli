import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readdir, readFile, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  MAX_OFFERS,
  RECALLS_BETWEEN_OFFERS,
  STATUSES,
  getStateFilePath,
  readOfferState,
  writeOfferState,
  recordOfferAnswer,
  noteRecall,
  armRecallNote,
} from '../skills/xmemo/scripts/lib/profile-offer.mjs';

import { armRecallNote as armRecallNoteFromProfile } from '../skills/xmemo/scripts/commands/profile.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills', 'xmemo', 'scripts', 'xmemo-skill.mjs');

function runSkill(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [skillScript, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function createMockServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += String(c)));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/v1/skill/operations' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          result: [
            { id: 'm1', content: 'Architecture decision: modular adapters', memory_type: 'working', score: 0.95 },
          ],
        }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Not found' } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('profile-offer.mjs exports expected constants and validation behavior', () => {
  assert.equal(MAX_OFFERS, 3);
  assert.equal(RECALLS_BETWEEN_OFFERS, 5);
  assert.deepEqual([...STATUSES], ['later', 'never']);
  assert.equal(typeof armRecallNote, 'function');
  assert.equal(armRecallNoteFromProfile, armRecallNote);

  assert.throws(() => recordOfferAnswer('done'), /Invalid status/);
  assert.throws(() => recordOfferAnswer('yes'), /Invalid status/);
  assert.throws(() => recordOfferAnswer('invalid'), /Invalid status/);
});

test('profile --status rejects invalid values with user error code 1', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-inv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  try {
    for (const invalidStatus of ['done', 'yes', 'foo', '123']) {
      const res = await runSkill(['profile', '--status', invalidStatus], {
        HOME: tempHome,
        USERPROFILE: tempHome,
      });
      assert.equal(res.code, 1, `Expected exit code 1 for status '${invalidStatus}', got ${res.code}`);
      assert.match(res.stderr, /Invalid status/);
    }
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('plain profile prints instructions with zero network requests and writes no files', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-plain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer();
  try {
    const res = await runSkill(['profile', '--base-url', mock.baseUrl], {
      HOME: tempHome,
      USERPROFILE: tempHome,
    });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /^## XMemo memory/m);
    assert.match(res.stdout, /_End of the XMemo memory section\._/);
    assert.equal(mock.requests.length, 0, 'Must make zero network requests');

    const files = await readdir(tempHome);
    assert.equal(files.length, 0, 'Must not write any files to HOME');
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('profile --status later and never record answers and maintain clean state file', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-rec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  try {
    const laterRes = await runSkill(['profile', '--status', 'later'], {
      HOME: tempHome,
      USERPROFILE: tempHome,
    });
    assert.equal(laterRes.code, 0);
    assert.equal(laterRes.stdout.trim(), 'Recorded: later');

    const statePath = path.join(tempHome, '.xmemo', 'profile-offer.json');
    const stateContent = await readFile(statePath, 'utf8');
    const parsedState = JSON.parse(stateContent);

    // State file contains ONLY the four fields and no query text
    const keys = Object.keys(parsedState).sort();
    assert.deepEqual(keys, ['lastOfferRecalls', 'offers', 'recalls', 'status']);
    assert.equal(parsedState.status, 'later');
    assert.equal(parsedState.offers, 1);
    assert.equal(parsedState.recalls, 0);
    assert.equal(parsedState.lastOfferRecalls, 0);
    assert.equal(stateContent.includes('query'), false, 'State file must not contain query text');

    // Switch to never
    const neverRes = await runSkill(['profile', '--status', 'never'], {
      HOME: tempHome,
      USERPROFILE: tempHome,
    });
    assert.equal(neverRes.code, 0);
    assert.equal(neverRes.stdout.trim(), 'Recorded: never');

    const updatedState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(updatedState.status, 'never');
    assert.deepEqual(Object.keys(updatedState).sort(), ['lastOfferRecalls', 'offers', 'recalls', 'status']);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('recall re-offer behavior: later triggers note at 5th recall on stderr, preserves JSON stdout, caps at 3 total offers', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-reoffer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer();

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test-secret-token',
    };

    // 1. Set status to later
    const initRes = await runSkill(['profile', '--status', 'later'], env);
    assert.equal(initRes.code, 0);

    const expectedNotePattern = /Note: XMemo recall has been used \d+ times on this computer\. If the current project's AGENTS\.md or CLAUDE\.md has no "## XMemo memory" section, you may offer once more to add it \(see references\/agent-profile\.md\) and record the answer with `profile --status later\|never`\./;

    // 2. Recalls 1 to 4: no note on stderr
    for (let i = 1; i <= 4; i++) {
      const res = await runSkill(['recall', '--query', `test query ${i}`, '--base-url', mock.baseUrl], env);
      assert.equal(res.code, 0);
      assert.equal(res.stderr.includes('Note: XMemo recall has been used'), false, `Recall ${i} should not emit a note`);
    }

    // 3. 5th recall with --json: note on stderr, stdout is 100% valid JSON without the note
    const recall5 = await runSkill(['recall', '--query', 'test query 5', '--json', '--base-url', mock.baseUrl], env);
    assert.equal(recall5.code, 0);
    assert.match(recall5.stderr, expectedNotePattern);
    assert.match(recall5.stderr, /Note: XMemo recall has been used 5 times on this computer\./);

    // Stdout must parse as valid JSON
    let parsedJson = null;
    assert.doesNotThrow(() => {
      parsedJson = JSON.parse(recall5.stdout.trim());
    }, 'Stdout in --json mode must remain strictly valid JSON');
    assert.equal(parsedJson.ok, true);
    assert.equal(recall5.stdout.includes('Note: XMemo recall has been used'), false, 'Stdout must not contain the note');

    // 4. Recalls 6 to 9: no note on stderr
    for (let i = 6; i <= 9; i++) {
      const res = await runSkill(['recall', '--query', `test query ${i}`, '--base-url', mock.baseUrl], env);
      assert.equal(res.code, 0);
      assert.equal(res.stderr.includes('Note: XMemo recall has been used'), false, `Recall ${i} should not emit a note`);
    }

    // 5. 10th recall: second note on stderr
    const recall10 = await runSkill(['recall', '--query', 'test query 10', '--base-url', mock.baseUrl], env);
    assert.equal(recall10.code, 0);
    assert.match(recall10.stderr, /Note: XMemo recall has been used 10 times on this computer\./);

    // 6. Recalls 11 to 25: maximum offers (3 total: initial + 2 notes) reached -> zero notes ever
    let noteCountAfter10 = 0;
    for (let i = 11; i <= 25; i++) {
      const res = await runSkill(['recall', '--query', `test query ${i}`, '--base-url', mock.baseUrl], env);
      assert.equal(res.code, 0);
      if (res.stderr.includes('Note: XMemo recall has been used')) {
        noteCountAfter10++;
      }
    }
    assert.equal(noteCountAfter10, 0, 'No notes should appear after reaching MAX_OFFERS');

    // Check state file
    const finalState = JSON.parse(await readFile(path.join(tempHome, '.xmemo', 'profile-offer.json'), 'utf8'));
    assert.equal(finalState.offers, 3);
    assert.equal(finalState.recalls, 25);
    assert.equal(finalState.lastOfferRecalls, 10);
    assert.deepEqual(Object.keys(finalState).sort(), ['lastOfferRecalls', 'offers', 'recalls', 'status']);
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('never status and unset status never emit recall notes across multiple recalls', async () => {
  const mock = await createMockServer();

  // Test unset status (fresh HOME)
  const tempHomeUnset = path.join(os.tmpdir(), `xmemo-test-profile-unset-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHomeUnset, { recursive: true });

  try {
    const envUnset = {
      HOME: tempHomeUnset,
      USERPROFILE: tempHomeUnset,
      XMEMO_KEY: 'test-secret-token',
    };
    for (let i = 1; i <= 8; i++) {
      const res = await runSkill(['recall', '--query', `query ${i}`, '--base-url', mock.baseUrl], envUnset);
      assert.equal(res.code, 0);
      assert.equal(res.stderr.includes('Note: XMemo recall has been used'), false);
    }
  } finally {
    await rm(tempHomeUnset, { recursive: true, force: true });
  }

  // Test never status
  const tempHomeNever = path.join(os.tmpdir(), `xmemo-test-profile-never-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHomeNever, { recursive: true });

  try {
    const envNever = {
      HOME: tempHomeNever,
      USERPROFILE: tempHomeNever,
      XMEMO_KEY: 'test-secret-token',
    };
    const neverRes = await runSkill(['profile', '--status', 'never'], envNever);
    assert.equal(neverRes.code, 0);

    for (let i = 1; i <= 8; i++) {
      const res = await runSkill(['recall', '--query', `query ${i}`, '--base-url', mock.baseUrl], envNever);
      assert.equal(res.code, 0);
      assert.equal(res.stderr.includes('Note: XMemo recall has been used'), false);
    }
  } finally {
    await rm(tempHomeNever, { recursive: true, force: true });
    await mock.close();
  }
});

test('unwritable state directory does not change recall exit code or output', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-unwrite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer();

  try {
    // Create a regular file where the .xmemo directory would be created, preventing mkdir
    const dotXmemo = path.join(tempHome, '.xmemo');
    await writeFile(dotXmemo, 'blocker-file', { encoding: 'utf8' });

    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test-secret-token',
    };

    const res = await runSkill(['recall', '--query', 'test query on unwritable dir', '--base-url', mock.baseUrl], env);
    assert.equal(res.code, 0, `Recall must succeed even with unwritable state dir, got: ${res.stderr}`);
    assert.match(res.stdout, /Architecture decision/);
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('failing recall prints no note and preserves exit code', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });

  const failingServer = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { code: 'server_error', message: 'Internal server error' } }));
  });

  const port = await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', () => resolve(failingServer.address().port)));

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test-secret-token',
    };

    const initRes = await runSkill(['profile', '--status', 'later'], env);
    assert.equal(initRes.code, 0);

    const res = await runSkill(['recall', '--query', 'failing query', '--base-url', `http://127.0.0.1:${port}`], env);
    assert.notEqual(res.code, 0, 'Exit code must be non-zero when API request fails');
    assert.equal(res.stderr.includes('Note: XMemo recall has been used'), false, 'Failing recall must not print offer note');

    const statePath = path.join(tempHome, '.xmemo', 'profile-offer.json');
    const stateContent = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(stateContent.recalls, 0, 'Recalls counter must not increment on failed recall');
  } finally {
    await new Promise((resolve) => failingServer.close(resolve));
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('guarded profile --status later --if-unset records later when unset, and emits note on 5th recall', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-ifunset-unset-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer();

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test-secret-token',
    };

    // (a) unset state + --if-unset -> sets status: 'later', offers: 1
    const res = await runSkill(['profile', '--status', 'later', '--if-unset'], env);
    assert.equal(res.code, 0);
    assert.equal(res.stdout.trim(), 'Recorded: later');

    const statePath = path.join(tempHome, '.xmemo', 'profile-offer.json');
    const parsedState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(parsedState.status, 'later');
    assert.equal(parsedState.offers, 1);
    assert.equal(parsedState.recalls, 0);

    // Recalls 1 to 4: no note on stderr
    for (let i = 1; i <= 4; i++) {
      const recallRes = await runSkill(['recall', '--query', `test query ${i}`, '--base-url', mock.baseUrl], env);
      assert.equal(recallRes.code, 0);
      assert.equal(recallRes.stderr.includes('Note: XMemo recall has been used'), false, `Recall ${i} should not emit a note`);
    }

    // 5th recall: note emitted on stderr
    const recall5 = await runSkill(['recall', '--query', 'test query 5', '--base-url', mock.baseUrl], env);
    assert.equal(recall5.code, 0);
    assert.match(recall5.stderr, /Note: XMemo recall has been used 5 times on this computer\./);
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('guarded profile --status later --if-unset leaves never status unchanged with zero notes over 6+ recalls', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-ifunset-never-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer();

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test-secret-token',
    };

    // User previously selected never
    const neverRes = await runSkill(['profile', '--status', 'never'], env);
    assert.equal(neverRes.code, 0);
    assert.equal(neverRes.stdout.trim(), 'Recorded: never');

    // (b) never state + --if-unset -> remains never, prints Unchanged: never
    const guardedRes = await runSkill(['profile', '--status', 'later', '--if-unset'], env);
    assert.equal(guardedRes.code, 0);
    assert.equal(guardedRes.stdout.trim(), 'Unchanged: never');

    const statePath = path.join(tempHome, '.xmemo', 'profile-offer.json');
    const stateAfter = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(stateAfter.status, 'never');

    // 6+ recalls: zero notes emitted
    for (let i = 1; i <= 8; i++) {
      const recallRes = await runSkill(['recall', '--query', `test query ${i}`, '--base-url', mock.baseUrl], env);
      assert.equal(recallRes.code, 0);
      assert.equal(recallRes.stderr.includes('Note: XMemo recall has been used'), false, `Recall ${i} on never status must not emit note`);
    }
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('guarded profile --status later --if-unset leaves existing later status unchanged when offers reached max', async () => {
  const tempHome = path.join(os.tmpdir(), `xmemo-test-profile-ifunset-max-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempHome, { recursive: true });
  const mock = await createMockServer();

  try {
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XMEMO_KEY: 'test-secret-token',
    };

    // Set initial state with status later and offers = 3 (MAX_OFFERS)
    const dotXmemo = path.join(tempHome, '.xmemo');
    await mkdir(dotXmemo, { recursive: true });
    const initialState = {
      status: 'later',
      recalls: 15,
      offers: 3,
      lastOfferRecalls: 10,
    };
    await writeFile(path.join(dotXmemo, 'profile-offer.json'), JSON.stringify(initialState, null, 2), 'utf8');

    // (c) later state with offers=3 + --if-unset -> unchanged, prints Unchanged: later
    const guardedRes = await runSkill(['profile', '--status', 'later', '--if-unset'], env);
    assert.equal(guardedRes.code, 0);
    assert.equal(guardedRes.stdout.trim(), 'Unchanged: later');

    const stateAfter = JSON.parse(await readFile(path.join(dotXmemo, 'profile-offer.json'), 'utf8'));
    assert.deepEqual(stateAfter, initialState);

    // Recalls should emit NO new note
    for (let i = 16; i <= 22; i++) {
      const recallRes = await runSkill(['recall', '--query', `test query ${i}`, '--base-url', mock.baseUrl], env);
      assert.equal(recallRes.code, 0);
      assert.equal(recallRes.stderr.includes('Note: XMemo recall has been used'), false, `Recall ${i} must not emit note after MAX_OFFERS`);
    }
  } finally {
    await mock.close();
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('size-cap test: all skills/xmemo modules and references strictly <= 12 KiB (12,288 bytes)', async () => {
  const skillsDir = path.join(repoRoot, 'skills', 'xmemo');

  async function getFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await getFiles(fullPath)));
      } else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.md'))) {
        // CHANGELOG and SKILL.md have separate guidelines; test all scripts and references
        const rel = path.relative(skillsDir, fullPath).replace(/\\/g, '/');
        if (rel.startsWith('scripts/') || rel.startsWith('references/')) {
          files.push(fullPath);
        }
      }
    }
    return files;
  }

  const filesToCheck = await getFiles(skillsDir);
  assert.ok(filesToCheck.length >= 15, `Expected at least 15 modules/references, found ${filesToCheck.length}`);

  const violations = [];
  const MAX_BYTES = 12 * 1024; // 12,288 bytes

  for (const filePath of filesToCheck) {
    const content = await readFile(filePath, 'utf8');
    const lfContent = content.replace(/\r\n/g, '\n');
    const byteLength = Buffer.byteLength(lfContent, 'utf8');
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');

    if (byteLength > MAX_BYTES) {
      violations.push({
        file: relPath,
        size: byteLength,
        limit: MAX_BYTES,
        excess: byteLength - MAX_BYTES,
      });
    }
  }

  assert.deepEqual(violations, [], `Files exceeding 12 KiB limit: ${JSON.stringify(violations, null, 2)}`);
});
