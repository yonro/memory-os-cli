import https from 'node:https';
import http from 'node:http';
import {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  DEFAULT_TEMPORARY_LIMITS,
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
} from './core.mjs';

const warnedCredentialOrigins = new Set();

export function redactSensitiveResponse(value) {
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

export function safeJson(value) {
  return JSON.stringify(redactSensitiveResponse(value));
}

export function sanitizeTerminalText(value) {
  return String(value ?? '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

export function formatMemoryContent(content, compact) {
  const value = sanitizeTerminalText(content);
  const rendered = compact ? value.replace(/\s+/g, ' ').trim() : value;
  const limit = compact ? 280 : 2_000;
  return rendered.length > limit ? `${rendered.slice(0, limit)}… (truncated)` : rendered;
}

export function formatDuration(seconds) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  return `${seconds} seconds`;
}

export function parseJsonResponse(res, context) {
  const body = typeof res.body === 'string' ? res.body.trim() : '';
  if (!body) {
    const error = new Error(`${context}: server returned an empty response (HTTP ${res.statusCode}).`);
    error.statusCode = res.statusCode;
    throw error;
  }
  try {
    return JSON.parse(body);
  } catch {
    const safeBody = sanitizeTerminalText(body);
    const preview = safeBody.length > 2_000 ? `${safeBody.slice(0, 2_000)}…` : safeBody;
    const error = new Error(`${context}: server returned a non-JSON response (HTTP ${res.statusCode}): ${preview}`);
    error.statusCode = res.statusCode;
    throw error;
  }
}

export function extractList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.todos)) return result.todos;
  if (Array.isArray(result?.reminders)) return result.reminders;
  return [];
}

export function extractId(result) {
  if (typeof result === 'string') return result;
  if (result?.id) return result.id;
  if (result?.memory_id) return result.memory_id;
  return JSON.stringify(result) ?? String(result ?? '');
}

export function apiErrorMessage(data, fallback = 'Operation failed') {
  const candidate = data?.error?.message || data?.error_description || data?.detail || data?.error;
  if (typeof candidate === 'string') return sanitizeTerminalText(candidate);
  if (candidate !== undefined && candidate !== null) return safeJson(candidate);
  return fallback;
}

export function extractRequestId(data) {
  if (!data || typeof data !== 'object') return null;
  const candidate = data.error?.request_id || data.request_id;
  if (typeof candidate === 'string' && candidate.trim()) {
    return sanitizeTerminalText(candidate.trim());
  }
  return null;
}

export function extractExpiresInSeconds(data) {
  if (data?.expires_in !== undefined && data?.expires_in !== null) {
    const num = Number(data.expires_in);
    if (Number.isFinite(num) && num > 0) return num;
  }
  if (data?.expires !== undefined && data?.expires !== null) {
    if (typeof data.expires === 'number' && Number.isFinite(data.expires) && data.expires > 0) {
      if (data.expires > 1e11) {
        return Math.max(1, Math.round((data.expires - Date.now()) / 1000));
      }
      if (data.expires > 1e8) {
        return Math.max(1, Math.round(data.expires - Date.now() / 1000));
      }
      return data.expires;
    }
    if (typeof data.expires === 'string') {
      const parsedNum = Number(data.expires);
      if (Number.isFinite(parsedNum) && parsedNum > 0) {
        if (parsedNum > 1e11) {
          return Math.max(1, Math.round((parsedNum - Date.now()) / 1000));
        }
        if (parsedNum > 1e8) {
          return Math.max(1, Math.round(parsedNum - Date.now() / 1000));
        }
        return parsedNum;
      }
      const parsedDate = Date.parse(data.expires);
      if (Number.isFinite(parsedDate) && parsedDate > Date.now()) {
        return Math.max(1, Math.round((parsedDate - Date.now()) / 1000));
      }
    }
  }
  return 600;
}

export function formatRemainingValidity(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h${minutes}m${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m${secs}s`;
  }
  return `${secs}s`;
}

export function outputRestError(code, message, options, dataOrRequestId, explicitExitCode = null) {
  const reqId = typeof dataOrRequestId === 'string'
    ? sanitizeTerminalText(dataOrRequestId.trim())
    : extractRequestId(dataOrRequestId);
  if (options && options.json) {
    const errorObj = { code, message };
    if (reqId) {
      errorObj.request_id = reqId;
    }
    console.log(safeJson({ ok: false, error: errorObj }));
  } else {
    const reqSuffix = reqId ? ` (request_id: ${reqId})` : '';
    console.error(`Error: ${message} (Code: ${code})${reqSuffix}`);
  }
  const resolvedExitCode = explicitExitCode !== null
    ? explicitExitCode
    : (exitCodeForErrorCode(code) ?? EXIT_CODE.USER_ERROR);
  process.exit(resolvedExitCode);
}

export function handleRestError(res, { notFoundMessage, context = 'REST request', options }) {
  if (res.statusCode === 401 || res.statusCode === 403) {
    let errData = null;
    try { errData = parseJsonResponse(res, context); } catch {}
    const code = errData?.error?.code || (res.statusCode === 401 ? 'unauthorized' : 'forbidden');
    const defaultMsg = res.statusCode === 401
      ? 'Authentication required or token invalid.'
      : 'Access denied. Re-authorization is required to explicitly grant the required scope.';
    let msg = apiErrorMessage(errData, defaultMsg);
    if (res.statusCode === 403 && !/re-?authorization/i.test(msg)) {
      msg = `${msg.replace(/\.*$/, '')}. Re-authorization is required to explicitly grant the required scope.`;
    }
    outputRestError(code, msg, options, errData, EXIT_CODE.AUTH_ERROR);
  }

  if (res.statusCode === 404) {
    let errData = null;
    try { errData = parseJsonResponse(res, context); } catch {}
    const code = 'not_found';
    const msg = apiErrorMessage(errData, notFoundMessage || 'Resource not found.');
    outputRestError(code, msg, options, errData, EXIT_CODE.USER_ERROR);
  }

  const data = parseJsonResponse(res, context);
  if (res.statusCode < 200 || res.statusCode >= 300 || data.ok === false) {
    const code = data?.error?.code || (res.statusCode === 400 ? 'invalid_request' : `HTTP ${res.statusCode}`);
    const msg = apiErrorMessage(data);
    const exitCode = exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode);
    outputRestError(code, msg, options, data, exitCode);
  }
  return data;
}

export function makeHttpRequest(baseUrl, apiPath, method, body = null, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
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

export async function fetchTemporaryLimits(baseUrl, timeoutMs) {
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
    return { ...DEFAULT_TEMPORARY_LIMITS };
  }
}
