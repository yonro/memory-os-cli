import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { run } from '../src/cli.js';

async function snapshotDirectory(dir) {
  const entries = {};
  async function scan(current, rel = '') {
    const items = await fs.readdir(current, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(current, item.name);
      const relPath = path.join(rel, item.name);
      if (item.isDirectory()) {
        await scan(fullPath, relPath);
      } else if (item.isFile()) {
        const content = await fs.readFile(fullPath);
        entries[relPath] = content.toString('hex');
      }
    }
  }
  await scan(dir);
  return entries;
}

const COMMAND_MATRIX = [
  // Top-level commands
  ['init'],
  ['start'],
  ['account'],
  ['setup'],
  ['doctor'],
  ['uninstall'],
  ['login'],
  ['mcp'],
  ['profile'],
  ['memory'],
  ['token'],
  ['auth'],
  ['skill'],
  ['plugin'],
  ['knowledge'],
  ['dream'],
  ['cloud-skill'],
  ['context'],
  ['state'],
  ['restart'],
  ['discovery'],
  ['smoke'],
  ['status'],
  ['env'],
  ['privacy'],
  ['update'],

  // Subcommands
  ['setup', 'cursor'],
  ['setup', 'gemini'],
  ['setup', 'antigravity'],
  ['setup', 'kiro'],
  ['setup', 'openclaw'],
  ['setup', 'hermes'],
  ['setup', 'codex'],
  ['setup', '--all'],

  ['doctor', '--client', 'kiro'],
  ['doctor', '--client', 'codex'],
  ['doctor', '--client', 'codex', '--smoke'],
  ['doctor', '--discovery'],
  ['doctor', '--services'],

  ['uninstall', 'cursor'],
  ['uninstall', '--all'],

  ['mcp', 'list'],
  ['mcp', 'config'],
  ['mcp', 'add'],
  ['mcp', 'proxy'],
  ['mcp', 'profile'],
  ['mcp', 'serve'],

  ['profile', 'install'],
  ['profile', 'status'],
  ['profile', 'uninstall'],

  ['memory', 'add'],
  ['memory', 'search'],
  ['memory', 'read'],
  ['memory', 'list'],
  ['memory', 'import'],
  ['memory', 'ledger-delete'],
  ['memory', 'expense-delete'],

  ['token', 'status'],
  ['token', 'add'],
  ['token', 'set'],

  ['account', 'login'],
  ['account', 'logout'],
  ['account', 'status'],
  ['account', 'token'],
  ['account', 'token', 'status'],
  ['account', 'token', 'add'],
  ['account', 'token', 'set'],

  ['auth', 'status'],
  ['auth-status'],

  ['skill', 'install'],
  ['skill', 'status'],
  ['skill', 'remove'],
  ['skill', 'update'],

  ['plugin', 'list'],
  ['plugin', 'info'],
  ['plugin', 'install'],
  ['plugin', 'status'],

  ['knowledge', 'add'],
  ['knowledge', 'search'],
  ['knowledge', 'read'],
  ['knowledge', 'update'],

  ['dream', 'preview'],
  ['dream', 'show'],
  ['dream', 'apply'],

  ['cloud-skill', 'add'],
  ['cloud-skill', 'list'],
  ['cloud-skill', 'show'],
  ['cloud-skill', 'update'],
  ['cloud-skill', 'run'],

  ['context', 'recall'],

  ['state', 'save'],
  ['state', 'restore'],

  ['restart', 'snapshot'],
  ['restart', 'restore'],

  ['discovery', 'show'],

  ['env', 'example']
];

test('every registered command and subcommand prints help with zero network and zero file writes', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-help-home-'));
  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-help-cwd-'));

  // Plant a sentinel file in both directories to ensure directories exist and content check works
  await fs.writeFile(path.join(tempHome, 'canary.txt'), 'home-unmodified\n');
  await fs.writeFile(path.join(tempCwd, 'canary.txt'), 'cwd-unmodified\n');

  const homeSnapshotBefore = await snapshotDirectory(tempHome);
  const cwdSnapshotBefore = await snapshotDirectory(tempCwd);

  const networkRequests = [];
  const mockFetch = async (url) => {
    networkRequests.push(url);
    throw new Error(`Unexpected network call during help: ${url}`);
  };

  const forms = [
    (cmd) => [...cmd, '--help'],
    (cmd) => [...cmd, '-h'],
    (cmd) => ['help', ...cmd]
  ];

  for (const cmd of COMMAND_MATRIX) {
    for (const form of forms) {
      const args = form(cmd);
      let stdout = '';
      let stderr = '';

      const code = await run(args, {
        cwd: tempCwd,
        env: {
          HOME: tempHome,
          USERPROFILE: tempHome,
          XMEMO_URL: 'https://mock.example.test',
          XMEMO_BASE_URL: 'https://mock.example.test',
          MEMORY_OS_URL: 'https://mock.example.test',
          MEMORY_OS_BASE_URL: 'https://mock.example.test'
        },
        stdin: Readable.from([]),
        stdout: { write: (chunk) => { stdout += chunk; } },
        stderr: { write: (chunk) => { stderr += chunk; } },
        fetch: mockFetch
      });

      assert.equal(
        code,
        0,
        `Expected exit code 0 for "${args.join(' ')}", got ${code}. Stderr: ${stderr}`
      );
      assert.ok(
        stdout.trim().length > 0,
        `Expected help text in stdout for "${args.join(' ')}", got empty output.`
      );
      assert.equal(
        stderr,
        '',
        `Expected empty stderr for "${args.join(' ')}", got: ${stderr}`
      );
    }
  }

  // Verify zero network requests were made
  assert.equal(
    networkRequests.length,
    0,
    `Expected 0 network requests, but received ${networkRequests.length}: ${JSON.stringify(networkRequests)}`
  );

  // Verify temp HOME and temp cwd stay byte-identical
  const homeSnapshotAfter = await snapshotDirectory(tempHome);
  const cwdSnapshotAfter = await snapshotDirectory(tempCwd);

  assert.deepEqual(homeSnapshotAfter, homeSnapshotBefore, 'Temp HOME directory was modified by help commands');
  assert.deepEqual(cwdSnapshotAfter, cwdSnapshotBefore, 'Temp cwd directory was modified by help commands');

  // Clean up
  await fs.rm(tempHome, { recursive: true, force: true });
  await fs.rm(tempCwd, { recursive: true, force: true });
});
