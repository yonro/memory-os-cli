import { hasFlag, optionValue, parseDurationMs, parseIntegerInRange } from '../core/args.js';
import { DEFAULT_SERVICE_URL, TOKEN_ENV_VAR, LEGACY_TOKEN_ENV_VAR, AGENT_ID_ENV_VAR, AGENT_INSTANCE_ENV_VAR } from '../core/constants.js';
import { readStoredCredential, resolveCredentialToken } from '../network/auth.js';
import { baseUrlOption } from '../network/base-url.js';
import { assertServiceOrigin, createServiceClient } from './client.js';
import { ServiceClientError } from './errors.js';

export async function serviceContext(args, io) {
  const baseUrl = assertServiceOrigin(baseUrlOption(args, io.env));
  const environmentToken = io.env[TOKEN_ENV_VAR] || io.env[LEGACY_TOKEN_ENV_VAR] || null;
  const credential = environmentToken ? null : await readStoredCredential(io.env);
  const token = environmentToken ?? credential?.token ?? await resolveCredentialToken(io.env);
  if (!environmentToken && token) {
    const storedOrigin = credential?.metadata?.baseUrl ?? credential?.metadata?.origin;
    if (!storedOrigin) {
      const isDefaultOrigin = new URL(baseUrl).origin === new URL(DEFAULT_SERVICE_URL).origin;
      if (!hasFlag(args, '--allow-legacy-credential') || !isDefaultOrigin) {
        throw new ServiceClientError('Stored credential has no service origin binding.', {
          code: 'CREDENTIAL_ORIGIN_REQUIRED',
          httpStatus: 401,
          nextAction: `Run \`${'xmemo'} login --base-url ${DEFAULT_SERVICE_URL}\` to migrate this credential, or explicitly use --allow-legacy-credential only with the default service.`
        });
      }
    } else {
      let normalizedStoredOrigin;
      try {
        normalizedStoredOrigin = assertServiceOrigin(storedOrigin);
      } catch (error) {
        throw new ServiceClientError('Stored credential has an invalid service origin binding.', {
          code: 'CREDENTIAL_ORIGIN_INVALID',
          httpStatus: 401,
          cause: error,
          nextAction: '重新登录以替换无效的凭据 origin；CLI 不会发送该凭据。'
        });
      }
      if (new URL(normalizedStoredOrigin).origin !== new URL(baseUrl).origin) {
        throw new ServiceClientError('Stored credential is bound to a different service origin.', {
          code: 'CREDENTIAL_ORIGIN_MISMATCH',
          httpStatus: 401,
          nextAction: '登录到目标服务 origin 后再重试；CLI 不会跨 origin 发送凭证。'
        });
      }
    }
  }
  const client = createServiceClient({
    baseUrl,
    token,
    io,
    timeoutMs: parseIntegerInRange(optionValue(args, '--timeout-ms') ?? '15000', '--timeout-ms', { min: 1, max: 2_147_483_647 }),
    agentId: io.env[AGENT_ID_ENV_VAR] ?? 'xmemo-cli',
    agentInstanceId: io.env[AGENT_INSTANCE_ENV_VAR]
  });
  const deadlineMs = optionValue(args, '--deadline') ? parseDurationMs(optionValue(args, '--deadline'), '--deadline') : undefined;
  const deadlineClient = Object.freeze({
    ...client,
    request: (request) => client.request({ ...request, ...(deadlineMs === undefined || request.deadlineMs !== undefined ? {} : { deadlineMs }) })
  });
  return { client: deadlineClient, baseUrl: client.baseUrl, tokenSource: environmentToken ? 'environment' : 'credential-file', signal: io.signal };
}
