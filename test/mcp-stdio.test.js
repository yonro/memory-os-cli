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
});

async function callStdioToolsList() {
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

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
  child.stdin.end();

  const code = await new Promise((resolve) => {
    child.on('close', resolve);
  });
  assert.equal(code, 0, stderr);

  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, stdout);
  return JSON.parse(lines[0]);
}
