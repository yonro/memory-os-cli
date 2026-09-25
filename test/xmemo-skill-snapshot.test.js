import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillScript = path.join(repoRoot, 'skills/xmemo/scripts/xmemo-skill.mjs');
const fixturesDir = path.join(repoRoot, 'test', 'fixtures', 'snapshots');

const DEFAULT_DISCOVERY_RESPONSE = {
  schema_version: '1.0',
  protocol: 'https',
  service: 'XMemo Cloud',
  service_version: '2.0.0',
  mcp_url: 'https://xmemo.dev/mcp',
  supported_clients: ['cli', 'skill', 'mcp'],
  standalone_skill: {
    status: 'ready',
    runtime_model: 'standalone_cli',
    package: { version: '1.1.22' },
    operations: ['remember', 'recall', 'doctor'],
    auth: { default_scopes: ['memory:read', 'memory:write'] },
  },
};

const DEFAULT_TEMPORARY_LIMITS = {
  max_items: 100,
  ttl_seconds: 1209600,
  max_lifetime_seconds: 2592000,
};

function createMockServer() {
  const requests = [];
  let customHandler = null;

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      let parsedBody = null;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = rawBody;
        }
      }

      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody,
      });

      if (customHandler) {
        const handled = customHandler(req, res, parsedBody);
        if (handled) return;
      }

      // Default mock router
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;

      if (pathname === '/.well-known/agent-discovery.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(DEFAULT_DISCOVERY_RESPONSE));
        return;
      }

      if (pathname === '/v1/limits/temporary') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(DEFAULT_TEMPORARY_LIMITS));
        return;
      }

      if (pathname === '/v1/memories') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          memory: {
            id: 'mem_golden_123',
            content: parsedBody?.content || '',
            path: parsedBody?.path || 'memories',
            created_at: '2026-09-24T00:00:00Z',
          },
        }));
        return;
      }

      if (pathname === '/v1/memories/recall') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          results: [{
            id: 'mem_golden_123',
            content: 'Golden recall text',
            path: 'memories',
            score: 0.95,
          }],
        }));
        return;
      }

      if (pathname === '/v1/memories/search') {
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            results: [{
              id: 'mem_temp_123',
              content: 'Temporary search text',
              path: 'memories',
              score: 0.91,
            }],
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          results: [{
            id: 'mem_golden_123',
            content: 'Golden search text',
            path: 'memories',
            score: 0.91,
          }],
        }));
        return;
      }

      if (pathname === '/v1/remember') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          memory: {
            id: 'mem_temp_123',
            content: parsedBody?.content || '',
            path: parsedBody?.path || 'memories',
          },
        }));
        return;
      }

      if (pathname === '/v1/recall') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          results: [{
            id: 'mem_temp_123',
            content: 'Temporary recall text',
            path: 'memories',
            score: 0.95,
          }],
        }));
        return;
      }

      if (pathname === '/v1/recall/context') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          context_text: 'Golden recall context summary',
          items: [{
            id: 'mem_golden_123',
            content: 'Context note',
          }],
        }));
        return;
      }

      if (pathname === '/v1/memories/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          total: 42,
          breakdown: { facts: 30, plans: 12 },
        }));
        return;
      }

      if (pathname === '/v1/restart/snapshot') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          snapshot_id: 'snap_golden_123',
          created_at: '2026-09-24T00:00:00Z',
        }));
        return;
      }

      if (pathname === '/v1/restart/restore') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          snapshot_id: 'snap_golden_123',
          restored: true,
        }));
        return;
      }

      if (pathname === '/v1/auth/device/start') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          device_code: 'dev_code_golden',
          user_code: 'GOLD-1234',
          verification_uri: `http://127.0.0.1:${server.address().port}/device`,
          expires_in_seconds: 300,
          interval: 0.05,
        }));
        return;
      }

      if (pathname === '/v1/auth/device/token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'mos_token_golden_login',
        }));
        return;
      }

      if (pathname === '/v1/agents/register') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          temporary_token: 'mos_anon_golden',
          agent_id: 'agent_temp_golden',
          bind_url: `http://127.0.0.1:${server.address().port}/bind/abc`,
          status: 'created',
        }));
        return;
      }

      if (pathname === '/v1/auth/token/validate') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          scopes: ['memory:read', 'memory:write', 'ledger:read', 'ledger:write', 'knowledge:read'],
          setup_state: 'complete',
        }));
        return;
      }

      if (pathname === '/v1/auth/token/revoke-self') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, revoked: true }));
        return;
      }

      if (pathname === '/v1/agents/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'pending',
          bind_url: `http://127.0.0.1:${server.address().port}/bind/abc`,
        }));
        return;
      }

      if (pathname === '/v1/agents/bind/deny-current-user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'denied' }));
        return;
      }

      if (pathname === '/v1/agents/bind/confirm-current-user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'confirmed' }));
        return;
      }

      if (pathname === '/v1/skill/operations') {
        const op = parsedBody?.operation;
        let result = {};
        if (op === 'doctor') {
          result = { ok: true, status: 'healthy', version: '2.0.0' };
        } else if (op === 'read') {
          result = {
            id: parsedBody?.arguments?.id || 'mem_golden_123',
            content: 'Golden memory content',
            memory_type: 'fact',
          };
        } else if (op === 'update') {
          result = {
            id: parsedBody?.arguments?.id || 'mem_golden_123',
            content: parsedBody?.arguments?.content || 'Updated content',
          };
        } else if (op === 'forget') {
          result = {
            id: parsedBody?.arguments?.id || 'mem_golden_123',
            status: 'forgotten',
          };
        } else if (op === 'save-state') {
          result = {
            key: parsedBody?.arguments?.key || 'golden_key',
            saved: true,
          };
        } else if (op === 'restore-state') {
          result = {
            key: parsedBody?.arguments?.key || 'golden_key',
            content: 'Saved state content',
          };
        } else if (op === 'todo-add') {
          result = {
            id: 'todo_golden_123',
            content: parsedBody?.arguments?.content || 'TODO content',
            status: 'pending',
          };
        } else if (op === 'todo-list') {
          result = [{
            id: 'todo_golden_123',
            content: 'TODO task',
            status: 'pending',
          }];
        } else if (op === 'todo-done') {
          result = {
            id: parsedBody?.arguments?.id || 'todo_golden_123',
            status: 'completed',
          };
        } else if (op === 'expense-add') {
          result = {
            id: 'exp_golden_123',
            item: parsedBody?.arguments?.item,
            amount: parsedBody?.arguments?.amount,
            currency: parsedBody?.arguments?.currency,
          };
        } else if (op === 'ledger-list') {
          result = [{
            id: 'tx_golden_123',
            item: 'Server hosting',
            amount: 15.5,
            currency: 'USD',
            created_at: '2026-09-24T00:00:00Z',
          }];
        } else if (op === 'ledger-summary') {
          result = {
            total_amount: 15.5,
            currency: 'USD',
            by_category: { hosting: 15.5 },
          };
        } else if (op === 'overview') {
          result = {
            memory_count: 42,
            storage_bytes: 1048576,
            active_agents: 2,
            total_tokens: 15000,
          };
        } else if (op === 'activity') {
          result = [{
            event: 'memory_created',
            memory_id: 'mem_golden_123',
            timestamp: '2026-09-24T00:00:00Z',
          }];
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: `Route ${pathname} not found` } }));
    });
  });

  return {
    server,
    requests,
    setHandler: (fn) => {
      customHandler = fn;
    },
    clearHandler: () => {
      customHandler = null;
    },
    start: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve(`http://127.0.0.1:${server.address().port}`);
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function normalizeOutput(text, { baseUrl, homeDir }) {
  if (typeof text !== 'string') return text;
  let res = text.replace(/\r\n/g, '\n');
  if (baseUrl) {
    const port = new URL(baseUrl).port;
    if (port) {
      res = res.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:<PORT>');
      res = res.replaceAll(`localhost:${port}`, '127.0.0.1:<PORT>');
    }
  }
  if (homeDir) {
    const winHome = homeDir.replaceAll('/', '\\');
    const posixHome = homeDir.replaceAll('\\', '/');
    res = res.replaceAll(winHome, '<HOME>');
    res = res.replaceAll(posixHome, '<HOME>');
  }
  res = res.replaceAll('<HOME>\\.xmemo', '<HOME>/.xmemo');
  res = res.replaceAll('\\skill-credentials.json', '/skill-credentials.json');
  res = res.replaceAll('\\skill-registration.json', '/skill-registration.json');
  return res;
}

function normalizeRequest(req, { baseUrl }) {
  let url = req.url;
  if (baseUrl) {
    const port = new URL(baseUrl).port;
    if (port) {
      url = url.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:<PORT>');
    }
  }
  const normalized = {
    method: req.method,
    url,
  };
  if (req.body !== undefined && req.body !== null) {
    let body = req.body;
    if (typeof body === 'object') {
      body = JSON.parse(JSON.stringify(body));
      if (body.runtime && typeof body.runtime === 'string' && body.runtime.startsWith('node ')) {
        body.runtime = 'node <VERSION>';
      }
      if (body.installation_fingerprint) {
        body.installation_fingerprint = 'golden-fingerprint-uuid';
      }
    }
    normalized.body = body;
  }
  const criticalHeaders = {};
  if (req.headers['authorization']) {
    criticalHeaders['authorization'] = req.headers['authorization'];
  }
  if (req.headers['content-type']) {
    criticalHeaders['content-type'] = req.headers['content-type'];
  }
  if (req.headers['x-request-id']) {
    criticalHeaders['x-request-id'] = req.headers['x-request-id'];
  }
  normalized.headers = criticalHeaders;
  return normalized;
}

async function runSnapshotScript(args, { baseUrl, homeDir, stdin, env = {} }) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const childEnv = {
      ...process.env,
    };
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith('XMEMO_')) {
        delete childEnv[key];
      }
    }
    delete childEnv.JARVIS_AUTHD_SOCK;
    childEnv.HOME = homeDir;
    childEnv.USERPROFILE = homeDir;
    childEnv.XMEMO_BASE_URL = baseUrl;
    childEnv.XMEMO_FORCE_TTY = '1';
    Object.assign(childEnv, env);

    const child = spawn(process.execPath, [skillScript, ...args], {
      env: childEnv,
      cwd: repoRoot,
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

// Full test case catalog across all commands, error cases, json, and prerequisite paths
const SNAPSHOT_CASES = [
  // Flags & Top-level
  { id: 'flags-version', group: 'flags', args: ['--version'] },
  { id: 'flags-help', group: 'flags', args: ['--help'] },
  { id: 'flags-no-args', group: 'flags', args: [] },
  { id: 'flags-unknown-command', group: 'flags', args: ['unknown-command'] },
  { id: 'flags-reject-boolean-value', group: 'flags', args: ['overview', '--json=1'] },

  // Direct memory
  { id: 'remember-terminal', group: 'direct-memory', args: ['remember', '--content', 'Golden memory content'], useAuth: true },
  { id: 'remember-json', group: 'direct-memory', args: ['remember', '--content', 'Golden memory content', '--json'], useAuth: true },
  { id: 'remember-error-missing-content', group: 'direct-memory', args: ['remember'], useAuth: true },
  { id: 'remember-help', group: 'direct-memory', args: ['remember', '--help'] },
  { id: 'recall-terminal', group: 'direct-memory', args: ['recall', '--query', 'Golden search query'], useAuth: true },
  { id: 'recall-json', group: 'direct-memory', args: ['recall', '--query', 'Golden search query', '--json'], useAuth: true },
  { id: 'recall-error-missing-query', group: 'direct-memory', args: ['recall'], useAuth: true },
  { id: 'recall-help', group: 'direct-memory', args: ['recall', '--help'] },
  { id: 'search-terminal', group: 'direct-memory', args: ['search', '--query', 'Golden search term'], useAuth: true },
  { id: 'search-json', group: 'direct-memory', args: ['search', '--query', 'Golden search term', '--json'], useAuth: true },
  { id: 'search-error-missing-query', group: 'direct-memory', args: ['search'], useAuth: true },
  { id: 'search-help', group: 'direct-memory', args: ['search', '--help'] },
  { id: 'read-terminal', group: 'direct-memory', args: ['read', '--id', 'mem_golden_123'], useAuth: true },
  { id: 'read-json', group: 'direct-memory', args: ['read', '--id', 'mem_golden_123', '--json'], useAuth: true },
  { id: 'read-error-missing-id', group: 'direct-memory', args: ['read'], useAuth: true },
  {
    id: 'read-error-404',
    group: 'direct-memory',
    args: ['read', '--id', 'mem_missing'],
    useAuth: true,
    serverHandler: (req, res) => {
      if (req.url === '/v1/skill/operations') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'Memory not found' } }));
        return true;
      }
      return false;
    },
  },
  { id: 'read-help', group: 'direct-memory', args: ['read', '--help'] },
  { id: 'update-terminal', group: 'direct-memory', args: ['update', '--id', 'mem_golden_123', '--content', 'Updated content'], useAuth: true },
  { id: 'update-json', group: 'direct-memory', args: ['update', '--id', 'mem_golden_123', '--content', 'Updated content', '--json'], useAuth: true },
  { id: 'update-error-missing-id', group: 'direct-memory', args: ['update'], useAuth: true },
  { id: 'update-help', group: 'direct-memory', args: ['update', '--help'] },
  { id: 'forget-terminal', group: 'direct-memory', args: ['forget', '--id', 'mem_golden_123', '--confirm'], useAuth: true },
  { id: 'forget-json', group: 'direct-memory', args: ['forget', '--id', 'mem_golden_123', '--confirm', '--json'], useAuth: true },
  { id: 'forget-error-no-confirm', group: 'direct-memory', args: ['forget', '--id', 'mem_golden_123'], useAuth: true },
  { id: 'forget-help', group: 'direct-memory', args: ['forget', '--help'] },

  // Context
  { id: 'recall-context-terminal', group: 'context', args: ['recall-context', '--query', 'Golden context query'], useAuth: true },
  { id: 'recall-context-json', group: 'context', args: ['recall-context', '--query', 'Golden context query', '--json'], useAuth: true },
  { id: 'recall-context-error-missing-query', group: 'context', args: ['recall-context'], useAuth: true },
  { id: 'recall-context-help', group: 'context', args: ['recall-context', '--help'] },

  // Continuity
  { id: 'save-state-terminal', group: 'continuity', args: ['save-state', '--key', 'golden_key', '--content', 'State text'], useAuth: true },
  { id: 'save-state-json', group: 'continuity', args: ['save-state', '--key', 'golden_key', '--content', 'State text', '--json'], useAuth: true },
  { id: 'save-state-alias-terminal', group: 'continuity', args: ['state-save', '--key', 'golden_key', '--content', 'State text'], useAuth: true },
  { id: 'save-state-error-missing-key', group: 'continuity', args: ['save-state'], useAuth: true },
  { id: 'save-state-help', group: 'continuity', args: ['save-state', '--help'] },
  { id: 'restore-state-terminal', group: 'continuity', args: ['restore-state', '--key', 'golden_key'], useAuth: true },
  { id: 'restore-state-json', group: 'continuity', args: ['restore-state', '--key', 'golden_key', '--json'], useAuth: true },
  { id: 'restore-state-alias-terminal', group: 'continuity', args: ['state-restore', '--key', 'golden_key'], useAuth: true },
  { id: 'restore-state-error-missing-key', group: 'continuity', args: ['restore-state'], useAuth: true },
  { id: 'restore-state-help', group: 'continuity', args: ['restore-state', '--help'] },
  { id: 'restart-snapshot-terminal', group: 'continuity', args: ['restart-snapshot'], useAuth: true },
  { id: 'restart-snapshot-json', group: 'continuity', args: ['restart-snapshot', '--json'], useAuth: true },
  {
    id: 'restart-snapshot-error-400',
    group: 'continuity',
    args: ['restart-snapshot'],
    useAuth: true,
    serverHandler: (req, res) => {
      if (req.url === '/v1/restart/snapshot') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'Invalid session' } }));
        return true;
      }
      return false;
    },
  },
  { id: 'restart-snapshot-help', group: 'continuity', args: ['restart-snapshot', '--help'] },
  { id: 'restart-restore-terminal', group: 'continuity', args: ['restart-restore'], useAuth: true },
  { id: 'restart-restore-json', group: 'continuity', args: ['restart-restore', '--json'], useAuth: true },
  {
    id: 'restart-restore-error-404',
    group: 'continuity',
    args: ['restart-restore'],
    useAuth: true,
    serverHandler: (req, res) => {
      if (req.url === '/v1/restart/restore') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'No snapshot available' } }));
        return true;
      }
      return false;
    },
  },
  { id: 'restart-restore-help', group: 'continuity', args: ['restart-restore', '--help'] },

  // TODO
  { id: 'todo-add-terminal', group: 'todo', args: ['todo-add', '--content', 'Write golden tests'], useAuth: true },
  { id: 'todo-add-json', group: 'todo', args: ['todo-add', '--content', 'Write golden tests', '--json'], useAuth: true },
  { id: 'todo-add-error-missing-content', group: 'todo', args: ['todo-add'], useAuth: true },
  { id: 'todo-add-help', group: 'todo', args: ['todo-add', '--help'] },
  { id: 'todo-list-terminal', group: 'todo', args: ['todo-list'], useAuth: true },
  { id: 'todo-list-json', group: 'todo', args: ['todo-list', '--json'], useAuth: true },
  {
    id: 'todo-list-error-500',
    group: 'todo',
    args: ['todo-list'],
    useAuth: true,
    serverHandler: (req, res, parsedBody) => {
      if (req.url === '/v1/skill/operations' && parsedBody?.operation === 'todo-list') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Database query failed' } }));
        return true;
      }
      return false;
    },
  },
  { id: 'todo-list-help', group: 'todo', args: ['todo-list', '--help'] },
  { id: 'todo-done-terminal', group: 'todo', args: ['todo-done', '--id', 'todo_golden_123'], useAuth: true },
  { id: 'todo-done-json', group: 'todo', args: ['todo-done', '--id', 'todo_golden_123', '--json'], useAuth: true },
  { id: 'todo-done-error-missing-id', group: 'todo', args: ['todo-done'], useAuth: true },
  { id: 'todo-done-help', group: 'todo', args: ['todo-done', '--help'] },

  // Ledger
  { id: 'expense-add-terminal', group: 'ledger', args: ['expense-add', '--item', 'Domain name', '--amount', '12.99', '--currency', 'USD'], useAuth: true },
  { id: 'expense-add-json', group: 'ledger', args: ['expense-add', '--item', 'Domain name', '--amount', '12.99', '--currency', 'USD', '--json'], useAuth: true },
  { id: 'expense-add-error-missing-amount', group: 'ledger', args: ['expense-add', '--item', 'Domain name'], useAuth: true },
  { id: 'expense-add-help', group: 'ledger', args: ['expense-add', '--help'] },
  { id: 'ledger-list-terminal', group: 'ledger', args: ['ledger-list'], useAuth: true },
  { id: 'ledger-list-json', group: 'ledger', args: ['ledger-list', '--json'], useAuth: true },
  {
    id: 'ledger-list-error-404',
    group: 'ledger',
    args: ['ledger-list'],
    useAuth: true,
    serverHandler: (req, res, parsedBody) => {
      if (req.url === '/v1/skill/operations' && parsedBody?.operation === 'ledger-list') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'No records found' } }));
        return true;
      }
      return false;
    },
  },
  { id: 'ledger-list-help', group: 'ledger', args: ['ledger-list', '--help'] },
  { id: 'ledger-summary-terminal', group: 'ledger', args: ['ledger-summary'], useAuth: true },
  { id: 'ledger-summary-json', group: 'ledger', args: ['ledger-summary', '--json'], useAuth: true },
  { id: 'ledger-summary-help', group: 'ledger', args: ['ledger-summary', '--help'] },

  // Diagnostics
  { id: 'overview-terminal', group: 'diagnostics', args: ['overview'], useAuth: true },
  { id: 'overview-json', group: 'diagnostics', args: ['overview', '--json'], useAuth: true },
  { id: 'overview-help', group: 'diagnostics', args: ['overview', '--help'] },
  { id: 'activity-terminal', group: 'diagnostics', args: ['activity'], useAuth: true },
  { id: 'activity-json', group: 'diagnostics', args: ['activity', '--json'], useAuth: true },
  { id: 'activity-help', group: 'diagnostics', args: ['activity', '--help'] },
  { id: 'stats-terminal', group: 'diagnostics', args: ['stats'], useAuth: true },
  { id: 'stats-json', group: 'diagnostics', args: ['stats', '--json'], useAuth: true },
  { id: 'stats-error-top-n-invalid', group: 'diagnostics', args: ['stats', '--top-n', '999'], useAuth: true },
  { id: 'stats-help', group: 'diagnostics', args: ['stats', '--help'] },
  { id: 'doctor-auth-terminal', group: 'diagnostics', args: ['doctor'], useAuth: true },
  { id: 'doctor-auth-json', group: 'diagnostics', args: ['doctor', '--json'], useAuth: true },
  { id: 'doctor-anon-terminal', group: 'diagnostics', args: ['doctor', '--anonymous'], useAuth: true },
  { id: 'doctor-anon-json', group: 'diagnostics', args: ['doctor', '--anonymous', '--json'], useAuth: true },
  {
    id: 'doctor-error-503',
    group: 'diagnostics',
    args: ['doctor'],
    useAuth: true,
    serverHandler: (req, res, parsedBody) => {
      if (req.url === '/v1/skill/operations' && parsedBody?.operation === 'doctor') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'service_unavailable', message: 'Service maintenance' } }));
        return true;
      }
      return false;
    },
  },
  { id: 'doctor-help', group: 'diagnostics', args: ['doctor', '--help'] },

  // Auth commands
  { id: 'auth-status-logged-out-terminal', group: 'auth', args: ['auth', 'status'] },
  { id: 'auth-status-logged-out-json', group: 'auth', args: ['auth', 'status', '--json'] },
  { id: 'auth-status-terminal', group: 'auth', args: ['auth', 'status'], useAuth: true },
  { id: 'auth-status-json', group: 'auth', args: ['auth', 'status', '--json'], useAuth: true },
  { id: 'auth-status-verify-terminal', group: 'auth', args: ['auth', 'status', '--verify'], useAuth: true },
  { id: 'auth-status-verify-json', group: 'auth', args: ['auth', 'status', '--verify', '--json'], useAuth: true },
  { id: 'auth-status-help', group: 'auth', args: ['auth', 'status', '--help'] },
  { id: 'auth-status-alias-logged-out-terminal', group: 'auth', args: ['auth-status'] },
  { id: 'auth-status-alias-logged-out-json', group: 'auth', args: ['auth-status', '--json'] },
  { id: 'auth-status-alias-logged-in-terminal', group: 'auth', args: ['auth-status'], useAuth: true },
  { id: 'auth-status-alias-logged-in-json', group: 'auth', args: ['auth-status', '--json'], useAuth: true },
  { id: 'auth-add-terminal', group: 'auth', args: ['auth', 'add', '--from-stdin', '--allow-plaintext'], stdin: 'mos_token_golden_stdin' },
  { id: 'auth-add-json', group: 'auth', args: ['auth', 'add', '--from-stdin', '--allow-plaintext', '--json'], stdin: 'mos_token_golden_stdin' },
  { id: 'auth-add-error-no-plaintext', group: 'auth', args: ['auth', 'add', '--from-stdin'], stdin: 'mos_token_golden_stdin' },
  { id: 'auth-add-help', group: 'auth', args: ['auth', 'add', '--help'] },
  { id: 'login-terminal', group: 'auth', args: ['login', '--allow-plaintext'] },
  { id: 'login-error-no-plaintext', group: 'auth', args: ['login'] },
  { id: 'login-help', group: 'auth', args: ['login', '--help'] },
  { id: 'register-terminal', group: 'auth', args: ['register', '--reason', 'unattended', '--allow-plaintext'] },
  { id: 'register-json', group: 'auth', args: ['register', '--reason', 'unattended', '--allow-plaintext', '--json'] },
  { id: 'register-error-no-plaintext', group: 'auth', args: ['register', '--reason', 'unattended'] },
  { id: 'register-error-invalid-reason', group: 'auth', args: ['register', '--reason', 'invalid_reason', '--allow-plaintext'] },
  { id: 'register-help', group: 'auth', args: ['register', '--help'] },
  { id: 'logout-terminal', group: 'auth', args: ['logout'], useAuth: true },
  { id: 'logout-json', group: 'auth', args: ['logout', '--json'], useAuth: true },
  { id: 'logout-help', group: 'auth', args: ['logout', '--help'] },
  { id: 'auth-claim-status-terminal', group: 'auth', args: ['auth', 'claim-status', '--allow-plaintext'], useTemporaryCredential: true },
  { id: 'auth-claim-status-json', group: 'auth', args: ['auth', 'claim-status', '--allow-plaintext', '--json'], useTemporaryCredential: true },
  { id: 'auth-claim-status-help', group: 'auth', args: ['auth', 'claim-status', '--help'] },
  {
    id: 'auth-claim-confirm-formal-terminal',
    group: 'auth',
    args: ['auth', 'claim-confirm', '--allow-plaintext'],
    useTemporaryCredential: true,
    serverHandler: (req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      if (parsedUrl.pathname === '/v1/agents/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'claimed',
          formal_token: 'mos_formal_golden_token',
        }));
        return true;
      }
      return false;
    },
  },
  {
    id: 'auth-claim-confirm-formal-json',
    group: 'auth',
    args: ['auth', 'claim-confirm', '--allow-plaintext', '--json'],
    useTemporaryCredential: true,
    serverHandler: (req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      if (parsedUrl.pathname === '/v1/agents/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'claimed',
          formal_token: 'mos_formal_golden_token',
        }));
        return true;
      }
      return false;
    },
  },
  (() => {
    let callCount = 0;
    return {
      id: 'auth-claim-confirm-2step-terminal',
      group: 'auth',
      args: ['auth', 'claim-confirm', '--allow-plaintext'],
      useTemporaryCredential: true,
      before: () => {
        callCount = 0;
      },
      serverHandler: (req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        if (parsedUrl.pathname === '/v1/agents/status') {
          callCount++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (callCount === 1) {
            res.end(JSON.stringify({
              status: 'pending_confirmation',
              confirmation_token: 'confirm_golden_token_123',
            }));
          } else {
            res.end(JSON.stringify({
              status: 'claimed',
              formal_token: 'mos_formal_confirmed_step2_token',
            }));
          }
          return true;
        }
        if (parsedUrl.pathname === '/v1/agents/bind/confirm-current-user') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, status: 'confirmed' }));
          return true;
        }
        return false;
      },
    };
  })(),
  (() => {
    let callCount = 0;
    return {
      id: 'auth-claim-confirm-2step-json',
      group: 'auth',
      args: ['auth', 'claim-confirm', '--allow-plaintext', '--json'],
      useTemporaryCredential: true,
      before: () => {
        callCount = 0;
      },
      serverHandler: (req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        if (parsedUrl.pathname === '/v1/agents/status') {
          callCount++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (callCount === 1) {
            res.end(JSON.stringify({
              status: 'pending_confirmation',
              confirmation_token: 'confirm_golden_token_123',
            }));
          } else {
            res.end(JSON.stringify({
              status: 'claimed',
              formal_token: 'mos_formal_confirmed_step2_token',
            }));
          }
          return true;
        }
        if (parsedUrl.pathname === '/v1/agents/bind/confirm-current-user') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, status: 'confirmed' }));
          return true;
        }
        return false;
      },
    };
  })(),
  { id: 'auth-claim-confirm-help', group: 'auth', args: ['auth', 'claim-confirm', '--help'] },
  {
    id: 'auth-claim-deny-terminal',
    group: 'auth',
    args: ['auth', 'claim-deny', '--allow-plaintext'],
    useTemporaryCredential: true,
  },
  {
    id: 'auth-claim-deny-json',
    group: 'auth',
    args: ['auth', 'claim-deny', '--allow-plaintext', '--json'],
    useTemporaryCredential: true,
  },
  {
    id: 'auth-claim-deny-error-terminal',
    group: 'auth',
    args: ['auth', 'claim-deny', '--allow-plaintext'],
    useTemporaryCredential: true,
    serverHandler: (req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      if (parsedUrl.pathname === '/v1/agents/bind/deny-current-user') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'invalid_state', message: 'No pending claim to decline' } }));
        return true;
      }
      return false;
    },
  },
  {
    id: 'auth-claim-deny-error-json',
    group: 'auth',
    args: ['auth', 'claim-deny', '--allow-plaintext', '--json'],
    useTemporaryCredential: true,
    serverHandler: (req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      if (parsedUrl.pathname === '/v1/agents/bind/deny-current-user') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'invalid_state', message: 'No pending claim to decline' } }));
        return true;
      }
      return false;
    },
  },
  { id: 'auth-claim-deny-help', group: 'auth', args: ['auth', 'claim-deny', '--help'] },

  // Prerequisites: 3 dedicated paths
  { id: 'prereq-no-credentials-remember', group: 'prerequisites', args: ['remember', '--content', 'Note without credentials'] },
  { id: 'prereq-no-credentials-doctor-normal', group: 'prerequisites', args: ['doctor'] },
  { id: 'prereq-anonymous-doctor', group: 'prerequisites', args: ['doctor', '--anonymous'] },
  { id: 'prereq-anonymous-doctor-json', group: 'prerequisites', args: ['doctor', '--anonymous', '--json'] },
  { id: 'prereq-temporary-credentials-remember', group: 'prerequisites', args: ['remember', '--content', 'Sandbox note'], useTemporaryCredential: true },
  { id: 'prereq-temporary-credentials-recall', group: 'prerequisites', args: ['recall', '--query', 'Sandbox query'], useTemporaryCredential: true },
  { id: 'prereq-temporary-credentials-search', group: 'prerequisites', args: ['search', '--query', 'Sandbox search'], useTemporaryCredential: true },
  { id: 'prereq-temporary-credentials-unsupported-read', group: 'prerequisites', args: ['read', '--id', 'mem_golden_123'], useTemporaryCredential: true },
];

test('XMemo Skill Golden Snapshot behavior suite across all commands and prerequisite paths', async () => {
  const mockServer = createMockServer();
  const baseUrl = await mockServer.start();

  try {
    const isUpdateMode = process.env.UPDATE_SNAPSHOTS === '1';

    // Group cases by category
    const casesByGroup = new Map();
    for (const testCase of SNAPSHOT_CASES) {
      if (!casesByGroup.has(testCase.group)) {
        casesByGroup.set(testCase.group, []);
      }
      casesByGroup.get(testCase.group).push(testCase);
    }

    for (const [groupName, cases] of casesByGroup.entries()) {
      const fixtureFile = path.join(fixturesDir, `${groupName}.json`);
      let expectedSnapshots = {};
      let fixtureExists = false;

      try {
        const rawFixture = await fs.readFile(fixtureFile, 'utf8');
        expectedSnapshots = JSON.parse(rawFixture);
        fixtureExists = true;
      } catch {
        fixtureExists = false;
      }

      const currentSnapshots = {};

      for (const tc of cases) {
        mockServer.requests.length = 0;
        if (tc.before) {
          tc.before();
        }
        if (tc.serverHandler) {
          mockServer.setHandler(tc.serverHandler);
        } else {
          mockServer.clearHandler();
        }

        const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-snap-home-'));

        try {
          const env = {};
          if (tc.useAuth) {
            env.XMEMO_KEY = 'mos_test_token_golden';
          }

          const dotXmemo = path.join(tempHome, '.xmemo');
          await fs.mkdir(dotXmemo, { recursive: true });
          await fs.writeFile(
            path.join(dotXmemo, 'skill-registration.json'),
            `${JSON.stringify({
              installation_fingerprint: 'golden-fingerprint-uuid',
              created_at: '2026-09-24T00:00:00.000Z',
            }, null, 2)}\n`,
            'utf8'
          );

          if (tc.useTemporaryCredential) {
            const credData = {
              token: 'mos_anon_temp_token',
              credential_type: 'temporary',
              agent_id: 'agent_temp_golden',
              bind_url: `${baseUrl}/bind/abc`,
              registration_reason: 'unattended',
              storage: 'plaintext-user-file',
              plaintext_storage_consent: true,
              plaintext_storage_consent_at: '2026-09-24T00:00:00Z',
            };
            await fs.writeFile(path.join(dotXmemo, 'skill-credentials.json'), `${JSON.stringify(credData, null, 2)}\n`, 'utf8');
          }

          const res = await runSnapshotScript(tc.args, {
            baseUrl,
            homeDir: tempHome,
            stdin: tc.stdin,
            env,
          });

          const normalizedStdout = normalizeOutput(res.stdout, { baseUrl, homeDir: tempHome });
          const normalizedStderr = normalizeOutput(res.stderr, { baseUrl, homeDir: tempHome });
          const normalizedRequests = mockServer.requests.map((r) => normalizeRequest(r, { baseUrl }));

          currentSnapshots[tc.id] = {
            id: tc.id,
            args: tc.args,
            code: res.code,
            stdout: normalizedStdout,
            stderr: normalizedStderr,
            httpRequests: normalizedRequests,
          };

          if (fixtureExists && !isUpdateMode) {
            const expected = expectedSnapshots[tc.id];
            assert.ok(expected, `Missing golden snapshot for case "${tc.id}" in ${fixtureFile}`);
            assert.equal(
              res.code,
              expected.code,
              `Exit code mismatch in "${tc.id}". Expected ${expected.code}, got ${res.code}.\nStderr: ${normalizedStderr}`
            );
            assert.equal(
              normalizedStdout,
              expected.stdout,
              `Stdout mismatch in "${tc.id}".`
            );
            assert.equal(
              normalizedStderr,
              expected.stderr,
              `Stderr mismatch in "${tc.id}".`
            );
            assert.deepEqual(
              normalizedRequests,
              expected.httpRequests,
              `HTTP requests mismatch in "${tc.id}".`
            );
          }
        } finally {
          await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
        }
      }

      if (!fixtureExists || isUpdateMode) {
        await fs.mkdir(fixturesDir, { recursive: true });
        await fs.writeFile(
          fixtureFile,
          `${JSON.stringify(currentSnapshots, null, 2)}\n`,
          'utf8'
        );
      }
    }
  } finally {
    await mockServer.stop();
  }
});
