// Thin MCP JSON-RPC client over Streamable HTTP.
// Pattern copied from memory-os-cli/src/network/http.js (initialize + Bearer +
// 'accept: application/json, text/event-stream'). There is NO importable client
// library in the published @xmemo/client (it is a CLI bin), so we keep this small
// and self-contained.

import {
  AGENT_ID_HEADER,
  AGENT_INSTANCE_HEADER,
  EXTENSION_VERSION,
  TOOL_IDENTITY,
  TOOL_RECALL,
  TOOL_REMEMBER,
  TOOL_SEARCH
} from '../constants';

export interface XMemoClientOptions {
  baseUrl: string;
  token: string;
  agentId: string;
  agentInstanceId?: string;
  timeoutMs?: number;
}

export interface ToolResult {
  text: string;
  raw: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

function mcpUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = '/mcp';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Parses a Streamable-HTTP MCP response body, which may be either a single JSON
 * object or an SSE stream of data: lines. Returns the last JSON-RPC payload.
 */
function parseBody(contentType: string, body: string): JsonRpcResponse | undefined {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }
  if (contentType.includes('text/event-stream') || trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    let last: JsonRpcResponse | undefined;
    for (const line of trimmed.split(/\r?\n/)) {
      const match = /^data:\s?(.*)$/.exec(line);
      if (match && match[1]) {
        try {
          last = JSON.parse(match[1]) as JsonRpcResponse;
        } catch {
          /* ignore non-JSON keepalive frames */
        }
      }
    }
    return last;
  }
  return JSON.parse(trimmed) as JsonRpcResponse;
}

export class XMemoAuthError extends Error {}

export class XMemoClient {
  private readonly url: string;
  private sessionId: string | undefined;
  private nextId = 1;

  constructor(private readonly opts: XMemoClientOptions) {
    this.url = mcpUrl(opts.baseUrl);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${this.opts.token}`,
      'user-agent': `XMemo-VSCode/${EXTENSION_VERSION} (+https://xmemo.dev)`,
      [AGENT_ID_HEADER]: this.opts.agentId
    };
    if (this.opts.agentInstanceId) {
      headers[AGENT_INSTANCE_HEADER] = this.opts.agentInstanceId;
    }
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }
    return headers;
  }

  private async rpc(method: string, params: unknown, expectResult: boolean): Promise<JsonRpcResponse | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: controller.signal
      });

      const sid = response.headers.get('mcp-session-id');
      if (sid) {
        this.sessionId = sid;
      }

      if (response.status === 401 || response.status === 403) {
        throw new XMemoAuthError(`Not authorized (HTTP ${response.status}). Sign in again.`);
      }

      const body = await response.text();
      const payload = parseBody(response.headers.get('content-type') ?? '', body);

      if (!response.ok) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`;
        throw new Error(`XMemo request failed: ${message}`);
      }
      if (expectResult && payload?.error) {
        throw new Error(`XMemo error: ${payload.error.message}`);
      }
      return payload;
    } catch (error: any) {
      if (error instanceof XMemoAuthError) {
        throw error;
      }
      const reason = error?.name === 'AbortError' ? 'request timed out' : error?.message ?? String(error);
      throw new Error(reason);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** MCP handshake. Safe to call before each logical operation; cheap once a session exists. */
  async ensureSession(): Promise<void> {
    if (this.sessionId) {
      return;
    }
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'xmemo-vscode', version: EXTENSION_VERSION }
    }, true);
    try {
      await this.rpc('notifications/initialized', {}, false);
    } catch {
      /* some servers don't require it */
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    await this.ensureSession();
    const payload = await this.rpc('tools/call', { name, arguments: args }, true);
    const content = payload?.result?.content;
    let text = '';
    if (Array.isArray(content)) {
      text = content
        .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('\n')
        .trim();
    }
    return { text, raw: payload?.result };
  }

  /** remember requires BOTH content and path (confirmed against the live server). */
  async remember(content: string, path: string): Promise<ToolResult> {
    return this.callTool(TOOL_REMEMBER, { content, path });
  }

  async recall(query: string, limit = 5): Promise<ToolResult> {
    return this.callTool(TOOL_RECALL, { query, limit });
  }

  async search(query: string, limit = 5): Promise<ToolResult> {
    return this.callTool(TOOL_SEARCH, { query, limit });
  }

  /**
   * End-to-end auth check used by Sign In: calls get_mcp_identity (no args) and
   * returns the connected account/agent description. Throws on auth failure.
   */
  async verify(): Promise<string> {
    const result = await this.callTool(TOOL_IDENTITY, {});
    return result.text || 'connected';
  }
}
