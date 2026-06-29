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

// Helper to parse arguments
function parseArgs(args) {
  const options = {
    json: false,
    baseUrl: process.env.XMEMO_BASE_URL || 'https://xmemo.dev',
    verify: false,
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
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0], subcommand: positionals[1], positionals, options, flags };
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

  if (!command) {
    console.log('XMemo Standalone Skill Runtime. Use one of: login, logout, auth status, auth add, remember, recall, search, state-save, state-restore, todo-add, todo-list, todo-done, expense-add, doctor.');
    process.exit(0);
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
      if (res.statusCode !== 200) {
        console.error('Failed to start device login:', res.body);
        process.exit(1);
      }
      const data = JSON.parse(res.body);
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
          const pollData = JSON.parse(pollRes.body);
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
          console.error('Network error during polling:', e.message);
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
          if (res.statusCode === 200) {
            const data = JSON.parse(res.body);
            if (options.json) {
              console.log(JSON.stringify({ status: 'valid', scopes: data.scopes, setup_state: data.setup_state }));
            } else {
              console.log(`Status: Logged in (verified)\nToken Prefix: ${maskedToken}\nScopes: ${data.scopes.join(', ')}`);
            }
          } else {
            if (options.json) {
              console.log(JSON.stringify({ status: 'invalid' }));
            } else {
              console.error('Status: Invalid or expired token.');
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
    
    console.error('Unknown auth subcommand. Use "status" or "add".');
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
      const data = JSON.parse(res.body);
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
    console.error('Error: No XMemo credential found. Please run "node xmemo-skill.mjs login" or set process.env.XMEMO_KEY.');
    process.exit(1);
  }

  // Normalize commands for operations mapping
  let opName = command;
  if (command === 'save-state') opName = 'state-save';
  if (command === 'restore-state') opName = 'state-restore';

  try {
    const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
      operation: opName,
      arguments: flags,
    }, {
      'Authorization': `Bearer ${token}`
    });

    if (options.json) {
      console.log(res.body);
      process.exit(res.statusCode === 200 ? 0 : 1);
    }

    const data = JSON.parse(res.body);
    if (!data.ok) {
      console.error(`Error: ${data.error?.message || 'Operation failed'} (Code: ${data.error?.code || 'error'})`);
      process.exit(1);
    }

    if (opName === 'doctor') {
      const isValid = !!data.result?.auth_valid;
      if (isValid) {
        console.log(`XMemo Service Status: OK\nAuthentication: Valid\nScopes: ${(data.result?.scopes || []).join(', ')}`);
      } else {
        console.log(`XMemo Service Status: OK\nAuthentication: Invalid`);
        process.exit(1);
      }
    } else if (opName === 'recall' || opName === 'search') {
      const results = data.result || [];
      if (results.length === 0) {
        console.log('No matching memories found.');
      } else {
        results.forEach((item, index) => {
          console.log(`[${index + 1}] ID: ${item.id} | Path: ${item.path}`);
          console.log(`Content: ${item.content}`);
          console.log(`---`);
        });
      }
    } else if (opName === 'todo-list') {
      const todos = data.result || [];
      if (todos.length === 0) {
        console.log('No TODOs found.');
      } else {
        todos.forEach((todo) => {
          console.log(`- [${todo.status === 'done' ? 'x' : ' '}] ${todo.content} (ID: ${todo.id})`);
        });
      }
    } else if (opName === 'state-restore') {
      console.log(`Working State restored:\nKey: ${data.result?.state_key}\nContent: ${data.result?.content}`);
    } else if (opName === 'remember') {
      console.log(`✅ Saved to XMemo.\nID: ${data.result}`);
    } else if (opName === 'expense-add') {
      console.log(`✅ Expense recorded.\nID: ${data.result}`);
    } else {
      console.log(`✅ Operation succeeded.`);
    }
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(1);
  }
}

main();
