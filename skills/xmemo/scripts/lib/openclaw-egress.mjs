import { DEFAULT_BASE_URL, EXIT_CODE } from './core.mjs';
import { isSurrogateToken, assertSurrogateOrigin } from './muse-vault.mjs';

export const OPENCLAW_SENTINEL_REGEX = /^oc-sent-v2\.[A-Za-z0-9_-]+\.end$/;
export const ALLOWED_EGRESS_ORIGIN = new URL(DEFAULT_BASE_URL).origin;

export function isOpenClawSentinel(value) {
  return typeof value === 'string' && OPENCLAW_SENTINEL_REGEX.test(value);
}

export function looksLikeOpenClawSentinel(value) {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('oc-sent-');
}

export function isProxyEnvActive(env = process.env) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  const nodeProxy = env.NODE_USE_ENV_PROXY;
  const isNodeProxyTruthy = Boolean(
    nodeProxy && nodeProxy !== '0' && String(nodeProxy).toLowerCase() !== 'false'
  );
  return Boolean(proxy && isNodeProxyTruthy);
}

export function sanitizeSensitiveValue(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('hsurr:') || looksLikeOpenClawSentinel(value)) return '[REDACTED]';
  let sanitized = value;
  if (sanitized.includes('hsurr:')) {
    sanitized = sanitized.replace(/hsurr:[^\s"'>]+/g, '[REDACTED]');
  }
  if (/oc-sent-[A-Za-z0-9._-]+/i.test(sanitized)) {
    sanitized = sanitized.replace(/oc-sent-[A-Za-z0-9._-]+/gi, '[REDACTED]');
  }
  return sanitized;
}

export function assertOpenClawEgress(token, targetUrl, env = process.env) {
  if (!isOpenClawSentinel(token)) return;

  if (!isProxyEnvActive(env)) {
    const error = new Error(
      'OpenClaw egress proxy is required when using OpenClaw secrets. Enable secrets.egressProxy.enabled and ensure execution runs in Gateway-hosted exec (HTTPS_PROXY and NODE_USE_ENV_PROXY=1 must be set).'
    );
    error.exitCode = EXIT_CODE.USER_ERROR;
    throw error;
  }

  const urlObj = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;
  if (urlObj.origin !== ALLOWED_EGRESS_ORIGIN) {
    const error = new Error(
      `OpenClaw secret sentinels are restricted to ${ALLOWED_EGRESS_ORIGIN} and cannot be sent to ${urlObj.origin}. Unset XMEMO_BASE_URL or use a standard credential.`
    );
    error.exitCode = EXIT_CODE.USER_ERROR;
    throw error;
  }
}

export function assertEgressSecurity(authHeader, targetUrl, env = process.env) {
  if (!authHeader || typeof authHeader !== 'string') return;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) return;
  const token = match[1];

  if (isSurrogateToken(token)) {
    assertSurrogateOrigin(authHeader, targetUrl);
  } else if (looksLikeOpenClawSentinel(token)) {
    if (!isOpenClawSentinel(token)) {
      const error = new Error(
        'XMEMO_KEY looks like an OpenClaw secret sentinel in a format this skill version does not support. Update the xmemo skill.'
      );
      error.exitCode = EXIT_CODE.USER_ERROR;
      throw error;
    }
    assertOpenClawEgress(token, targetUrl, env);
  }
}

export function configureEgressRequest(reqOptions, authHeader, targetUrl, env = process.env) {
  assertEgressSecurity(authHeader, targetUrl, env);
}
