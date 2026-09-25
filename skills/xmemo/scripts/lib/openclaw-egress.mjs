import { DEFAULT_BASE_URL, EXIT_CODE } from './core.mjs';
import { safeJson } from './api.mjs';
import { isSurrogateToken, assertSurrogateOrigin } from './muse-vault.mjs';

export const OPENCLAW_SENTINEL_REGEX = /^oc-sent-v2\.[A-Za-z0-9_-]+\.end$/;
export const ALLOWED_EGRESS_ORIGIN = new URL(DEFAULT_BASE_URL).origin;

export function isOpenClawSentinel(value) {
  return typeof value === 'string' && OPENCLAW_SENTINEL_REGEX.test(value);
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
  if (value.startsWith('hsurr:') || isOpenClawSentinel(value)) return '[REDACTED]';
  if (value.includes('oc-sent-v2.') || value.includes('hsurr:')) {
    return value
      .replace(/hsurr:[^\s"'>]+/g, '[REDACTED]')
      .replace(/oc-sent-v2\.[A-Za-z0-9_-]+\.end/g, '[REDACTED]');
  }
  return value;
}

export function assertOpenClawEgress(token, targetUrl, env = process.env) {
  if (!isOpenClawSentinel(token)) return;

  if (!isProxyEnvActive(env)) {
    throw new Error(
      'OpenClaw egress proxy is required when using OpenClaw secrets. Enable secrets.egressProxy.enabled and ensure execution runs in Gateway-hosted exec (HTTPS_PROXY and NODE_USE_ENV_PROXY=1 must be set).'
    );
  }

  const urlObj = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;
  if (urlObj.origin !== ALLOWED_EGRESS_ORIGIN) {
    throw new Error(
      `OpenClaw secret sentinels are restricted to ${ALLOWED_EGRESS_ORIGIN} and cannot be sent to ${urlObj.origin}. Unset XMEMO_BASE_URL or use a standard credential.`
    );
  }
}

export function assertEgressSecurity(authHeader, targetUrl, env = process.env) {
  if (!authHeader || typeof authHeader !== 'string') return;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) return;
  const token = match[1];

  if (isSurrogateToken(token)) {
    assertSurrogateOrigin(authHeader, targetUrl);
  } else if (isOpenClawSentinel(token)) {
    assertOpenClawEgress(token, targetUrl, env);
  }
}

export function configureEgressRequest(reqOptions, authHeader, targetUrl, env = process.env) {
  assertEgressSecurity(authHeader, targetUrl, env);
}

export function handleOpenClawLogout(options) {
  if (options?.revokeEnvironmentToken) {
    console.error('Error: OpenClaw secret sentinels are managed by OpenClaw and cannot be revoked remotely. Use "openclaw secrets delete" or the OpenClaw Control UI to manage secrets.');
    process.exit(EXIT_CODE.USER_ERROR);
  }
  const result = {
    status: 'openclaw_secret_unchanged',
    credential_source: 'openclaw-secret',
    remote_revoked: false,
    local_file_removed: false,
  };
  if (options?.json) {
    console.log(safeJson(result));
  } else {
    console.log('XMemo credential is provided by OpenClaw (openclaw-secret). No remote token was revoked and no local credential file was changed.');
    console.log('To disconnect or rotate, use "openclaw secrets delete" or the OpenClaw Control UI.');
  }
  process.exit(EXIT_CODE.SUCCESS);
}
