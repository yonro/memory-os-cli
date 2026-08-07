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
  recall_context: 'Read a multi-memory context pack. Requires memory:read and does not change content. Use when many memories need explicit budgets; use recall for lightweight answer or get_project_context for project snapshot. max_items/max_tokens bound rendered output.',
  memory_stats: 'Show aggregate statistics for XMemo memories.',
  update_memory: 'Update the content or metadata of an existing memory.',
  explain_memory: 'Explain why a memory exists or matched a query.',
  restore_memory: 'Restore a previously deleted memory.',
  add_expense: "Create one XMemo Ledger transaction and backing memory. Requires memory:write; it records a new transaction or reuses a semantic duplicate, and never deletes Ledger records. Use it for a purchase, income, refund, or transfer; use list_ledger_transactions or get_monthly_ledger_summary for reads. amount must be positive; transaction_type defaults to expense; blank transaction_date uses today's UTC date.",
  list_ledger_transactions: 'Show XMemo Ledger records.',
  get_monthly_ledger_summary: 'Summarize Ledger totals by month and currency.',
  forget: 'Permanently delete a memory by target.',
  create_memory_todo: 'Create a TODO/action item with an optional due time.',
  list_memory_todos: 'List open or completed TODO/action items.',
  complete_memory_todo: 'Mark a TODO/action item completed.',
  list_memory_versions: 'List available versions for a memory.',
  get_timeline: 'Read authorized timeline events newest first. Requires memory:read and makes no memory changes. Use it for recent history or session resumption; use recall_context for semantic multi-memory context. limit is clamped to 1-500; session_id and event_type are exact filters.',
  record_event: 'Record a significant session event, milestone, or decision.',
  update_state: 'Create or replace one scoped working-state record for resuming a task, next action, or blocker. Requires memory:write; it versions that state slot and refreshes its expiry without deleting other memories. Use remember for durable facts or record_event for history. Provide content or a structured state field; ttl_seconds=0 means no expiry.',
  get_project_context: "Read one authorized project's bounded context pack: state, TODOs, decisions, timeline, recent memories, and optional durable recall. Requires memory:read; it does not mutate project memories, and access is audit-logged. Use an exact project_id for a whole-project snapshot; otherwise use recall_context. max_items/max_tokens bound the whole pack; recent_hours affects only timeline; durable_query requires include_durable_context."
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
    query: { type: 'string', description: 'Natural-language query used to rank memories for the context pack.' },
    max_items: { type: 'integer', default: 8, description: 'Maximum memories rendered in the context pack.' },
    max_tokens: { type: 'integer', default: 1500, description: 'Approximate token budget for the rendered context pack.' },
    limit: { type: 'integer', default: 0, description: 'Candidate-result limit; 0 derives it from the item/token budgets.' },
    path_filter: { type: 'string', default: '%', description: 'Case-insensitive memory-path pattern; % matches all paths.' },
    bucket: { type: 'string', default: '%', description: 'Accessible bucket filter; % includes all accessible buckets.' },
    scope: { type: 'string', default: '', description: 'Optional authorized scope; blank uses the token default.' },
    team_id: { type: 'string', default: '', description: 'Optional exact authorized team filter.' },
    memory_type: { type: 'string', default: 'auto', description: 'Memory type filter; auto searches the normal mixed set.' },
    prefer_working: { type: 'boolean', default: true, description: 'True prioritizes active working/session-state signals.' },
    output_json: { type: 'boolean', default: false, description: 'True returns the full structured pack; false returns rendered context text.' },
    agent_id: { type: 'string', default: '', description: 'Optional client-supplied agent label for memory attribution.' },
    agent_instance_id: { type: 'string', default: '', description: 'Optional stable, non-secret agent instance ID for per-client attribution.' }
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
    item: { type: 'string', description: 'Purchased item, income source, refund, or transfer label.' },
    amount: { type: 'number', description: 'Positive transaction amount; zero and negative values are rejected.' },
    transaction_type: { type: 'string', default: 'expense', description: 'Transaction to create: expense, income, refund, or transfer.' },
    currency: { type: 'string', default: 'CNY', description: 'Currency code or label; labels such as yen or RMB are normalized to codes.' },
    transaction_date: { type: 'string', default: '', description: "YYYY-MM-DD transaction date; blank uses today's UTC date." },
    category: { type: 'string', default: '', description: 'Optional Ledger category, such as food, transport, or electronics.' },
    merchant: { type: 'string', default: '', description: 'Optional merchant, payer, payee, or store name.' },
    payment_method: { type: 'string', default: '', description: 'Optional payment method, such as card, cash, Alipay, or WeChat Pay.' },
    note: { type: 'string', default: '', description: 'Optional note stored with the transaction.' },
    path: { type: 'string', default: 'finance/ledger/expenses', description: 'Memory path; the default follows transaction_type for non-expenses.' },
    bucket: { type: 'string', default: 'private', description: 'Bucket for the backing memory; defaults to private.' },
    scope: { type: 'string', default: '', description: 'Optional authorized scope; must match project_id when both are set.' },
    team_id: { type: 'string', default: '', description: 'Optional team attribution within the authorized scope.' },
    agent_id: { type: 'string', default: '', description: 'Optional client-supplied agent label for memory attribution.' },
    agent_instance_id: { type: 'string', default: '', description: 'Optional stable, non-secret agent instance ID for per-client attribution.' },
    device_id: { type: 'string', default: '', description: 'Optional client-supplied device identifier for attribution.' },
    device_label: { type: 'string', default: '', description: 'Optional human-readable device label for attribution.' },
    project_id: { type: 'string', default: '', description: 'Optional exact authorized project ID; stores the transaction in its private scope.' }
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
  get_timeline: {
    limit: { type: 'integer', default: 20, description: 'Maximum events to return; values are clamped to 1-500.' },
    bucket: { type: 'string', default: '%', description: 'Accessible bucket filter; % includes all accessible buckets.' },
    scope: { type: 'string', default: '', description: 'Optional authorized scope; blank uses the token default.' },
    session_id: { type: 'string', default: '', description: 'Optional exact session ID filter.' },
    event_type: { type: 'string', default: '', description: 'Optional exact event type after lowercase normalization.' }
  },
  update_state: {
    content: { type: 'string', default: '', description: 'Free-form state body; otherwise provide at least one structured state field.' },
    state_key: { type: 'string', default: 'active_task', description: 'Normalized state slot; the same owner, bucket, scope, and key updates that slot.' },
    current_task: { type: 'string', default: '', description: 'Current task; used to build the state body when content is blank.' },
    next_action: { type: 'string', default: '', description: 'Next action; used to build the state body when content is blank.' },
    blocked_reason: { type: 'string', default: '', description: 'Blocker; used to build the state body when content is blank.' },
    metadata_json: { type: 'string', default: '{}', description: 'JSON object merged into the working-state metadata.' },
    ttl_seconds: { type: 'integer', default: 86400, description: 'Expiry in seconds from 0 to 2592000; 0 means no expiry.' },
    bucket: { type: 'string', default: 'work', description: 'Bucket containing the working-state slot; defaults to work.' },
    scope: { type: 'string', default: '', description: 'Scope containing the working-state slot; blank uses the token default.' }
  },
  get_project_context: {
    project_id: { type: 'string', description: 'Exact authorized project ID; project names are not accepted.' },
    bucket: { type: 'string', default: '%', description: 'Accessible bucket filter; % includes all accessible buckets.' },
    team_id: { type: 'string', default: '', description: 'Optional exact authorized team focus; other team rows are excluded.' },
    max_items: { type: 'integer', default: 100, description: 'Whole-pack item budget from 1 to 1000.' },
    max_tokens: { type: 'integer', default: 8000, description: 'Whole-pack approximate token budget from 1 to 50000.' },
    include_durable_context: { type: 'boolean', default: true, description: 'Include semantic durable recall; false omits that section.' },
    durable_query: { type: 'string', default: '', description: 'Query only for durable recall; ignored when include_durable_context is false.' },
    recent_hours: { type: 'integer', default: 168, description: 'Timeline lookback from 1 to 8760 hours; other sections are unaffected.' },
    output_json: { type: 'boolean', default: false, description: 'True returns the full structured pack; false returns a text summary.' },
    agent_id: { type: 'string', default: '', description: 'Optional client-supplied agent label for memory attribution.' },
    agent_instance_id: { type: 'string', default: '', description: 'Optional stable, non-secret agent instance ID for per-client attribution.' }
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
  get_project_context: ['project_id'],
};

const READ_ONLY_STATIC_TOOLS = new Set([
  'recall_context',
  'get_project_context',
  'get_timeline'
]);

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

export const STATIC_TOOLS = STATIC_TOOL_NAMES.map((name) => ({
  name,
  description: STATIC_TOOL_DESCRIPTIONS[name],
  inputSchema: {
    type: 'object',
    properties: STATIC_TOOL_SCHEMAS[name] || {},
    required: STATIC_TOOL_REQUIRED[name] || []
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'string', description: 'Human-readable text or JSON requested by output_json.' }
    },
    required: ['result']
  },
  ...(READ_ONLY_STATIC_TOOLS.has(name) || name === 'update_state' || name === 'add_expense'
    ? {
        annotations: {
          readOnlyHint: READ_ONLY_STATIC_TOOLS.has(name),
          destructiveHint: false,
          idempotentHint: READ_ONLY_STATIC_TOOLS.has(name),
          openWorldHint: false
        }
      }
    : {})
}));

const SERVER_INFO = {
  name: 'xmemo',
  version: CLI_VERSION
};

export const STATIC_PROMPTS = [
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

const GETTING_STARTED_RESOURCE = `# XMemo MCP quick start

XMemo gives AI agents durable, user-owned memory across clients and sessions.

1. Install the CLI: \`npm install -g @xmemo/client\`
2. Sign in: \`xmemo login\`
3. Check the connection: \`xmemo doctor\`
4. Configure a client: \`xmemo setup <client>\`

For stdio MCP clients, run \`xmemo-mcp\` or \`xmemo mcp serve\`.
For Streamable HTTP clients, connect to \`https://xmemo.dev/mcp\`.

Documentation: https://xmemo.dev/product/mcp
`;

const SECURITY_RESOURCE = `# XMemo security and privacy

- Credentials are read from the user-scoped XMemo credential store or the
  \`XMEMO_KEY\` environment variable.
- Generated project configuration never embeds token values.
- Discovery, tools, prompts, and these documentation resources are available
  without a token; tool execution requires authentication.
- Never paste XMemo credentials into prompts, source files, logs, or public
  issue reports.
- Destructive operations such as \`forget\` require an explicit user request.
`;

export const STATIC_RESOURCES = [
  {
    uri: 'xmemo://docs/getting-started',
    name: 'XMemo MCP quick start',
    description: 'Installation, authentication, and connection guidance for XMemo MCP.',
    mimeType: 'text/markdown'
  },
  {
    uri: 'xmemo://docs/security',
    name: 'XMemo security and privacy',
    description: 'Credential handling, privacy boundaries, and destructive-action guidance.',
    mimeType: 'text/markdown'
  }
];

const STATIC_RESOURCE_CONTENT = new Map([
  ['xmemo://docs/getting-started', GETTING_STARTED_RESOURCE],
  ['xmemo://docs/security', SECURITY_RESOURCE]
]);

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

function handleResourcesRead(id, params) {
  const uri = params?.uri;
  const resource = STATIC_RESOURCES.find((item) => item.uri === uri);
  const text = STATIC_RESOURCE_CONTENT.get(uri);
  if (!resource || text === undefined) {
    return makeError(id, -32002, `Resource not found: ${uri || '(missing uri)'}`);
  }
  return makeResult(id, {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text
      }
    ]
  });
}

const SERVER_CAPABILITIES = {
  tools: {},
  prompts: {},
  resources: {}
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
      return makeResult(id, { resources: STATIC_RESOURCES });
    case 'resources/read':
      return handleResourcesRead(id, params);
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
