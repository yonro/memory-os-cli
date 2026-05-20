import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { run } from '../src/cli.js';

test('help documents privacy defaults', async () => {
  const result = await invoke(['help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /no telemetry/i);
  assert.match(result.stdout, /no token in project files/i);
});

test('status does not send authorization tokens', async () => {
  const requests = [];
  const result = await invoke(['status', '--url', 'https://api.example.test', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    }
  });

  assert.equal(result.code, 0);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.init.headers.authorization, undefined);
  }
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('status uses hosted default service URL without sending tokens', async () => {
  const requests = [];
  const result = await invoke(['status', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    }
  });

  assert.equal(result.code, 0);
  assert.deepEqual(requests.map((request) => request.url), [
    'https://xmemo.dev/.well-known/memory-os.json',
    'https://xmemo.dev/health',
    'https://xmemo.dev/ready'
  ]);
  for (const request of requests) {
    assert.equal(request.init.headers.authorization, undefined);
  }
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('token set refuses plaintext storage unless explicit', async () => {
  const result = await invoke(['token', 'set', '--from-stdin'], {
    stdin: 'mem_os_test_token_1234567890'
  });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /refuses plaintext token storage/i);
});

test('mcp codex config references env var without leaking token value', async () => {
  const result = await invoke(['mcp', 'add', 'codex', '--url', 'https://api.example.test'], {
    env: {
      HOME: '/tmp/example-home',
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /bearer_token_env_var = "XMEMO_KEY"/);
  assert.match(result.stdout, /url = "https:\/\/api\.example\.test\/mcp"/);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp codex config uses hosted default service URL', async () => {
  const result = await invoke(['mcp', 'add', 'codex'], {
    env: {
      HOME: '/tmp/example-home',
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /url = "https:\/\/xmemo\.dev\/mcp"/);
  assert.match(result.stdout, /bearer_token_env_var = "XMEMO_KEY"/);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp list exposes supported clients without token values', async () => {
  const result = await invoke(['mcp', 'list', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  const clients = JSON.parse(result.stdout);
  assert.deepEqual(clients.map((client) => client.id), ['codex', 'cursor']);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('doctor validates agent discovery without sending token values', async () => {
  const requests = [];
  const result = await invoke(['doctor', '--base-url', 'https://api.example.test', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' },
    fetch: agentDiscoveryFetch(requests)
  });

  assert.equal(result.code, 0);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.init.headers.authorization, undefined);
  }

  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.cli.version, '0.4.126');
  assert.equal(report.discovery.mcpUrl, 'https://api.example.test/mcp');
  assert.deepEqual(report.discovery.supportedClients, ['codex', 'copilot-cli', 'gemini-cli']);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('discovery show returns read-only agent discovery', async () => {
  const requests = [];
  const result = await invoke(['discovery', 'show', '--base-url', 'https://api.example.test', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' },
    fetch: agentDiscoveryFetch(requests)
  });

  assert.equal(result.code, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers.authorization, undefined);

  const discovery = JSON.parse(result.stdout);
  assert.equal(discovery.service, 'memory-os');
  assert.equal(discovery.security.no_remote_code_execution, true);
  assert.equal(discovery.security.token_in_discovery, false);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp config emits generic template without token values', async () => {
  const result = await invoke(['mcp', 'config', '--client', 'generic', '--base-url', 'https://api.example.test', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  const template = JSON.parse(result.stdout);
  assert.equal(template.client, 'generic');
  assert.equal(template.snippet.mcpServers['memory-os'].url, 'https://api.example.test/mcp');
  assert.equal(template.snippet.mcpServers['memory-os'].headers.Authorization, 'Bearer ${XMEMO_KEY}');
  assert.equal(template.snippet.mcpServers['memory-os'].headers['X-Memory-OS-Agent-ID'], 'generic');
  assert.equal(template.snippet.mcpServers['memory-os'].headers['X-Memory-OS-Agent-Instance-ID'], '${XMEMO_AGENT_INSTANCE_ID}');
  assert.equal(template.writesTokenValue, false);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('env example emits shell-specific placeholders', async () => {
  const result = await invoke(['env', 'example', '--shell', 'bash', '--base-url', 'https://api.example.test'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /export MEMORY_OS_URL="https:\/\/api\.example\.test"/);
  assert.match(result.stdout, /export XMEMO_KEY="<paste-token-from-your-secret-store>"/);
  assert.match(result.stdout, /export XMEMO_AGENT_ID="<agent-family>"/);
  assert.match(result.stdout, /export XMEMO_AGENT_INSTANCE_ID="<stable-random-id-for-this-local-agent>"/);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp cursor config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-cli-'));
  const configPath = path.join(tempDir, 'mcp.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcpServers: { existing: { url: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'cursor', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: {
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.existing.url, 'https://existing.example/mcp');
  assert.equal(config.mcpServers.memory_os.url, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.memory_os.headers.Authorization, 'Bearer ${env:XMEMO_KEY}');
  assert.equal(config.mcpServers.memory_os.headers['X-Memory-OS-Agent-ID'], 'cursor');
  assert.match(config.mcpServers.memory_os.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-cursor-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);

  const identity = JSON.parse(await fs.readFile(path.join(tempDir, 'agent-instances', 'cursor.json'), 'utf8'));
  assert.equal(identity.agentInstanceId, config.mcpServers.memory_os.headers['X-Memory-OS-Agent-Instance-ID']);
});

test('setup discovers hosted service without sending token values', async () => {
  const requests = [];
  const result = await invoke(['setup', '--url', 'https://api.example.test', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' },
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/.well-known/memory-os.json')) {
        return jsonResponse({
          service: 'memory-os',
          urls: {
            api_base: 'https://api.example.test',
            mcp: 'https://mcp.example.test/mcp',
            guide: 'https://api.example.test/guide',
            docs: 'https://docs.example.test/memory-os',
            token_portal: 'https://console.example.test/tokens',
            onboarding_status: 'https://api.example.test/v1/onboarding/status'
          },
          clients: {
            mcp: [
              { id: 'codex', config_endpoint: 'https://api.example.test/v1/mcp/config/codex' },
              { id: 'cursor', config_endpoint: 'https://api.example.test/v1/mcp/config/cursor' }
            ]
          },
          auth: {
            token_env_var: 'XMEMO_KEY',
            token_in_discovery: false
          },
          agent_boundary: {
            client_allowed: ['discover_service', 'configure_local_mcp'],
            admin_required: ['issue_token', 'run_database_migration']
          }
        });
      }
      return jsonResponse({
        ready: true,
        requirements: {
          token_required: true,
          token_env_var: 'XMEMO_KEY',
          token_portal_url: 'https://console.example.test/tokens'
        }
      });
    }
  });

  assert.equal(result.code, 0);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.init.headers.authorization, undefined);
  }

  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mcpUrl, 'https://mcp.example.test/mcp');
  assert.equal(plan.tokenPortalUrl, 'https://console.example.test/tokens');
  assert.deepEqual(plan.boundaries.adminRequired, ['issue_token', 'run_database_migration']);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('setup writes cursor config from discovered mcp url without token value', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-'));
  const result = await invoke(['setup', '--url', 'https://api.example.test', '--client', 'cursor', '--write', '--json'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);

  const configPath = path.join(tempDir, '.cursor', 'mcp.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.memory_os.url, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.memory_os.headers.Authorization, 'Bearer ${env:XMEMO_KEY}');
  assert.equal(config.mcpServers.memory_os.headers['X-Memory-OS-Agent-ID'], 'cursor');
  assert.match(config.mcpServers.memory_os.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-cursor-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('codex setup writes env-referenced config and smoke validates it', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-codex-'));
  const env = {
    HOME: tempDir,
    MEMORY_OS_CONFIG_HOME: tempDir,
    XMEMO_KEY: 'secret-token-that-must-not-leak'
  };
  const setup = await invoke(['setup', '--url', 'https://api.example.test', '--client', 'codex', '--write', '--json'], {
    env,
    fetch: discoveryFetch()
  });

  assert.equal(setup.code, 0);
  assert.doesNotMatch(setup.stdout, /secret-token-that-must-not-leak/);

  const configPath = path.join(tempDir, '.codex', 'config.toml');
  const config = await fs.readFile(configPath, 'utf8');
  assert.match(config, /\[mcp_servers\.memory_os\]/);
  assert.match(config, /url = "https:\/\/mcp\.example\.test\/mcp"/);
  assert.match(config, /bearer_token_env_var = "XMEMO_KEY"/);
  assert.doesNotMatch(config, /secret-token-that-must-not-leak/);

  const smoke = await invoke(['smoke', '--client', 'codex', '--config', configPath, '--json'], { env });

  assert.equal(smoke.code, 0);
  assert.doesNotMatch(smoke.stdout, /secret-token-that-must-not-leak/);
  const report = JSON.parse(smoke.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.client, 'codex');
  assert.equal(report.mcpUrl, 'https://mcp.example.test/mcp');
  assert.equal(report.tokenEnvVar, 'XMEMO_KEY');
  assert.equal(report.checks.find((check) => check.name === 'bearer_token_env_var').ok, true);
  assert.equal(report.checks.find((check) => check.name === 'agent_instance_identity_file').ok, true);
});

test('setup codex shorthand previews project profile without writing files', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-codex-preview-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');
  const result = await invoke(['setup', 'codex', '--url', 'https://api.example.test', '--profile-target', profilePath, '--json'], {
    env: {
      HOME: tempDir,
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'codex');
  assert.equal(plan.selectedClient.written, false);
  assert.equal(plan.selectedClient.codexProfile.targetPath, profilePath);
  assert.equal(plan.selectedClient.codexProfile.written, false);
  assert.equal(plan.selectedClient.codexProfile.changed, true);
  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('setup codex --yes writes mcp config and marker-scoped project profile', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-codex-yes-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');
  const env = {
    HOME: tempDir,
    MEMORY_OS_CONFIG_HOME: tempDir,
    XMEMO_KEY: 'secret-token-that-must-not-leak'
  };
  const result = await invoke(['setup', 'codex', '--url', 'https://api.example.test', '--yes', '--profile-target', profilePath, '--json'], {
    env,
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.codexProfile.written, true);
  assert.equal(plan.selectedClient.codexProfile.writesTokenValue, false);

  const config = await fs.readFile(path.join(tempDir, '.codex', 'config.toml'), 'utf8');
  assert.match(config, /bearer_token_env_var = "XMEMO_KEY"/);
  assert.doesNotMatch(config, /secret-token-that-must-not-leak/);

  const profile = await fs.readFile(profilePath, 'utf8');
  assert.match(profile, /<!-- memory-os:codex-profile:start -->/);
  assert.match(profile, /<!-- memory-os:codex-profile:end -->/);
  assert.match(profile, /Use Memory OS deliberately through MCP/);
  assert.doesNotMatch(profile, /secret-token-that-must-not-leak/);
});

test('profile install, status, and uninstall preserve user AGENTS content', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-profile-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');
  await fs.writeFile(profilePath, '# Project instructions\n\nKeep this line.\n');

  const install = await invoke(['profile', 'install', 'codex', '--target', profilePath, '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });
  assert.equal(install.code, 0);
  assert.doesNotMatch(install.stdout, /secret-token-that-must-not-leak/);

  const installed = await fs.readFile(profilePath, 'utf8');
  assert.match(installed, /# Project instructions/);
  assert.match(installed, /Keep this line\./);
  assert.equal((installed.match(/memory-os:codex-profile:start/g) ?? []).length, 1);

  const reinstall = await invoke(['profile', 'install', 'codex', '--target', profilePath, '--json']);
  assert.equal(reinstall.code, 0);
  const afterReinstall = await fs.readFile(profilePath, 'utf8');
  assert.equal((afterReinstall.match(/memory-os:codex-profile:start/g) ?? []).length, 1);

  const status = await invoke(['profile', 'status', 'codex', '--target', profilePath, '--json']);
  assert.equal(status.code, 0);
  assert.equal(JSON.parse(status.stdout).installed, true);

  const uninstall = await invoke(['profile', 'uninstall', 'codex', '--target', profilePath, '--json']);
  assert.equal(uninstall.code, 0);
  const uninstalled = await fs.readFile(profilePath, 'utf8');
  assert.match(uninstalled, /Keep this line\./);
  assert.doesNotMatch(uninstalled, /memory-os:codex-profile:start/);
});

test('profile install fails closed on incomplete marker block', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-profile-bad-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');
  await fs.writeFile(profilePath, '<!-- memory-os:codex-profile:start -->\n');

  const result = await invoke(['profile', 'install', 'codex', '--target', profilePath]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /markers are incomplete/i);
});

test('codex memory behavior profile documents recall and write-back', async () => {
  const result = await invoke(['mcp', 'profile', 'codex', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const profile = JSON.parse(result.stdout);
  assert.equal(profile.client, 'codex');
  assert.equal(profile.mcpServerName, 'memory_os');
  assert.match(profile.instructions.join('\n'), /recall\/search/);
  assert.match(profile.instructions.join('\n'), /write a concise Memory OS memory/);
});

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';

  const code = await run(args, {
    env: options.env ?? {},
    stdin: Readable.from([options.stdin ?? '']),
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    fetch: options.fetch
  });

  return { code, stdout, stderr };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

function discoveryFetch() {
  return async (url) => {
    if (url.endsWith('/.well-known/memory-os.json')) {
      return jsonResponse({
        service: 'memory-os',
        urls: {
          api_base: 'https://api.example.test',
          mcp: 'https://mcp.example.test/mcp',
          token_portal: 'https://console.example.test/tokens',
          onboarding_status: 'https://api.example.test/v1/onboarding/status'
        },
        auth: {
          token_env_var: 'XMEMO_KEY'
        }
      });
    }

    return jsonResponse({ ready: true });
  };
}

function agentDiscoveryFetch(requests) {
  return async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/.well-known/agent-discovery.json')) {
      return jsonResponse({
        service: 'memory-os',
        name: 'Memory OS',
        schema_version: '1.0',
        protocol: 'mcp',
        urls: {
          docs: 'https://docs.example.test/memory-os',
          root_discovery: 'https://api.example.test/.well-known/memory-os.json'
        },
        api: {
          mcp: {
            url: 'https://api.example.test/mcp'
          }
        },
        clients: [
          { id: 'codex' },
          { id: 'copilot-cli' },
          { id: 'gemini-cli' }
        ],
        security: {
          no_remote_code_execution: true,
          token_in_discovery: false
        },
        auth: {
          token_in_discovery: false
        }
      });
    }

    if (url.endsWith('/.well-known/memory-os.json')) {
      return jsonResponse({
        service: 'memory-os',
        version: '0.4.124'
      });
    }

    return { ok: false, status: 404 };
  };
}
