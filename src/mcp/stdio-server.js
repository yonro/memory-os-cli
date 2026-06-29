/**
 * Self-contained MCP stdio server for XMemo.
 *
 * Forwards JSON-RPC over stdin/stdout to the hosted XMemo MCP endpoint.
 * When no token is available or the remote returns 401, serves static
 * tool/prompt/resource discovery so marketplace validators (LobeHub, Glama,
 * MCP Registry) can confirm the server installs and exposes tools.
 *
 * Real tool calls without a valid token return an auth-required error.
 */

import { CLI_VERSION, DEFAULT_SERVICE_URL, TOKEN_ENV_VAR } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Static tool metadata — returned when remote is unreachable or unauthenticated
// ---------------------------------------------------------------------------

const STATIC_TOOLS = [
  {
    name: 'remember',
    description: 'Save a memory so it can be recalled in future conversations.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Text body to save.' },
        path: { type: 'string', description: 'Category path, e.g. preferences, projects/xmemo.' }
      },
      required: ['content', 'path']
    }
  },
  {
    name: 'recall',
    description: 'Recall the most relevant saved memories before answering.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language question or search text.' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_memory',
    description: 'Search XMemo memories by natural-language query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language question or search text.' }
      },
      required: ['query']
    }
  },
  {
    name: 'recall_context',
    description: 'Build a context pack from XMemo memories for complex tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language question or search text.' }
      },
      required: ['query']
    }
  },
  {
    name: 'update_memory',
    description: 'Update the content or metadata of an existing memory.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'Exact XMemo memory reference.' }
      },
      required: ['memory_id']
    }
  },
  {
    name: 'forget',
    description: 'Permanently delete a memory by target.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'The memory to forget: current or an exact memory ID.' }
      },
      required: []
    }
  },
  {
    name: 'forget_memory',
    description: 'Delete a memory (recoverable) by exact reference.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'Exact XMemo memory reference.' }
      },
      required: ['memory_id']
    }
  },
  {
    name: 'redact_memory',
    description: 'Redact sensitive content from a memory while keeping an audit trail.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'Exact XMemo memory reference.' }
      },
      required: ['memory_id']
    }
  },
  {
    name: 'explain_memory',
    description: 'Explain why a memory exists or matched a query.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'Exact XMemo memory reference.' }
      },
      required: ['memory_id']
    }
  },
  {
    name: 'create_memory_todo',
    description: 'Create a TODO/action item with an optional due time.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Text body of the TODO item.' }
      },
      required: ['content']
    }
  },
  {
    name: 'list_memory_todos',
    description: 'List open or completed TODO/action items.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'complete_memory_todo',
    description: 'Mark a TODO/action item completed.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'The memory TODO/action-item ID to complete.' }
      },
      required: ['todo_id']
    }
  },
  {
    name: 'record_event',
    description: 'Record a significant session event, milestone, or decision.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Text body of the event.' }
      },
      required: ['content']
    }
  },
  {
    name: 'get_timeline',
    description: 'Show recent events.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'add_expense',
    description: 'Record one expense in the XMemo Ledger.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'The purchased item or service.' },
        amount: { type: 'number', description: 'Positive transaction amount.' }
      },
      required: ['item', 'amount']
    }
  },
  {
    name: 'create_restart_snapshot',
    description: 'Save active state for restart/handoff.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'restore_restart_snapshot',
    description: 'Resume previous work from a saved snapshot.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'memory_overview',
    description: 'Show a summary of XMemo memories and recent activity.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

const SERVER_INFO = {
  name: 'xmemo',
  version: CLI_VERSION
};

const SERVER_CAPABILITIES = {
  tools: {}
};

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

/**
 * Start the stdio MCP server. Reads newline-delimited JSON-RPC from stdin,
 * writes responses to stdout.
 */
export async function startStdioServer(env = process.env) {
  const token = env[TOKEN_ENV_VAR] || env.MEMORY_OS_API_KEY || env.MEMORY_OS_MCP_TOKEN || '';
  const baseUrl = (env.XMEMO_URL || env.MEMORY_OS_URL || DEFAULT_SERVICE_URL).replace(/\/$/, '');
  const mcpUrl = `${baseUrl}/mcp`;

  // Track session state
  let sessionId = null;
  let remoteAvailable = false;

  // Attempt remote initialize to check availability
  if (token) {
    remoteAvailable = await probeRemote(mcpUrl, token);
  }

  const rl = await createLineReader();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      writeResponse(makeError(null, -32700, 'Parse error'));
      continue;
    }

    const response = await handleRequest(request, { token, mcpUrl, remoteAvailable, sessionId });
    if (response) {
      if (response._sessionId) {
        sessionId = response._sessionId;
        delete response._sessionId;
      }
      writeResponse(response);
    }
  }
}

async function createLineReader() {
  const { createInterface } = await import('node:readline');
  return createInterface({ input: process.stdin, terminal: false });
}

function writeResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

async function handleRequest(request, ctx) {
  const { method, id, params } = request;

  // Notifications (no id) — no response needed
  if (id === undefined || id === null) {
    // Forward notifications to remote if available
    if (ctx.token && ctx.remoteAvailable) {
      forwardToRemote(request, ctx).catch(() => {});
    }
    return null;
  }

  switch (method) {
    case 'initialize':
      return handleInitialize(id, params, ctx);
    case 'tools/list':
      return handleToolsList(id, params, ctx);
    case 'tools/call':
      return handleToolsCall(id, params, ctx);
    case 'prompts/list':
      return makeResult(id, { prompts: [] });
    case 'resources/list':
      return makeResult(id, { resources: [] });
    case 'ping':
      return makeResult(id, {});
    default:
      // Try to forward unknown methods to remote
      if (ctx.token && ctx.remoteAvailable) {
        return await forwardToRemote(request, ctx);
      }
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

function handleInitialize(id, params, ctx) {
  const result = {
    protocolVersion: '2024-11-05',
    capabilities: SERVER_CAPABILITIES,
    serverInfo: SERVER_INFO
  };
  return makeResult(id, result);
}

async function handleToolsList(id, params, ctx) {
  // Try remote first
  if (ctx.token && ctx.remoteAvailable) {
    try {
      const remoteResponse = await forwardToRemote(
        { jsonrpc: '2.0', id, method: 'tools/list', params: params || {} },
        ctx
      );
      if (remoteResponse && remoteResponse.result && !remoteResponse.error) {
        return remoteResponse;
      }
    } catch {
      // Fall through to static
    }
  }
  // Static fallback
  return makeResult(id, { tools: STATIC_TOOLS });
}

async function handleToolsCall(id, params, ctx) {
  if (!ctx.token) {
    return makeError(id, -32002,
      `Authentication required. Set the ${TOKEN_ENV_VAR} environment variable or run: xmemo login`
    );
  }
  if (!ctx.remoteAvailable) {
    return makeError(id, -32002,
      `Remote XMemo server is not reachable. Run: xmemo doctor`
    );
  }
  // Forward to remote
  return await forwardToRemote(
    { jsonrpc: '2.0', id, method: 'tools/call', params },
    ctx
  );
}

// ---------------------------------------------------------------------------
// Remote communication
// ---------------------------------------------------------------------------

async function probeRemote(mcpUrl, token) {
  try {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'user-agent': `XMemo-MCP-Stdio/${CLI_VERSION}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '__probe__',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'xmemo-mcp-stdio', version: CLI_VERSION }
        }
      }),
      signal: AbortSignal.timeout(10000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function forwardToRemote(request, ctx) {
  try {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${ctx.token}`,
      'user-agent': `XMemo-MCP-Stdio/${CLI_VERSION}`
    };
    if (ctx.sessionId) {
      headers['mcp-session-id'] = ctx.sessionId;
    }

    const response = await fetch(ctx.mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      if (response.status === 401) {
        ctx.remoteAvailable = false;
        return makeError(request.id, -32002,
          `Authentication failed (HTTP 401). Verify your token: xmemo auth status --verify`
        );
      }
      return makeError(request.id, -32603,
        `Remote server returned HTTP ${response.status}`
      );
    }

    // Capture session ID from response headers
    const newSessionId = response.headers.get('mcp-session-id');

    const contentType = response.headers.get('content-type') || '';
    let result;
    if (contentType.includes('text/event-stream')) {
      // Parse SSE — take last data line as the JSON-RPC response
      const text = await response.text();
      const dataLines = text.split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trim())
        .filter(l => l);
      const lastData = dataLines[dataLines.length - 1];
      result = lastData ? JSON.parse(lastData) : makeError(request.id, -32603, 'Empty SSE response');
    } else {
      result = await response.json();
    }

    if (newSessionId) {
      result._sessionId = newSessionId;
    }
    return result;
  } catch (error) {
    return makeError(request.id, -32603,
      `Remote request failed: ${error.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function makeResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
