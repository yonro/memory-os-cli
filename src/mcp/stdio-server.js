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

const STATIC_TOOL_DESCRIPTIONS = {
  get_mcp_identity: 'Check XMemo connection status and the connected account/agent.',
  remember: 'Save a memory so it can be recalled in future conversations.',
  recall: 'Recall the most relevant saved memories before answering.',
  recall_context: 'Build a context pack from XMemo memories for complex tasks.',
  memory_stats: 'Show aggregate statistics for XMemo memories.',
  update_memory: 'Update the content or metadata of an existing memory.',
  explain_memory: 'Explain why a memory exists or matched a query.',
  restore_memory: 'Restore a previously deleted memory.',
  add_expense: 'Record one expense in the XMemo Ledger.',
  list_ledger_transactions: 'Show XMemo Ledger records.',
  get_monthly_ledger_summary: 'Summarize Ledger totals by month and currency.',
  forget: 'Permanently delete a memory by target.',
  create_memory_todo: 'Create a TODO/action item with an optional due time.',
  list_memory_todos: 'List open or completed TODO/action items.',
  complete_memory_todo: 'Mark a TODO/action item completed.',
  list_memory_versions: 'List available versions for a memory.',
  get_timeline: 'Show recent timeline events.',
  record_event: 'Record a significant session event, milestone, or decision.',
  update_state: 'Save the current working state during long-running work.',
  get_project_context: 'Build project-scoped context from XMemo memories.'
};

const STATIC_TOOL_SCHEMAS = {
  remember: {
    content: { type: 'string', description: 'Text body to save.' },
    path: { type: 'string', description: 'Category path, e.g. preferences, projects/xmemo.' }
  },
  recall: {
    query: { type: 'string', description: 'Natural-language question or search text.' }
  },
  recall_context: {
    query: { type: 'string', description: 'Natural-language question or search text.' }
  },
  update_memory: {
    memory_id: { type: 'string', description: 'Exact XMemo memory reference.' },
    content: { type: 'string', description: 'Replacement memory content.' },
    path: { type: 'string', description: 'Replacement memory path.' }
  },
  explain_memory: {
    memory_id: { type: 'string', description: 'Exact XMemo memory reference.' },
    query: { type: 'string', description: 'Optional explanation query.' }
  },
  restore_memory: {
    memory_id: { type: 'string', description: 'Exact XMemo memory reference.' },
    reason: { type: 'string', description: 'Optional restore reason.' }
  },
  add_expense: {
    item: { type: 'string', description: 'The purchased item or service.' },
    amount: { type: 'number', description: 'Positive transaction amount.' }
  },
  list_ledger_transactions: {
    query: { type: 'string', description: 'Optional ledger search text.' },
    limit: { type: 'integer', description: 'Maximum number of records.' }
  },
  get_monthly_ledger_summary: {
    months: { type: 'integer', description: 'Number of recent months to summarize.' }
  },
  forget: {
    target: { type: 'string', description: 'The memory to forget: current or an exact memory ID.' },
    reason: { type: 'string', description: 'Optional deletion reason.' }
  },
  create_memory_todo: {
    content: { type: 'string', description: 'Text body of the TODO item.' },
    due_at: { type: 'string', description: 'Optional due time.' }
  },
  list_memory_todos: {
    item_status: { type: 'string', description: 'Optional TODO status filter.' },
    limit: { type: 'integer', description: 'Maximum number of TODOs.' }
  },
  complete_memory_todo: {
    todo_id: { type: 'string', description: 'The memory TODO/action-item ID to complete.' }
  },
  list_memory_versions: {
    memory_id: { type: 'string', description: 'Exact XMemo memory reference.' }
  },
  record_event: {
    content: { type: 'string', description: 'Text body of the event.' }
  },
  update_state: {
    state_key: { type: 'string', description: 'Working-state key to save.' },
    current_task: { type: 'string', description: 'Current task or work item.' },
    next_action: { type: 'string', description: 'Next action for later resume.' }
  },
  get_project_context: {
    query: { type: 'string', description: 'Project-context query.' },
    project_id: { type: 'string', description: 'Optional project identifier.' }
  }
};

const STATIC_TOOL_REQUIRED = {
  remember: ['content', 'path'],
  recall: ['query'],
  recall_context: ['query'],
  update_memory: ['memory_id'],
  explain_memory: ['memory_id'],
  restore_memory: ['memory_id'],
  add_expense: ['item', 'amount'],
  create_memory_todo: ['content'],
  complete_memory_todo: ['todo_id'],
  list_memory_versions: ['memory_id'],
  record_event: ['content'],
};

const STATIC_TOOL_NAMES = [
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
];

const STATIC_TOOLS = STATIC_TOOL_NAMES.map((name) => ({
  name,
  description: STATIC_TOOL_DESCRIPTIONS[name],
  inputSchema: {
    type: 'object',
    properties: STATIC_TOOL_SCHEMAS[name] || {},
    required: STATIC_TOOL_REQUIRED[name] || []
  }
}));

const SERVER_INFO = {
  name: 'xmemo',
  version: CLI_VERSION
};

const STATIC_PROMPTS = [
  {
    name: 'remember',
    description: 'Save a memory to XMemo for future recall across sessions.',
    arguments: [
      { name: 'content', description: 'The text to remember.', required: true },
      { name: 'path', description: 'Category path, e.g. preferences, projects/myapp.', required: false }
    ]
  },
  {
    name: 'recall',
    description: 'Recall relevant memories from XMemo before answering a question.',
    arguments: [
      { name: 'query', description: 'What to search for in memory.', required: true }
    ]
  },
  {
    name: 'project-context',
    description: 'Build a context pack from XMemo for the current project or task.',
    arguments: [
      { name: 'query', description: 'Describe the project or task context needed.', required: true }
    ]
  }
];

function handlePromptsGet(id, params, ctx) {
  const name = params?.name;
  const prompt = STATIC_PROMPTS.find(p => p.name === name);
  if (!prompt) {
    return makeError(id, -32602, `Prompt not found: ${name}`);
  }
  const args = params?.arguments || {};
  const messages = [];
  if (name === 'remember') {
    messages.push({
      role: 'user',
      content: { type: 'text', text: `Remember this: ${args.content || '(no content provided)'}${args.path ? ` [path: ${args.path}]` : ''}` }
    });
  } else if (name === 'recall') {
    messages.push({
      role: 'user',
      content: { type: 'text', text: `Recall memories related to: ${args.query || '(no query provided)'}` }
    });
  } else if (name === 'project-context') {
    messages.push({
      role: 'user',
      content: { type: 'text', text: `Build XMemo context for: ${args.query || '(no query provided)'}` }
    });
  }
  return makeResult(id, { description: prompt.description, messages });
}

const SERVER_CAPABILITIES = {
  tools: {},
  prompts: {}
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
      return makeResult(id, { prompts: STATIC_PROMPTS });
    case 'prompts/get':
      return handlePromptsGet(id, params, ctx);
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
