import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { run } from '../src/cli.js';

test('help documents privacy defaults', async () => {
  const result = await invoke(['help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /XMemo CLI/);
  assert.match(result.stdout, /@xmemo\/client/);
  assert.match(result.stdout, /Legacy command: memory-os/);
  assert.match(result.stdout, /xmemo setup/);
  assert.match(result.stdout, /xmemo login/);
  assert.match(result.stdout, /xmemo doctor/);
  assert.match(result.stdout, /ZERO Telemetry/i);
  assert.match(result.stdout, /never written to project configs/i);
});

test('update dry-run documents npm global install command', async () => {
  const result = await invoke(['update', '--dry-run', '--json']);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.package, '@xmemo/client');
  assert.equal(payload.dryRun, true);
  assert.deepEqual(payload.command.slice(1), ['install', '-g', '@xmemo/client@latest']);
  assert.match(payload.command[0], /^npm(\.cmd)?$/);
  assert.equal(payload.tokenSent, false);
  assert.equal(payload.projectFilesModified, false);
});

test('update runs npm global install and streams progress', async () => {
  const calls = [];
  const result = await invoke(['update'], {
    spawn: spawnStub(calls, { code: 0, stdout: 'updated package\n' })
  });

  assert.equal(result.code, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /^npm(\.cmd)?$/);
  assert.deepEqual(calls[0].args, ['install', '-g', '@xmemo/client@latest']);
  assert.match(result.stdout, /updated package/);
  assert.match(result.stdout, /Update complete/);
});

test('--update alias supports dry-run', async () => {
  const result = await invoke(['--update', '--dry-run']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /npm(\.cmd)? install -g @xmemo\/client@latest/);
  assert.match(result.stdout, /Dry run only/);
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

test('login from stdin stores token in user credential file without printing it', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-login-'));
  const token = 'mem_os_test_token_1234567890';
  const result = await invoke(['login', '--from-stdin', '--json'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    stdin: token
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, new RegExp(token));
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tokenPrinted, false);
  assert.equal(payload.projectFilesModified, false);

  const credential = JSON.parse(await fs.readFile(path.join(tempDir, 'credentials.json'), 'utf8'));
  assert.equal(credential.token, token);
  assert.equal(credential.storage, 'user-scoped-credential-file');
});

test('token add from stdin stores token and status sees user credential', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-token-add-'));
  const token = 'mem_os_test_token_1234567890';
  const add = await invoke(['token', 'add', '--from-stdin'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    stdin: token
  });

  assert.equal(add.code, 0);
  assert.doesNotMatch(add.stdout, new RegExp(token));

  const status = await invoke(['token', 'status'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir }
  });
  assert.equal(status.code, 0);
  assert.match(status.stdout, /User credential file: present/);
  assert.doesNotMatch(status.stdout, new RegExp(token));
});

test('auth status reports login state without printing tokens', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-auth-status-'));
  const token = 'mem_os_test_token_1234567890';
  await invoke(['login', '--from-stdin'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    stdin: token
  });

  const status = await invoke(['auth', 'status', '--json'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir }
  });

  assert.equal(status.code, 0);
  assert.doesNotMatch(status.stdout, new RegExp(token));
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.loggedIn, true);
  assert.equal(payload.tokenSource, 'user-credential-file');
  assert.equal(payload.userCredentialFile.present, true);
  assert.equal(payload.privacy.tokenPrinted, false);
  assert.equal(payload.privacy.projectFilesModified, false);
});

test('auth status shows stored device-login account without token warning noise', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-auth-account-'));
  const token = 'mem_os_test_token_1234567890';
  await invoke(['login', '--from-stdin'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    stdin: token
  });
  const credentialPath = path.join(tempDir, 'credentials.json');
  const credential = JSON.parse(await fs.readFile(credentialPath, 'utf8'));
  credential.metadata.account = {
    userId: 'usr_real',
    email: 'real@example.test',
    displayName: 'Real User'
  };
  await fs.writeFile(credentialPath, `${JSON.stringify(credential, null, 2)}\n`);

  const status = await invoke(['auth', 'status'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir }
  });

  assert.equal(status.code, 0);
  assert.match(status.stdout, /Account: Real User <real@example\.test>/);
  assert.match(status.stdout, /Credential is ready; token value remains hidden\./);
  assert.doesNotMatch(status.stdout, /User credential file:/);
  assert.doesNotMatch(status.stdout, new RegExp(credentialPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(status.stdout, /Token values are never printed/);
  assert.doesNotMatch(status.stdout, new RegExp(token));
});

test('token status verify uses stored credential without printing it', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-token-verify-'));
  const token = 'mem_os_test_token_1234567890';
  await invoke(['token', 'add', '--from-stdin'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    stdin: token
  });
  const requests = [];
  const status = await invoke(['token', 'status', '--verify', '--base-url', 'https://api.example.test'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    }
  });

  assert.equal(status.code, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.example.test/mcp');
  assert.equal(requests[0].init.headers.authorization, `Bearer ${token}`);
  assert.doesNotMatch(status.stdout, new RegExp(token));
});

test('device login stores issued token without printing it', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-device-login-'));
  const token = 'mem_os_device_token_1234567890';
  const requests = [];
  const result = await invoke(['login', '--base-url', 'https://api.example.test', '--json'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/api/v1/auth/device/start')) {
        return jsonResponse({
          device_code: 'device-code-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://api.example.test/device',
          interval: 1,
          expires_in: 600
        });
      }
      return jsonResponse({
        access_token: token,
        user: {
          user_id: 'usr_real',
          email: 'real@example.test',
          display_name: 'Real User'
        }
      });
    }
  });

  assert.equal(result.code, 0);
  assert.equal(requests.length, 2);
  assert.doesNotMatch(result.stdout, new RegExp(token));
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.deviceLogin, true);
  assert.deepEqual(payload.account, {
    userId: 'usr_real',
    email: 'real@example.test',
    displayName: 'Real User'
  });
  const credential = JSON.parse(await fs.readFile(path.join(tempDir, 'credentials.json'), 'utf8'));
  assert.equal(credential.token, token);
  assert.equal(credential.metadata.source, 'device-login');
  assert.deepEqual(credential.metadata.account, payload.account);
});

test('device login waits for the service approval window by default', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-device-login-window-'));
  const token = 'mem_os_device_token_1234567890';
  const originalNow = Date.now;
  const nowValues = [0, 0, 31_000];
  const sleeps = [];
  let polls = 0;
  Date.now = () => nowValues.shift() ?? 31_000;
  try {
    const result = await invoke(['login', '--base-url', 'https://api.example.test', '--json'], {
      env: { MEMORY_OS_CONFIG_HOME: tempDir },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: async (url) => {
        if (url.endsWith('/api/v1/auth/device/start')) {
          return jsonResponse({
            device_code: 'device-code-1',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://api.example.test/device',
            interval: 1,
            expires_in: 600
          });
        }
        polls += 1;
        if (polls === 1) {
          return devicePendingResponse();
        }
        return jsonResponse({ access_token: token });
      }
    });

    assert.equal(result.code, 0);
    assert.deepEqual(sleeps, [1000]);
    assert.equal(polls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test('device login text confirms account and no extra token configuration', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-device-login-text-'));
  const token = 'mem_os_device_token_1234567890';
  const result = await invoke(['login', '--base-url', 'https://api.example.test'], {
    env: { MEMORY_OS_CONFIG_HOME: tempDir },
    fetch: async (url) => {
      if (url.endsWith('/api/v1/auth/device/start')) {
        return jsonResponse({
          device_code: 'device-code-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://api.example.test/device',
          interval: 1,
          expires_in: 600
        });
      }
      return jsonResponse({
        access_token: token,
        user: {
          user_id: 'usr_real',
          email: 'real@example.test',
          display_name: 'Real User'
        }
      });
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Signed in as: Real User <real@example\.test>/);
  assert.match(result.stdout, /No extra token configuration is required\./);
  assert.doesNotMatch(result.stdout, /Verify with: xmemo token status --verify/);
  assert.doesNotMatch(result.stdout, new RegExp(token));
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
  assert.deepEqual(clients.map((client) => client.id), ['codex', 'cursor', 'gemini-cli', 'antigravity', 'antigravity-ide', 'antigravity2', 'antigravity-cli', 'windsurf', 'cline', 'continue', 'claude-desktop', 'openclaw', 'kiro', 'zed', 'jetbrains', 'opencode', 'hermes', 'qwen', 'trae', 'trae-solo', 'claude-code', 'copilot-cli']);
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
  assert.equal(report.cli.package, '@xmemo/client');
  assert.equal(report.cli.version, '0.4.155');
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
  assert.equal(template.snippet.mcpServers['XMemo'].url, 'https://api.example.test/mcp');
  assert.equal(template.snippet.mcpServers['XMemo'].headers.Authorization, 'Bearer ${XMEMO_KEY}');
  assert.equal(template.snippet.mcpServers['XMemo'].headers['X-Memory-OS-Agent-ID'], 'generic');
  assert.equal(template.snippet.mcpServers['XMemo'].headers['X-Memory-OS-Agent-Instance-ID'], '${XMEMO_AGENT_INSTANCE_ID}');
  assert.equal(template.writesTokenValue, false);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp cursor config uses Cursor env reference syntax and generated identity guidance', async () => {
  const result = await invoke(['mcp', 'config', '--client', 'cursor', '--base-url', 'https://api.example.test', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  const template = JSON.parse(result.stdout);
  assert.equal(template.client, 'cursor');
  assert.equal(template.serverName, 'XMemo');
  assert.equal(template.snippet.mcpServers.XMemo.url, 'https://api.example.test/mcp');
  assert.equal(template.snippet.mcpServers.XMemo.headers.Authorization, 'Bearer ${env:XMEMO_KEY}');
  assert.equal(template.snippet.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'cursor');
  assert.equal(template.snippet.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], '${XMEMO_AGENT_INSTANCE_ID}');
  assert.equal(template.agentInstanceGeneration.automaticCommand, 'xmemo mcp add cursor --write');
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp config for copilot-cli uses local proxy without token headers by default', async () => {
  const result = await invoke(['mcp', 'config', '--client', 'copilot-cli', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  const template = JSON.parse(result.stdout);
  assert.equal(template.client, 'copilot-cli');
  assert.equal(template.snippet.mcpServers['XMemo'].url, 'http://127.0.0.1:8765/mcp');
  assert.equal(template.snippet.mcpServers['XMemo'].headers, undefined);
  assert.equal(template.requiresLocalCommand, 'xmemo mcp proxy --port 8765');
  assert.equal(template.writesTokenValue, false);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp config for copilot-cli can still emit remote env template', async () => {
  const result = await invoke(['mcp', 'config', '--client', 'copilot-cli', '--remote-env', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  const template = JSON.parse(result.stdout);
  assert.equal(template.snippet.mcpServers['XMemo'].url, 'https://xmemo.dev/mcp');
  assert.equal(template.snippet.mcpServers['XMemo'].headers.Authorization, 'Bearer ${XMEMO_KEY}');
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('mcp config for antigravity emits OAuth serverUrl config without token env', async () => {
  const result = await invoke(['mcp', 'config', '--client', 'antigravity', '--base-url', 'https://api.example.test', '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  const template = JSON.parse(result.stdout);
  assert.equal(template.client, 'antigravity');
  assert.equal(template.authentication, 'oauth');
  assert.deepEqual(template.requiresEnv, []);
  assert.equal(template.snippet.mcpServers.XMemo.serverUrl, 'https://api.example.test/mcp');
  assert.equal(template.snippet.mcpServers.XMemo.url, undefined);
  assert.equal(template.snippet.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(template.snippet.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.equal(template.snippet.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], '${XMEMO_AGENT_INSTANCE_ID}');
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
});

test('env example emits shell-specific placeholders', async () => {
  const result = await invoke(['env', 'example', '--shell', 'bash', '--base-url', 'https://api.example.test'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /export XMEMO_URL="https:\/\/api\.example\.test"/);
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
  assert.equal(config.mcpServers.XMemo.url, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.headers.Authorization, 'Bearer ${env:XMEMO_KEY}');
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'cursor');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-cursor-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);

  const identity = JSON.parse(await fs.readFile(path.join(tempDir, 'agent-instances', 'cursor.json'), 'utf8'));
  assert.equal(identity.agentInstanceId, config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID']);
});

test('mcp antigravity config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-antigravity-'));
  const configPath = path.join(tempDir, 'mcp_config.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcpServers: { existing: { serverUrl: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'antigravity', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: {
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  assert.match(result.stdout, /will complete MCP OAuth on first use/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.existing.serverUrl, 'https://existing.example/mcp');
  assert.equal(config.mcpServers.XMemo.serverUrl, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.url, undefined);
  assert.equal(config.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);

  const identity = JSON.parse(await fs.readFile(path.join(tempDir, 'agent-instances', 'antigravity.json'), 'utf8'));
  assert.equal(identity.agentInstanceId, config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID']);
});

test('mcp antigravity-ide config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-antigravity-ide-'));
  const configPath = path.join(tempDir, 'mcp.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcpServers: { existing: { url: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'antigravity-ide', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: {
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  assert.match(result.stdout, /will complete MCP OAuth on first use/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.existing.url, 'https://existing.example/mcp');
  assert.equal(config.mcpServers.XMemo.type, 'http');
  assert.equal(config.mcpServers.XMemo.url, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('mcp antigravity2 config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-antigravity2-'));
  const configPath = path.join(tempDir, 'mcp.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcpServers: { existing: { url: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'antigravity2', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: {
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  assert.match(result.stdout, /will complete MCP OAuth on first use/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.existing.url, 'https://existing.example/mcp');
  assert.equal(config.mcpServers.XMemo.type, 'http');
  assert.equal(config.mcpServers.XMemo.url, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('mcp antigravity-cli config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-antigravity-cli-'));
  const configPath = path.join(tempDir, 'settings.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcpServers: { existing: { url: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'antigravity-cli', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: {
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  assert.match(result.stdout, /will complete MCP OAuth on first use/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.existing.url, 'https://existing.example/mcp');
  assert.equal(config.mcpServers.XMemo.httpUrl, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.url, undefined);
  assert.equal(config.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('mcp qwen config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-qwen-'));
  const configPath = path.join(tempDir, 'settings.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcpServers: { existing: { url: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'qwen', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: {
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.existing.url, 'https://existing.example/mcp');
  assert.equal(config.mcpServers.XMemo.httpUrl, 'https://api.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.url, undefined);
  assert.equal(config.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'qwen');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-qwen-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('mcp opencode config can be merged into a user-scoped json file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-opencode-'));
  const configPath = path.join(tempDir, 'opencode.json');
  await fs.writeFile(configPath, `${JSON.stringify({ mcp: { existing: { type: 'remote', url: 'https://existing.example/mcp' } } }, null, 2)}\n`);

  const result = await invoke(['mcp', 'add', 'opencode', '--url', 'https://api.example.test', '--write', '--config', configPath], {
    env: {
      MEMORY_OS_CONFIG_HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    }
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);

  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcp.existing.url, 'https://existing.example/mcp');
  assert.equal(config.mcp.XMemo.type, 'remote');
  assert.equal(config.mcp.XMemo.url, 'https://api.example.test/mcp');
  assert.equal(config.mcp.XMemo.enabled, true);
  assert.equal(config.mcp.XMemo.headers.Authorization, undefined);
  assert.equal(config.mcp.XMemo.headers['X-Memory-OS-Agent-ID'], 'opencode');
  assert.match(config.mcp.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-opencode-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
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
  assert.equal(config.mcpServers.XMemo.url, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.headers.Authorization, 'Bearer ${env:XMEMO_KEY}');
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'cursor');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-cursor-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('setup cursor shorthand writes config by default', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-cursor-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'cursor');
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.behaviorProfile.targetPath, path.join(tempDir, '.cursor', 'memory-profile.md'));
  assert.equal(plan.selectedClient.behaviorProfile.written, true);
  assert.equal(plan.selectedClient.behaviorProfile.writesTokenValue, false);

  const config = JSON.parse(await fs.readFile(path.join(tempDir, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(config.mcpServers.XMemo.url, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.headers.Authorization, 'Bearer ${env:XMEMO_KEY}');

  const profile = await fs.readFile(path.join(tempDir, '.cursor', 'memory-profile.md'), 'utf8');
  assert.match(profile, /XMemo Cursor profile/);
  assert.match(profile, /recall\/search/);
  assert.doesNotMatch(profile, /secret-token-that-must-not-leak/);
});

test('setup --all auto-detects and configures all local clients', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-all-'));
  
  await fs.mkdir(path.join(tempDir, '.cursor'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.continue'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.qwen'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.config', 'opencode'), { recursive: true });
  
  const traeConfigDir = process.platform === 'win32'
    ? path.join(tempDir, 'AppData', 'Roaming', 'Trae', 'User')
    : process.platform === 'darwin'
      ? path.join(tempDir, 'Library', 'Application Support', 'Trae', 'User')
      : path.join(tempDir, '.config', 'Trae', 'User');
  await fs.mkdir(traeConfigDir, { recursive: true });

  const traeSoloConfigDir = process.platform === 'win32'
    ? path.join(tempDir, 'AppData', 'Roaming', 'TRAE SOLO', 'User')
    : process.platform === 'darwin'
      ? path.join(tempDir, 'Library', 'Application Support', 'TRAE SOLO', 'User')
      : path.join(tempDir, '.config', 'TRAE SOLO', 'User');
  await fs.mkdir(traeSoloConfigDir, { recursive: true });
  
  const result = await invoke(['setup', '--all', '--write', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      USERPROFILE: tempDir,
      APPDATA: path.join(tempDir, 'AppData', 'Roaming'),
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.detectedClients.length, 6);
  
  const cursorPlan = plan.detectedClients.find(c => c.id === 'cursor');
  const continuePlan = plan.detectedClients.find(c => c.id === 'continue');
  const qwenPlan = plan.detectedClients.find(c => c.id === 'qwen');
  const opencodePlan = plan.detectedClients.find(c => c.id === 'opencode');
  const traePlan = plan.detectedClients.find(c => c.id === 'trae');
  const traeSoloPlan = plan.detectedClients.find(c => c.id === 'trae-solo');
  
  assert.ok(cursorPlan);
  assert.ok(continuePlan);
  assert.ok(qwenPlan);
  assert.ok(opencodePlan);
  assert.ok(traePlan);
  assert.ok(traeSoloPlan);
  assert.equal(cursorPlan.written, true);
  assert.equal(continuePlan.written, true);
  assert.equal(qwenPlan.written, true);
  assert.equal(opencodePlan.written, true);
  assert.equal(traePlan.written, true);
  assert.equal(traeSoloPlan.written, true);

  const cursorConfig = JSON.parse(await fs.readFile(path.join(tempDir, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(cursorConfig.mcpServers.XMemo.url, 'https://mcp.example.test/mcp');

  const continueConfig = JSON.parse(await fs.readFile(path.join(tempDir, '.continue', 'config.json'), 'utf8'));
  assert.equal(continueConfig.mcpServers.XMemo.transport.url, 'https://mcp.example.test/mcp');

  const qwenConfig = JSON.parse(await fs.readFile(path.join(tempDir, '.qwen', 'settings.json'), 'utf8'));
  assert.equal(qwenConfig.mcpServers.XMemo.httpUrl, 'https://mcp.example.test/mcp');
  assert.equal(qwenConfig.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(qwenConfig.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'qwen');
  assert.match(qwenConfig.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-qwen-/);

  const opencodeConfig = JSON.parse(await fs.readFile(path.join(tempDir, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.equal(opencodeConfig.mcp.XMemo.type, 'remote');
  assert.equal(opencodeConfig.mcp.XMemo.url, 'https://mcp.example.test/mcp');
  assert.equal(opencodeConfig.mcp.XMemo.enabled, true);
  assert.equal(opencodeConfig.mcp.XMemo.headers.Authorization, undefined);
  assert.equal(opencodeConfig.mcp.XMemo.headers['X-Memory-OS-Agent-ID'], 'opencode');
  assert.match(opencodeConfig.mcp.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-opencode-/);

  const traeConfig = JSON.parse(await fs.readFile(path.join(traeConfigDir, 'mcp.json'), 'utf8'));
  assert.equal(traeConfig.mcpServers.XMemo.command, 'npx');
  assert.deepEqual(traeConfig.mcpServers.XMemo.args, [
    '-y',
    'mcp-remote',
    'https://mcp.example.test/mcp',
    '--header',
    'Authorization:Bearer ${XMEMO_KEY}',
    '--header',
    'X-Memory-OS-Agent-ID:trae',
    '--header',
    'X-Memory-OS-Agent-Instance-ID:${XMEMO_AGENT_INSTANCE_ID}'
  ]);
  assert.equal(traeConfig.mcpServers.XMemo.env.XMEMO_KEY, '${env:XMEMO_KEY}');
  assert.match(traeConfig.mcpServers.XMemo.env.XMEMO_AGENT_INSTANCE_ID, /^xmemo-trae-/);

  const traeSoloConfig = JSON.parse(await fs.readFile(path.join(traeSoloConfigDir, 'mcp.json'), 'utf8'));
  assert.equal(traeSoloConfig.mcpServers.XMemo.command, 'npx');
  assert.deepEqual(traeSoloConfig.mcpServers.XMemo.args, [
    '-y',
    'mcp-remote',
    'https://mcp.example.test/mcp',
    '--header',
    'Authorization:Bearer ${XMEMO_KEY}',
    '--header',
    'X-Memory-OS-Agent-ID:trae-solo',
    '--header',
    'X-Memory-OS-Agent-Instance-ID:${XMEMO_AGENT_INSTANCE_ID}'
  ]);
  assert.equal(traeSoloConfig.mcpServers.XMemo.env.XMEMO_KEY, '${env:XMEMO_KEY}');
  assert.match(traeSoloConfig.mcpServers.XMemo.env.XMEMO_AGENT_INSTANCE_ID, /^xmemo-trae-solo-/);
});

test('setup --all --profile writes behavior profiles for detected clients', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-all-profile-'));
  
  await fs.mkdir(path.join(tempDir, '.cursor'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.trae'), { recursive: true });
  
  const traeConfigDir = process.platform === 'win32'
    ? path.join(tempDir, 'AppData', 'Roaming', 'Trae', 'User')
    : process.platform === 'darwin'
      ? path.join(tempDir, 'Library', 'Application Support', 'Trae', 'User')
      : path.join(tempDir, '.config', 'Trae', 'User');
  await fs.mkdir(traeConfigDir, { recursive: true });

  const result = await invoke(['setup', '--all', '--write', '--profile', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      USERPROFILE: tempDir,
      APPDATA: path.join(tempDir, 'AppData', 'Roaming'),
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  const plan = JSON.parse(result.stdout);
  const cursorPlan = plan.detectedClients.find(c => c.id === 'cursor');
  const traePlan = plan.detectedClients.find(c => c.id === 'trae');
  
  assert.ok(cursorPlan);
  assert.equal(cursorPlan.written, true);
  assert.ok(cursorPlan.behaviorProfile);
  assert.equal(cursorPlan.behaviorProfile.installed, true);

  assert.ok(traePlan);
  assert.equal(traePlan.written, true);
  assert.ok(traePlan.behaviorProfile);
  assert.equal(traePlan.behaviorProfile.installed, true);

  const profile = await fs.readFile(path.join(tempDir, '.cursor', 'memory-profile.md'), 'utf8');
  assert.match(profile, /XMemo Cursor profile/);
  assert.match(profile, /recall\/search/);

  const traeProfile = await fs.readFile(path.join(tempDir, '.trae', 'memory-profile.md'), 'utf8');
  assert.match(traeProfile, /XMemo Trae profile/);
  assert.match(traeProfile, /recall\/search/);
});

test('setup cursor prompt can skip behavior profile with n', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-cursor-no-profile-'));
  const result = await invoke(['setup', 'cursor', '--url', 'https://api.example.test'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch(),
    stdin: 'n\n'
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Write XMemo memory behavior profile/);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const config = JSON.parse(await fs.readFile(path.join(tempDir, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(config.mcpServers.XMemo.url, 'https://mcp.example.test/mcp');
  await assert.rejects(fs.readFile(path.join(tempDir, '.cursor', 'memory-profile.md'), 'utf8'), /ENOENT/);
});

test('setup copilot writes user MCP config for local proxy by default', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-copilot-'));
  const result = await invoke(['setup', 'copilot', '--url', 'https://api.example.test', '--json'], {
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
  assert.equal(plan.selectedClient.id, 'copilot-cli');
  assert.equal(plan.selectedClient.configKind, 'local-proxy');
  assert.equal(plan.selectedClient.writeSupported, true);
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.configPath, path.join(tempDir, '.copilot', 'mcp-config.json'));
  assert.equal(plan.selectedClient.requiresLocalCommand, 'xmemo mcp proxy --port 8765');
  assert.equal(plan.selectedClient.template.mcpServers['XMemo'].url, 'http://127.0.0.1:8765/mcp');

  const config = JSON.parse(await fs.readFile(path.join(tempDir, '.copilot', 'mcp-config.json'), 'utf8'));
  assert.equal(config.mcpServers['XMemo'].type, 'http');
  assert.equal(config.mcpServers['XMemo'].url, 'http://127.0.0.1:8765/mcp');
  assert.equal(config.mcpServers['XMemo'].headers, undefined);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('setup copilot dry-run previews without writing config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-copilot-preview-'));
  const result = await invoke(['setup', 'copilot', '--url', 'https://api.example.test', '--dry-run', '--json'], {
    env: { HOME: tempDir },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.writeSupported, true);
  assert.equal(plan.selectedClient.written, false);
  await assert.rejects(fs.readFile(path.join(tempDir, '.copilot', 'mcp-config.json'), 'utf8'), /ENOENT/);
});

test('setup gemini shorthand writes oauth httpUrl config without token', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-gemini-'));
  const result = await invoke(['setup', 'gemini', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'gemini-cli');
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.behaviorProfile.targetPath, path.join(tempDir, '.gemini', 'GEMINI.md'));
  assert.equal(plan.selectedClient.behaviorProfile.written, true);

  const configPath = path.join(tempDir, '.gemini', 'settings.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.XMemo.httpUrl, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.url, undefined);
  assert.equal(config.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'gemini-cli');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-gemini-cli-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);

  const profile = await fs.readFile(path.join(tempDir, '.gemini', 'GEMINI.md'), 'utf8');
  assert.match(profile, /XMemo Gemini CLI profile/);
  assert.match(profile, /client-managed MCP OAuth credential/);
  assert.doesNotMatch(profile, /secret-token-that-must-not-leak/);
});

test('setup gemini dry-run previews without writing config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-gemini-preview-'));
  const result = await invoke(['setup', 'gemini', '--url', 'https://api.example.test', '--dry-run', '--json'], {
    env: { HOME: tempDir },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'gemini-cli');
  assert.equal(plan.selectedClient.written, false);
  assert.equal(plan.selectedClient.behaviorProfile.written, false);
  await assert.rejects(fs.readFile(path.join(tempDir, '.gemini', 'settings.json'), 'utf8'), /ENOENT/);
  await assert.rejects(fs.readFile(path.join(tempDir, '.gemini', 'GEMINI.md'), 'utf8'), /ENOENT/);
});

test('setup gemini no-profile writes config but skips behavior profile', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-gemini-no-profile-'));
  const result = await invoke(['setup', 'gemini', '--url', 'https://api.example.test', '--no-profile', '--json'], {
    env: { HOME: tempDir },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.behaviorProfile.written, false);
  assert.equal(plan.selectedClient.behaviorProfile.skipped, true);
  const config = JSON.parse(await fs.readFile(path.join(tempDir, '.gemini', 'settings.json'), 'utf8'));
  assert.equal(config.mcpServers.XMemo.httpUrl, 'https://mcp.example.test/mcp');
  await assert.rejects(fs.readFile(path.join(tempDir, '.gemini', 'GEMINI.md'), 'utf8'), /ENOENT/);
});

test('setup antigravity shorthand writes oauth serverUrl config without token', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-antigravity-'));
  const result = await invoke(['setup', 'antigravity', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'antigravity');
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.configPath, path.join(tempDir, '.gemini', 'config', 'mcp_config.json'));
  assert.equal(plan.selectedClient.behaviorProfile.targetPath, path.join(tempDir, '.gemini', 'antigravity', 'MEMORY.md'));
  assert.equal(plan.selectedClient.behaviorProfile.written, true);

  const config = JSON.parse(await fs.readFile(plan.selectedClient.configPath, 'utf8'));
  assert.equal(config.mcpServers.XMemo.serverUrl, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.url, undefined);
  assert.equal(config.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);

  const profile = await fs.readFile(path.join(tempDir, '.gemini', 'antigravity', 'MEMORY.md'), 'utf8');
  assert.match(profile, /XMemo Antigravity profile/);
  assert.match(profile, /client-managed MCP OAuth credential/);
  assert.doesNotMatch(profile, /secret-token-that-must-not-leak/);
});

test('setup antigravity-ide shorthand writes oauth config without token', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-antigravity-ide-'));
  const result = await invoke(['setup', 'antigravity-ide', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'antigravity-ide');
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.configPath, path.join(tempDir, '.gemini', 'config', 'mcp_config.json'));

  const config = JSON.parse(await fs.readFile(plan.selectedClient.configPath, 'utf8'));
  assert.equal(config.mcpServers.XMemo.type, 'http');
  assert.equal(config.mcpServers.XMemo.url, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('setup antigravity2 shorthand writes oauth config without token', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-antigravity2-'));
  const result = await invoke(['setup', 'antigravity2', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'antigravity2');
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.configPath, path.join(tempDir, '.gemini', 'config', 'mcp_config.json'));

  const config = JSON.parse(await fs.readFile(plan.selectedClient.configPath, 'utf8'));
  assert.equal(config.mcpServers.XMemo.type, 'http');
  assert.equal(config.mcpServers.XMemo.url, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('setup antigravity-cli shorthand writes oauth config without token', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-antigravity-cli-'));
  const result = await invoke(['setup', 'antigravity-cli', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'antigravity-cli');
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.configPath, path.join(tempDir, '.gemini', 'config', 'mcp_config.json'));

  const config = JSON.parse(await fs.readFile(plan.selectedClient.configPath, 'utf8'));
  assert.equal(config.mcpServers.XMemo.httpUrl, 'https://mcp.example.test/mcp');
  assert.equal(config.mcpServers.XMemo.url, undefined);
  assert.equal(config.mcpServers.XMemo.headers.Authorization, undefined);
  assert.equal(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-ID'], 'antigravity');
  assert.match(config.mcpServers.XMemo.headers['X-Memory-OS-Agent-Instance-ID'], /^xmemo-antigravity-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('setup trae shorthand writes config by default', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-trae-'));
  const result = await invoke(['setup', 'trae', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      USERPROFILE: tempDir,
      APPDATA: path.join(tempDir, 'AppData', 'Roaming'),
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'trae');
  assert.equal(plan.selectedClient.written, true);

  const configPath = process.platform === 'win32'
    ? path.join(tempDir, 'AppData', 'Roaming', 'Trae', 'User', 'mcp.json')
    : process.platform === 'darwin'
      ? path.join(tempDir, 'Library', 'Application Support', 'Trae', 'User', 'mcp.json')
      : path.join(tempDir, '.config', 'Trae', 'User', 'mcp.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.XMemo.command, 'npx');
  assert.deepEqual(config.mcpServers.XMemo.args, [
    '-y',
    'mcp-remote',
    'https://mcp.example.test/mcp',
    '--header',
    'Authorization:Bearer ${XMEMO_KEY}',
    '--header',
    'X-Memory-OS-Agent-ID:trae',
    '--header',
    'X-Memory-OS-Agent-Instance-ID:${XMEMO_AGENT_INSTANCE_ID}'
  ]);
  assert.equal(config.mcpServers.XMemo.env.XMEMO_KEY, '${env:XMEMO_KEY}');
  assert.match(config.mcpServers.XMemo.env.XMEMO_AGENT_INSTANCE_ID, /^xmemo-trae-/);
  assert.doesNotMatch(JSON.stringify(config), /secret-token-that-must-not-leak/);
});

test('setup trae-solo shorthand writes config by default', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-setup-traesolo-'));
  const result = await invoke(['setup', 'trae-solo', '--url', 'https://api.example.test', '--json'], {
    env: {
      HOME: tempDir,
      USERPROFILE: tempDir,
      APPDATA: path.join(tempDir, 'AppData', 'Roaming'),
      XMEMO_KEY: 'secret-token-that-must-not-leak'
    },
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.id, 'trae-solo');
  assert.equal(plan.selectedClient.written, true);

  const configPath = process.platform === 'win32'
    ? path.join(tempDir, 'AppData', 'Roaming', 'TRAE SOLO', 'User', 'mcp.json')
    : process.platform === 'darwin'
      ? path.join(tempDir, 'Library', 'Application Support', 'TRAE SOLO', 'User', 'mcp.json')
      : path.join(tempDir, '.config', 'TRAE SOLO', 'User', 'mcp.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers.XMemo.command, 'npx');
  assert.deepEqual(config.mcpServers.XMemo.args, [
    '-y',
    'mcp-remote',
    'https://mcp.example.test/mcp',
    '--header',
    'Authorization:Bearer ${XMEMO_KEY}',
    '--header',
    'X-Memory-OS-Agent-ID:trae-solo',
    '--header',
    'X-Memory-OS-Agent-Instance-ID:${XMEMO_AGENT_INSTANCE_ID}'
  ]);
  assert.equal(config.mcpServers.XMemo.env.XMEMO_KEY, '${env:XMEMO_KEY}');
  assert.match(config.mcpServers.XMemo.env.XMEMO_AGENT_INSTANCE_ID, /^xmemo-trae-solo-/);
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
  assert.match(config, /\[mcp_servers\.XMemo\]/);
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

test('setup codex shorthand previews project profile with dry-run', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-codex-preview-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');
  const result = await invoke(['setup', 'codex', '--url', 'https://api.example.test', '--profile-target', profilePath, '--dry-run', '--json'], {
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
  assert.equal(plan.selectedClient.behaviorProfile.targetPath, profilePath);
  assert.equal(plan.selectedClient.behaviorProfile.written, false);
  assert.equal(plan.selectedClient.codexProfile.targetPath, profilePath);
  assert.equal(plan.selectedClient.codexProfile.written, false);
  assert.equal(plan.selectedClient.codexProfile.changed, true);
  await assert.rejects(fs.readFile(profilePath, 'utf8'), /ENOENT/);
});

test('setup codex writes mcp config and marker-scoped project profile by default', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-codex-yes-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');
  const env = {
    HOME: tempDir,
    MEMORY_OS_CONFIG_HOME: tempDir,
    XMEMO_KEY: 'secret-token-that-must-not-leak'
  };
  const result = await invoke(['setup', 'codex', '--url', 'https://api.example.test', '--profile-target', profilePath, '--json'], {
    env,
    fetch: discoveryFetch()
  });

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret-token-that-must-not-leak/);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selectedClient.written, true);
  assert.equal(plan.selectedClient.behaviorProfile.written, true);
  assert.equal(plan.selectedClient.codexProfile.written, true);
  assert.equal(plan.selectedClient.codexProfile.writesTokenValue, false);

  const config = await fs.readFile(path.join(tempDir, '.codex', 'config.toml'), 'utf8');
  assert.match(config, /bearer_token_env_var = "XMEMO_KEY"/);
  assert.doesNotMatch(config, /secret-token-that-must-not-leak/);

  const profile = await fs.readFile(profilePath, 'utf8');
  assert.match(profile, /<!-- memory-os:codex-profile:start -->/);
  assert.match(profile, /<!-- memory-os:codex-profile:end -->/);
  assert.match(profile, /Use XMemo deliberately through MCP/);
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

test('profile install supports Gemini behavior profile targets', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-profile-gemini-'));
  const profilePath = path.join(tempDir, 'GEMINI.md');

  const install = await invoke(['profile', 'install', 'gemini', '--target', profilePath, '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });
  assert.equal(install.code, 0);
  assert.doesNotMatch(install.stdout, /secret-token-that-must-not-leak/);

  const installed = await fs.readFile(profilePath, 'utf8');
  assert.match(installed, /memory-os:memory-profile:gemini-cli:start/);
  assert.match(installed, /XMemo Gemini CLI profile/);
  assert.match(installed, /client-managed MCP OAuth credential/);
  assert.doesNotMatch(installed, /secret-token-that-must-not-leak/);

  const status = await invoke(['profile', 'status', 'gemini', '--target', profilePath, '--json']);
  assert.equal(status.code, 0);
  assert.equal(JSON.parse(status.stdout).installed, true);
});

test('profile install supports Qwen behavior profile targets', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-profile-qwen-'));
  const profilePath = path.join(tempDir, 'QWEN.md');

  const install = await invoke(['profile', 'install', 'qwen', '--target', profilePath, '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });
  assert.equal(install.code, 0);
  assert.doesNotMatch(install.stdout, /secret-token-that-must-not-leak/);

  const installed = await fs.readFile(profilePath, 'utf8');
  assert.match(installed, /memory-os:memory-profile:qwen:start/);
  assert.match(installed, /XMemo Qwen profile/);
  assert.match(installed, /Keep XMemo authentication through the XMEMO_KEY environment variable/);
  assert.doesNotMatch(installed, /secret-token-that-must-not-leak/);

  const status = await invoke(['profile', 'status', 'qwen', '--target', profilePath, '--json']);
  assert.equal(status.code, 0);
  assert.equal(JSON.parse(status.stdout).installed, true);
});

test('profile install supports OpenCode behavior profile targets', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-os-profile-opencode-'));
  const profilePath = path.join(tempDir, 'AGENTS.md');

  const install = await invoke(['profile', 'install', 'opencode', '--target', profilePath, '--json'], {
    env: { XMEMO_KEY: 'secret-token-that-must-not-leak' }
  });
  assert.equal(install.code, 0);
  assert.doesNotMatch(install.stdout, /secret-token-that-must-not-leak/);

  const installed = await fs.readFile(profilePath, 'utf8');
  assert.match(installed, /memory-os:memory-profile:opencode:start/);
  assert.match(installed, /XMemo OpenCode profile/);
  assert.match(installed, /Use the client-managed MCP OAuth credential/);
  assert.doesNotMatch(installed, /secret-token-that-must-not-leak/);

  const status = await invoke(['profile', 'status', 'opencode', '--target', profilePath, '--json']);
  assert.equal(status.code, 0);
  assert.equal(JSON.parse(status.stdout).installed, true);
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
  assert.equal(profile.mcpServerName, 'XMemo');
  assert.match(profile.instructions.join('\n'), /recall\/search/);
  assert.match(profile.instructions.join('\n'), /write a concise XMemo memory/);
});

async function invoke(args, options = {}) {
  let stdout = '';
  let stderr = '';

  const code = await run(args, {
    env: options.env ?? {},
    stdin: Readable.from([options.stdin ?? '']),
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    fetch: options.fetch,
    spawn: options.spawn,
    sleep: options.sleep
  });

  return { code, stdout, stderr };
}

function devicePendingResponse() {
  return {
    ok: false,
    status: 400,
    async json() {
      return { error: 'authorization_pending', interval: 1 };
    }
  };
}

function spawnStub(calls, { code = 0, stdout = '', stderr = '' } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) {
        child.stdout.emit('data', stdout);
      }
      if (stderr) {
        child.stderr.emit('data', stderr);
      }
      child.emit('close', code);
    });
    return child;
  };
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
