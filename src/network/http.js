import {
  CLI_VERSION,
  COMMAND_NAME
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';

export async function verifyTokenWithMcp(baseUrl, token, timeoutMs, io) {
  const url = endpointUrl(baseUrl, '/mcp');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await io.fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'user-agent': `XMemo-CLI/${CLI_VERSION} (+https://github.com/yonro/memory-os-cli)`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: COMMAND_NAME, version: CLI_VERSION }
        }
      }),
      signal: controller.signal
    });
    return {
      ok: response.ok,
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      detail: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probe(url, timeoutMs, io) {
  if (typeof io.fetch !== 'function') {
    return { url, ok: false, error: 'fetch unavailable in this Node runtime' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await io.fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    return { url, ok: response.ok, status: response.status };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(url, timeoutMs, io) {
  if (typeof io.fetch !== 'function') {
    throw new UsageError('This Node runtime does not provide fetch; use Node.js 20 or newer.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await io.fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new UsageError(`Discovery request failed with HTTP ${response.status}: ${url}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    const reason = error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message;
    throw new UsageError(`Discovery request failed: ${url} (${reason})`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function postJson(url, payload, timeoutMs, io, options = {}) {
  if (typeof io.fetch !== 'function') {
    throw new UsageError('This Node runtime does not provide fetch; use Node.js 20 or newer.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await io.fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const responsePayload = await response.json();
    if (!response.ok) {
      const error = responsePayload?.error ?? responsePayload?.detail ?? `HTTP ${response.status}`;
      if (options.allowDevicePending && (error === 'authorization_pending' || error === 'slow_down')) {
        return { error };
      }
      throw new UsageError(`Request failed with HTTP ${response.status}: ${url} (${error})`);
    }
    return responsePayload;
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    const reason = error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message;
    throw new UsageError(`Request failed: ${url} (${reason})`);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeBaseUrl(input) {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new UsageError('URL must use http or https.');
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    throw new UsageError(`Invalid URL: ${input}`);
  }
}

export function endpointUrl(baseUrl, pathname) {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.hash = '';
  url.search = '';
  return url.toString();
}

