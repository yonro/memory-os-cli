import { CLI_VERSION, COMMAND_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { endpointUrl, normalizeBaseUrl } from '../network/http.js';
import { ContractRequiredError, InterruptedError, ServiceClientError, UnknownOutcomeError, classifyHttpFailure } from './errors.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function assertServiceOrigin(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  const supplied = new URL(baseUrl);
  const parsed = new URL(normalized);
  if (supplied.username || supplied.password || supplied.search || supplied.hash) throw new UsageError('Service URL must not contain credentials, query parameters, or fragments.');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))) {
    throw new UsageError('Service URL must use HTTPS; HTTP is allowed only for loopback development URLs.');
  }
  return normalized;
}

export function createServiceClient({
  baseUrl,
  token,
  io,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  agentId,
  agentInstanceId
}) {
  const serviceBaseUrl = assertServiceOrigin(baseUrl);
  if (!token || typeof token !== 'string') {
    throw new ServiceClientError('Authentication is required for this service request.', {
      code: 'AUTH_REQUIRED',
      httpStatus: 401,
      nextAction: `Run \`${COMMAND_NAME} login\` or provide ${'XMEMO_KEY'}.`
    });
  }
  if (typeof io?.fetch !== 'function') {
    throw new UsageError('This Node runtime does not provide fetch; use Node.js 20 or newer.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new UsageError('timeoutMs must be a positive integer.');
  }

  async function request({ method, path, query, body, sideEffect = false, retry = 'none', operation, timeoutMs: requestTimeoutMs = timeoutMs, deadlineMs }) {
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new UsageError('Request timeout must be a positive integer.');
    if (deadlineMs !== undefined && (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0)) throw new UsageError('Request deadline must be a positive integer.');
    if (io.signal?.aborted) throw new InterruptedError('Local request interrupted before transmission.');
    const url = buildUrl(serviceBaseUrl, path, query);
    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': `XMemo-CLI/${CLI_VERSION}`
    };
    if (agentId) headers['X-Memory-OS-Agent-ID'] = agentId;
    if (agentInstanceId) headers['X-Memory-OS-Agent-Instance-ID'] = agentInstanceId;
    const init = {
      method,
      headers,
      redirect: 'error'
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const attempts = retry === 'bounded' && !sideEffect ? 2 : 1;
    const deadline = deadlineMs === undefined ? null : Date.now() + deadlineMs;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const remaining = deadline === null ? requestTimeoutMs : deadline - Date.now();
        if (remaining <= 0) throw new ServiceClientError(`Service request deadline exceeded: ${method} ${path}.`, { code: 'REQUEST_DEADLINE_EXCEEDED' });
        const { response, payload } = await fetchWithTimeout(url, init, Math.min(requestTimeoutMs, remaining), io, async (response) => {
          let payload;
          try { payload = await readJsonResponse(response, maxResponseBytes); }
          catch (error) {
            if (response.ok || !(error instanceof ServiceClientError)) throw error;
            payload = null;
          }
          return { response, payload };
        });
        if (!response.ok) {
          const safePayload = safeErrorData(payload, token);
          const details = classifyHttpFailure(response.status, safePayload);
          if (details.retryable && attempt + 1 < attempts) {
            const retryAfterMs = retryDelayMs(response.headers?.get?.('retry-after'), attempt);
            if (deadline !== null && retryAfterMs >= deadline - Date.now()) {
              throw new ServiceClientError(`Service request deadline exceeded while waiting to retry: ${method} ${path}.`, { code: 'REQUEST_DEADLINE_EXCEEDED', data: { retryAfterMs } });
            }
            await waitForRetry(retryAfterMs, io);
            continue;
          }
          if ((details.httpStatus === 404 || details.httpStatus === 405) && operation?.contractRequired) {
            throw new ContractRequiredError(`Server contract is unavailable for ${operation.name ?? path}.`, details);
          }
          if (sideEffect && (details.httpStatus === 408 || details.httpStatus >= 500)) {
            throw new UnknownOutcomeError(`Service may have processed the write before returning HTTP ${details.httpStatus}: ${method} ${path}.`, {
              ...details,
              data: safePayload,
              nextAction: '核对服务端资源状态；不要自动重试该写入。'
            });
          }
          throw new ServiceClientError(details.message, { ...details, data: safePayload });
        }
        return { status: response.status, headers: response.headers, data: payload };
      } catch (error) {
        if (error instanceof ContractRequiredError || (error instanceof ServiceClientError && error.httpStatus)) throw error;
        if (sideEffect) throw new UnknownOutcomeError(`Service request outcome is unknown: ${method} ${path}.`, { cause: error, nextAction: '核对服务端资源状态；不要自动重试该写入。' });
        if (io.signal?.aborted) throw new InterruptedError('Local request interrupted.');
        if (error instanceof ServiceClientError) throw error;
        lastError = error;
        if (attempt + 1 >= attempts) {
          const reason = error?.name === 'AbortError' ? `timeout after ${requestTimeoutMs}ms` : 'network transport error';
          throw new ServiceClientError(`Service request failed: ${method} ${path} (${reason}).`, {
            code: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
            retryable: false,
            outcome: 'known-failure',
            cause: error
          });
        }
      }
    }
    throw lastError;
  }

  return Object.freeze({ baseUrl: serviceBaseUrl, request });
}

function retryDelayMs(retryAfter, attempt) {
  if (typeof retryAfter === 'string' && /^\d+(?:\.\d+)?$/u.test(retryAfter.trim())) return Math.ceil(Number(retryAfter) * 1000);
  if (typeof retryAfter === 'string') {
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  const baseMs = attempt === 0 ? 250 : 1000;
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

async function waitForRetry(delayMs, io) {
  if (delayMs <= 0) return;
  if (io.signal?.aborted) throw new InterruptedError('Local request interrupted while waiting to retry.');
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      io.signal?.removeEventListener?.('abort', abort);
      callback();
    };
    const timer = setTimeout(() => finish(resolve), delayMs);
    const abort = () => {
      clearTimeout(timer);
      finish(() => reject(new InterruptedError('Local request interrupted while waiting to retry.')));
    };
    io.signal?.addEventListener?.('abort', abort, { once: true });
  });
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(endpointUrl(baseUrl, path));
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  if (url.origin !== new URL(baseUrl).origin) {
    throw new UsageError('Service request path must remain on the configured service origin.');
  }
  return url;
}

async function fetchWithTimeout(url, init, timeoutMs, io, consume) {
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(Object.assign(new Error('Request aborted.'), { name: 'AbortError' }));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const interrupt = () => controller.abort();
  if (io.signal?.aborted) controller.abort();
  else io.signal?.addEventListener?.('abort', interrupt, { once: true });
  try {
    return await Promise.race([
      Promise.resolve().then(() => io.fetch(url.toString(), { ...init, signal: controller.signal })).then(consume),
      aborted
    ]);
  } finally {
    clearTimeout(timeout);
    io.signal?.removeEventListener?.('abort', interrupt);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

async function readJsonResponse(response, maxBytes) {
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength && Number.isFinite(Number(declaredLength)) && Number(declaredLength) > maxBytes) {
    await response.body?.cancel?.();
    throw new ServiceClientError(`Service response exceeded the ${maxBytes}-byte limit.`, { code: 'RESPONSE_TOO_LARGE' });
  }
  let text = '';
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel();
            throw new ServiceClientError(`Service response exceeded the ${maxBytes}-byte limit.`, { code: 'RESPONSE_TOO_LARGE' });
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    } else {
      text = await response.text();
    }
  } catch (error) {
    if (error instanceof ServiceClientError) throw error;
    throw new ServiceClientError('Could not read service response.', { code: 'INVALID_RESPONSE', cause: error });
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new ServiceClientError(`Service response exceeded the ${maxBytes}-byte limit.`, { code: 'RESPONSE_TOO_LARGE' });
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ServiceClientError('Service returned invalid JSON.', { code: 'INVALID_RESPONSE', cause: error });
  }
}

function safeErrorData(payload, token) {
  return redact(payload, new WeakSet(), token);
}

function redact(value, seen, token) {
  if (typeof value === 'string') return value.split(token).join('[REDACTED]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen, token));
  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/token|cookie|secret|authorization|oauth|private.?key/i.test(key)) continue;
    copy[key] = redact(entry, seen, token);
  }
  return copy;
}
