import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { run } from '../src/cli.js';
import {
  generateUnifiedDiff,
  isHomeProfileTarget,
  isRepo,
  profileBlock
} from '../src/config/profile.js';

function discoveryFetch() {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/.well-known/memory-os.json') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            service: 'memory-os',
            urls: {
              mcp: 'https://mcp.example.test/mcp',
              onboarding_status: 'https://api.example.test/v1/onboarding/status',
              token_portal: 'https://app.example.test/tokens'
            }
          };
        }
      };
    }
    if (parsed.pathname === '/v1/onboarding/status') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            onboarding_complete: true,
            account_ready: true,
            mcp_ready: true
          };
        }
      };
    }
    return {
      ok: false,
      status: 404,
      async json() {
        return { error: 'not_found' };
      }
    };
  };
}

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const stdin = options.stdinStream ?? Readable.from([options.stdin ?? '']);
  if (options.isTTY !== undefined) {
    stdin.isTTY = options.isTTY;
  }

  const code = await run(args, {
    cwd: options.cwd,
    env: {
      XMEMO_KEY: 'secret-token-that-must-not-leak',
      ...(options.env ?? {})
    },
    stdin,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    fetch: options.fetch ?? discoveryFetch(),
    spawn: options.spawn,
    sleep: options.sleep,
    confirm: options.confirm,
    nodeVersion: options.nodeVersion
  });

  return { code, stdout, stderr };
}

test('generateUnifiedDiff returns (new file) for empty/missing content', () => {
  assert.equal(generateUnifiedDiff('AGENTS.md', '', 'content\n'), '(new file)');
  assert.equal(generateUnifiedDiff('AGENTS.md', null, 'content\n'), '(new file)');
  assert.equal(generateUnifiedDiff('AGENTS.md', '   \n  ', 'content\n'), '(new file)');
});

test('generateUnifiedDiff returns empty string when texts are identical', () => {
  assert.equal(generateUnifiedDiff('AGENTS.md', 'same\n', 'same\n'), '');
});

test('generateUnifiedDiff produces standard unified diff hunks with +/- markers', () => {
  const oldText = '# Title\n\nExisting section\n\nFooter\n';
  const newText = '# Title\n\nExisting section\n\n<!-- xmemo:profile:start -->\nProfile\n<!-- xmemo:profile:end -->\n\nFooter\n';
  const diff = generateUnifiedDiff('AGENTS.md', oldText, newText);

  assert.match(diff, /^--- a\/AGENTS\.md\n\+\+\+ b\/AGENTS\.md/);
  assert.match(diff, /@@ -\d+,\d+ \+\d+,\d+ @@/);
  assert.match(diff, /\+<!-- xmemo:profile:start -->/);
  assert.match(diff, /\+Profile/);
});

test('profile prompt: Enter defaults to No, writing nothing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-enter-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test'], {
    cwd: tempDir,
    env: { HOME: tempDir },
    stdin: '\n'
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Write XMemo memory behavior profile to .*\? \[y\/N\]/);
  assert.match(result.stdout, /Behavior profile installed: false/);

  const profilePath = path.join(tempDir, '.cursor', 'memory-profile.md');
  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('profile prompt: EOF / closed stdin defaults to No, writing nothing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-eof-'));
  const emptyStream = Readable.from([]);
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test'], {
    cwd: tempDir,
    env: { HOME: tempDir },
    stdinStream: emptyStream
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Write XMemo memory behavior profile to .*\? \[y\/N\]/);
  assert.match(result.stdout, /Behavior profile installed: false/);

  const profilePath = path.join(tempDir, '.cursor', 'memory-profile.md');
  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('profile prompt: unknown answer defaults to No without crashing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-unknown-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test'], {
    cwd: tempDir,
    env: { HOME: tempDir },
    stdin: 'not-sure\n'
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Write XMemo memory behavior profile to .*\? \[y\/N\]/);
  assert.match(result.stdout, /Behavior profile installed: false/);

  const profilePath = path.join(tempDir, '.cursor', 'memory-profile.md');
  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('profile prompt: explicit yes installs profile', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-yes-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test'], {
    cwd: tempDir,
    env: { HOME: tempDir },
    stdin: 'y\n'
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Behavior profile installed: true/);

  const profilePath = path.join(tempDir, '.cursor', 'memory-profile.md');
  const content = await fs.readFile(profilePath, 'utf8');
  assert.match(content, /<!-- xmemo:profile:start -->/);
  assert.match(content, /XMemo Agent profile/);
});

test('--json alone is NEVER consent and does not write profile', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-json-noconsent-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test', '--json'], {
    cwd: tempDir,
    env: { HOME: tempDir }
  });

  assert.equal(result.code, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.behaviorProfile.written, false);
  assert.equal(plan.selectedClient.behaviorProfile.accepted, false);

  const profilePath = path.join(tempDir, '.cursor', 'memory-profile.md');
  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('--yes writes profile and creates backup of existing file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-backup-'));
  const profileDir = path.join(tempDir, '.cursor');
  await fs.mkdir(profileDir, { recursive: true });
  const profilePath = path.join(profileDir, 'memory-profile.md');
  const originalContent = '## User Prior Instructions\nKeep this safe.\n';
  await fs.writeFile(profilePath, originalContent);

  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test', '--yes'], {
    cwd: tempDir,
    env: { HOME: tempDir }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Created backup at/);
  assert.match(result.stdout, /\.xmemo\.bak/);

  const backupPath = `${profilePath}.xmemo.bak`;
  const backupContent = await fs.readFile(backupPath, 'utf8');
  assert.equal(backupContent, originalContent);

  const updatedContent = await fs.readFile(profilePath, 'utf8');
  assert.match(updatedContent, /User Prior Instructions/);
  assert.match(updatedContent, /<!-- xmemo:profile:start -->/);

  // Overwriting previous backup on subsequent modification
  const secondState = updatedContent.replace('MCP server: `XMemo`', 'MCP server: `OldMemo`') + '\nSecond modification.\n';
  await fs.writeFile(profilePath, secondState);

  const secondResult = await invoke(['profile', 'install', 'cursor', '--target', profilePath], {
    cwd: tempDir,
    env: { HOME: tempDir }
  });

  assert.equal(secondResult.code, 0);
  const secondBackupContent = await fs.readFile(backupPath, 'utf8');
  assert.match(secondBackupContent, /Second modification\./);
  assert.match(secondBackupContent, /MCP server: `OldMemo`/);
});

test('profile install --dry-run prints block and diff without writing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-dryrun-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');
  await fs.writeFile(profilePath, '# Existing Project Guidelines\n');

  const result = await invoke(['profile', 'install', 'cursor', '--target', profilePath, '--dry-run'], {
    cwd: tempDir,
    env: { HOME: tempDir }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Profile block:/);
  assert.match(result.stdout, /XMemo Agent profile/);
  assert.match(result.stdout, /Diff:/);
  assert.match(result.stdout, /\+<!-- xmemo:profile:start -->/);

  const content = await fs.readFile(profilePath, 'utf8');
  assert.equal(content, '# Existing Project Guidelines\n');
});

test('profile install --dry-run prints (new file) when target does not exist', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-profile-dryrun-new-'));
  const profilePath = path.join(tempDir, 'NEW_AGENTS.md');

  const result = await invoke(['profile', 'install', 'cursor', '--target', profilePath, '--dry-run'], {
    cwd: tempDir,
    env: { HOME: tempDir }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Profile block:/);
  assert.match(result.stdout, /\(new file\)/);

  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('setup --dry-run prints block and diff without writing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-setup-dryrun-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test', '--dry-run'], {
    cwd: tempDir,
    env: { HOME: tempDir }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Behavior profile block:/);
  assert.match(result.stdout, /Behavior profile diff:/);
  assert.match(result.stdout, /\(new file\)/);

  const profilePath = path.join(tempDir, '.cursor', 'memory-profile.md');
  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('outside a repo, explicitly states target is in home directory', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-outside-repo-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test'], {
    cwd: tempDir,
    env: { HOME: tempDir },
    stdin: '\n'
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Target is in home directory \(outside a repository\):/);
  assert.match(result.stdout, /Behavior profile target: .* \(home directory, outside a repository\)/);
});

test('HOME containing "test" behaves like any other path', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-test-word-in-home-'));
  const mockHome = path.join(baseDir, 'home-with-test-in-name');
  await fs.mkdir(mockHome, { recursive: true });

  // 1. Inside a repo (cwd has .git)
  const repoDir = path.join(baseDir, 'my-repo');
  await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
  await fs.writeFile(path.join(repoDir, 'package.json'), '{"name":"repo"}\n');

  assert.equal(isRepo(repoDir, { HOME: mockHome }), true);
  assert.equal(isHomeProfileTarget(path.join(repoDir, '.cursor', 'rules', 'AGENTS.md'), { HOME: mockHome }, { cwd: repoDir }), false);

  const repoResult = await invoke(['setup', 'cursor', '--url', 'https://api.example.test', '--dry-run'], {
    cwd: repoDir,
    env: { HOME: mockHome }
  });
  assert.equal(repoResult.code, 0);
  assert.doesNotMatch(repoResult.stdout, /outside a repository/);
  assert.match(repoResult.stdout, /rules.*AGENTS\.md/);

  // 2. Outside a repo (cwd is scratch dir without .git)
  const scratchDir = path.join(baseDir, 'scratch-folder');
  await fs.mkdir(scratchDir, { recursive: true });

  assert.equal(isRepo(scratchDir, { HOME: mockHome }), false);
  const targetOutside = path.join(mockHome, '.cursor', 'memory-profile.md');
  assert.equal(isHomeProfileTarget(targetOutside, { HOME: mockHome }, { cwd: scratchDir }), true);

  const scratchResult = await invoke(['setup', 'cursor', '--url', 'https://api.example.test', '--dry-run'], {
    cwd: scratchDir,
    env: { HOME: mockHome }
  });
  assert.equal(scratchResult.code, 0);
  assert.match(scratchResult.stdout, /home directory, outside a repository/);
});
