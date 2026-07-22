#!/usr/bin/env node

/**
 * Standalone XMemo Skill Runtime
 * Zero-dependency, self-contained client. Node.js built-ins only.
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const SKILL_VERSION = '1.0.0';
const credentialsPath = path.join(os.homedir(), '.xmemo', 'skill-credentials.json');
const SCRIPT_COMMAND = 'node scripts/xmemo-skill.mjs';
const REST_COMMANDS = new Set([
  'remember', 'recall', 'search', 'save-state', 'restore-state', 'state-save', 'state-restore',
  'todo-add', 'todo-list', 'todo-done', 'expense-add', 'doctor',
]);

// Helper to parse arguments
function parseArgs(args) {
  const options = {
    json: false,
    baseUrl: process.env.XMEMO_BASE_URL || 'https://xmemo.dev',
    verify: false,
    compact: false,
    help: false,
  };
  const positionals = [];
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'json') {
        options.json = true;
      } else if (key === 'verify') {
        options.verify = true;
      } else if (key === 'compact') {
        options.compact = true;
      } else if (key === 'help') {
        options.help = true;
      } else if (key === 'base-url') {
        options.baseUrl = args[++i];
      } else if (key.includes('=')) {
        const [k, v] = key.split('=', 2);
        flags[k] = v;
      } else {
        // next arg is the value
        flags[key] = args[++i];
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (key === 'j') {
        options.json = true;
      } else if (key === 'v') {
        options.verify = true;
      } else if (key === 'h') {
        options.help = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0], subcommand: positionals[1], positionals, options, flags };
}

function printUsage(command) {
  const commonOptions = '[--json] [--base-url <url>]';
  if (command === 'auth') {
    console.log(`Usage:\n  ${SCRIPT_COMMAND} auth status [--verify] ${commonOptions}\n  ${SCRIPT_COMMAND} auth add --from-stdin\n\nRun \`${SCRIPT_COMMAND} --help\` to list all commands.`);
    return;
  }

  if (REST_COMMANDS.has(command)) {
    const commandUsage = {
      remember: 'remember --content <text> --path <path>',
      recall: 'recall --query <text> [--limit <n>] [--compact]',
      search: 'search --query <text> [--limit <n>] [--compact]',
      'save-state': 'save-state --key <key> [--content <text>]',
      'restore-state': 'restore-state --key <key>',
      'state-save': 'state-save --key <key> [--content <text>] (legacy alias)',
      'state-restore': 'state-restore --key <key> (legacy alias)',
      'todo-add': 'todo-add --content <text>',
      'todo-list': 'todo-list',
      'todo-done': 'todo-done --id <todo_id>',
      'expense-add': 'expense-add --item <text> --amount <number> --currency <code>',
      doctor: 'doctor',
    };
    console.log(`Usage:\n  ${SCRIPT_COMMAND} ${commandUsage[command]} ${commonOptions}`);
    return;
  }

  console.log(`XMemo Standalone Skill Runtime\n\nUsage:\n  ${SCRIPT_COMMAND} <command> [options]\n\nCommands:\n  login                              Start device login\n  logout                             Revoke and remove local credentials\n  auth status [--verify]             Show local or verified auth status\n  auth add --from-stdin              Store a token read from standard input\n  remember --content <text> --path <path>\n  recall --query <text> [--limit <n>] [--compact]\n  search --query <text> [--limit <n>] [--compact]\n  save-state --key <key> [--content <text>] (aliases: state-save)\n  restore-state --key <key> (aliases: state-restore)\n  todo-add --content <text>\n  todo-list\n  todo-done --id <todo_id>\n  expense-add --item <text> --amount <number> --currency <code>\n  doctor\n\nGlobal options:\n  --json                             Print the API response as JSON\n  --base-url <url>                   Override https://xmemo.dev\n  --compact                           Shorten recall/search content for terminals\n  --help, -h                          Show this help\n\nRun \`${SCRIPT_COMMAND} <command> --help\` for command-specific usage.`);
}

function parseJsonResponse(res, context) {
  const body = typeof res.body === 'string' ? res.body.trim() : '';
  if (!body) {
    throw new Error(`${context}: server returned an empty response (HTTP ${res.statusCode}).`);
  }
  try {
    return JSON.parse(body);
  } catch {
    const preview = body.length > 2_000 ? `${body.slice(0, 2_000)}…` : body;
    throw new Error(`${context}: server returned a non-JSON response (HTTP ${res.statusCode}): ${preview}`);
  }
}

function extractList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.todos)) return result.todos;
  return [];
}

function extractId(result) {
  if (typeof result === 'string') return result;
  if (result?.id) return result.id;
  if (result?.memory_id) return result.memory_id;
  return JSON.stringify(result) ?? String(result ?? '');
}

function apiErrorMessage(data, fallback = 'Operation failed') {
  return data?.error?.message || data?.error_description || data?.error || fallback;
}

function formatMemoryContent(content, compact) {
  const value = String(content ?? '');
  const rendered = compact ? value.replace(/\s+/g, ' ').trim() : value;
  const limit = compact ? 280 : 2_000;
  return rendered.length > limit ? `${rendered.slice(0, limit)}… (truncated)` : rendered;
}

// HTTP request helper
function makeHttpRequest(baseUrl, apiPath, method, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(apiPath, baseUrl);
      const client = url.protocol === 'https:' ? https : http;
      const bodyStr = body ? JSON.stringify(body) : null;
      const reqHeaders = {
        'Content-Type': 'application/json',
        ...headers,
      };
      if (bodyStr) {
        reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
      }
      const options = {
        method: method.toUpperCase(),
        headers: reqHeaders,
      };
      const req = client.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      });
      req.on('error', (err) => {
        reject(err);
      });
      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Read credential helper
async function getStoredToken() {
  if (process.env.XMEMO_KEY) {
    return process.env.XMEMO_KEY;
  }
  try {
    const data = await fs.readFile(credentialsPath, 'utf8');
    const parsed = JSON.parse(data);
    return parsed.token || null;
  } catch {
    return null;
  }
}

// Save credential helper
async function saveToken(token) {
  await fs.mkdir(path.dirname(credentialsPath), { recursive: true });
  const data = JSON.stringify({
    token,
    created_at: new Date().toISOString(),
  }, null, 2);
  await fs.writeFile(credentialsPath, data, 'utf8');
}

// Read stdin helper
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
  });
}

// Command execution dispatcher
async function main() {
  const { command, subcommand, options, flags } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage(command);
    process.exit(0);
  }

  if (!command) {
    printUsage();
    process.exit(0);
  }

  if (!['login', 'logout', 'auth'].includes(command) && !REST_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  // 1. LOGIN
  if (command === 'login') {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/auth/device/start', 'POST', {
        client_id: 'xmemo-skill',
        surface: 'standalone_skill',
        token_type: 'skill_token',
        client_version: SKILL_VERSION,
        scopes: ['memory:read', 'memory:write', 'memory:restore', 'ledger:write', 'ledger:read']
      });
      const data = parseJsonResponse(res, 'Device login start');
      if (res.statusCode !== 200) {
        console.error(`Failed to start device login: ${apiErrorMessage(data, JSON.stringify(data))}`);
        process.exit(1);
      }
      console.log(`To verify this device, open the following URL in your browser:\n`);
      console.log(`  ${data.verification_uri_complete}\n`);
      console.log(`Or enter the code: ${data.user_code}`);
      console.log(`\nWaiting for authorization...`);

      const deviceCode = data.device_code;
      const interval = (data.interval || 5) * 1000;
      
      const poll = async () => {
        try {
          const pollRes = await makeHttpRequest(options.baseUrl, '/v1/auth/device/token', 'POST', {
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          });
          const pollData = parseJsonResponse(pollRes, 'Device login polling');
          if (pollData.error) {
            if (pollData.error === 'authorization_pending') {
              setTimeout(poll, interval);
            } else if (pollData.error === 'slow_down') {
              setTimeout(poll, interval + 5000);
            } else {
              console.error(`Login failed: ${pollData.error_description || pollData.error}`);
              process.exit(1);
            }
          } else if (pollData.access_token) {
            try {
              await saveToken(pollData.access_token);
              console.log('✅ Authorization successful. Credentials stored securely.');
              process.exit(0);
            } catch (err) {
              console.error('Failed to save credentials file:', err.message);
              process.exit(1);
            }
          }
        } catch (e) {
          console.error('Login polling error:', e.message);
          setTimeout(poll, interval);
        }
      };
      setTimeout(poll, interval);
    } catch (e) {
      console.error('Login error:', e.message);
      process.exit(1);
    }
    return;
  }

  // 2. LOGOUT
  if (command === 'logout') {
    const token = await getStoredToken();
    if (!token) {
      console.log('No active login found.');
      process.exit(0);
    }
    try {
      await makeHttpRequest(options.baseUrl, '/v1/auth/token/revoke-self', 'POST', {}, {
        'Authorization': `Bearer ${token}`
      });
    } catch {
      // Ignored: delete local credentials anyway
    }
    try {
      await fs.unlink(credentialsPath);
    } catch {}
    console.log('✅ Logged out successfully.');
    process.exit(0);
  }

  // 3. AUTH (status / add)
  if (command === 'auth') {
    if (subcommand === 'status') {
      const token = await getStoredToken();
      if (!token) {
        if (options.json) {
          console.log(JSON.stringify({ status: 'logged_out' }));
        } else {
          console.log('Status: Logged out.');
        }
        process.exit(0);
      }
      
      const maskedToken = token.includes(':') ? `${token.split(':')[0]}:***` : '***';
      if (options.verify) {
        try {
          const res = await makeHttpRequest(options.baseUrl, '/v1/auth/token/validate', 'GET', null, {
            'Authorization': `Bearer ${token}`
          });
          const data = parseJsonResponse(res, 'Token verification');
          if (res.statusCode === 200) {
            if (options.json) {
              console.log(JSON.stringify({ status: 'valid', scopes: data.scopes, setup_state: data.setup_state }));
            } else {
              const scopes = Array.isArray(data.scopes) ? data.scopes : [];
              console.log(`Status: Logged in (verified)\nToken Prefix: ${maskedToken}\nScopes: ${scopes.join(', ')}`);
            }
          } else {
            if (options.json) {
              console.log(JSON.stringify({ status: 'invalid' }));
            } else {
              console.error(`Status: Invalid or expired token.${data ? ` ${apiErrorMessage(data, '')}` : ''}`);
            }
            process.exit(1);
          }
        } catch (e) {
          console.error('Verification error:', e.message);
          process.exit(1);
        }
      } else {
        if (options.json) {
          console.log(JSON.stringify({ status: 'logged_in', token_prefix: maskedToken }));
        } else {
          console.log(`Status: Logged in\nToken Prefix: ${maskedToken}`);
        }
      }
      process.exit(0);
    }
    
    if (subcommand === 'add') {
      if (flags['from-stdin'] !== undefined || process.argv.includes('--from-stdin')) {
        const token = await readStdin();
        if (!token) {
          console.error('Error: Stdin did not provide a token.');
          process.exit(1);
        }
        try {
          await saveToken(token);
          console.log('✅ Credentials saved.');
          process.exit(0);
        } catch (err) {
          console.error('Failed to save credentials file:', err.message);
          process.exit(1);
        }
      } else {
        console.error('Error: Run "auth add --from-stdin" to supply token.');
        process.exit(1);
      }
    }
    
    console.error(`Unknown auth subcommand: ${subcommand || '(missing)'}`);
    printUsage('auth');
    process.exit(1);
  }

  // 4. REST OPERATIONS (remember, recall, search, update, forget, state-save, state-restore, todo-*, expense-*, doctor)
  const token = await getStoredToken();
  
  // Doctor can be anonymous
  if (command === 'doctor' && !token) {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'doctor',
        arguments: {}
      });
      const data = parseJsonResponse(res, 'Doctor health check');
      if (res.statusCode < 200 || res.statusCode >= 300 || data.ok === false) {
        console.error(`Doctor health check failed: ${apiErrorMessage(data, JSON.stringify(data))}`);
        process.exit(1);
      }
      if (options.json) {
        console.log(JSON.stringify(data));
      } else {
        console.log(`XMemo Service Status: OK\nAuthentication: Missing/Unauthenticated`);
      }
      process.exit(0);
    } catch (e) {
      console.error('Doctor health check failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (!token) {
    console.error(`Error: No XMemo credential found. Please run "${SCRIPT_COMMAND} login" or set process.env.XMEMO_KEY.`);
    process.exit(1);
  }

  // Normalize commands for operations mapping
  let opName = command;
  if (command === 'save-state' || command === 'state-save') opName = 'state-save';
  if (command === 'restore-state' || command === 'state-restore') opName = 'state-restore';

  try {
    const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
      operation: opName,
      arguments: flags,
    }, {
      'Authorization': `Bearer ${token}`
    });

    const data = parseJsonResponse(res, `${opName} request`);
    const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
    if (options.json) {
      console.log(JSON.stringify(data));
      process.exit(succeeded ? 0 : 1);
    }

    if (!succeeded) {
      console.error(`Error: ${apiErrorMessage(data)} (Code: ${data.error?.code || `HTTP ${res.statusCode}`})`);
      process.exit(1);
    }

    if (opName === 'doctor') {
      const isValid = !!data.result?.auth_valid;
      if (isValid) {
        console.log(`XMemo Service Status: OK\nAuthentication: Valid\nScopes: ${extractList(data.result?.scopes).join(', ')}`);
      } else {
        console.log(`XMemo Service Status: OK\nAuthentication: Invalid`);
        process.exit(1);
      }
    } else if (opName === 'recall' || opName === 'search') {
      const results = extractList(data.result);
      if (results.length === 0) {
        console.log('No matching memories found.');
      } else {
        results.forEach((item, index) => {
          console.log(`[${index + 1}] ID: ${item?.id || item?.memory_id || '(unknown)'} | Path: ${item?.path || '(unknown)'}`);
          console.log(`Content: ${formatMemoryContent(item?.content, options.compact)}`);
          console.log(`---`);
        });
      }
    } else if (opName === 'todo-list') {
      const todos = extractList(data.result);
      if (todos.length === 0) {
        console.log('No TODOs found.');
      } else {
        todos.forEach((todo) => {
          console.log(`- [${todo?.status === 'done' ? 'x' : ' '}] ${todo?.content || ''} (ID: ${todo?.id || todo?.memory_id || '(unknown)'})`);
        });
      }
    } else if (opName === 'state-restore') {
      console.log(`Working State restored:\nKey: ${data.result?.state_key}\nContent: ${data.result?.content}`);
    } else if (opName === 'remember') {
      console.log(`✅ Saved to XMemo.\nID: ${extractId(data.result)}`);
    } else if (opName === 'expense-add') {
      console.log(`✅ Expense recorded.\nID: ${extractId(data.result)}`);
    } else {
      console.log(`✅ Operation succeeded.`);
    }
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(1);
  }
}

main();
