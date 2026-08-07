import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('offline stdio tools/list exposes current full/free XMemo tools', async () => {
  const response = await callStdioToolsList();
  const names = response.result.tools.map((tool) => tool.name);

  assert.deepEqual(names, [
    'get_mcp_identity',
    'remember',
    'recall',
    'recall_context',
    'memory_stats',
    'update_memory',
    'explain_memory',
    'restore_memory',
    'add_expense',
    'list_ledger_transactions',
    'get_monthly_ledger_summary',
    'forget',
    'create_memory_todo',
    'list_memory_todos',
    'complete_memory_todo',
    'list_memory_versions',
    'get_timeline',
    'record_event',
    'update_state',
    'get_project_context'
  ]);
  assert.equal(names.includes('search_memory'), false);
  assert.equal(names.includes('forget_memory'), false);
  assert.equal(names.includes('redact_memory'), false);
  assert.equal(names.includes('create_restart_snapshot'), false);
  assert.equal(names.includes('restore_restart_snapshot'), false);
  assert.equal(names.includes('memory_overview'), false);
  assert.equal(names.includes('list_memory_conflicts'), false);
  assert.equal(names.includes('resolve_memory_conflict'), false);
  assert.equal(names.includes('query_audit'), false);
  assert.equal(names.includes('update_project_todo'), false);
  assert.equal(names.includes('update_project_decision'), false);

  const tools = new Map(response.result.tools.map((tool) => [tool.name, tool]));
  const qualityTargets = {
    recall_context: {
      parameterCount: 13,
      markers: ['Requires memory:read', 'use recall for lightweight answer', 'get_project_context']
    },
    add_expense: {
      parameterCount: 18,
      markers: ['Requires memory:write', 'never deletes Ledger records', 'list_ledger_transactions']
    },
    get_timeline: {
      parameterCount: 5,
      markers: ['events newest first', 'Requires memory:read', 'use recall_context']
    },
    update_state: {
      parameterCount: 9,
      markers: ['Requires memory:write', 'Use remember for durable facts', 'ttl_seconds=0']
    },
    get_project_context: {
      parameterCount: 11,
      markers: ['Requires memory:read', 'exact project_id', 'otherwise use recall_context']
    }
  };

  for (const [name, expected] of Object.entries(qualityTargets)) {
    const tool = tools.get(name);
    assert.ok(tool, name);
    assert.equal(Object.keys(tool.inputSchema.properties).length, expected.parameterCount, name);
    for (const marker of expected.markers) {
      assert.match(tool.description, new RegExp(escapeRegExp(marker)), `${name}: ${marker}`);
    }
    for (const property of Object.values(tool.inputSchema.properties)) {
      assert.doesNotMatch(property.description, /Input value for/i, name);
    }
    assert.equal(tool.outputSchema.required.includes('result'), true, name);
    assert.equal(tool.annotations.destructiveHint, false, name);
  }
  assert.deepEqual(tools.get('get_project_context').inputSchema.required, ['project_id']);
});

test('offline stdio initialize advertises tools, prompts, and resources', async () => {
  const [response] = await callStdio([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'marketplace-validator', version: '1.0.0' }
      }
    }
  ]);

  assert.equal(response.result.serverInfo.name, 'xmemo');
  assert.deepEqual(response.result.capabilities, {
    tools: {},
    prompts: {},
    resources: {}
  });
});

test('offline stdio exposes prompt templates and readable documentation resources', async () => {
  const responses = await callStdio([
    { jsonrpc: '2.0', id: 1, method: 'prompts/list', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'xmemo://docs/getting-started' }
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: 'xmemo://docs/security' }
    }
  ]);

  assert.deepEqual(
    responses[0].result.prompts.map((prompt) => prompt.name),
    ['remember', 'recall', 'project-context']
  );
  assert.deepEqual(
    responses[1].result.resources.map((resource) => resource.uri),
    ['xmemo://docs/getting-started', 'xmemo://docs/security']
  );
  assert.match(responses[2].result.contents[0].text, /xmemo-mcp/);
  assert.match(responses[3].result.contents[0].text, /never embeds token values/i);
});

test('offline stdio rejects unknown resources with an MCP error', async () => {
  const [response] = await callStdio([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'xmemo://docs/missing' }
    }
  ]);

  assert.equal(response.error.code, -32002);
  assert.match(response.error.message, /Resource not found/);
});

async function callStdioToolsList() {
  const [response] = await callStdio([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
  ]);
  return response;
}

async function callStdio(requests) {
  const child = spawn(process.execPath, [path.join(root, 'bin', 'mcp-stdio.js')], {
    cwd: root,
    env: {
      ...process.env,
      XMEMO_KEY: '',
      MEMORY_OS_API_KEY: '',
      MEMORY_OS_MCP_TOKEN: ''
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  for (const request of requests) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }
  child.stdin.end();

  const code = await new Promise((resolve) => {
    child.on('close', resolve);
  });
  assert.equal(code, 0, stderr);

  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, requests.length, stdout);
  return lines.map((line) => JSON.parse(line));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
