#!/usr/bin/env node
/**
 * XMemo MCP stdio server — thin local proxy for Glama quality tests and
 * clients that only support stdio transport.
 *
 * Reads XMEMO_KEY and XMEMO_URL from environment, forwards all MCP
 * JSON-RPC messages to the hosted endpoint over Streamable HTTP.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpRemoteBin = resolve(__dirname, '..', 'node_modules', '.bin', 'mcp-remote');
const url = process.env.XMEMO_URL
  ? `${process.env.XMEMO_URL.replace(/\/$/, '')}/mcp`
  : 'https://xmemo.dev/mcp';
const token = process.env.XMEMO_KEY ?? '';

const args = [url];
if (token) {
  args.push('--header', `Authorization:Bearer ${token}`);
}

const child = spawn(process.execPath, [mcpRemoteBin, ...args], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: { ...process.env }
});

child.on('exit', (code) => process.exit(code ?? 1));
