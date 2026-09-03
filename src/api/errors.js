export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INTERNAL: 1,
  INPUT: 2,
  UNAUTHENTICATED: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
  SERVICE: 7,
  REMOTE_FAILURE: 8,
  CONFIRMATION_REQUIRED: 10,
  UNKNOWN_OUTCOME: 11,
  PARTIAL: 12,
  LOCAL_TIMEOUT: 124,
  INTERRUPTED: 130
});

export class ServiceClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ServiceClientError';
    this.code = details.code ?? 'SERVICE_ERROR';
    this.httpStatus = details.httpStatus ?? null;
    this.serviceCode = details.serviceCode ?? null;
    this.retryable = details.retryable === true;
    this.outcome = details.outcome ?? 'known-failure';
    this.nextAction = details.nextAction ?? null;
    this.cause = details.cause;
    this.data = details.data;
  }
}

export class UnknownOutcomeError extends ServiceClientError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: details.code ?? 'REQUEST_OUTCOME_UNKNOWN',
      outcome: 'unknown',
      retryable: false,
      nextAction: details.nextAction ?? '核对服务端状态后再决定是否继续。'
    });
    this.name = 'UnknownOutcomeError';
  }
}

export class ContractRequiredError extends ServiceClientError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: 'SERVER_CONTRACT_REQUIRED',
      outcome: 'not-sent',
      retryable: false,
      nextAction: details.contractNextAction ?? '升级服务端契约后重试；CLI 不会回退到旧写接口。'
    });
    this.name = 'ContractRequiredError';
  }
}

export class PartialCompletionError extends ServiceClientError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: details.code ?? 'PARTIAL_COMPLETION',
      outcome: 'partial',
      retryable: false,
      nextAction: details.nextAction ?? '使用返回的资源 ID 继续核对或完成后续步骤。'
    });
    this.name = 'PartialCompletionError';
  }
}

export class InterruptedError extends ServiceClientError {
  constructor(message = 'Local operation interrupted.', details = {}) {
    super(message, {
      ...details,
      code: 'INTERRUPTED',
      outcome: 'known-failure',
      retryable: false,
      nextAction: details.nextAction ?? null
    });
    this.name = 'InterruptedError';
  }
}

export class ConfirmationRequiredError extends ServiceClientError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: 'CONFIRMATION_REQUIRED',
      outcome: 'not-sent',
      retryable: false,
      nextAction: details.nextAction ?? 'Review the operation and rerun with --yes in non-interactive mode.'
    });
    this.name = 'ConfirmationRequiredError';
  }
}

export class PrerequisiteRequiredError extends ServiceClientError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: details.code ?? 'PREREQUISITE_REQUIRED',
      outcome: 'not-sent',
      retryable: false,
      nextAction: details.nextAction ?? null
    });
    this.name = 'PrerequisiteRequiredError';
  }
}

export function classifyHttpFailure(status, payload) {
  const serviceError = payload?.error;
  const detail = payload?.detail;
  const serviceCode = typeof serviceError === 'object'
    ? serviceError.code ?? serviceError.error_code ?? null
    : typeof detail === 'object'
      ? detail.code ?? detail.error_code ?? null
      : typeof payload?.code === 'string' ? payload.code : null;
  const message = typeof serviceError === 'string'
    ? serviceError
    : serviceError?.message
      ?? payload?.detail?.message
      ?? payload?.detail
      ?? payload?.message
      ?? `HTTP ${status}`;
  const scopeText = `${serviceCode ?? ''} ${message}`.toLowerCase();
  const code = status === 401 ? 'AUTH_REQUIRED'
    : status === 403 ? 'PERMISSION_DENIED'
      : status === 404 ? 'NOT_FOUND'
        : status === 409 ? 'CONFLICT'
          : status === 422 ? 'VALIDATION_ERROR'
            : status === 429 ? 'RATE_LIMITED'
              : status >= 500 ? 'SERVICE_UNAVAILABLE'
                : 'SERVICE_ERROR';
  return {
    code,
    message: String(message),
    httpStatus: status,
    serviceCode,
    retryable: status === 408 || status === 425 || status === 429 || status >= 500,
    outcome: 'known-failure',
    nextAction: status === 401 ? '登录或重新授权后重试。'
      : status === 403 && /document|memory.*scope|scope.*memory/.test(scopeText) ? '重新授权：xmemo login --scopes knowledge:write,memory:write。'
        : status === 403 ? '检查授权 scope、账号角色和团队空间。'
        : status === 404 ? '检查资源 ID 与服务契约。'
          : status === 409 ? '重新读取最新资源后再提交。'
            : status === 429 || status >= 500 ? '稍后重试；写入请求不会自动重放。'
              : '修正请求后重试。'
  };
}

export function errorToExitCode(error) {
  if (error?.name === 'UsageError') return EXIT_CODES.INPUT;
  if (error?.code === 'INTERRUPTED') return EXIT_CODES.INTERRUPTED;
  if (error?.code === 'CONFIRMATION_REQUIRED' || error?.code === 'PREREQUISITE_REQUIRED') return EXIT_CODES.CONFIRMATION_REQUIRED;
  if (error?.code === 'LOCAL_WAIT_TIMEOUT') return EXIT_CODES.LOCAL_TIMEOUT;
  if (error instanceof UnknownOutcomeError) return EXIT_CODES.UNKNOWN_OUTCOME;
  if (error instanceof ContractRequiredError) return EXIT_CODES.SERVICE;
  if (error instanceof PartialCompletionError) return EXIT_CODES.PARTIAL;
  if (error instanceof ServiceClientError) {
    if (error.httpStatus === 401) return EXIT_CODES.UNAUTHENTICATED;
    if (error.httpStatus === 403) return EXIT_CODES.FORBIDDEN;
    if (error.httpStatus === 404) return EXIT_CODES.NOT_FOUND;
    if (error.httpStatus === 409) return EXIT_CODES.CONFLICT;
    if (error.code === 'SKILL_EXECUTION_FAILED' || error.code === 'DREAM_RUN_FAILED') return EXIT_CODES.REMOTE_FAILURE;
    if (error.outcome === 'partial') return EXIT_CODES.PARTIAL;
    return EXIT_CODES.SERVICE;
  }
  return EXIT_CODES.INTERNAL;
}

export function errorEnvelope(error, command) {
  return {
    schemaVersion: '1',
    ok: false,
    command,
    data: null,
    meta: { readReceipt: null, warnings: [], nextCursor: null },
    error: {
      code: error?.code ?? (error?.name === 'UsageError' ? 'INPUT_ERROR' : 'INTERNAL_ERROR'),
      message: error?.message ?? 'Unexpected error.',
      httpStatus: error?.httpStatus ?? null,
      serviceCode: error?.serviceCode ?? null,
      retryable: error?.retryable === true,
      outcome: error?.outcome ?? 'known-failure',
      nextAction: error?.nextAction ?? null,
      ...(error?.data ? { data: error.data } : {})
    }
  };
}
