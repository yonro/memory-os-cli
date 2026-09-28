import { DEFAULT_DEVICE_LOGIN_SCOPES } from '../network/auth.js';

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
      nextAction: details.nextAction ?? 'Verify service resource status before deciding whether to continue.'
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
      nextAction: details.contractNextAction ?? 'Upgrade server contract and retry; CLI will not fall back to legacy write endpoints.'
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
      nextAction: details.nextAction ?? 'Use the returned resource ID to verify or proceed with next steps.'
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

export function formatErrorDetail(detail) {
  if (detail === undefined || detail === null) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const formatted = detail.map((d) => {
      if (typeof d === 'string') return d;
      if (typeof d === 'object' && d !== null) {
        let loc = '';
        if (Array.isArray(d.loc)) {
          const filtered = d.loc.filter((part) => part !== 'body' || d.loc.length === 1);
          loc = filtered.join('.') || 'body';
        } else if (d.loc) {
          loc = String(d.loc);
        }
        const msg = d.msg ?? d.message ?? JSON.stringify(d);
        return loc ? `${loc}: ${msg}` : msg;
      }
      return String(d);
    });
    return formatted.filter(Boolean).join('; ');
  }
  if (typeof detail === 'object') {
    return detail.message ?? detail.msg ?? detail.error ?? JSON.stringify(detail);
  }
  return String(detail);
}

export function classifyHttpFailure(status, payload) {
  const serviceError = payload?.error;
  const detail = payload?.detail;
  const serviceCode = typeof serviceError === 'object' && !Array.isArray(serviceError)
    ? serviceError.code ?? serviceError.error_code ?? null
    : typeof detail === 'object' && !Array.isArray(detail)
      ? detail.code ?? detail.error_code ?? null
      : typeof payload?.code === 'string' ? payload.code : null;
  const rawMessage = typeof serviceError === 'string'
    ? serviceError
    : serviceError?.message
      ?? (detail !== undefined && detail !== null ? formatErrorDetail(detail) : null)
      ?? payload?.message
      ?? `HTTP ${status}`;
  const message = typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage : `HTTP ${status}`;
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
    nextAction: status === 401 ? 'Log in or re-authenticate and retry.'
      : status === 403 && /knowledge.*scope|scope.*knowledge|knowledge_scope_required/.test(scopeText) ? `xmemo account login --scopes ${DEFAULT_DEVICE_LOGIN_SCOPES.join(',')}`
      : status === 403 && /restore.*scope|scope.*restore|memory:restore|restore_scope_required/.test(scopeText) ? `xmemo account login --scopes ${DEFAULT_DEVICE_LOGIN_SCOPES.join(',')}`
        : status === 403 && /document|memory.*scope|scope.*memory/.test(scopeText) ? 'xmemo account login --scopes knowledge:write,memory:write'
          : status === 403 ? 'Check authorized scopes, account roles, and team workspace.'
          : status === 404 ? 'Check resource ID and service contract.'
            : status === 409 ? 'Reload the latest resource before resubmitting.'
              : status === 429 || status >= 500 ? 'Retry later; write requests will not automatically replay.'
                : 'Correct the request and retry.'
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
