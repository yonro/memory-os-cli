#!/usr/bin/env node
/**
 * XMemo MCP stdio server — self-contained local proxy.
 *
 * Reads XMEMO_KEY and XMEMO_URL from environment, forwards MCP JSON-RPC
 * messages to the hosted endpoint over Streamable HTTP. Falls back to
 * static tool metadata when unauthenticated so marketplace validators
 * can confirm server capabilities.
 *
 * Equivalent to: xmemo mcp serve
 */
import { startStdioServer } from '../src/mcp/stdio-server.js';

await startStdioServer(process.env);
