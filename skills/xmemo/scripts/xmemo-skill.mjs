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

const SKILL_VERSION = '1.1.18';
const credentialsPath = path.join(os.homedir(), '.xmemo', 'skill-credentials.json');
const registrationPath = path.join(os.homedir(), '.xmemo', 'skill-registration.json');
const SCRIPT_COMMAND = 'node scripts/xmemo-skill.mjs';
const PLAINTEXT_STORAGE = 'plaintext-user-file';
const DEFAULT_BASE_URL = 'https://xmemo.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_BYTES = 8_388_608;
const MAX_STATE_TTL_SECONDS = 2_592_000;
const DEFAULT_TEMPORARY_LIMITS = Object.freeze({
  max_items: 100,
  ttl_seconds: 1_209_600,
  max_lifetime_seconds: 2_592_000,
});
const warnedCredentialOrigins = new Set();
const REST_COMMANDS = new Set([
  'read', 'update', 'forget',
  'ledger-list', 'ledger-summary',
  'overview', 'activity', 'stats',
  'remember', 'recall', 'search', 'save-state', 'restore-state', 'state-save', 'state-restore',
  'restart-snapshot', 'restart-restore', 'recall-context',
  'todo-add', 'todo-list', 'todo-done', 'expense-add', 'doctor',
]);
const COMMAND_FLAGS = {
  login: new Set(),
  register: new Set(['reason']),
  logout: new Set(),
  doctor: new Set(),
  read: new Set(['id', 'offset', 'limit', 'bucket', 'scope']),
  update: new Set(['id', 'content', 'path', 'metadata', 'bucket', 'scope']),
  forget: new Set(['id', 'reason', 'confirm']),
  'ledger-list': new Set(['limit', 'offset', 'currency', 'from', 'to', 'category', 'min-amount', 'max-amount', 'type', 'month']),
  'ledger-summary': new Set(['months', 'currency', 'type']),
  overview: new Set(),
  activity: new Set(['limit']),
  stats: new Set(['scope', 'path', 'bucket', 'memory-type', 'memory_type', 'status', 'source', 'since', 'until', 'group-by', 'group_by', 'top-n', 'top_n', 'team-id', 'team_id']),
  remember: new Set(['content', 'path', 'metadata', 'logic_path', 'bucket', 'scope', 'team_id']),
  recall: new Set(['query', 'limit', 'threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain', 'prefer_working']),
  search: new Set(['query', 'limit', 'threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain', 'prefer_working']),
  'save-state': new Set(['key', 'state_key', 'content', 'current_task', 'next_action', 'blocked_reason', 'ttl_seconds', 'bucket', 'scope']),
  'state-save': new Set(['key', 'state_key', 'content', 'current_task', 'next_action', 'blocked_reason', 'ttl_seconds', 'bucket', 'scope']),
  'restore-state': new Set(['key', 'state_key', 'bucket', 'scope']),
  'state-restore': new Set(['key', 'state_key', 'bucket', 'scope']),
  'restart-snapshot': new Set(['session_id', 'state_key', 'timeline_limit', 'reminder_limit', 'decision_limit', 'metadata', 'bucket', 'scope', 'path', 'ttl_seconds']),
  'restart-restore': new Set(['snapshot_id', 'source_session_id', 'target_session_id', 'state_key', 'restore_state', 'record_restore_event', 'ttl_seconds', 'bucket', 'scope']),
  'recall-context': new Set(['query', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'status', 'threshold', 'max_items', 'max_tokens', 'limit', 'prefer_working', 'include_knowledge']),
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
  'claim-deny': new Set(),
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
      } else if (key === 'confirm') {
        if (inlineValue !== undefined) {
          flags.confirm = parseStrictBoolean(inlineValue, '--confirm');
        } else {
          const nextArg = args[i + 1];
          if (nextArg === 'true' || nextArg === 'false') {
            flags.confirm = nextArg === 'true';
            i++;
          } else {
            flags.confirm = true;
          }
        }
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
  if (command === undefined) {
    console.log(`XMemo Standalone Skill Runtime\n\nUsage:\n  ${SCRIPT_COMMAND} <command> [options]\n\nCommands:\n  login | register | logout | auth status | auth add\n  read --id <id> [--offset <n>] [--limit <n>]\n  update --id <id> [--content <text>] [--path <path>] [--metadata <json>]\n  forget --id <id> [--reason <text>] --confirm\n  ledger-list [--month <YYYY-MM>] [--from <date>] [--to <date>] [--currency <code>]\n  ledger-summary [--months <n>] [--currency <code>] [--type <type>]\n  overview | activity [--limit <n>] | stats [options]\n  remember --content <text> --path <path>\n  recall --query <text> [--limit <n>] [--compact]\n  search --query <text> [--limit <n>] [--compact]\n  recall-context --query <text> [--include_knowledge <true|false>]\n                                  Read-only bounded Memory context; opt into Knowledge with true\n  save-state | restore-state | restart-snapshot | restart-restore\n  todo-add | todo-list | todo-done | expense-add | doctor\n\nCredential resolution:\n  XMEMO_KEY                          Preferred; never copied to the local credential file\n  User credential file               Read only as a fallback\n\nGlobal options:\n  --json                             Print the API response as JSON\n  --base-url <url>                   Override ${DEFAULT_BASE_URL}; HTTPS or loopback HTTP only\n  --timeout-ms <ms>                  Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})\n  --compact                          Shorten recall/search content for terminals\n  --allow-plaintext                  Explicitly permit unencrypted user-file credential storage\n  --version                          Show the Skill runtime version\n  --help, -h                         Show this help\n\nRun \`${SCRIPT_COMMAND} <command> --help\` for command-specific usage.`);
    return;
  }
  if (command === 'auth') {
    console.log(`Usage:\n  ${SCRIPT_COMMAND} auth status [--verify] ${commonOptions}\n  ${SCRIPT_COMMAND} auth add --from-stdin --allow-plaintext\n  ${SCRIPT_COMMAND} auth claim-status [--allow-plaintext]\n  ${SCRIPT_COMMAND} auth claim-confirm [--allow-plaintext]\n  ${SCRIPT_COMMAND} auth claim-deny [--allow-plaintext]\n\nAlias: ${SCRIPT_COMMAND} auth-status [--verify]\nXMEMO_KEY remains the preferred non-file credential source. --allow-plaintext explicitly permits unencrypted user-file storage.\nRun \`${SCRIPT_COMMAND} --help\` to list all commands.`);
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
      read: 'read --id <id> [--offset <n>] [--limit <n>] [--bucket <bucket>] [--scope <scope>]',
      update: 'update --id <id> [--content <text>] [--path <path>] [--metadata <json>] [--bucket <bucket>] [--scope <scope>]',
      forget: 'forget --id <id> [--reason <text>] --confirm',
      'ledger-list': 'ledger-list [--month <YYYY-MM>] [--from <date>] [--to <date>] [--currency <code>] [--category <name>] [--type <type>] [--min-amount <n>] [--max-amount <n>] [--limit <n>] [--offset <n>]',
      'ledger-summary': 'ledger-summary [--months <n>] [--currency <code>] [--type <type>]',
      overview: 'overview',
      activity: 'activity [--limit <n>]',
      stats: 'stats [--scope <scope>] [--path <path>] [--bucket <bucket>] [--memory-type <type>] [--status <status>] [--source <src>] [--since <iso>] [--until <iso>] [--group-by <dims>] [--top-n <1..200>] [--team-id <id>]',
      remember: 'remember --content <text> [--path <path>] [--metadata <json-object>]',
      recall: 'recall --query <text> [--limit <n>] [--explain <true|false>] [--prefer_working <true|false>] [--compact]',
      search: 'search --query <text> [--limit <n>] [--explain <true|false>] [--prefer_working <true|false>] [--compact]',
      'recall-context': 'recall-context --query <text> [--max_items <n>] [--max_tokens <n>] [--prefer_working <true|false>] [--include_knowledge <true|false>]',
      'save-state': 'save-state --key <key> [--content <text>] [--ttl_seconds <0..604800>]',
      'restore-state': 'restore-state --key <key>',
      'state-save': 'state-save --key <key> [--content <text>] [--ttl_seconds <0..604800>] (legacy alias)',
      'state-restore': 'state-restore --key <key> (legacy alias)',
      'restart-snapshot': 'restart-snapshot [--state_key <key>] [--session_id <id>] [--ttl_seconds <0..2592000>]',
      'restart-restore': 'restart-restore [--snapshot_id <id> | --source_session_id <id>] [--target_session_id <id>]',
      'todo-add': 'todo-add --content <text>',
      'todo-list': 'todo-list',
      'todo-done': 'todo-done --id <todo_id>',
      'expense-add': 'expense-add --item <text> --amount <number> --currency <code>',
      doctor: 'doctor [--anonymous]',
    };
    console.log(`Usage:\n  ${SCRIPT_COMMAND} ${commandUsage[command]} ${commonOptions}`);
    return;
  }

  console.log(`XMemo Standalone Skill Runtime\n\nUsage:\n  ${SCRIPT_COMMAND} <command> [options]\n\nCommands:\n  login --allow-plaintext            Start formal device login and explicitly permit local token storage\n  register --reason <unattended|declined> --allow-plaintext\n                                     Start limited temporary memory only when formal login is unavailable\n  logout                             Revoke and remove a local credential\n  auth status [--verify]             Show local or verified auth status\n  auth-status [--verify]             Alias for auth status\n  auth add --from-stdin --allow-plaintext\n                                     Store a formal token read from standard input\n  auth claim-status [--allow-plaintext]\n                                     Check temporary-account claim status\n  auth claim-confirm [--allow-plaintext]\n                                     Confirm a pending human claim and accept formal token handoff\n  auth claim-deny [--allow-plaintext]\n                                     Decline a pending bind and keep isolated temporary access\n  read --id <id> [--offset <n>] [--limit <n>]\n  update --id <id> [--content <text>] [--path <path>] [--metadata <json>]\n  forget --id <id> [--reason <text>] --confirm\n  ledger-list [--month <YYYY-MM>] [--from <date>] [--to <date>] [--currency <code>]\n  ledger-summary [--months <n>] [--currency <code>] [--type <type>]\n  overview                           Show account overview (memories, storage, agents)\n  activity [--limit <n>]             Show recent account activity\n  stats [options]                    Show memory statistics and breakdown\n  remember --content <text> --path <path>\n  recall --query <text> [--limit <n>] [--compact]\n  search --query <text> [--limit <n>] [--compact]\n  save-state --key <key> [--content <text>] (aliases: state-save)\n  restore-state --key <key> (aliases: state-restore)\n  restart-snapshot                  Save a full restart-continuity snapshot\n  restart-restore                   Restore the latest or selected restart snapshot\n  todo-add --content <text>\n  todo-list\n  todo-done --id <todo_id>\n  expense-add --item <text> --amount <number> --currency <code>\n  doctor [--anonymous]\n\nCredential resolution:\n  XMEMO_KEY                          Preferred; never copied to the local credential file\n  User credential file              Read only as a fallback\n\nGlobal options:\n  --json                             Print the API response as JSON\n  --base-url <url>                   Override ${DEFAULT_BASE_URL}; HTTPS or loopback HTTP only\n  --timeout-ms <ms>                  Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})\n  --compact                          Shorten recall/search content for terminals\n  --allow-plaintext                  Explicitly permit unencrypted user-file credential storage\n  --version                          Show the Skill runtime version\n  --help, -h                         Show this help\n\nRun \`${SCRIPT_COMMAND} <command> --help\` for command-specific usage.`);
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

function parseIntegerInRange(value, name, min, max) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function parseJsonObject(value, name) {
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error(`${name} must be a valid JSON object.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return parsed;
}

function parseStrictBoolean(value, name) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
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
    if (/^(token|api[-_]?key|bearer|authorization|cookie|secret|password|passwd|credential|client[-_]?secret|refresh[-_]?token|access[-_]?token|private[-_]?key|xmemo[-_]?key)$/i.test(key) && key !== 'from-stdin') {
      throw new Error(`Refusing sensitive command-line option --${key}. Use XMEMO_KEY or --from-stdin where documented.`);
    }
    if (!allowedFlags.has(key)) {
      throw new Error(`Unknown option for ${command}${subcommand ? ` ${subcommand}` : ''}: --${key}`);
    }
  }

  const required = {
    read: ['id'],
    update: ['id'],
    forget: ['id'],
    remember: ['content'],
    recall: ['query'],
    search: ['query'],
    'recall-context': ['query'],
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

  if (flags.limit !== undefined) {
    if (command === 'read') {
      flags.limit = parsePositiveInteger(flags.limit, '--limit', 1_000_000);
    } else {
      flags.limit = parsePositiveInteger(flags.limit, '--limit', 100);
    }
  }
  if (flags['top-n'] !== undefined || flags.top_n !== undefined) {
    const rawVal = flags['top-n'] !== undefined ? flags['top-n'] : flags.top_n;
    const parsed = parseIntegerInRange(rawVal, '--top-n', 1, 200);
    flags['top-n'] = parsed;
    flags.top_n = parsed;
  }
  if (flags.offset !== undefined) {
    flags.offset = parseIntegerInRange(flags.offset, '--offset', 0, Number.MAX_SAFE_INTEGER);
  }
  for (const key of ['max_items', 'max_tokens']) {
    if (flags[key] !== undefined) flags[key] = parsePositiveInteger(flags[key], `--${key}`, key === 'max_items' ? 100 : 50_000);
  }
  if (flags.ttl_seconds !== undefined) {
    const ttlMax = command.startsWith('restart-') ? MAX_STATE_TTL_SECONDS : 604_800;
    const parsedTtl = parseIntegerInRange(flags.ttl_seconds, '--ttl_seconds', 0, ttlMax);
    if (command.startsWith('restart-')) flags.ttl_seconds = parsedTtl;
  }
  if (flags.metadata !== undefined) flags.metadata = parseJsonObject(flags.metadata, '--metadata');
  if (flags.explain !== undefined) flags.explain = parseStrictBoolean(flags.explain, '--explain');
  if (flags.prefer_working !== undefined) flags.prefer_working = parseStrictBoolean(flags.prefer_working, '--prefer_working');
  if (flags.include_knowledge !== undefined) flags.include_knowledge = parseStrictBoolean(flags.include_knowledge, '--include_knowledge');
  if (flags.restore_state !== undefined) flags.restore_state = parseStrictBoolean(flags.restore_state, '--restore_state');
  if (flags.record_restore_event !== undefined) flags.record_restore_event = parseStrictBoolean(flags.record_restore_event, '--record_restore_event');
  for (const key of ['timeline_limit', 'reminder_limit', 'decision_limit']) {
    if (flags[key] !== undefined) flags[key] = parseIntegerInRange(flags[key], `--${key}`, 0, 100);
  }
  if (flags.months !== undefined) {
    flags.months = parsePositiveInteger(flags.months, '--months', 24);
  }
  if (flags.month !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(flags.month))) {
      throw new Error('--month must be formatted as YYYY-MM.');
    }
  }
  if (flags['min-amount'] !== undefined) {
    const val = Number(flags['min-amount']);
    if (Number.isNaN(val) || val < 0) {
      throw new Error('--min-amount must be a non-negative number.');
    }
  }
  if (flags['max-amount'] !== undefined) {
    const val = Number(flags['max-amount']);
    if (Number.isNaN(val) || val < 0) {
      throw new Error('--max-amount must be a non-negative number.');
    }
  }
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

function outputRestError(code, message, options) {
  if (options && options.json) {
    console.log(safeJson({ ok: false, error: { code, message } }));
  } else {
    console.error(`Error: ${message} (Code: ${code})`);
  }
  process.exit(1);
}

function handleRestError(res, { notFoundMessage, context = 'REST request', options }) {
  if (res.statusCode === 401 || res.statusCode === 403) {
    let errData = null;
    try { errData = parseJsonResponse(res, context); } catch {}
    const code = errData?.error?.code || (res.statusCode === 401 ? 'unauthorized' : 'forbidden');
    const msg = apiErrorMessage(errData, res.statusCode === 401 ? 'Authentication required or token invalid.' : 'Access denied.');
    outputRestError(code, msg, options);
  }

  if (res.statusCode === 404) {
    let errData = null;
    try { errData = parseJsonResponse(res, context); } catch {}
    const code = 'not_found';
    const msg = apiErrorMessage(errData, notFoundMessage || 'Resource not found.');
    outputRestError(code, msg, options);
  }

  const data = parseJsonResponse(res, context);
  if (res.statusCode < 200 || res.statusCode >= 300 || data.ok === false) {
    const code = data?.error?.code || (res.statusCode === 400 ? 'invalid_request' : `HTTP ${res.statusCode}`);
    const msg = apiErrorMessage(data);
    outputRestError(code, msg, options);
  }
  return data;
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

function formatDuration(seconds) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  return `${seconds} seconds`;
}

function discoveryString(value) {
  if (typeof value !== 'string') return null;
  const sanitized = sanitizeTerminalText(value).trim();
  return sanitized ? sanitized.slice(0, 200) : null;
}

function discoveryStringList(value, maxItems = 24) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map(discoveryString)
    .filter(Boolean)
    .slice(0, maxItems);
}

function summarizeDoctorDiscovery(discovery, discoveryUrl) {
  const standalone = discovery?.standalone_skill ?? discovery?.integrations?.standalone_skill ?? {};
  return {
    status: 'available',
    url: discoveryUrl,
    schemaVersion: discoveryString(discovery?.schema_version),
    protocol: discoveryString(discovery?.protocol),
    service: discoveryString(discovery?.service),
    serviceVersion: discoveryString(discovery?.service_version),
    mcpUrl: discoveryString(discovery?.mcp_url),
    supportedClients: discoveryStringList(discovery?.supported_clients),
    standaloneSkill: {
      status: discoveryString(standalone.status),
      runtimeModel: discoveryString(standalone.runtime_model),
      packageVersion: discoveryString(standalone.package?.version),
      operations: discoveryStringList(standalone.operations),
      defaultScopes: discoveryStringList(standalone.auth?.default_scopes),
    },
  };
}

function discoveryFailureCode(error) {
  const message = String(error?.message ?? '').toLowerCase();
  if (message.includes('timed out')) return 'timeout';
  if (message.includes('non-json')) return 'invalid_response';
  return 'request_failed';
}

async function fetchDoctorDiscovery(baseUrl, timeoutMs) {
  const discoveryUrl = new URL('/.well-known/agent-discovery.json', baseUrl).toString();
  try {
    const res = await makeHttpRequest(baseUrl, '/.well-known/agent-discovery.json', 'GET', null, {}, timeoutMs);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return {
        status: 'unavailable',
        url: discoveryUrl,
        errorCode: 'http_error',
        httpStatus: res.statusCode ?? null,
      };
    }
    return summarizeDoctorDiscovery(parseJsonResponse(res, 'Doctor discovery'), discoveryUrl);
  } catch (error) {
    return {
      status: 'unavailable',
      url: discoveryUrl,
      errorCode: discoveryFailureCode(error),
    };
  }
}

function doctorNextAction({ credential, anonymous }) {
  if (!anonymous && !credential) {
    return {
      command: `${SCRIPT_COMMAND} login --allow-plaintext`,
      reason: 'Sign in before using account-scoped memory operations.',
    };
  }
  return {
    command: `${SCRIPT_COMMAND} auth status --verify`,
    reason: 'Verify the credential separately when an authenticated follow-up is needed.',
  };
}

function withDoctorDiagnostics(data, discovery, nextAction) {
  const report = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...data }
    : { ok: true, result: data };
  return {
    ...report,
    clientDiagnostics: {
      discovery,
      nextAction,
    },
  };
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

async function fetchTemporaryLimits(baseUrl, timeoutMs) {
  try {
    const res = await makeHttpRequest(baseUrl, '/.well-known/xmemo-agent.json', 'GET', null, {}, timeoutMs);
    if (res.statusCode < 200 || res.statusCode >= 300) return { ...DEFAULT_TEMPORARY_LIMITS };
    const data = parseJsonResponse(res, 'Temporary-memory policy discovery');
    const limits = data?.temporary_token?.limits;
    const max_items = Number(limits?.max_items);
    const ttl_seconds = Number(limits?.ttl_seconds);
    const max_lifetime_seconds = Number(limits?.max_lifetime_seconds);
    if (![max_items, ttl_seconds, max_lifetime_seconds].every(Number.isSafeInteger)
      || max_items <= 0 || ttl_seconds <= 0 || max_lifetime_seconds <= 0) {
      return { ...DEFAULT_TEMPORARY_LIMITS };
    }
    return { max_items, ttl_seconds, max_lifetime_seconds };
  } catch {
    // Discovery must not make an otherwise available registration endpoint unusable.
    return { ...DEFAULT_TEMPORARY_LIMITS };
  }
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
    const body = Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined));
    body.content = flags.content || '';
    body.path = flags.path || 'memories';
    res = await makeHttpRequest(options.baseUrl, '/v1/remember', 'POST', body, headers, options.timeoutMs);
  } else {
    const params = new URLSearchParams({ query: flags.query || '', limit: String(flags.limit || 5) });
    for (const key of ['threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain', 'prefer_working']) {
      if (flags[key] !== undefined) params.set(key, String(flags[key]));
    }
    const apiPath = command === 'search' ? '/v1/memories/search' : '/v1/recall';
    res = await makeHttpRequest(options.baseUrl, `${apiPath}?${params}`, 'GET', null, headers, options.timeoutMs);
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
  let { command, subcommand, positionals, options, flags } = parseArgs(process.argv.slice(2));

  if (command === 'auth-status') {
    command = 'auth';
    subcommand = 'status';
    positionals = ['auth', 'status', ...positionals.slice(1)];
  }

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
        scopes: ['memory:read', 'memory:write', 'memory:restore', 'ledger:write', 'ledger:read', 'knowledge:read']
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
      const limits = await fetchTemporaryLimits(options.baseUrl, options.timeoutMs);
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
        console.log(safeJson({ agent_id: data.agent_id, bind_url: data.bind_url, status: data.status, limits }));
      } else {
        console.log(`✅ Temporary XMemo memory enabled for this installation.\nThis is a limited sandbox, not a formal account.\nTemporary limits: up to ${limits.max_items} items; expires after ${formatDuration(limits.ttl_seconds)} without successful memory activity; maximum ${formatDuration(limits.max_lifetime_seconds)} from registration.\nComplete formal registration (recommended): ${sanitizeTerminalText(data.bind_url)}\nDo not share this bind URL publicly. After the human claim, run "${SCRIPT_COMMAND} auth claim-confirm" to accept the formal credential.`);
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

    if (subcommand === 'claim-status' || subcommand === 'claim-confirm' || subcommand === 'claim-deny') {
      const credential = await getStoredCredential();
      if (!credential?.token || credential.credential_type !== 'temporary') {
        console.error('Error: Claim commands require a locally stored temporary credential from "register".');
        process.exit(1);
      }
      try {
        if (subcommand === 'claim-deny') {
          const denyRes = await makeHttpRequest(options.baseUrl, '/v1/agents/bind/deny-current-user', 'POST', {}, {
            Authorization: `Bearer ${credential.token}`,
          }, options.timeoutMs);
          const denyData = parseJsonResponse(denyRes, 'Claim denial');
          if (denyRes.statusCode < 200 || denyRes.statusCode >= 300) {
            throw new Error(apiErrorMessage(denyData, safeJson(denyData)));
          }
          const allowPlaintext = plaintextStorageAllowed(options, credential);
          await saveToken(credential.token, {
            credential_type: 'temporary',
            agent_id: credential.agent_id,
            bind_url: credential.bind_url,
            registration_reason: credential.registration_reason,
          }, { allowPlaintext, warn: options.allowPlaintext && !credential.plaintext_storage_consent });
          if (options.json) {
            console.log(safeJson(denyData));
          } else {
            console.log('Pending account binding declined. The credential remains limited to isolated temporary memory; formal account login is still recommended.');
          }
          process.exit(0);
        }
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

  // 4. REST OPERATIONS (memory, state, restart continuity, TODO, ledger, and diagnostics)
  const credential = command === 'doctor' && options.anonymous ? null : await getStoredCredential();
  const token = credential?.token;
  
  // Doctor can be anonymous
  if (command === 'doctor' && !token) {
    try {
      const discovery = options.json
        ? await fetchDoctorDiscovery(options.baseUrl, options.timeoutMs)
        : null;
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
        console.log(safeJson(withDoctorDiagnostics(data, discovery, doctorNextAction({
          credential,
          anonymous: options.anonymous,
        }))));
      } else {
        const authentication = options.anonymous
          ? 'Not checked (anonymous mode)'
          : 'Missing/Unauthenticated';
        const nextStep = options.anonymous
          ? ''
          : `\nNext: ${SCRIPT_COMMAND} login --allow-plaintext`;
        console.log(`XMemo Service Status: OK\nAuthentication: ${authentication}${nextStep}`);
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

  if (command === 'restart-snapshot' || command === 'restart-restore') {
    const endpoint = command === 'restart-snapshot' ? '/v1/restart/snapshot' : '/v1/restart/restore';
    const label = command === 'restart-snapshot' ? 'Restart snapshot' : 'Restart restore';
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', flags, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
      const data = parseJsonResponse(res, `${label} request`);
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      if (options.json) {
        console.log(safeJson(data));
        process.exit(succeeded ? 0 : 1);
      }
      if (!succeeded) {
        console.error(`${label} failed: ${apiErrorMessage(data)} (HTTP ${res.statusCode})`);
        process.exit(1);
      }
      if (command === 'restart-snapshot') {
        console.log(`✅ Restart snapshot saved.\nID: ${sanitizeTerminalText(extractId(data))}${data.expires_at ? `\nExpires: ${sanitizeTerminalText(data.expires_at)}` : ''}`);
      } else {
        const isNotRestored = data.restored === false || data.status === 'not_found' || (!extractId(data) && !data.restored_at);
        if (isNotRestored) {
          console.log('ℹ️ No active restart snapshot found to restore.');
        } else {
          console.log(`✅ Restart snapshot restored.\nID: ${sanitizeTerminalText(extractId(data))}${data.restored_at ? `\nRestored: ${sanitizeTerminalText(data.restored_at)}` : ''}`);
        }
      }
    } catch (e) {
      console.error(`${label} failed:`, e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'recall-context') {
    const body = {
      query: flags.query,
      path: flags.path || '%',
      bucket: flags.bucket || '%',
      scope: flags.scope,
      team_id: flags.team_id,
      memory_type: flags.memory_type || 'auto',
      status: flags.status || 'active',
      threshold: flags.threshold === undefined ? undefined : Number(flags.threshold),
      max_items: flags.max_items,
      max_tokens: flags.max_tokens,
      limit: flags.limit,
      prefer_working: flags.prefer_working === undefined ? true : flags.prefer_working,
      include_knowledge: flags.include_knowledge,
    };
    Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/recall/context', 'POST', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
      const data = parseJsonResponse(res, 'Recall context request');
      const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
      if (options.json) {
        console.log(safeJson(data));
        process.exit(succeeded ? 0 : 1);
      }
      if (!succeeded) {
        console.error(`Error: ${apiErrorMessage(data)} (Code: ${data.error?.code || `HTTP ${res.statusCode}`})`);
        process.exit(1);
      }
      const items = Array.isArray(data.items) ? data.items.length : 0;
      const contextText = sanitizeTerminalText(data.context_text || '');
      console.log(`XMemo Context: ${items} item${items === 1 ? '' : 's'}\n${contextText || 'No matching memories found.'}`);
    } catch (e) {
      console.error('Recall context failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'read') {
    let endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/explain?include_embedding=false`;
    const queryParams = [];
    if (flags.bucket) queryParams.push(`bucket=${encodeURIComponent(flags.bucket)}`);
    if (flags.scope) queryParams.push(`scope=${encodeURIComponent(flags.scope)}`);
    if (queryParams.length > 0) {
      endpoint += `&${queryParams.join('&')}`;
    }
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found.`,
        context: 'Read memory request',
        options,
      });

      const record = (data && typeof data === 'object' && data.result && typeof data.result === 'object')
        ? data.result
        : (data && typeof data === 'object' && data.memory && typeof data.memory === 'object')
          ? data.memory
          : data;

      if (record && record.status && String(record.status).toLowerCase() === 'deleted') {
        outputRestError('not_found', `Memory '${flags.id}' not found or deleted.`, options);
      }

      if (!record || typeof record.content !== 'string') {
        outputRestError('not_found', `Memory '${flags.id}' not found.`, options);
      }

      const fullContent = record.content;
      const totalLength = fullContent.length;
      const offset = flags.offset !== undefined ? Number(flags.offset) : 0;
      const hasLimit = flags.limit !== undefined && flags.limit !== null;
      const limit = hasLimit ? Number(flags.limit) : totalLength;
      const slicedContent = fullContent.slice(offset, offset + limit);
      const truncated = offset > 0 || (offset + slicedContent.length < totalLength);

      const projected = {
        id: record.id || record.memory_id || flags.id,
        path: record.path || record.canonical_path || '',
        content: slicedContent,
        version: record.version || record.updated_at || record.created_at || null,
        truncated,
      };

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...projected,
        }));
        process.exit(0);
      }

      console.log(`Memory: ${sanitizeTerminalText(projected.id)} | Path: ${sanitizeTerminalText(projected.path || '(unknown)')} | Version: ${sanitizeTerminalText(projected.version || '(unknown)')}${projected.truncated ? ' [truncated]' : ''}`);
      console.log(`Content: ${formatMemoryContent(projected.content, options.compact)}`);
      process.exit(0);
    } catch (e) {
      console.error('Read memory failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'update') {
    let endpoint = `/v1/memories/${encodeURIComponent(flags.id)}`;
    const body = {};
    if (flags.content !== undefined) body.content = flags.content;
    if (flags.path !== undefined) body.path = flags.path;
    if (flags.metadata !== undefined) body.metadata = flags.metadata;
    if (flags.bucket !== undefined) body.bucket = flags.bucket;
    if (flags.scope !== undefined) body.scope = flags.scope;

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'PATCH', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      if (res.statusCode === 400) {
        let errData = null;
        try { errData = parseJsonResponse(res, 'Update memory request'); } catch {}
        const code = errData?.error?.code || 'invalid_request';
        const fallbackMsg = code === 'invalid_memory_id'
          ? `Invalid memory ID: '${flags.id}'.`
          : 'Invalid update request.';
        const msg = apiErrorMessage(errData, fallbackMsg);
        outputRestError(code, msg, options);
      }

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found.`,
        context: 'Update memory request',
        options,
      });

      const record = (data && typeof data === 'object' && data.result && typeof data.result === 'object')
        ? data.result
        : (data && typeof data === 'object' && data.memory && typeof data.memory === 'object')
          ? data.memory
          : data;

      const memoryId = record?.id || record?.memory_id || flags.id;
      if (options.json) {
        console.log(safeJson({
          ok: true,
          id: memoryId,
          path: record?.path || flags.path || '',
          updated: true,
          ...(typeof record === 'object' ? record : {}),
        }));
        process.exit(0);
      }

      console.log(`✅ Memory updated.\nID: ${sanitizeTerminalText(memoryId)}${flags.path ? `\nPath: ${sanitizeTerminalText(flags.path)}` : ''}`);
      process.exit(0);
    } catch (e) {
      console.error('Update memory failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'forget') {
    if (!flags.confirm) {
      const msg = `Confirmation required to forget memory '${flags.id}'. Pass --confirm to proceed.`;
      if (options.json) {
        console.log(safeJson({ ok: false, error: { code: 'confirmation_required', message: msg, target_id: flags.id } }));
      } else {
        console.error(`Error: ${msg}\nTarget: ${sanitizeTerminalText(flags.id)}`);
      }
      process.exit(1);
    }

    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/forget`;
    const body = {
      mode: 'soft_delete',
    };
    if (flags.reason !== undefined && String(flags.reason).trim() !== '') {
      body.reason = String(flags.reason);
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found.`,
        context: 'Forget memory request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          id: flags.id,
          mode: 'soft_delete',
          forgotten: true,
        }));
        process.exit(0);
      }

      console.log(`✅ Memory forgotten (soft-deleted).\nID: ${sanitizeTerminalText(flags.id)}`);
      process.exit(0);
    } catch (e) {
      console.error('Forget memory failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'ledger-list') {
    let dateFrom = flags.from;
    let dateTo = flags.to;
    if (flags.month) {
      const [y, m] = flags.month.split('-').map(Number);
      const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (!dateFrom) dateFrom = `${flags.month}-01`;
      if (!dateTo) dateTo = `${flags.month}-${String(lastDayNum).padStart(2, '0')}`;
    }

    const queryParams = [];
    if (flags.limit !== undefined) queryParams.push(`limit=${encodeURIComponent(flags.limit)}`);
    if (flags.offset !== undefined) queryParams.push(`offset=${encodeURIComponent(flags.offset)}`);
    if (flags.currency) queryParams.push(`currency=${encodeURIComponent(flags.currency)}`);
    if (dateFrom) queryParams.push(`date_from=${encodeURIComponent(dateFrom)}`);
    if (dateTo) queryParams.push(`date_to=${encodeURIComponent(dateTo)}`);
    if (flags.category) queryParams.push(`category=${encodeURIComponent(flags.category)}`);
    if (flags['min-amount'] !== undefined) queryParams.push(`min_amount=${encodeURIComponent(flags['min-amount'])}`);
    if (flags['max-amount'] !== undefined) queryParams.push(`max_amount=${encodeURIComponent(flags['max-amount'])}`);
    if (flags.type) queryParams.push(`transaction_type=${encodeURIComponent(flags.type)}`);

    let endpoint = '/v1/me/ledger/transactions';
    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Ledger transactions not found.',
        context: 'List ledger transactions request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(0);
      }

      const transactions = Array.isArray(data.transactions)
        ? data.transactions
        : (Array.isArray(data.result) ? data.result : []);

      if (transactions.length === 0) {
        console.log('No ledger transactions found.');
        process.exit(0);
      }

      const totalInfo = data.total !== undefined ? ` (total: ${data.total})` : '';
      console.log(`XMemo Ledger Transactions (${transactions.length}${totalInfo}):`);
      transactions.forEach((tx, idx) => {
        const date = tx.transaction_date || tx.date || tx.created_at || '(unknown date)';
        const amount = (tx.amount !== undefined && tx.amount !== null) ? tx.amount : '(unknown)';
        const curr = tx.currency || 'UNKNOWN';
        const type = tx.transaction_type || tx.type || 'expense';
        const cat = tx.category ? ` [${tx.category}]` : '';
        const desc = tx.description || tx.item || tx.note || '';
        console.log(`[${idx + 1}] ${sanitizeTerminalText(date)} | ${type.toUpperCase()} | ${amount} ${curr}${sanitizeTerminalText(cat)}${desc ? ` | ${sanitizeTerminalText(desc)}` : ''}`);
      });
      process.exit(0);
    } catch (e) {
      console.error('List ledger transactions failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'ledger-summary') {
    const queryParams = [];
    if (flags.months !== undefined) queryParams.push(`months=${encodeURIComponent(flags.months)}`);
    if (flags.currency) queryParams.push(`currency=${encodeURIComponent(flags.currency)}`);
    if (flags.type) queryParams.push(`transaction_type=${encodeURIComponent(flags.type)}`);

    let endpoint = '/v1/me/ledger/monthly-summary';
    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Ledger monthly summary not found.',
        context: 'Get ledger monthly summary request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(0);
      }

      const summaryList = Array.isArray(data.summary) ? data.summary : [];
      if (summaryList.length === 0 && data.total === undefined && data.count === undefined) {
        console.log('No ledger monthly summary available.');
        process.exit(0);
      }

      if (summaryList.length > 0) {
        console.log(`XMemo Ledger Monthly Summary (${summaryList.length} month${summaryList.length === 1 ? '' : 's'}):`);
        summaryList.forEach((item) => {
          const month = item.month || '(unknown month)';
          const curr = item.currency || 'UNKNOWN';
          const expense = item.expense_total !== undefined ? `${item.expense_total} ${curr}` : null;
          const income = item.income_total !== undefined ? `${item.income_total} ${curr}` : null;
          const net = item.net_total !== undefined ? `${item.net_total} ${curr}` : null;
          const count = item.transaction_count !== undefined ? `${item.transaction_count} tx` : '';
          const parts = [];
          if (expense !== null) parts.push(`Expense: ${expense}`);
          if (income !== null) parts.push(`Income: ${income}`);
          if (net !== null) parts.push(`Net: ${net}`);
          if (count) parts.push(count);
          console.log(`- ${month} (${curr}): ${parts.join(' | ')}`);
        });
        process.exit(0);
      }

      const month = data.month || '(unknown month)';
      const curr = data.currency || 'UNKNOWN';
      const total = data.total !== undefined ? data.total : 0;
      const count = data.count !== undefined ? data.count : 0;
      console.log(`XMemo ledger summary for ${sanitizeTerminalText(month)}: ${total} ${curr} across ${count} transaction${count === 1 ? '' : 's'}.`);
      process.exit(0);
    } catch (e) {
      console.error('Get ledger monthly summary failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'overview') {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/me/overview', 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Account overview not found.',
        context: 'Get overview request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(0);
      }

      console.log('XMemo Account Overview:');
      console.log(`- Memories: ${data.memories_total ?? 0} total (${data.memories_active ?? 0} active, ${data.memories_archived ?? 0} archived, ${data.memories_forgotten ?? 0} forgotten)`);
      console.log(`- Active Agents: ${data.agents_active ?? 0}`);
      console.log(`- Storage: ${data.storage_mb ?? 0} MB`);
      console.log(`- Tokens (30d): ${data.tokens_30d ?? 0}`);
      process.exit(0);
    } catch (e) {
      console.error('Get overview failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'activity') {
    const queryParams = [];
    if (flags.limit !== undefined) {
      queryParams.push(`limit=${encodeURIComponent(flags.limit)}`);
    }

    let endpoint = '/v1/me/activity';
    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Account activity not found.',
        context: 'Get activity request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(0);
      }

      const activityList = Array.isArray(data.activity) ? data.activity : [];
      if (activityList.length === 0) {
        console.log('No recent activity found.');
        process.exit(0);
      }

      const totalInfo = data.total !== undefined ? ` (total: ${data.total})` : '';
      console.log(`XMemo Recent Activity (${activityList.length}${totalInfo}):`);
      activityList.forEach((item, idx) => {
        const ts = item.ts || '(unknown date)';
        const type = item.type || 'unknown';
        const summary = item.summary || '';
        const ref = item.ref_id ? ` [ref: ${item.ref_id}]` : '';
        console.log(`[${idx + 1}] ${sanitizeTerminalText(ts)} | ${type.toUpperCase()} | ${sanitizeTerminalText(summary)}${ref}`);
      });
      process.exit(0);
    } catch (e) {
      console.error('Get activity failed:', e.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'stats') {
    const scope = flags.scope;
    const path = flags.path;
    const bucket = flags.bucket;
    const memoryType = flags['memory-type'] !== undefined ? flags['memory-type'] : flags.memory_type;
    const status = flags.status;
    const source = flags.source;
    const since = flags.since;
    const until = flags.until;
    const groupBy = flags['group-by'] !== undefined ? flags['group-by'] : flags.group_by;
    const topN = flags['top-n'] !== undefined ? flags['top-n'] : flags.top_n;
    const teamId = flags['team-id'] !== undefined ? flags['team-id'] : flags.team_id;

    const queryParams = [];
    if (scope) queryParams.push(`scope=${encodeURIComponent(scope)}`);
    if (path) queryParams.push(`path=${encodeURIComponent(path)}`);
    if (bucket) queryParams.push(`bucket=${encodeURIComponent(bucket)}`);
    if (memoryType) queryParams.push(`memory_type=${encodeURIComponent(memoryType)}`);
    if (status) queryParams.push(`status=${encodeURIComponent(status)}`);
    if (source) queryParams.push(`source=${encodeURIComponent(source)}`);
    if (since) queryParams.push(`since=${encodeURIComponent(since)}`);
    if (until) queryParams.push(`until=${encodeURIComponent(until)}`);
    if (groupBy) queryParams.push(`group_by=${encodeURIComponent(groupBy)}`);
    if (topN !== undefined) queryParams.push(`top_n=${encodeURIComponent(topN)}`);
    if (teamId) queryParams.push(`team_id=${encodeURIComponent(teamId)}`);

    let endpoint = '/v1/memories/stats';
    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Memory stats not found.',
        context: 'Get memory stats request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(0);
      }

      if ((data.total_count ?? 0) === 0 && (data.filtered_count ?? 0) === 0) {
        console.log('No memory statistics available.');
        process.exit(0);
      }

      console.log('XMemo Memory Statistics:');
      console.log(`- Total Memories: ${data.total_count ?? 0} (filtered: ${data.filtered_count ?? 0}, scanned: ${data.scanned_count ?? 0})`);
      if (data.latest_at) console.log(`- Latest Memory: ${data.latest_at}`);
      if (data.oldest_at) console.log(`- Oldest Memory: ${data.oldest_at}`);
      if (data.type_counts && Object.keys(data.type_counts).length > 0) {
        const counts = Object.entries(data.type_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Types: ${counts}`);
      }
      if (data.status_counts && Object.keys(data.status_counts).length > 0) {
        const counts = Object.entries(data.status_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Status: ${counts}`);
      }
      if (data.bucket_counts && Object.keys(data.bucket_counts).length > 0) {
        const counts = Object.entries(data.bucket_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Buckets: ${counts}`);
      }
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        console.log(`- Groups (${data.groups.length}):`);
        data.groups.forEach((g) => {
          const dims = g.group_by ? Object.entries(g.group_by).map(([k, v]) => `${k}=${v}`).join(', ') : '';
          console.log(`  * [${dims}]: ${g.count}`);
        });
      }
      process.exit(0);
    } catch (e) {
      console.error('Get memory stats failed:', e.message);
      process.exit(1);
    }
    return;
  }

  // Normalize commands for operations mapping
  let opName = command;
  if (command === 'save-state' || command === 'state-save') opName = 'state-save';
  if (command === 'restore-state' || command === 'state-restore') opName = 'state-restore';

  try {
    const discovery = command === 'doctor' && options.json
      ? await fetchDoctorDiscovery(options.baseUrl, options.timeoutMs)
      : null;
    const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
      operation: opName,
      arguments: flags,
    }, {
      'Authorization': `Bearer ${token}`
    }, options.timeoutMs);

    const data = parseJsonResponse(res, `${opName} request`);
    const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
    if (options.json) {
      const output = opName === 'doctor'
        ? withDoctorDiagnostics(data, discovery, doctorNextAction({ credential, anonymous: false }))
        : data;
      console.log(safeJson(output));
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
      const state = data.result;
      if (!state || typeof state !== 'object') {
        console.log('No saved working state found for the requested key.');
      } else {
        const stateKey = state.state_key || flags.key || flags.state_key || '(unknown)';
        const content = state.content === undefined || state.content === null || state.content === ''
          ? '(empty)'
          : state.content;
        console.log(`Working State restored:\nKey: ${sanitizeTerminalText(stateKey)}\nContent: ${formatMemoryContent(content, false)}`);
      }
    } else if (opName === 'remember') {
      console.log(`✅ Saved to XMemo.\nID: ${sanitizeTerminalText(extractId(data.result))}`);
    } else if (opName === 'expense-add') {
      console.log(`✅ Expense recorded.\nID: ${sanitizeTerminalText(extractId(data.result))}`);
    } else if (opName === 'todo-add') {
      const id = extractId(data.result);
      console.log(`✅ TODO added.${id ? `\nID: ${sanitizeTerminalText(id)}` : ''}`);
    } else if (opName === 'todo-done') {
      const id = flags.id || flags.todo_id || extractId(data.result);
      console.log(`✅ TODO completed.${id ? `\nID: ${sanitizeTerminalText(id)}` : ''}`);
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
