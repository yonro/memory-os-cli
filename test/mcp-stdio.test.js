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
      parameterCount: 21,
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

test('offline stdio tools/list defines 8 temporal and semantic parameters on recall and recall_context', async () => {
  const response = await callStdioToolsList();
  const tools = new Map(response.result.tools.map((tool) => [tool.name, tool]));

  const recall = tools.get('recall');
  const recallContext = tools.get('recall_context');

  assert.ok(recall, 'recall tool must exist');
  assert.ok(recallContext, 'recall_context tool must exist');

  assert.equal(Object.keys(recall.inputSchema.properties).length, 9);
  assert.deepEqual(recall.inputSchema.required, ['query']);

  assert.equal(Object.keys(recallContext.inputSchema.properties).length, 21);
  assert.deepEqual(recallContext.inputSchema.required, ['query']);

  const expectedTemporalParams = {
    since: {
      type: 'string',
      descriptionMatches: [/RFC 3339/, /timezone offset/]
    },
    until: {
      type: 'string',
      descriptionMatches: [/RFC 3339/, /until > since/]
    },
    time_order: {
      type: 'string',
      enum: ['desc', 'asc'],
      descriptionMatches: [/Sort order/, /desc/, /asc/]
    },
    owner_timezone: {
      type: 'string',
      descriptionMatches: [/IANA timezone/]
    },
    reference_time: {
      type: 'string',
      descriptionMatches: [/ISO 8601/]
    },
    temporal_axis_mode: {
      type: 'string',
      enum: ['created_at', 'updated_at', 'split_filter_created_order_updated'],
      descriptionMatches: [/temporal axis resolution policy/]
    },
    query_mode: {
      type: 'string',
      enum: ['topic', 'activity_log'],
      descriptionMatches: [/activity_log/, /bounded/]
    },
    hypothetical_answer: {
      type: 'string',
      descriptionMatches: [/hypothetical answer/, /semantic expansion/]
    }
  };

  for (const [toolName, tool] of [['recall', recall], ['recall_context', recallContext]]) {
    for (const [paramName, spec] of Object.entries(expectedTemporalParams)) {
      const prop = tool.inputSchema.properties[paramName];
      assert.ok(prop, `${toolName} must have property ${paramName}`);
      assert.equal(prop.type, spec.type, `${toolName}.${paramName} type`);
      if (spec.enum) {
        assert.deepEqual(prop.enum, spec.enum, `${toolName}.${paramName} enum`);
      }
      for (const pattern of spec.descriptionMatches) {
        assert.match(prop.description, pattern, `${toolName}.${paramName} description match ${pattern}`);
      }
      assert.doesNotMatch(prop.description, /Input value for/i, `${toolName}.${paramName} must not contain placeholder`);
    }
  }
});

test('offline stdio tools/list leaves other 18 static tool schemas untouched', async () => {
  const response = await callStdioToolsList();
  const tools = new Map(response.result.tools.map((tool) => [tool.name, tool]));

  const otherToolExpectations = {
    get_mcp_identity: { propertyCount: 0, required: [] },
    remember: { propertyCount: 2, required: ['content', 'path'] },
    memory_stats: { propertyCount: 0, required: [] },
    update_memory: { propertyCount: 3, required: ['memory_id'] },
    explain_memory: { propertyCount: 2, required: ['memory_id'] },
    restore_memory: { propertyCount: 2, required: ['memory_id'] },
    add_expense: { propertyCount: 18, required: ['item', 'amount'] },
    list_ledger_transactions: { propertyCount: 2, required: [] },
    get_monthly_ledger_summary: { propertyCount: 1, required: [] },
    forget: { propertyCount: 2, required: [] },
    create_memory_todo: { propertyCount: 2, required: ['content'] },
    list_memory_todos: { propertyCount: 2, required: [] },
    complete_memory_todo: { propertyCount: 1, required: ['todo_id'] },
    list_memory_versions: { propertyCount: 1, required: ['memory_id'] },
    get_timeline: { propertyCount: 5, required: [] },
    record_event: { propertyCount: 1, required: ['content'] },
    update_state: { propertyCount: 9, required: [] },
    get_project_context: { propertyCount: 11, required: ['project_id'] }
  };

  for (const [name, expected] of Object.entries(otherToolExpectations)) {
    const tool = tools.get(name);
    assert.ok(tool, `${name} must exist`);
    assert.equal(
      Object.keys(tool.inputSchema.properties).length,
      expected.propertyCount,
      `${name} propertyCount`
    );
    assert.deepEqual(tool.inputSchema.required, expected.required, `${name} required`);
  }
});

test('stdio tools/call forwards parameters to remote without local validation', async () => {
  const http = await import('node:http');
  const receivedRequests = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedRequests.push(parsed);

      if (parsed.id === '__probe__') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: '__probe__',
          result: { protocolVersion: '2024-11-05', serverInfo: { name: 'mock-xmemo' } }
        }));
        return;
      }

      if (parsed.method === 'tools/call') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: { content: [{ type: 'text', text: 'ok' }] }
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockUrl = `http://127.0.0.1:${port}`;

  try {
    const toolCallParams = {
      name: 'recall',
      arguments: {
        query: 'search term',
        since: 'raw-arbitrary-string',
        until: 'raw-arbitrary-end',
        time_order: 'desc',
        owner_timezone: 'Asia/Tokyo',
        reference_time: 'arbitrary-ref',
        temporal_axis_mode: 'split_filter_created_order_updated',
        query_mode: 'activity_log',
        hypothetical_answer: 'hypo text'
      }
    };

    const [response] = await callStdio(
      [
        {
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/call',
          params: toolCallParams
        }
      ],
      {
        XMEMO_KEY: 'test-mock-token',
        XMEMO_URL: mockUrl
      }
    );

    assert.equal(response.id, 42);
    assert.deepEqual(response.result, { content: [{ type: 'text', text: 'ok' }] });

    const callReq = receivedRequests.find((r) => r.method === 'tools/call');
    assert.ok(callReq, 'remote must receive tools/call');
    assert.deepEqual(callReq.params, toolCallParams, 'remote must receive exact params without local validation');
  } finally {
    server.close();
  }
});

test('authenticated stdio tools/list prefers remote definitions over static fallback', async () => {
  const http = await import('node:http');

  const remoteTool = {
    name: 'remote_custom_tool',
    description: 'Provided by remote server',
    inputSchema: { type: 'object', properties: {} }
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      if (parsed.id === '__probe__') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: '__probe__',
          result: { protocolVersion: '2024-11-05', serverInfo: { name: 'mock-xmemo' } }
        }));
        return;
      }
      if (parsed.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: { tools: [remoteTool] }
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockUrl = `http://127.0.0.1:${port}`;

  try {
    const [response] = await callStdio(
      [{ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }],
      {
        XMEMO_KEY: 'test-mock-token',
        XMEMO_URL: mockUrl
      }
    );

    assert.equal(response.id, 99);
    assert.deepEqual(response.result.tools, [remoteTool]);
  } finally {
    server.close();
  }
});

async function callStdioToolsList() {
  const [response] = await callStdio([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
  ]);
  return response;
}

async function callStdio(requests, envOverrides = {}) {
  const child = spawn(process.execPath, [path.join(root, 'bin', 'mcp-stdio.js')], {
    cwd: root,
    env: {
      ...process.env,
      XMEMO_KEY: '',
      MEMORY_OS_API_KEY: '',
      MEMORY_OS_MCP_TOKEN: '',
      ...envOverrides
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
