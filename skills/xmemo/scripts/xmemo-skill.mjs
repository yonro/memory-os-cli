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
import { randomUUID } from 'node:crypto';

const SKILL_VERSION = '1.0.7';
const credentialsPath = path.join(os.homedir(), '.xmemo', 'skill-credentials.json');
const registrationPath = path.join(os.homedir(), '.xmemo', 'skill-registration.json');
const SCRIPT_COMMAND = 'node scripts/xmemo-skill.mjs';
const PLAINTEXT_STORAGE = 'plaintext-user-file';
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
    allowPlaintext: false,
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
      } else if (key === 'allow-plaintext') {
        options.allowPlaintext = true;
      } else if (key === 'from-stdin') {
        flags[key] = true;
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
    console.log(`Usage:\n  ${SCRIPT_COMMAND} auth status [--verify] ${commonOptions}\n  ${SCRIPT_COMMAND} auth add --from-stdin --allow-plaintext\n  ${SCRIPT_COMMAND} auth claim-status [--allow-plaintext]\n  ${SCRIPT_COMMAND} auth claim-confirm [--allow-plaintext]\n\nXMEMO_KEY remains the preferred non-file credential source. --allow-plaintext explicitly permits unencrypted user-file storage.\nRun \`${SCRIPT_COMMAND} --help\` to list all commands.`);
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

  console.log(`XMemo Standalone Skill Runtime\n\nUsage:\n  ${SCRIPT_COMMAND} <command> [options]\n\nCommands:\n  login --allow-plaintext            Start formal device login and explicitly permit local token storage\n  register --reason <unattended|declined> --allow-plaintext\n                                     Start limited temporary memory only when formal login is unavailable\n  logout                             Revoke and remove local credentials\n  auth status [--verify]             Show local or verified auth status\n  auth add --from-stdin --allow-plaintext\n                                     Store a formal token read from standard input\n  auth claim-status [--allow-plaintext]\n                                     Check temporary-account claim status\n  auth claim-confirm [--allow-plaintext]\n                                     Confirm a pending human claim and accept formal token handoff\n  remember --content <text> --path <path>\n  recall --query <text> [--limit <n>] [--compact]\n  search --query <text> [--limit <n>] [--compact]\n  save-state --key <key> [--content <text>] (aliases: state-save)\n  restore-state --key <key> (aliases: state-restore)\n  todo-add --content <text>\n  todo-list\n  todo-done --id <todo_id>\n  expense-add --item <text> --amount <number> --currency <code>\n  doctor\n\nCredential resolution:\n  XMEMO_KEY                          Preferred; never copied to the local credential file\n  User credential file              Read only as a fallback\n\nGlobal options:\n  --json                             Print the API response as JSON\n  --base-url <url>                   Override https://xmemo.dev\n  --compact                          Shorten recall/search content for terminals\n  --allow-plaintext                  Explicitly permit unencrypted user-file credential storage\n  --help, -h                         Show this help\n\nRun \`${SCRIPT_COMMAND} <command> --help\` for command-specific usage.`);
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

function redactSensitiveResponse(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSensitiveResponse);
  const sensitiveKeys = new Set(['access_token', 'temporary_token', 'formal_token', 'confirmation_token', 'token']);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKeys.has(key) ? '[REDACTED]' : redactSensitiveResponse(item),
  ]));
}

function safeJson(value) {
  return JSON.stringify(redactSensitiveResponse(value));
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
  const credential = await getStoredCredential();
  return credential?.token || null;
}

async function getStoredCredential() {
  if (process.env.XMEMO_KEY) {
    return { token: process.env.XMEMO_KEY, credential_type: 'environment', storage: 'environment' };
  }
  try {
    const data = await fs.readFile(credentialsPath, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed.token) return null;
    if (parsed.storage !== PLAINTEXT_STORAGE || parsed.plaintext_storage_consent !== true) {
      console.error(`⚠️ Legacy plaintext XMemo credential detected at ${credentialsPath}. Rotate it with XMEMO_KEY, or explicitly recreate it with --allow-plaintext.`);
    }
    return parsed;
  } catch {
    return null;
  }
}

async function bestEffortChmod(targetPath, mode) {
  try {
    await fs.chmod(targetPath, mode);
  } catch {
    // Some platforms do not implement POSIX permission bits. Never claim this is encryption.
  }
}

function plaintextStorageAllowed(options, credential = null) {
  return options?.allowPlaintext === true
    || (credential?.storage === PLAINTEXT_STORAGE && credential?.plaintext_storage_consent === true);
}

function requirePlaintextStorageConsent(options, action) {
  if (options?.allowPlaintext === true) return;
  throw new Error(`${action} needs to persist a token between commands. XMEMO_KEY is preferred and is never copied to disk. To explicitly permit unencrypted storage in ${credentialsPath}, rerun with --allow-plaintext.`);
}

function warnPlaintextStorage() {
  console.error(`⚠️ Plaintext credential storage explicitly enabled. The token will be stored unencrypted at ${credentialsPath} and may be read by processes running as your OS user. Prefer XMEMO_KEY or a managed secret store; never share or commit this file.`);
}

// Save credential helper. Every caller must prove explicit consent or carry forward recorded consent.
async function saveToken(token, details = {}, { allowPlaintext = false, warn = false } = {}) {
  if (!allowPlaintext) {
    throw new Error(`Refusing unencrypted credential storage without --allow-plaintext. Prefer XMEMO_KEY.`);
  }
  if (warn) warnPlaintextStorage();
  const credentialDir = path.dirname(credentialsPath);
  await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 });
  await bestEffortChmod(credentialDir, 0o700);
  const {
    token: _discardToken,
    created_at: _discardCreatedAt,
    storage: _discardStorage,
    plaintext_storage_consent: _discardConsent,
    plaintext_storage_consent_at: _discardConsentAt,
    claim_code: _discardClaimCode,
    ...safeDetails
  } = details;
  const data = JSON.stringify({
    token,
    created_at: new Date().toISOString(),
    credential_type: 'formal',
    ...safeDetails,
    storage: PLAINTEXT_STORAGE,
    plaintext_storage_consent: true,
    plaintext_storage_consent_at: new Date().toISOString(),
  }, null, 2);
  await fs.writeFile(credentialsPath, `${data}\n`, { encoding: 'utf8', mode: 0o600 });
  await bestEffortChmod(credentialsPath, 0o600);
}

async function getInstallationFingerprint() {
  try {
    const data = JSON.parse(await fs.readFile(registrationPath, 'utf8'));
    if (typeof data.installation_fingerprint === 'string' && data.installation_fingerprint) {
      return data.installation_fingerprint;
    }
  } catch {
    // Create a non-secret stable ID below when no local registration file exists.
  }

  const installation_fingerprint = randomUUID();
  const registrationDir = path.dirname(registrationPath);
  await fs.mkdir(registrationDir, { recursive: true, mode: 0o700 });
  await bestEffortChmod(registrationDir, 0o700);
  await fs.writeFile(registrationPath, `${JSON.stringify({ installation_fingerprint, created_at: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await bestEffortChmod(registrationPath, 0o600);
  return installation_fingerprint;
}

function printMemoryResults(result, compact) {
  const results = extractList(result);
  if (results.length === 0) {
    console.log('No matching memories found.');
    return;
  }
  results.forEach((item, index) => {
    console.log(`[${index + 1}] ID: ${item?.id || item?.memory_id || '(unknown)'} | Path: ${item?.path || '(unknown)'}`);
    console.log(`Content: ${formatMemoryContent(item?.content, compact)}`);
    console.log('---');
  });
}

async function requestTemporaryMemoryOperation(command, options, flags, credential) {
  const headers = { Authorization: `Bearer ${credential.token}` };
  let res;
  if (command === 'remember') {
    res = await makeHttpRequest(options.baseUrl, '/v1/remember', 'POST', {
      content: flags.content || '',
      path: flags.path || 'memories',
    }, headers);
  } else {
    const params = new URLSearchParams({ query: flags.query || '', limit: String(flags.limit || 5) });
    if (flags.path) params.set('path', flags.path);
    res = await makeHttpRequest(options.baseUrl, `/v1/recall?${params}`, 'GET', null, headers);
  }

  const data = parseJsonResponse(res, `Temporary ${command} request`);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const challenge = data?.detail;
    if (res.statusCode === 428 && challenge?.errorType === 'binding_confirmation_required') {
      const allowPlaintext = plaintextStorageAllowed(options, credential);
      const pending = {
        credential_type: 'temporary',
        agent_id: credential.agent_id,
        bind_url: credential.bind_url,
        registration_reason: credential.registration_reason,
        pending_confirmation_token: challenge.confirmation_token,
      };
      await saveToken(credential.token, pending, { allowPlaintext, warn: options.allowPlaintext && !credential.plaintext_storage_consent });
      if (options.json) {
        console.log(safeJson(data));
      } else {
        console.error('Your human account has a pending bind confirmation. Run "auth claim-confirm" to finish the formal-token handoff. Do not share the bind URL or confirmation value.');
      }
    } else {
      console.error(`Temporary ${command} failed: ${apiErrorMessage(data, safeJson(data))}`);
    }
    process.exit(1);
  }

  if (options.json) {
    console.log(safeJson(data));
    process.exit(0);
  }

  if (command === 'remember') {
    console.log(`✅ Saved to temporary XMemo memory.\nID: ${extractId(data.result || data)}`);
  } else {
    printMemoryResults(data.result || data, options.compact);
  }
}

async function claimStatus(baseUrl, credential, options) {
  const res = await makeHttpRequest(baseUrl, '/v1/agents/status', 'GET', null, {
    Authorization: `Bearer ${credential.token}`,
  });
  const data = parseJsonResponse(res, 'Claim status request');
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Claim status request failed: ${apiErrorMessage(data, safeJson(data))}`);
  }
  if (typeof data.formal_token === 'string' && data.formal_token) {
    const allowPlaintext = plaintextStorageAllowed(options, credential);
    await saveToken(data.formal_token, { credential_type: 'formal', agent_id: credential.agent_id }, {
      allowPlaintext,
      warn: options.allowPlaintext && !credential.plaintext_storage_consent,
    });
    console.log('✅ Formal XMemo credential received and stored in the explicitly approved user credential file. Temporary access has been replaced.');
    return data;
  }
  if (options.json) {
    console.log(safeJson(data));
  } else {
    console.log(`Claim status: ${data.status || 'unknown'}`);
  }
  return data;
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

  if (!['login', 'register', 'logout', 'auth'].includes(command) && !REST_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  // 1. LOGIN
  if (command === 'login') {
    try {
      requirePlaintextStorageConsent(options, 'Device login');
      const res = await makeHttpRequest(options.baseUrl, '/v1/auth/device/start', 'POST', {
        client_id: 'xmemo-skill',
        surface: 'standalone_skill',
        token_type: 'skill_token',
        client_version: SKILL_VERSION,
        scopes: ['memory:read', 'memory:write', 'memory:restore', 'ledger:write', 'ledger:read']
      });
      const data = parseJsonResponse(res, 'Device login start');
      if (res.statusCode !== 200) {
        console.error(`Failed to start device login: ${apiErrorMessage(data, safeJson(data))}`);
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
              await saveToken(pollData.access_token, { credential_type: 'formal' }, { allowPlaintext: options.allowPlaintext, warn: true });
              console.log(`✅ Authorization successful. Token stored in the explicitly approved user credential file: ${credentialsPath}`);
              console.log('Token value was not printed. Project files were not modified.');
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

  // 1b. LIMITED NO-ACCOUNT-START REGISTRATION (explicit fallback only)
  if (command === 'register') {
    const reason = flags.reason;
    if (!['unattended', 'declined'].includes(reason)) {
      console.error(`Temporary registration is a conditional fallback. Use "${SCRIPT_COMMAND} register --reason unattended --allow-plaintext" when no human can log in, or "--reason declined --allow-plaintext" after the human explicitly declines formal registration.`);
      process.exit(1);
    }
    try {
      requirePlaintextStorageConsent(options, 'Temporary registration');
    } catch (e) {
      console.error(`Temporary registration refused: ${e.message}`);
      process.exit(1);
    }
    if (await getStoredToken()) {
      console.error(`A credential is already configured. Formal login is the recommended path; use "${SCRIPT_COMMAND} login" to refresh it instead of creating temporary access.`);
      process.exit(1);
    }
    try {
      const installation_fingerprint = await getInstallationFingerprint();
      const res = await makeHttpRequest(options.baseUrl, '/v1/agents/register', 'POST', {
        entry_type: 'skill',
        client_name: 'xmemo-skill',
        client_version: SKILL_VERSION,
        installation_fingerprint,
        runtime: `node ${process.version}`,
        skill_package_id: 'xmemo-memory',
        metadata: { registration_reason: reason },
      });
      const data = parseJsonResponse(res, 'Temporary registration');
      if (res.statusCode < 200 || res.statusCode >= 300 || !data.temporary_token) {
        throw new Error(apiErrorMessage(data, safeJson(data)));
      }
      await saveToken(data.temporary_token, {
        credential_type: 'temporary',
        agent_id: data.agent_id,
        bind_url: data.bind_url,
        registration_reason: reason,
      }, { allowPlaintext: options.allowPlaintext, warn: true });
      if (options.json) {
        console.log(JSON.stringify({ agent_id: data.agent_id, bind_url: data.bind_url, status: data.status }));
      } else {
        console.log(`✅ Temporary XMemo memory enabled for this installation.\nThis is a limited sandbox, not a formal account.\nComplete formal registration (recommended): ${data.bind_url}\nDo not share this bind URL publicly. After the human claim, run "${SCRIPT_COMMAND} auth claim-confirm" to accept the formal credential.`);
      }
      process.exit(0);
    } catch (e) {
      console.error('Temporary registration failed:', e.message);
      process.exit(1);
    }
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
      const credential = await getStoredCredential();
      const token = credential?.token;
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
          const kind = credential?.credential_type === 'temporary' ? 'Temporary access' : 'Logged in';
          console.log(`Status: ${kind}\nToken Prefix: ${maskedToken}`);
        }
      }
      process.exit(0);
    }
    
    if (subcommand === 'add') {
      if (flags['from-stdin'] !== undefined || process.argv.includes('--from-stdin')) {
        try {
          requirePlaintextStorageConsent(options, 'auth add');
        } catch (e) {
          console.error(`Credential storage refused: ${e.message}`);
          process.exit(1);
        }
        const token = await readStdin();
        if (!token) {
          console.error('Error: Stdin did not provide a token.');
          process.exit(1);
        }
        try {
          await saveToken(token, { credential_type: 'formal' }, { allowPlaintext: options.allowPlaintext, warn: true });
          console.log(`✅ Credential stored in the explicitly approved user credential file: ${credentialsPath}`);
          console.log('Token value was not printed. Project files were not modified.');
          process.exit(0);
        } catch (err) {
          console.error('Failed to save credentials file:', err.message);
          process.exit(1);
        }
      } else {
        console.error(`Error: Run "${SCRIPT_COMMAND} auth add --from-stdin --allow-plaintext" to supply and explicitly store a token.`);
        process.exit(1);
      }
    }

    if (subcommand === 'claim-status' || subcommand === 'claim-confirm') {
      const credential = await getStoredCredential();
      if (!credential?.token || credential.credential_type !== 'temporary') {
        console.error('Error: Claim commands require a locally stored temporary credential from "register".');
        process.exit(1);
      }
      try {
        const status = await claimStatus(options.baseUrl, credential, options);
        if (subcommand === 'claim-confirm' && !status.formal_token) {
          const confirmation_token = status.confirmation_token || credential.pending_confirmation_token;
          if (!confirmation_token) {
            console.error(`No pending human claim confirmation is available. Current status: ${status.status || 'unknown'}. Open the stored bind URL first: ${credential.bind_url || '(unavailable)'}`);
            process.exit(1);
          }
          const confirmRes = await makeHttpRequest(options.baseUrl, '/v1/agents/bind/confirm-current-user', 'POST', { confirmation_token }, {
            Authorization: `Bearer ${credential.token}`,
          });
          const confirmData = parseJsonResponse(confirmRes, 'Claim confirmation');
          if (confirmRes.statusCode < 200 || confirmRes.statusCode >= 300) {
            throw new Error(apiErrorMessage(confirmData, safeJson(confirmData)));
          }
          if (credential.pending_confirmation_token) {
            const allowPlaintext = plaintextStorageAllowed(options, credential);
            await saveToken(credential.token, {
              credential_type: 'temporary',
              agent_id: credential.agent_id,
              bind_url: credential.bind_url,
              registration_reason: credential.registration_reason,
            }, { allowPlaintext, warn: options.allowPlaintext && !credential.plaintext_storage_consent });
          }
          await claimStatus(options.baseUrl, credential, options);
        }
        process.exit(0);
      } catch (e) {
        console.error('Claim flow failed:', e.message);
        process.exit(1);
      }
    }
    
    console.error(`Unknown auth subcommand: ${subcommand || '(missing)'}`);
    printUsage('auth');
    process.exit(1);
  }

  // 4. REST OPERATIONS (remember, recall, search, update, forget, state-save, state-restore, todo-*, expense-*, doctor)
  const credential = await getStoredCredential();
  const token = credential?.token;
  
  // Doctor can be anonymous
  if (command === 'doctor' && !token) {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'doctor',
        arguments: {}
      });
      const data = parseJsonResponse(res, 'Doctor health check');
      if (res.statusCode < 200 || res.statusCode >= 300 || data.ok === false) {
        console.error(`Doctor health check failed: ${apiErrorMessage(data, safeJson(data))}`);
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
    console.error(`Error: No XMemo credential found. Preferred: set XMEMO_KEY. For formal account login with explicit local storage consent, run "${SCRIPT_COMMAND} login --allow-plaintext". For a limited temporary sandbox only when permitted, run "${SCRIPT_COMMAND} register --reason unattended|declined --allow-plaintext".`);
    process.exit(1);
  }

  if (credential?.credential_type === 'temporary') {
    if (['remember', 'recall', 'search'].includes(command)) {
      try {
        await requestTemporaryMemoryOperation(command, options, flags, credential);
      } catch (e) {
        console.error('Temporary memory request failed:', e.message);
        process.exit(1);
      }
      return;
    }
    console.error(`Temporary access supports only remember, recall, and search in its isolated sandbox. Complete formal registration at ${credential.bind_url || 'the bind URL shown at registration'} to use ${command}.`);
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
