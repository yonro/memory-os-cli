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

const SKILL_VERSION = '1.0.8';
const credentialsPath = path.join(os.homedir(), '.xmemo', 'skill-credentials.json');
const registrationPath = path.join(os.homedir(), '.xmemo', 'skill-registration.json');
const SCRIPT_COMMAND = 'node scripts/xmemo-skill.mjs';
const PLAINTEXT_STORAGE = 'plaintext-user-file';
const DEFAULT_BASE_URL = 'https://xmemo.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_BYTES = 8_388_608;
const warnedCredentialOrigins = new Set();
const REST_COMMANDS = new Set([
  'remember', 'recall', 'search', 'save-state', 'restore-state', 'state-save', 'state-restore',
  'todo-add', 'todo-list', 'todo-done', 'expense-add', 'doctor',
]);
const COMMAND_FLAGS = {
  login: new Set(),
  register: new Set(['reason']),
  logout: new Set(),
  doctor: new Set(),
  remember: new Set(['content', 'path', 'metadata', 'logic_path', 'bucket', 'scope', 'team_id']),
  recall: new Set(['query', 'limit', 'threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain', 'prefer_working']),
  search: new Set(['query', 'limit', 'threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain', 'prefer_working']),
  'save-state': new Set(['key', 'state_key', 'content', 'current_task', 'next_action', 'blocked_reason', 'ttl_seconds', 'bucket', 'scope']),
  'state-save': new Set(['key', 'state_key', 'content', 'current_task', 'next_action', 'blocked_reason', 'ttl_seconds', 'bucket', 'scope']),
  'restore-state': new Set(['key', 'state_key', 'bucket', 'scope']),
  'state-restore': new Set(['key', 'state_key', 'bucket', 'scope']),
  'todo-add': new Set(['content', 'due_at', 'bucket', 'scope', 'path']),
  'todo-list': new Set(['bucket', 'scope', 'status']),
  'todo-done': new Set(['id', 'todo_id', 'note']),
  'expense-add': new Set(['item', 'amount', 'currency', 'transaction_date', 'date', 'path', 'bucket', 'scope']),
};
const AUTH_FLAGS = {
  status: new Set(),
  add: new Set(['from-stdin']),
  'claim-status': new Set(),
  'claim-confirm': new Set(),
};

// Helper to parse arguments
function parseArgs(args) {
  const options = {
    json: false,
    baseUrl: process.env.XMEMO_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: process.env.XMEMO_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    verify: false,
    compact: false,
    help: false,
    version: false,
    allowPlaintext: false,
    anonymous: false,
    revokeEnvironmentToken: false,
  };
  const positionals = [];
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      const equalsIndex = rawKey.indexOf('=');
      const key = equalsIndex === -1 ? rawKey : rawKey.slice(0, equalsIndex);
      const inlineValue = equalsIndex === -1 ? undefined : rawKey.slice(equalsIndex + 1);
      if (key === 'json') {
        rejectBooleanValue(key, inlineValue);
        options.json = true;
      } else if (key === 'verify') {
        rejectBooleanValue(key, inlineValue);
        options.verify = true;
      } else if (key === 'compact') {
        rejectBooleanValue(key, inlineValue);
        options.compact = true;
      } else if (key === 'help') {
        rejectBooleanValue(key, inlineValue);
        options.help = true;
      } else if (key === 'version') {
        rejectBooleanValue(key, inlineValue);
        options.version = true;
      } else if (key === 'allow-plaintext') {
        rejectBooleanValue(key, inlineValue);
        options.allowPlaintext = true;
      } else if (key === 'from-stdin') {
        rejectBooleanValue(key, inlineValue);
        flags[key] = true;
      } else if (key === 'anonymous') {
        rejectBooleanValue(key, inlineValue);
        options.anonymous = true;
      } else if (key === 'revoke-environment-token') {
        rejectBooleanValue(key, inlineValue);
        options.revokeEnvironmentToken = true;
      } else if (key === 'base-url') {
        const parsed = readOptionValue(args, i, key, inlineValue);
        options.baseUrl = parsed.value;
        i = parsed.index;
      } else if (key === 'timeout-ms') {
        const parsed = readOptionValue(args, i, key, inlineValue);
        options.timeoutMs = parsed.value;
        i = parsed.index;
      } else {
        const parsed = readOptionValue(args, i, key, inlineValue);
        flags[key] = parsed.value;
        i = parsed.index;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (key === 'j') {
        options.json = true;
      } else if (key === 'v') {
        options.verify = true;
      } else if (key === 'h') {
        options.help = true;
      } else {
        throw new Error(`Unknown short option: -${key}`);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0], subcommand: positionals[1], positionals, options, flags };
}

function rejectBooleanValue(key, inlineValue) {
  if (inlineValue !== undefined) {
    throw new Error(`--${key} does not accept a value; pass it as a bare flag.`);
  }
}

function readOptionValue(args, index, key, inlineValue) {
  if (inlineValue !== undefined) {
    if (!inlineValue) throw new Error(`--${key} requires a value.`);
    return { value: inlineValue, index };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${key} requires a value.`);
  }
  return { value, index: index + 1 };
}

function printUsage(command) {
  const commonOptions = '[--json] [--base-url <url>] [--timeout-ms <ms>]';
  if (command === 'auth') {
    console.log(`Usage:\n  ${SCRIPT_COMMAND} auth status [--verify] ${commonOptions}\n  ${SCRIPT_COMMAND} auth add --from-stdin --allow-plaintext\n  ${SCRIPT_COMMAND} auth claim-status [--allow-plaintext]\n  ${SCRIPT_COMMAND} auth claim-confirm [--allow-plaintext]\n\nXMEMO_KEY remains the preferred non-file credential source. --allow-plaintext explicitly permits unencrypted user-file storage.\nRun \`${SCRIPT_COMMAND} --help\` to list all commands.`);
    return;
  }

  const directUsage = {
    login: `login --allow-plaintext ${commonOptions}`,
    register: `register --reason <unattended|declined> --allow-plaintext ${commonOptions}`,
    logout: `logout [--revoke-environment-token] ${commonOptions}`,
  };
  if (directUsage[command]) {
    console.log(`Usage:\n  ${SCRIPT_COMMAND} ${directUsage[command]}`);
    if (command === 'logout') {
      console.log('\nXMEMO_KEY is externally managed and is not revoked unless --revoke-environment-token is explicitly passed.');
    }
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
      doctor: 'doctor [--anonymous]',
    };
    console.log(`Usage:\n  ${SCRIPT_COMMAND} ${commandUsage[command]} ${commonOptions}`);
    return;
  }

  console.log(`XMemo Standalone Skill Runtime\n\nUsage:\n  ${SCRIPT_COMMAND} <command> [options]\n\nCommands:\n  login --allow-plaintext            Start formal device login and explicitly permit local token storage\n  register --reason <unattended|declined> --allow-plaintext\n                                     Start limited temporary memory only when formal login is unavailable\n  logout                             Revoke and remove a local credential\n  auth status [--verify]             Show local or verified auth status\n  auth add --from-stdin --allow-plaintext\n                                     Store a formal token read from standard input\n  auth claim-status [--allow-plaintext]\n                                     Check temporary-account claim status\n  auth claim-confirm [--allow-plaintext]\n                                     Confirm a pending human claim and accept formal token handoff\n  remember --content <text> --path <path>\n  recall --query <text> [--limit <n>] [--compact]\n  search --query <text> [--limit <n>] [--compact]\n  save-state --key <key> [--content <text>] (aliases: state-save)\n  restore-state --key <key> (aliases: state-restore)\n  todo-add --content <text>\n  todo-list\n  todo-done --id <todo_id>\n  expense-add --item <text> --amount <number> --currency <code>\n  doctor [--anonymous]\n\nCredential resolution:\n  XMEMO_KEY                          Preferred; never copied to the local credential file\n  User credential file              Read only as a fallback\n\nGlobal options:\n  --json                             Print the API response as JSON\n  --base-url <url>                   Override ${DEFAULT_BASE_URL}; HTTPS or loopback HTTP only\n  --timeout-ms <ms>                  Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})\n  --compact                          Shorten recall/search content for terminals\n  --allow-plaintext                  Explicitly permit unencrypted user-file credential storage\n  --version                          Show the Skill runtime version\n  --help, -h                         Show this help\n\nRun \`${SCRIPT_COMMAND} <command> --help\` for command-specific usage.`);
}

function parsePositiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}.`);
  }
  return parsed;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid XMemo base URL: ${value}`);
  }
  if (url.username || url.password) {
    throw new Error('XMemo base URL must not contain embedded credentials.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
    throw new Error('XMemo base URL must use HTTPS. Plain HTTP is allowed only for localhost/loopback development.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function validateCommandInput(command, subcommand, positionals, options, flags) {
  const expectedPositionals = command === 'auth' ? 2 : 1;
  if (positionals.length > expectedPositionals) {
    throw new Error(`Unexpected positional argument: ${positionals[expectedPositionals]}`);
  }
  if (options.anonymous && command !== 'doctor') {
    throw new Error('--anonymous is supported only by doctor.');
  }
  if (options.revokeEnvironmentToken && command !== 'logout') {
    throw new Error('--revoke-environment-token is supported only by logout.');
  }

  const allowedFlags = command === 'auth'
    ? AUTH_FLAGS[subcommand] || new Set()
    : COMMAND_FLAGS[command] || new Set();
  for (const key of Object.keys(flags)) {
    if (/token|api[-_]?key|bearer|authorization|cookie|secret/i.test(key) && key !== 'from-stdin') {
      throw new Error(`Refusing sensitive command-line option --${key}. Use XMEMO_KEY or --from-stdin where documented.`);
    }
    if (!allowedFlags.has(key)) {
      throw new Error(`Unknown option for ${command}${subcommand ? ` ${subcommand}` : ''}: --${key}`);
    }
  }

  const required = {
    remember: ['content'],
    recall: ['query'],
    search: ['query'],
    'todo-add': ['content'],
    'todo-done': ['id|todo_id'],
    'expense-add': ['item', 'amount'],
  };
  for (const requirement of required[command] || []) {
    const alternatives = requirement.split('|');
    if (!alternatives.some((key) => flags[key] !== undefined && String(flags[key]).trim())) {
      throw new Error(`${command} requires --${alternatives.join(' or --')}.`);
    }
  }

  if (flags.limit !== undefined) parsePositiveInteger(flags.limit, '--limit', 100);
  if (flags.ttl_seconds !== undefined) parsePositiveInteger(flags.ttl_seconds, '--ttl_seconds', 31_536_000);
  if (flags.threshold !== undefined) {
    const threshold = Number(flags.threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error('--threshold must be a number between 0 and 1.');
    }
  }
  if (flags.amount !== undefined && !Number.isFinite(Number(flags.amount))) {
    throw new Error('--amount must be numeric.');
  }
}

function parseJsonResponse(res, context) {
  const body = typeof res.body === 'string' ? res.body.trim() : '';
  if (!body) {
    throw new Error(`${context}: server returned an empty response (HTTP ${res.statusCode}).`);
  }
  try {
    return JSON.parse(body);
  } catch {
    const safeBody = sanitizeTerminalText(body);
    const preview = safeBody.length > 2_000 ? `${safeBody.slice(0, 2_000)}…` : safeBody;
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
  const candidate = data?.error?.message || data?.error_description || data?.detail || data?.error;
  if (typeof candidate === 'string') return sanitizeTerminalText(candidate);
  if (candidate !== undefined && candidate !== null) return safeJson(candidate);
  return fallback;
}

function redactSensitiveResponse(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSensitiveResponse);
  const sensitiveKeys = new Set([
    'access_token', 'refresh_token', 'id_token', 'temporary_token', 'formal_token',
    'confirmation_token', 'pending_confirmation_token', 'device_code', 'token',
    'authorization', 'api_key', 'apikey', 'cookie', 'set-cookie',
  ]);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKeys.has(key.toLowerCase()) ? '[REDACTED]' : redactSensitiveResponse(item),
  ]));
}

function safeJson(value) {
  return JSON.stringify(redactSensitiveResponse(value));
}

function sanitizeTerminalText(value) {
  return String(value ?? '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

function formatMemoryContent(content, compact) {
  const value = sanitizeTerminalText(content);
  const rendered = compact ? value.replace(/\s+/g, ' ').trim() : value;
  const limit = compact ? 280 : 2_000;
  return rendered.length > limit ? `${rendered.slice(0, limit)}… (truncated)` : rendered;
}

// HTTP request helper
function makeHttpRequest(baseUrl, apiPath, method, body = null, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
      const authorizationHeader = Object.entries(reqHeaders)
        .find(([key]) => key.toLowerCase() === 'authorization')?.[1];
      if (authorizationHeader && url.origin !== new URL(DEFAULT_BASE_URL).origin && !warnedCredentialOrigins.has(url.origin)) {
        warnedCredentialOrigins.add(url.origin);
        console.error(`⚠️ Sending an XMemo credential to custom origin ${url.origin}. Continue only if this host is trusted.`);
      }

      let settled = false;
      const settleResolve = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const req = client.request(url, options, (res) => {
        let data = '';
        let responseBytes = 0;
        res.on('data', (chunk) => {
          responseBytes += Buffer.byteLength(chunk);
          if (responseBytes > MAX_RESPONSE_BYTES) {
            const error = new Error(`Server response exceeded the ${MAX_RESPONSE_BYTES}-byte safety limit.`);
            settleReject(error);
            res.destroy();
            return;
          }
          data += chunk;
        });
        res.on('end', () => {
          settleResolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
        res.on('error', settleReject);
        res.on('aborted', () => settleReject(new Error('Server response was interrupted.')));
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Request timed out after ${timeoutMs} ms.`));
      });
      req.on('error', settleReject);
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
    console.log(`[${index + 1}] ID: ${sanitizeTerminalText(item?.id || item?.memory_id || '(unknown)')} | Path: ${sanitizeTerminalText(item?.path || '(unknown)')}`);
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
    }, headers, options.timeoutMs);
  } else {
    const params = new URLSearchParams({ query: flags.query || '', limit: String(flags.limit || 5) });
    if (flags.path) params.set('path', flags.path);
    res = await makeHttpRequest(options.baseUrl, `/v1/recall?${params}`, 'GET', null, headers, options.timeoutMs);
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
    console.log(`✅ Saved to temporary XMemo memory.\nID: ${sanitizeTerminalText(extractId(data.result || data))}`);
  } else {
    printMemoryResults(data.result || data, options.compact);
  }
}

async function claimStatus(baseUrl, credential, options) {
  const res = await makeHttpRequest(baseUrl, '/v1/agents/status', 'GET', null, {
    Authorization: `Bearer ${credential.token}`,
  }, options.timeoutMs);
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
    console.log(`Claim status: ${sanitizeTerminalText(data.status || 'unknown')}`);
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
  const { command, subcommand, positionals, options, flags } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage(command);
    process.exit(0);
  }

  if (options.version) {
    console.log(SKILL_VERSION);
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

  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  options.timeoutMs = parsePositiveInteger(options.timeoutMs, '--timeout-ms', MAX_TIMEOUT_MS);
  validateCommandInput(command, subcommand, positionals, options, flags);

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
      }, {}, options.timeoutMs);
      const data = parseJsonResponse(res, 'Device login start');
      if (res.statusCode !== 200) {
        console.error(`Failed to start device login: ${apiErrorMessage(data, safeJson(data))}`);
        process.exit(1);
      }
      const verificationUrl = data.verification_uri_complete || data.verification_uri;
      if (!data.device_code || !verificationUrl) {
        console.error('Failed to start device login: the service response omitted the device code or verification URL.');
        process.exit(1);
      }
      console.log(`To verify this device, open the following URL in your browser:\n`);
      console.log(`  ${sanitizeTerminalText(verificationUrl)}\n`);
      console.log(`Or enter the code: ${sanitizeTerminalText(data.user_code)}`);
      console.log(`\nWaiting for authorization...`);

      const deviceCode = data.device_code;
      const intervalSeconds = Number(data.interval);
      const expiresInSeconds = Number(data.expires_in);
      let pollInterval = Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? Math.max(1, intervalSeconds * 1000)
        : 5000;
      const expiresInMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? Math.max(1, expiresInSeconds * 1000)
        : 600_000;
      const loginDeadline = Date.now() + expiresInMs;
      
      const poll = async () => {
        if (Date.now() >= loginDeadline) {
          console.error('Login failed: the device authorization code expired before approval.');
          process.exit(1);
        }
        try {
          const pollRes = await makeHttpRequest(options.baseUrl, '/v1/auth/device/token', 'POST', {
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          }, {}, options.timeoutMs);
          const pollData = parseJsonResponse(pollRes, 'Device login polling');
          if (pollData.error) {
            if (pollData.error === 'authorization_pending') {
              setTimeout(poll, Math.min(pollInterval, Math.max(1, loginDeadline - Date.now())));
            } else if (pollData.error === 'slow_down') {
              pollInterval += 5000;
              setTimeout(poll, Math.min(pollInterval, Math.max(1, loginDeadline - Date.now())));
            } else {
              console.error(`Login failed: ${sanitizeTerminalText(pollData.error_description || pollData.error)}`);
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
          } else {
            console.error('Login failed: the token endpoint returned neither an access token nor a recognized pending status.');
            process.exit(1);
          }
        } catch (e) {
          if (Date.now() >= loginDeadline) {
            console.error('Login failed: the device authorization window expired after repeated polling errors.');
            process.exit(1);
          }
          console.error('Login polling error:', e.message);
          setTimeout(poll, Math.min(pollInterval, Math.max(1, loginDeadline - Date.now())));
        }
      };
      setTimeout(poll, Math.min(pollInterval, expiresInMs));
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
      }, {}, options.timeoutMs);
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
        console.log(safeJson({ agent_id: data.agent_id, bind_url: data.bind_url, status: data.status }));
      } else {
        console.log(`✅ Temporary XMemo memory enabled for this installation.\nThis is a limited sandbox, not a formal account.\nComplete formal registration (recommended): ${sanitizeTerminalText(data.bind_url)}\nDo not share this bind URL publicly. After the human claim, run "${SCRIPT_COMMAND} auth claim-confirm" to accept the formal credential.`);
      }
      process.exit(0);
    } catch (e) {
      console.error('Temporary registration failed:', e.message);
      process.exit(1);
    }
  }

  // 2. LOGOUT
  if (command === 'logout') {
    const credential = await getStoredCredential();
    const token = credential?.token;
    if (!token) {
      console.log('No active login found.');
      process.exit(0);
    }

    if (credential.storage === 'environment' && !options.revokeEnvironmentToken) {
      const result = {
        status: 'environment_credential_unchanged',
        credential_source: 'XMEMO_KEY',
        remote_revoked: false,
        local_file_removed: false,
      };
      if (options.json) {
        console.log(safeJson(result));
      } else {
        console.log('XMEMO_KEY is externally managed. No token was revoked and no local credential file was changed.');
        console.log('Unset XMEMO_KEY in the launching environment to log out, or pass --revoke-environment-token to explicitly revoke that token.');
      }
      process.exit(0);
    }

    let remoteRevoked = false;
    let revokeError = null;
    try {
      const revokeRes = await makeHttpRequest(options.baseUrl, '/v1/auth/token/revoke-self', 'POST', {}, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
      remoteRevoked = revokeRes.statusCode >= 200 && revokeRes.statusCode < 300;
      if (!remoteRevoked) revokeError = `HTTP ${revokeRes.statusCode}`;
    } catch (error) {
      revokeError = sanitizeTerminalText(error.message);
    }

    let localFileRemoved = false;
    if (credential.storage !== 'environment') {
      try {
        await fs.unlink(credentialsPath);
        localFileRemoved = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    const result = {
      status: remoteRevoked ? 'logged_out' : 'local_logout_completed',
      credential_source: credential.storage === 'environment' ? 'XMEMO_KEY' : 'user-credential-file',
      remote_revoked: remoteRevoked,
      local_file_removed: localFileRemoved,
      ...(revokeError ? { remote_revoke_error: revokeError } : {}),
    };
    if (options.json) {
      console.log(safeJson(result));
    } else if (credential.storage === 'environment') {
      console.log(remoteRevoked
        ? '✅ The externally managed XMEMO_KEY token was explicitly revoked. Unset XMEMO_KEY in the launching environment.'
        : `The XMEMO_KEY token could not be revoked (${revokeError}). It remains externally managed.`);
    } else if (remoteRevoked) {
      console.log('✅ Logged out successfully. The remote token was revoked and the local credential file was removed.');
    } else {
      console.log(`Local credential file removed. Remote revocation could not be confirmed${revokeError ? ` (${revokeError})` : ''}.`);
    }
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
      
      const credentialSource = credential?.storage === 'environment'
        ? 'XMEMO_KEY'
        : credential?.credential_type === 'temporary'
          ? 'temporary-user-credential-file'
          : 'formal-user-credential-file';
      if (options.verify) {
        try {
          const res = await makeHttpRequest(options.baseUrl, '/v1/auth/token/validate', 'GET', null, {
            'Authorization': `Bearer ${token}`
          }, options.timeoutMs);
          const data = parseJsonResponse(res, 'Token verification');
          if (res.statusCode === 200) {
            if (options.json) {
              console.log(safeJson({ status: 'valid', credential_source: credentialSource, scopes: data.scopes, setup_state: data.setup_state }));
            } else {
              const scopes = Array.isArray(data.scopes) ? data.scopes : [];
              console.log(`Status: Logged in (verified)\nCredential Source: ${credentialSource}\nScopes: ${scopes.join(', ')}`);
            }
          } else {
            if (options.json) {
              console.log(safeJson({ status: 'invalid', credential_source: credentialSource }));
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
          console.log(safeJson({ status: 'logged_in', credential_source: credentialSource }));
        } else {
          const kind = credential?.credential_type === 'temporary' ? 'Temporary access' : 'Logged in';
          console.log(`Status: ${kind}\nCredential Source: ${credentialSource}`);
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
            console.error(`No pending human claim confirmation is available. Current status: ${sanitizeTerminalText(status.status || 'unknown')}. Open the stored bind URL first: ${sanitizeTerminalText(credential.bind_url || '(unavailable)')}`);
            process.exit(1);
          }
          const confirmRes = await makeHttpRequest(options.baseUrl, '/v1/agents/bind/confirm-current-user', 'POST', { confirmation_token }, {
            Authorization: `Bearer ${credential.token}`,
          }, options.timeoutMs);
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
  const credential = command === 'doctor' && options.anonymous ? null : await getStoredCredential();
  const token = credential?.token;
  
  // Doctor can be anonymous
  if (command === 'doctor' && !token) {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'doctor',
        arguments: {}
      }, {}, options.timeoutMs);
      const data = parseJsonResponse(res, 'Doctor health check');
      if (res.statusCode < 200 || res.statusCode >= 300 || data.ok === false) {
        console.error(`Doctor health check failed: ${apiErrorMessage(data, safeJson(data))}`);
        process.exit(1);
      }
      if (options.json) {
        console.log(safeJson(data));
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
    console.error(`Temporary access supports only remember, recall, and search in its isolated sandbox. Complete formal registration at ${sanitizeTerminalText(credential.bind_url || 'the bind URL shown at registration')} to use ${command}.`);
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
    }, options.timeoutMs);

    const data = parseJsonResponse(res, `${opName} request`);
    const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
    if (options.json) {
      console.log(safeJson(data));
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
          console.log(`[${index + 1}] ID: ${sanitizeTerminalText(item?.id || item?.memory_id || '(unknown)')} | Path: ${sanitizeTerminalText(item?.path || '(unknown)')}`);
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
          console.log(`- [${todo?.status === 'done' ? 'x' : ' '}] ${sanitizeTerminalText(todo?.content || '')} (ID: ${sanitizeTerminalText(todo?.id || todo?.memory_id || '(unknown)')})`);
        });
      }
    } else if (opName === 'state-restore') {
      console.log(`Working State restored:\nKey: ${sanitizeTerminalText(data.result?.state_key)}\nContent: ${formatMemoryContent(data.result?.content, false)}`);
    } else if (opName === 'remember') {
      console.log(`✅ Saved to XMemo.\nID: ${sanitizeTerminalText(extractId(data.result))}`);
    } else if (opName === 'expense-add') {
      console.log(`✅ Expense recorded.\nID: ${sanitizeTerminalText(extractId(data.result))}`);
    } else {
      console.log(`✅ Operation succeeded.`);
    }
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Error: ${sanitizeTerminalText(error?.message || error)}`);
  process.exit(1);
});
