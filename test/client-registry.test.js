import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { run } from '../src/cli.js';
import {
  CLIENT_REGISTRY,
  allClientIds,
  allClients,
  getClient,
  resolveClientAlias,
  resolveClientId,
  supportedDoctorClientIds,
  supportedMcpClientIds,
  supportedMcpClients,
  supportedProfileClientIds,
  supportedSetupClientIds,
  supportedUninstallClientIds,
  usesClientOAuth
} from '../src/clients/registry.js';

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

test('client registry: contains exactly 24 supported clients with complete schema', () => {
  assert.equal(CLIENT_REGISTRY.length, 24);
  const ids = allClientIds();
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, 24, 'All client IDs must be unique');

  for (const client of CLIENT_REGISTRY) {
    assert.ok(client.id, 'client must have id');
    assert.ok(client.label, `client ${client.id} must have label`);
    assert.ok(Array.isArray(client.aliases), `client ${client.id} aliases must be array`);
    assert.equal(typeof client.setupAlias, 'string', `client ${client.id} setupAlias must be string`);
    assert.equal(typeof client.detect, 'function', `client ${client.id} detect must be function`);

    if (client.mcp !== null) {
      assert.ok(typeof client.mcp === 'object', `client ${client.id} mcp must be object`);
      assert.ok(typeof client.mcp.configKind === 'string', `client ${client.id} mcp.configKind must be string`);
      assert.ok(typeof client.mcp.defaultConfigPath === 'function', `client ${client.id} mcp.defaultConfigPath must be function`);
    }

    if (client.profile !== null) {
      assert.ok(typeof client.profile === 'object', `client ${client.id} profile must be object`);
      assert.ok(typeof client.profile.defaultTarget === 'function', `client ${client.id} profile.defaultTarget must be function`);
    }
  }
});

test('client registry: helper functions query registry correctly', () => {
  assert.equal(allClients().length, 24);
  assert.equal(supportedSetupClientIds().length, 24);
  assert.equal(supportedMcpClientIds().length, 24);
  assert.equal(supportedMcpClients().length, 24);
  assert.equal(supportedUninstallClientIds().length, 24);

  // Profile clients: 11 supported
  const profileIds = supportedProfileClientIds();
  assert.equal(profileIds.length, 11);
  for (const pid of profileIds) {
    assert.ok(getClient(pid)?.profile !== null, `${pid} must have profile`);
  }

  // Doctor clients: kiro supported
  const doctorIds = supportedDoctorClientIds();
  assert.deepEqual(doctorIds, ['kiro']);

  // Uninstall client list has zero duplicate entries
  const uninstallIds = supportedUninstallClientIds();
  assert.equal(new Set(uninstallIds).size, uninstallIds.length, 'No duplicate uninstall client IDs');
});

test('client registry: resolveClientId and resolveClientAlias handle canonical IDs and aliases', () => {
  // Canonical ID resolves to itself
  assert.equal(resolveClientId('codex'), 'codex');
  assert.equal(resolveClientId('cursor'), 'cursor');
  assert.equal(resolveClientId('gemini-cli'), 'gemini-cli');
  assert.equal(resolveClientId('claude-code'), 'claude-code');

  // Case insensitivity
  assert.equal(resolveClientId('Codex'), 'codex');
  assert.equal(resolveClientId('CURSOR'), 'cursor');

  // Setup aliases and alternate aliases
  assert.equal(resolveClientId('gemini'), 'gemini-cli');
  assert.equal(resolveClientId('kimi'), 'kimi-code');
  assert.equal(resolveClientId('kimi-cli'), 'kimi-code');
  assert.equal(resolveClientId('claudecode'), 'claude-code');
  assert.equal(resolveClientId('claude-cli'), 'claude-code');
  assert.equal(resolveClientId('devin-desktop'), 'windsurf');

  // Unknown alias returns null
  assert.equal(resolveClientId('unknown-client'), null);
  assert.equal(resolveClientId(''), null);
  assert.equal(resolveClientId(null), null);

  // resolveClientAlias falls back to input string if unknown
  assert.equal(resolveClientAlias('unknown-client'), 'unknown-client');
  assert.equal(resolveClientAlias('gemini'), 'gemini-cli');
});

test('client registry: getClient returns client definition or null', () => {
  const codex = getClient('codex');
  assert.ok(codex);
  assert.equal(codex.id, 'codex');
  assert.equal(codex.label, 'Codex');

  // Through alias
  const gemini = getClient('gemini');
  assert.ok(gemini);
  assert.equal(gemini.id, 'gemini-cli');

  assert.equal(getClient('nonexistent'), null);
});

test('client registry: usesClientOAuth identifies OAuth clients', () => {
  assert.equal(usesClientOAuth('codex'), false);
  assert.equal(usesClientOAuth('cursor'), false);
  assert.equal(usesClientOAuth('gemini-cli'), true);
  assert.equal(usesClientOAuth('gemini'), true);
  assert.equal(usesClientOAuth('antigravity'), true);
  assert.equal(usesClientOAuth('kiro'), true);
  assert.equal(usesClientOAuth('opencode'), true);
  assert.equal(usesClientOAuth('qwen'), true);
});

test('command acceptance: mcp config --client accepts all 24 supported MCP client IDs', async () => {
  for (const clientId of supportedMcpClientIds()) {
    const result = await invoke(['mcp', 'config', '--client', clientId, '--json']);
    assert.equal(result.code, 0, `mcp config --client ${clientId} must exit 0: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed, `mcp config --client ${clientId} must output valid JSON`);
  }
});

test('command acceptance: mcp add accepts all 24 supported MCP client IDs with --json', async () => {
  for (const clientId of supportedMcpClientIds()) {
    const result = await invoke(['mcp', 'add', clientId, '--json']);
    assert.equal(result.code, 0, `mcp add ${clientId} --json must exit 0: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.client, clientId);
  }
});

test('command acceptance: profile show accepts all 11 supported profile client IDs', async () => {
  for (const clientId of supportedProfileClientIds()) {
    const result = await invoke(['profile', 'show', clientId, '--json']);
    assert.equal(result.code, 0, `profile show ${clientId} --json must exit 0: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.client, clientId);
    assert.ok(parsed.block.includes('## XMemo memory'));
  }
});

test('command acceptance: doctor --client accepts supported doctor client IDs', async () => {
  for (const clientId of supportedDoctorClientIds()) {
    const result = await invoke(['doctor', '--client', clientId, '--json']);
    assert.doesNotMatch(result.stderr, /Unsupported doctor client/);
  }
});

test('rejection format: setup rejects unknown clients with consistent error format', async () => {
  const result = await invoke(['setup', 'nonexistent-agent', '--url', 'https://api.example.test']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unsupported setup client: nonexistent-agent\. Supported clients: /);
  for (const id of supportedSetupClientIds()) {
    assert.ok(result.stderr.includes(id), `setup error must list supported client ${id}`);
  }
});

test('rejection format: mcp config rejects unknown clients with consistent error format', async () => {
  const result = await invoke(['mcp', 'config', '--client', 'nonexistent-agent']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unsupported MCP client: nonexistent-agent\. Supported clients: /);
  for (const id of supportedMcpClientIds()) {
    assert.ok(result.stderr.includes(id), `mcp config error must list supported client ${id}`);
  }
});

test('rejection format: mcp add rejects unknown clients with consistent error format', async () => {
  const result = await invoke(['mcp', 'add', 'nonexistent-agent', '--json']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Supported MCP setup command: xmemo mcp add <.+> \[--url <url>\]/);
});

test('rejection format: profile install rejects unknown clients with consistent error format', async () => {
  const result = await invoke(['profile', 'install', 'nonexistent-agent']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unsupported profile client: nonexistent-agent\. Supported clients: /);
  for (const id of supportedProfileClientIds()) {
    assert.ok(result.stderr.includes(id), `profile error must list supported client ${id}`);
  }
});

test('rejection format: uninstall rejects unknown clients with consistent error format', async () => {
  const result = await invoke(['uninstall', 'nonexistent-agent']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unsupported uninstall client: nonexistent-agent\. Supported clients: /);
  for (const id of supportedUninstallClientIds()) {
    assert.ok(result.stderr.includes(id), `uninstall error must list supported client ${id}`);
  }
});

test('rejection format: doctor rejects unknown clients with consistent error format', async () => {
  const result = await invoke(['doctor', '--client', 'nonexistent-agent']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unsupported doctor client: nonexistent-agent\. Supported clients: /);
  for (const id of supportedDoctorClientIds()) {
    assert.ok(result.stderr.includes(id), `doctor error must list supported client ${id}`);
  }
});

test('uninstall error text: no duplicate openclaw in uninstall error', async () => {
  const result = await invoke(['uninstall']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Uninstall requires --all, --client <.+>, or a positional client id\./);

  const match = result.stderr.match(/<([^>]+)>/);
  assert.ok(match, 'Must contain <clients> in error text');
  const clientList = match[1].split('|');

  const openclawCount = clientList.filter((c) => c === 'openclaw').length;
  assert.equal(openclawCount, 1, 'openclaw must appear exactly once');

  assert.equal(new Set(clientList).size, clientList.length, 'Every client ID must appear exactly once');
  assert.equal(clientList.length, 24, 'All 24 registry client IDs must appear in uninstall error');
});

test('doctor output: labels remote discovery clients clearly as server-supported', async () => {
  const requests = [];
  const fakeFetch = async (url) => {
    requests.push(url);
    if (url.includes('agent-discovery.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schema_version: '1.0',
          protocol: 'https',
          service: 'memory-os',
          supported_clients: ['codex', 'copilot-cli', 'gemini-cli'],
          urls: { mcp: 'https://api.example.test/mcp' },
          security: { no_remote_code_execution: true, token_in_discovery: false },
          auth: { token_in_discovery: false }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ service: 'memory-os', version: '2.0.0' })
    };
  };

  const result = await invoke(['doctor', '--base-url', 'https://api.example.test'], {
    fetch: fakeFetch,
    nodeVersion: '22.0.0'
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Supported clients \(server\): codex, copilot-cli, gemini-cli/);
});
