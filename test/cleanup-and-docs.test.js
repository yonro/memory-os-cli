import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { run } from '../src/cli.js';
import { writeHelp, writeHelpJson } from '../src/ui/help.js';
import * as constants from '../src/core/constants.js';
import { isRepo as runtimeIsRepo } from '../src/core/runtime.js';
import { isRepo as profileIsRepo } from '../src/config/profile.js';

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const stdin = Readable.from([options.stdin ?? '']);

  const code = await run(args, {
    env: options.env !== undefined ? options.env : process.env,
    stdin,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    fetch: options.fetch,
    spawn: options.spawn,
    sleep: options.sleep,
    cwd: options.cwd
  });

  return { code, stdout, stderr };
}

test('dead code cleanup: unused constants and re-exported isRepo', () => {
  assert.equal(constants.FALLBACK_PACKAGE_NAME, undefined, 'FALLBACK_PACKAGE_NAME must be removed');
  assert.equal(typeof runtimeIsRepo, 'function');
  assert.equal(typeof profileIsRepo, 'function');
  assert.equal(runtimeIsRepo, profileIsRepo, 'profile.js should re-export isRepo from runtime.js');
});

test('top-level help renders the 7 plan menu groups in correct order', () => {
  let stdout = '';
  writeHelp({ stdout: { write: (chunk) => { stdout += chunk; } } });

  const groups = [
    'Get started',
    'Connect agents',
    'Skill',
    'Plugins',
    'Memory',
    'Account',
    'Maintenance'
  ];

  let lastIndex = -1;
  for (const group of groups) {
    const idx = stdout.indexOf(group);
    assert.ok(idx > -1, `Help output must contain group "${group}"`);
    assert.ok(idx > lastIndex, `Group "${group}" must appear after preceding group (idx=${idx}, last=${lastIndex})`);
    lastIndex = idx;
  }

  // Ensure legacy aliases remain hidden from top-level list
  assert.ok(!stdout.includes('  xmemo start\n      Guided'), 'start alias should not be listed as primary');
  assert.ok(!stdout.includes('  xmemo login\n'), 'login alias should not be listed as primary');
  assert.ok(!stdout.includes('  xmemo smoke\n'), 'smoke alias should not be listed as primary');
  assert.ok(!stdout.includes('  xmemo discovery show\n'), 'discovery alias should not be listed as primary');
});

test('writeHelpJson lists 20 registered commands matching menu groups', () => {
  let stdout = '';
  writeHelpJson({ stdout: { write: (chunk) => { stdout += chunk; } } });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.commands, [
    'init',
    'setup',
    'mcp',
    'profile',
    'skill',
    'plugin',
    'memory',
    'context',
    'knowledge',
    'dream',
    'cloud-skill',
    'state',
    'restart',
    'account',
    'doctor',
    'status',
    'update',
    'uninstall',
    'env',
    'privacy'
  ]);
});

test('doctor --client codex --smoke validates codex config identically to smoke command', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-codex-smoke-'));
  const codexDir = path.join(tempHome, '.codex');
  await fs.mkdir(codexDir, { recursive: true });
  const configPath = path.join(codexDir, 'config.toml');

  const validToml = [
    '[mcp_servers.XMemo]',
    'url = "https://xmemo.dev/mcp"',
    'bearer_token_env_var = "XMEMO_KEY"'
  ].join('\n');
  await fs.writeFile(configPath, validToml);

  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    XMEMO_KEY: 'dummy-token-for-test'
  };

  // 1. Run doctor --client codex --smoke with --json
  const resDoctorJson = await invoke(['doctor', '--client', 'codex', '--smoke', '--config', configPath, '--json'], { env });
  assert.equal(resDoctorJson.code, 0);
  assert.equal(resDoctorJson.stderr, '');
  const doctorReport = JSON.parse(resDoctorJson.stdout);
  assert.equal(doctorReport.ok, true);
  assert.equal(doctorReport.configPath, configPath);

  // 2. Run legacy smoke with --json
  const resSmokeJson = await invoke(['smoke', '--client', 'codex', '--config', configPath, '--json'], { env });
  assert.equal(resSmokeJson.code, 0);
  assert.equal(resSmokeJson.stderr, '', 'smoke --json must not emit deprecation hint');
  const smokeReport = JSON.parse(resSmokeJson.stdout);
  assert.deepEqual(doctorReport, smokeReport, 'doctor --smoke and smoke reports must match');

  // 3. Run doctor --client codex in human mode
  const resDoctorHuman = await invoke(['doctor', '--client', 'codex', '--config', configPath], { env });
  assert.equal(resDoctorHuman.code, 0);
  assert.equal(resDoctorHuman.stderr, '');
  assert.match(resDoctorHuman.stdout, /Codex MCP smoke: ok/);

  // 4. Run legacy smoke in human mode: emits deprecation hint
  const resSmokeHuman = await invoke(['smoke', '--client', 'codex', '--config', configPath], { env });
  assert.equal(resSmokeHuman.code, 0);
  assert.match(resSmokeHuman.stderr, /Note: 'xmemo smoke' is deprecated and will be removed in a future release. Use 'xmemo doctor --client codex --smoke' instead./);
  assert.match(resSmokeHuman.stdout, /Codex MCP smoke: ok/);

  // 5. doctor --smoke without --client codex throws usage error
  const resNoClient = await invoke(['doctor', '--smoke'], { env });
  assert.equal(resNoClient.code, 2);
  assert.match(resNoClient.stderr, /Smoke requires --client codex/);

  // 6. doctor --smoke with non-codex client throws usage error
  const resWrongClient = await invoke(['doctor', '--client', 'kiro', '--smoke'], { env });
  assert.equal(resWrongClient.code, 2);
  assert.match(resWrongClient.stderr, /Unsupported or duplicate Kiro doctor option/);
});

test('doctor --discovery runs discovery checks and legacy discovery emits deprecation hint', async () => {
  const fakeDiscovery = {
    schema_version: '1',
    name: 'XMemo Test Service',
    protocol: 'xmemo-discovery-v1',
    service: 'memory-os',
    urls: {
      docs: 'https://xmemo.dev/docs',
      mcp: 'https://xmemo.dev/mcp'
    },
    clients: ['cursor', 'codex']
  };

  const mockFetch = async (url) => {
    if (url.includes('agent-discovery.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => fakeDiscovery
      };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  // 1. doctor --discovery --json
  const resDoctorJson = await invoke(['doctor', '--discovery', '--json'], { fetch: mockFetch });
  assert.equal(resDoctorJson.code, 0);
  assert.equal(resDoctorJson.stderr, '');
  const parsedDoctor = JSON.parse(resDoctorJson.stdout);
  assert.equal(parsedDoctor.name, 'XMemo Test Service');

  // 2. legacy discovery show --json: no deprecation hint on stderr
  const resLegacyJson = await invoke(['discovery', 'show', '--json'], { fetch: mockFetch });
  assert.equal(resLegacyJson.code, 0);
  assert.equal(resLegacyJson.stderr, '');
  const parsedLegacy = JSON.parse(resLegacyJson.stdout);
  assert.deepEqual(parsedDoctor, parsedLegacy);

  // 3. doctor --discovery in human mode: clean stdout, empty stderr
  const resDoctorHuman = await invoke(['doctor', '--discovery'], { fetch: mockFetch });
  assert.equal(resDoctorHuman.code, 0);
  assert.equal(resDoctorHuman.stderr, '');
  assert.match(resDoctorHuman.stdout, /XMemo Test Service discovery/);

  // 4. legacy discovery show in human mode: emits deprecation hint on stderr
  const resLegacyHuman = await invoke(['discovery', 'show'], { fetch: mockFetch });
  assert.equal(resLegacyHuman.code, 0);
  assert.match(resLegacyHuman.stderr, /Note: 'xmemo discovery' is deprecated and will be removed in a future release. Use 'xmemo doctor --discovery' instead./);
  assert.match(resLegacyHuman.stdout, /XMemo Test Service discovery/);
});
