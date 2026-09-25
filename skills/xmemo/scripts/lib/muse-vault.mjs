import http from 'node:http';
import fs from 'node:fs/promises';

export const VAULT_CREDENTIAL_NAME = 'custom.xmemo';
export const VAULT_ENTRY_NAME = 'access_token';
export const DEFAULT_AUTHD_SOCKET = '/run/hatch/auth/authd.sock';
export const VAULT_ALLOWED_ORIGIN = 'https://xmemo.dev';
export const AUTHD_TIMEOUT_MS = 2000;
export const MAX_AUTHD_RESPONSE_BYTES = 65536;

export class VaultKeyError extends Error {
  constructor(message, codeOrOptions = 'authd_error') {
    super(message);
    this.name = 'VaultKeyError';
    if (typeof codeOrOptions === 'string') {
      this.code = codeOrOptions;
    } else if (codeOrOptions && typeof codeOrOptions === 'object') {
      this.code = codeOrOptions.code || 'authd_error';
      if (codeOrOptions.statusCode !== undefined) this.statusCode = codeOrOptions.statusCode;
      if (codeOrOptions.cause !== undefined) this.cause = codeOrOptions.cause;
    } else {
      this.code = 'authd_error';
    }
  }
}

export function isSurrogateToken(value) {
  return typeof value === 'string' && value.startsWith('hsurr:');
}

export function validateSurrogate(token) {
  if (typeof token !== 'string' || !token.startsWith('hsurr:')) {
    throw new VaultKeyError('Invalid surrogate token: missing hsurr: prefix', 'authd_error');
  }
  if (token.length < 7 || token.length > 4096) {
    throw new VaultKeyError('Invalid surrogate token: length out of bounds', 'authd_error');
  }
  if (/[\s\u0000-\u001F\u007F-\u009F]/.test(token)) {
    throw new VaultKeyError('Invalid surrogate token: contains whitespace or control characters', 'authd_error');
  }
  return token;
}

export function assertSurrogateOrigin(authHeader, targetUrl) {
  if (!authHeader || typeof authHeader !== 'string') return;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) return;
  const token = match[1];
  if (!isSurrogateToken(token)) return;

  const urlObj = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;
  if (urlObj.origin !== new URL(VAULT_ALLOWED_ORIGIN).origin) {
    throw new Error(
      `Meta Muse vault credentials (surrogate) are restricted to ${VAULT_ALLOWED_ORIGIN} and cannot be sent to ${urlObj.origin}. Unset XMEMO_BASE_URL or use a standard credential.`
    );
  }
}

export async function getVaultSurrogate(options = {}) {
  const socketPath = options.socketPath || process.env.JARVIS_AUTHD_SOCK || DEFAULT_AUTHD_SOCKET;

  try {
    await fs.stat(socketPath);
  } catch (err) {
    throw new VaultKeyError(`Auth daemon socket unavailable at ${socketPath}`, 'unavailable');
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ name: VAULT_CREDENTIAL_NAME });
    const reqOptions = {
      socketPath,
      path: '/v1/credentials/surrogate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const timeout = options.timeoutMs || AUTHD_TIMEOUT_MS;
    let settled = false;
    const settleResolve = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const settleReject = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = http.request(reqOptions, (res) => {
      let responseData = '';
      let byteCount = 0;

      res.on('data', (chunk) => {
        byteCount += Buffer.byteLength(chunk);
        if (byteCount > MAX_AUTHD_RESPONSE_BYTES) {
          res.destroy();
          settleReject(new VaultKeyError('Auth daemon response exceeded size limit', 'authd_error'));
          return;
        }
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 403 || res.statusCode === 404) {
          settleReject(new VaultKeyError(`Vault credential missing or access denied (HTTP ${res.statusCode})`, {
            code: 'missing',
            statusCode: res.statusCode,
          }));
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          settleReject(new VaultKeyError(`Auth daemon returned HTTP ${res.statusCode}`, {
            code: 'authd_error',
            statusCode: res.statusCode,
          }));
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(responseData);
        } catch (err) {
          settleReject(new VaultKeyError('Failed to parse auth daemon response as JSON', {
            code: 'authd_error',
            cause: err,
          }));
          return;
        }

        const candidate = typeof parsed === 'string'
          ? parsed
          : (parsed?.[VAULT_ENTRY_NAME] || parsed?.surrogate || parsed?.token);

        if (!candidate || typeof candidate !== 'string') {
          settleReject(new VaultKeyError('No valid surrogate entry found in auth daemon response', 'authd_error'));
          return;
        }

        try {
          const validated = validateSurrogate(candidate);
          settleResolve(validated);
        } catch (err) {
          settleReject(err);
        }
      });

      res.on('error', (err) => {
        settleReject(new VaultKeyError(`Auth daemon stream error: ${err.message}`, {
          code: 'authd_error',
          cause: err,
        }));
      });
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      settleReject(new VaultKeyError(`Auth daemon request timed out after ${timeout} ms`, 'authd_error'));
    });

    req.on('error', (err) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        settleReject(new VaultKeyError(`Auth daemon socket connection failed: ${err.message}`, {
          code: 'unavailable',
          cause: err,
        }));
      } else {
        settleReject(new VaultKeyError(`Auth daemon request failed: ${err.message}`, {
          code: 'authd_error',
          cause: err,
        }));
      }
    });

    req.write(postData);
    req.end();
  });
}
