#!/usr/bin/env node

/**
 * XMemo Skill Pre-Release Smoke Test Runner
 *
 * Runs all read-only and gated write commands against an XMemo service target
 * and asserts process exit codes and JSON envelope contracts.
 *
 * Usage:
 *   node scripts/xmemo-skill-smoke-test.mjs [options]
 *
 * Options:
 *   --base-url <url>        XMemo service URL (default: $XMEMO_BASE_URL or https://xmemo.dev)
 *   --timeout-ms <ms>       Request timeout in milliseconds (default: 15000)
 *   --execute-writes        Enable write operations (default: false, writes skipped)
 *   --script-path <path>    Path to xmemo-skill.mjs (default: auto-detected)
 *   --token <token>         Explicit token to use (default: $XMEMO_KEY)
 *   --json                  Output smoke test summary envelope in JSON format
 *   --verbose               Print command output as each check executes
 *   --help                  Display help and options
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SKILL_SCRIPT = path.resolve(__dirname, '../skills/xmemo/scripts/xmemo-skill.mjs');

export const READ_ONLY_COMMANDS = Object.freeze([
  {
    id: 'version',
    name: '--version',
    type: 'read',
    args: ['--version'],
    isJson: false,
    validate: (res) => {
      if (res.code !== 0) return { valid: false, error: `Expected exit code 0, got ${res.code}` };
      if (!/^\d+\.\d+\.\d+/.test(res.stdout)) {
        return { valid: false, error: `Output does not contain valid semver: ${res.stdout}` };
      }
      return { valid: true };
    },
  },
  {
    id: 'help',
    name: '--help',
    type: 'read',
    args: ['--help'],
    isJson: false,
    validate: (res) => {
      if (res.code !== 0) return { valid: false, error: `Expected exit code 0, got ${res.code}` };
      if (!/Usage:/i.test(res.stdout)) {
        return { valid: false, error: 'Output does not contain usage banner' };
      }
      return { valid: true };
    },
  },
  {
    id: 'doctor-anonymous',
    name: 'doctor --anonymous',
    type: 'read',
    args: ['doctor', '--anonymous', '--json'],
    isJson: true,
    validate: (res, payload) => {
      if (res.code !== 0) return { valid: false, error: `Expected exit code 0, got ${res.code}` };
      if (!payload || typeof payload !== 'object') {
        return { valid: false, error: 'Expected valid JSON object response' };
      }
      if (payload.ok === false) {
        return { valid: false, error: `Doctor check failed: ${payload.error?.message || 'unknown'}` };
      }
      return { valid: true };
    },
  },
  {
    id: 'auth-status',
    name: 'auth status',
    type: 'read',
    args: ['auth', 'status', '--json'],
    isJson: true,
    validate: (res, payload) => {
      if (res.code !== 0) return { valid: false, error: `Expected exit code 0, got ${res.code}` };
      if (!payload || typeof payload !== 'object' || typeof payload.status !== 'string') {
        return { valid: false, error: 'Envelope missing string status property' };
      }
      return { valid: true };
    },
  },
  {
    id: 'overview',
    name: 'overview',
    type: 'read',
    args: ['overview', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'overview');
    },
  },
  {
    id: 'activity',
    name: 'activity',
    type: 'read',
    args: ['activity', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'activity');
    },
  },
  {
    id: 'stats',
    name: 'stats',
    type: 'read',
    args: ['stats', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'stats');
    },
  },
  {
    id: 'ledger-list',
    name: 'ledger-list',
    type: 'read',
    args: ['ledger-list', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'ledger-list');
    },
  },
  {
    id: 'ledger-summary',
    name: 'ledger-summary',
    type: 'read',
    args: ['ledger-summary', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'ledger-summary');
    },
  },
  {
    id: 'todo-list',
    name: 'todo-list',
    type: 'read',
    args: ['todo-list', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'todo-list');
    },
  },
  {
    id: 'search',
    name: 'search',
    type: 'read',
    args: ['search', '--query', 'smoke_test_query', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'search');
    },
  },
  {
    id: 'recall',
    name: 'recall',
    type: 'read',
    args: ['recall', '--query', 'smoke_test_query', '--json'],
    isJson: true,
    validate: (res, payload) => {
      return validateStandardEnvelope(res, payload, 'recall');
    },
  },
  {
    id: 'recall-context',
    name: 'recall-context',
    type: 'read',
    args: ['recall-context', '--query', 'smoke_test_query', '--json'],
    isJson: true,
    validate: (res, payload) => {
      if (res.code !== 0) return { valid: false, error: `Expected exit code 0, got ${res.code}` };
      if (!payload || typeof payload !== 'object') {
        return { valid: false, error: 'Expected valid JSON object response' };
      }
      if (payload.ok === false) {
        if (!payload.error?.code) {
          return { valid: false, error: 'Error envelope missing error.code' };
        }
        return { valid: false, error: `Recall context returned error: ${payload.error.code}` };
      }
      if (payload.context_text === undefined && payload.ok !== true) {
        return { valid: false, error: 'Envelope missing context_text and ok fields' };
      }
      return { valid: true };
    },
  },
  {
    id: 'read-probe',
    name: 'read (probe nonexistent ID)',
    type: 'read',
    args: ['read', '--id', '__smoke_probe_nonexistent_id__', '--json'],
    isJson: true,
    validate: (res, payload) => {
      if (res.code === 0) {
        if (payload?.ok !== true) {
          return { valid: false, error: 'Success exit 0 requires ok: true in envelope' };
        }
        return { valid: true };
      }
      if (res.code === 1) {
        if (payload?.ok !== false) {
          return { valid: false, error: 'Error exit 1 requires ok: false in envelope' };
        }
        if (!payload?.error || typeof payload.error.code !== 'string') {
          return { valid: false, error: 'Error envelope missing error.code string property' };
        }
        return { valid: true };
      }
      return { valid: false, error: `Unexpected exit code ${res.code} (expected 0 or 1)` };
    },
  },
  {
    id: 'state-restore-probe',
    name: 'restore-state (probe nonexistent key)',
    type: 'read',
    args: ['restore-state', '--key', '__smoke_probe_key__', '--json'],
    isJson: true,
    validate: (res, payload) => {
      if (res.code === 0) {
        if (payload?.ok !== true) {
          return { valid: false, error: 'Success exit 0 requires ok: true in envelope' };
        }
        return { valid: true };
      }
      if (res.code === 1) {
        if (payload?.ok !== false) {
          return { valid: false, error: 'Error exit 1 requires ok: false in envelope' };
        }
        if (!payload?.error || typeof payload.error.code !== 'string') {
          return { valid: false, error: 'Error envelope missing error.code string property' };
        }
        return { valid: true };
      }
      return { valid: false, error: `Unexpected exit code ${res.code} (expected 0 or 1)` };
    },
  },
]);

export const WRITE_COMMANDS = Object.freeze([
  {
    id: 'remember',
    name: 'remember',
    type: 'write',
    args: ['remember', '--content', 'smoke test content verification', '--json'],
    isJson: true,
    validate: (res, payload) => validateStandardEnvelope(res, payload, 'remember'),
  },
  {
    id: 'update',
    name: 'update',
    type: 'write',
    args: ['update', '--id', '__smoke_probe_write_id__', '--content', 'updated content', '--json'],
    isJson: true,
    validate: (res, payload) => validateProbeWriteEnvelope(res, payload, 'update'),
  },
  {
    id: 'forget',
    name: 'forget',
    type: 'write',
    args: ['forget', '--id', '__smoke_probe_write_id__', '--confirm', '--json'],
    isJson: true,
    validate: (res, payload) => validateProbeWriteEnvelope(res, payload, 'forget'),
  },
  {
    id: 'todo-add',
    name: 'todo-add',
    type: 'write',
    args: ['todo-add', '--content', 'smoke test todo item', '--json'],
    isJson: true,
    validate: (res, payload) => validateStandardEnvelope(res, payload, 'todo-add'),
  },
  {
    id: 'todo-done',
    name: 'todo-done',
    type: 'write',
    args: ['todo-done', '--id', '__smoke_probe_todo_id__', '--json'],
    isJson: true,
    validate: (res, payload) => validateProbeWriteEnvelope(res, payload, 'todo-done'),
  },
  {
    id: 'expense-add',
    name: 'expense-add',
    type: 'write',
    args: ['expense-add', '--item', 'smoke test expense', '--amount', '1.00', '--currency', 'USD', '--json'],
    isJson: true,
    validate: (res, payload) => validateStandardEnvelope(res, payload, 'expense-add'),
  },
  {
    id: 'save-state',
    name: 'save-state',
    type: 'write',
    args: ['save-state', '--key', '__smoke_probe_state_key__', '--content', 'active state', '--json'],
    isJson: true,
    validate: (res, payload) => validateStandardEnvelope(res, payload, 'save-state'),
  },
  {
    id: 'restart-snapshot',
    name: 'restart-snapshot',
    type: 'write',
    args: ['restart-snapshot', '--session_id', '__smoke_probe_session__', '--json'],
    isJson: true,
    validate: (res, payload) => validateStandardEnvelope(res, payload, 'restart-snapshot'),
  },
  {
    id: 'restart-restore',
    name: 'restart-restore',
    type: 'write',
    args: ['restart-restore', '--snapshot_id', '__smoke_probe_snap_id__', '--json'],
    isJson: true,
    validate: (res, payload) => validateProbeWriteEnvelope(res, payload, 'restart-restore'),
  },
]);

function validateStandardEnvelope(res, payload, commandName) {
  if (res.code !== 0) {
    const errCode = payload?.error?.code ? ` (code: ${payload.error.code})` : '';
    const errMsg = payload?.error?.message ? `: ${payload.error.message}` : '';
    return { valid: false, error: `${commandName} returned exit code ${res.code}${errCode}${errMsg}` };
  }
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Expected valid JSON object response' };
  }
  if (payload.ok !== true) {
    return { valid: false, error: `Expected ok: true in envelope, got: ${JSON.stringify(payload.ok)}` };
  }
  return { valid: true };
}

function validateProbeWriteEnvelope(res, payload, commandName) {
  if (res.code === 0) {
    if (payload?.ok !== true) {
      return { valid: false, error: `${commandName} exit 0 requires ok: true in envelope` };
    }
    return { valid: true };
  }
  if (res.code === 1) {
    if (payload?.ok !== false) {
      return { valid: false, error: `${commandName} exit 1 requires ok: false in envelope` };
    }
    if (!payload?.error || typeof payload.error.code !== 'string') {
      return { valid: false, error: `${commandName} error envelope missing error.code string property` };
    }
    return { valid: true };
  }
  return { valid: false, error: `${commandName} unexpected exit code ${res.code}` };
}

export function parseArgs(rawArgs) {
  const options = {
    baseUrl: process.env.XMEMO_BASE_URL || 'https://xmemo.dev',
    timeoutMs: Number(process.env.XMEMO_TIMEOUT_MS || 15000),
    executeWrites: false,
    scriptPath: DEFAULT_SKILL_SCRIPT,
    token: process.env.XMEMO_KEY || undefined,
    json: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--execute-writes') {
      options.executeWrites = true;
    } else if (arg === '--base-url') {
      options.baseUrl = rawArgs[++i];
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(rawArgs[++i]);
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg === '--script-path') {
      options.scriptPath = path.resolve(rawArgs[++i]);
    } else if (arg.startsWith('--script-path=')) {
      options.scriptPath = path.resolve(arg.slice('--script-path='.length));
    } else if (arg === '--token') {
      options.token = rawArgs[++i];
    } else if (arg.startsWith('--token=')) {
      options.token = arg.slice('--token='.length);
    }
  }

  return options;
}

export async function runCommand(scriptPath, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const env = {
      ...process.env,
      XMEMO_BASE_URL: options.baseUrl || process.env.XMEMO_BASE_URL || 'https://xmemo.dev',
      XMEMO_TIMEOUT_MS: String(options.timeoutMs || 15000),
      ...(options.env || {}),
    };
    if (options.token) {
      env.XMEMO_KEY = options.token;
    }
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env,
      cwd: options.cwd || path.dirname(scriptPath),
    });
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => {
      resolve({
        code: 1,
        stdout,
        stderr: (stderr ? `${stderr}\n` : '') + err.message,
        spawnError: err,
      });
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export function printHelp() {
  console.log(`XMemo Skill Pre-Release Smoke Test Runner

Usage:
  node scripts/xmemo-skill-smoke-test.mjs [options]

Options:
  --base-url <url>        XMemo service URL (default: $XMEMO_BASE_URL or https://xmemo.dev)
  --timeout-ms <ms>       Request timeout in milliseconds (default: 15000)
  --execute-writes        Enable write operations (default: false, writes skipped)
  --script-path <path>    Path to xmemo-skill.mjs (default: skills/xmemo/scripts/xmemo-skill.mjs)
  --token <token>         Explicit token to use (default: $XMEMO_KEY)
  --json                  Output smoke test summary envelope in JSON format
  --verbose, -v           Print command output as each check executes
  --help, -h              Display help and options
`);
}

export async function runSmokeTests(options = {}) {
  const allSpecs = [...READ_ONLY_COMMANDS, ...WRITE_COMMANDS];
  const results = [];
  const failures = [];

  for (const spec of allSpecs) {
    if (spec.type === 'write' && !options.executeWrites) {
      results.push({
        id: spec.id,
        name: spec.name,
        type: spec.type,
        status: 'skipped',
        reason: 'write command skipped (pass --execute-writes to run)',
      });
      continue;
    }

    const res = await runCommand(options.scriptPath, spec.args, {
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      token: options.token,
      env: options.env,
    });

    let payload = null;
    let parseError = null;
    if (spec.isJson && res.stdout) {
      try {
        payload = JSON.parse(res.stdout);
      } catch (err) {
        parseError = `Failed to parse JSON response: ${err.message}. Output was: ${res.stdout.slice(0, 100)}`;
      }
    }

    let validation;
    if (parseError) {
      validation = { valid: false, error: parseError };
    } else {
      try {
        validation = spec.validate(res, payload);
      } catch (err) {
        validation = { valid: false, error: `Validator exception: ${err.message}` };
      }
    }

    if (validation.valid) {
      results.push({
        id: spec.id,
        name: spec.name,
        type: spec.type,
        status: 'passed',
        code: res.code,
      });
    } else {
      const failure = {
        id: spec.id,
        name: spec.name,
        type: spec.type,
        status: 'failed',
        code: res.code,
        error: validation.error,
        stdout: res.stdout,
        stderr: res.stderr,
      };
      results.push(failure);
      failures.push(failure);
    }
  }

  const passedCount = results.filter((r) => r.status === 'passed').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const failedCount = failures.length;

  return {
    ok: failedCount === 0,
    total: allSpecs.length,
    passed: passedCount,
    skipped: skippedCount,
    failed: failedCount,
    executeWrites: Boolean(options.executeWrites),
    baseUrl: options.baseUrl,
    results,
    failures,
  };
}

export async function main(cliArgs = process.argv.slice(2)) {
  const options = parseArgs(cliArgs);

  if (options.help) {
    printHelp();
    return 0;
  }

  if (!options.json) {
    console.log(`🔍 Running XMemo Skill pre-release smoke checks against ${options.baseUrl}...`);
    if (!options.executeWrites) {
      console.log('ℹ️ Write commands are skipped by default. Pass --execute-writes to run writes.');
    }
    console.log('');
  }

  const summary = await runSmokeTests(options);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return summary.ok ? 0 : 1;
  }

  // Terminal human-readable report
  for (const item of summary.results) {
    if (item.status === 'passed') {
      console.log(`  ✅ PASS: ${item.name} (exit: ${item.code})`);
    } else if (item.status === 'skipped') {
      console.log(`  ⏭️ SKIP: ${item.name} (${item.reason})`);
    } else {
      console.log(`  ❌ FAIL: ${item.name} (exit: ${item.code}) - ${item.error}`);
      if (options.verbose) {
        if (item.stdout) console.log(`     stdout: ${item.stdout}`);
        if (item.stderr) console.log(`     stderr: ${item.stderr}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Smoke Test Summary: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.failed} failed of ${summary.total} total.`);

  if (summary.failures.length > 0) {
    console.error('\n🚨 Failed Command Checklist:');
    summary.failures.forEach((f, idx) => {
      console.error(`  [${idx + 1}] ${f.name} (exit: ${f.code})`);
      console.error(`      Error: ${f.error}`);
      if (f.stderr) console.error(`      Stderr: ${f.stderr.slice(0, 150)}`);
    });
    console.error('\n❌ Smoke testing failed. Aborting release.');
    return 1;
  }

  console.log('✅ All pre-release smoke checks passed.');
  return 0;
}

const isDirectExecution = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectExecution) {
  main().then((code) => {
    process.exit(code);
  }).catch((err) => {
    console.error(`Fatal smoke runner error: ${err.message}`);
    process.exit(1);
  });
}
