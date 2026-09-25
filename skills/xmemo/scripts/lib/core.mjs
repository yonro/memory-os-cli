import path from 'node:path';
import os from 'node:os';

export const credentialsPath = path.join(os.homedir(), '.xmemo', 'skill-credentials.json');
export const registrationPath = path.join(os.homedir(), '.xmemo', 'skill-registration.json');
export const SCRIPT_COMMAND = 'node scripts/xmemo-skill.mjs';
export const PLAINTEXT_STORAGE = 'plaintext-user-file';
export const DEFAULT_BASE_URL = 'https://xmemo.dev';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 300_000;
export const MAX_RESPONSE_BYTES = 8_388_608;
// Maximum memory content limit (512 KiB), matching memory-os server models/memory_schema.py: MAX_MEMORY_CONTENT_BYTES
export const MAX_MEMORY_CONTENT_BYTES = 524_288;
export const MAX_STATE_TTL_SECONDS = 2_592_000;
export const DEFAULT_TEMPORARY_LIMITS = Object.freeze({
  max_items: 100,
  ttl_seconds: 1_209_600,
  max_lifetime_seconds: 2_592_000,
});
export const EXIT_CODE = Object.freeze({
  SUCCESS: 0,
  USER_ERROR: 1,
  AUTH_ERROR: 2,
  SERVER_ERROR: 3,
});

export function exitCodeForHttpStatus(statusCode) {
  const code = Number(statusCode);
  if (code >= 200 && code < 300) {
    return EXIT_CODE.SUCCESS;
  }
  if (code === 401 || code === 403) {
    return EXIT_CODE.AUTH_ERROR;
  }
  if (code >= 500) {
    return EXIT_CODE.SERVER_ERROR;
  }
  return EXIT_CODE.USER_ERROR;
}

export function exitCodeForErrorCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.toLowerCase();
  if (
    normalized === 'unauthorized' ||
    normalized === 'forbidden' ||
    normalized === 'tenant_forbidden' ||
    normalized === 'auth_error' ||
    normalized === 'invalid_token' ||
    normalized === 'token_expired' ||
    normalized === 'authentication_required' ||
    normalized === 'missing_credentials'
  ) {
    return EXIT_CODE.AUTH_ERROR;
  }
  if (
    normalized === 'server_error' ||
    normalized === 'internal_error' ||
    normalized === 'timeout' ||
    normalized === 'bad_gateway' ||
    normalized === 'service_unavailable' ||
    normalized === 'econnrefused' ||
    normalized === 'enotfound' ||
    normalized === 'ehostunreach' ||
    normalized === 'econnreset' ||
    normalized === 'etimedout' ||
    normalized === 'esockettimedout'
  ) {
    return EXIT_CODE.SERVER_ERROR;
  }
  if (
    normalized === 'bad_request' ||
    normalized === 'invalid_argument' ||
    normalized === 'not_found' ||
    normalized === 'rate_limited' ||
    normalized === 'rate_limit_exceeded' ||
    normalized === 'precondition_required'
  ) {
    return EXIT_CODE.USER_ERROR;
  }
  if (normalized.startsWith('http 401') || normalized.startsWith('http 403')) {
    return EXIT_CODE.AUTH_ERROR;
  }
  if (normalized.startsWith('http 5')) {
    return EXIT_CODE.SERVER_ERROR;
  }
  if (normalized.startsWith('http 4')) {
    return EXIT_CODE.USER_ERROR;
  }
  return null;
}

export function exitCodeForError(err) {
  if (!err) return EXIT_CODE.USER_ERROR;
  if (typeof err.exitCode === 'number') {
    return err.exitCode;
  }
  const status = Number(err.statusCode || err.status || err.httpStatus);
  if (Number.isInteger(status) && status > 0) {
    return exitCodeForHttpStatus(status);
  }
  const code = String(err.code || '').toUpperCase();
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN', 'EPIPE'].includes(code)) {
    return EXIT_CODE.SERVER_ERROR;
  }
  const msg = String(err.message || err).toLowerCase();
  if (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('safety limit') ||
    msg.includes('socket hang up') ||
    msg.includes('interrupted') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach') ||
    msg.includes('server response exceeded') ||
    msg.includes('server returned a non-json response') ||
    msg.includes('server returned an empty response')
  ) {
    return EXIT_CODE.SERVER_ERROR;
  }
  if (
    /\b40[13]\b/.test(msg) ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('invalid or expired token') ||
    msg.includes('no xmemo credential found') ||
    msg.includes('authentication required')
  ) {
    return EXIT_CODE.AUTH_ERROR;
  }
  return EXIT_CODE.USER_ERROR;
}

export const REST_COMMANDS = new Set([
  'read', 'update', 'forget',
  'ledger-list', 'ledger-summary',
  'overview', 'activity', 'stats',
  'remember', 'recall', 'search', 'save-state', 'restore-state', 'state-save', 'state-restore',
  'restart-snapshot', 'restart-restore', 'recall-context',
  'todo-add', 'todo-list', 'todo-done', 'expense-add', 'doctor',
]);

export const COMMAND_FLAGS = {
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
  remember: new Set(['content', 'file', 'path', 'metadata', 'logic_path', 'bucket', 'scope', 'team_id']),
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

export const AUTH_FLAGS = {
  status: new Set(),
  add: new Set(['from-stdin']),
  'claim-status': new Set(),
  'claim-confirm': new Set(),
  'claim-deny': new Set(),
};

export function parsePositiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}.`);
  }
  return parsed;
}

export function parseIntegerInRange(value, name, min, max) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

export function parseJsonObject(value, name) {
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

export function parseStrictBoolean(value, name) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

export function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function normalizeBaseUrl(value) {
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
