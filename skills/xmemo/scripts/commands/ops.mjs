import {
  SCRIPT_COMMAND,
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  makeHttpRequest,
  parseJsonResponse,
  extractRequestId,
  extractId,
  extractList,
  apiErrorMessage,
  safeJson,
  sanitizeTerminalText,
  formatMemoryContent,
} from '../lib/api.mjs';

function discoveryString(value) {
  if (typeof value !== 'string') return null;
  const sanitized = sanitizeTerminalText(value).trim();
  return sanitized ? sanitized.slice(0, 200) : null;
}

function discoveryStringList(value, maxItems = 24) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map(discoveryString)
    .filter(Boolean)
    .slice(0, maxItems);
}

function summarizeDoctorDiscovery(discovery, discoveryUrl) {
  const standalone = discovery?.standalone_skill ?? discovery?.integrations?.standalone_skill ?? {};
  return {
    status: 'available',
    url: discoveryUrl,
    schemaVersion: discoveryString(discovery?.schema_version),
    protocol: discoveryString(discovery?.protocol),
    service: discoveryString(discovery?.service),
    serviceVersion: discoveryString(discovery?.service_version),
    mcpUrl: discoveryString(discovery?.mcp_url),
    supportedClients: discoveryStringList(discovery?.supported_clients),
    standaloneSkill: {
      status: discoveryString(standalone.status),
      runtimeModel: discoveryString(standalone.runtime_model),
      packageVersion: discoveryString(standalone.package?.version),
      operations: discoveryStringList(standalone.operations),
      defaultScopes: discoveryStringList(standalone.auth?.default_scopes),
    },
  };
}

function discoveryFailureCode(error) {
  const message = String(error?.message ?? '').toLowerCase();
  if (message.includes('timed out')) return 'timeout';
  if (message.includes('non-json')) return 'invalid_response';
  return 'request_failed';
}

async function fetchDoctorDiscovery(baseUrl, timeoutMs) {
  const discoveryUrl = new URL('/.well-known/agent-discovery.json', baseUrl).toString();
  try {
    const res = await makeHttpRequest(baseUrl, '/.well-known/agent-discovery.json', 'GET', null, {}, timeoutMs);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return {
        status: 'unavailable',
        url: discoveryUrl,
        errorCode: 'http_error',
        httpStatus: res.statusCode ?? null,
      };
    }
    return summarizeDoctorDiscovery(parseJsonResponse(res, 'Doctor discovery'), discoveryUrl);
  } catch (error) {
    return {
      status: 'unavailable',
      url: discoveryUrl,
      errorCode: discoveryFailureCode(error),
    };
  }
}

function doctorNextAction({ credential, anonymous }) {
  if (!anonymous && !credential) {
    return {
      command: `${SCRIPT_COMMAND} login --allow-plaintext`,
      reason: 'Sign in before using account-scoped memory operations.',
    };
  }
  return {
    command: `${SCRIPT_COMMAND} auth status --verify`,
    reason: 'Verify the credential separately when an authenticated follow-up is needed.',
  };
}

function withDoctorDiagnostics(data, discovery, nextAction) {
  const report = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...data }
    : { ok: true, result: data };
  return {
    ...report,
    clientDiagnostics: {
      discovery,
      nextAction,
    },
  };
}

export async function handleOps(ctx) {
  const { command, options, flags, credential, token } = ctx;

  // Doctor can be anonymous
  if (command === 'doctor' && !token) {
    try {
      const discovery = options.json
        ? await fetchDoctorDiscovery(options.baseUrl, options.timeoutMs)
        : null;
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'doctor',
        arguments: {}
      }, {}, options.timeoutMs);
      const data = parseJsonResponse(res, 'Doctor health check');
      if (res.statusCode < 200 || res.statusCode >= 300 || data.ok === false) {
        const reqId = extractRequestId(data);
        const reqSuffix = reqId ? ` (request_id: ${reqId})` : '';
        console.error(`Doctor health check failed: ${apiErrorMessage(data, safeJson(data))}${reqSuffix}`);
        process.exit(exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode));
      }
      if (options.json) {
        console.log(safeJson(withDoctorDiagnostics(data, discovery, doctorNextAction({
          credential,
          anonymous: options.anonymous,
        }))));
      } else {
        const authentication = options.anonymous
          ? 'Not checked (anonymous mode)'
          : 'Missing/Unauthenticated';
        const nextStep = options.anonymous
          ? ''
          : `\nNext: ${SCRIPT_COMMAND} login --allow-plaintext`;
        console.log(`XMemo Service Status: OK\nAuthentication: ${authentication}${nextStep}`);
      }
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Doctor health check failed:', e.message);
      process.exit(exitCodeForError(e));
    }
  }

  // Normalize commands for operations mapping
  let opName = command;
  if (command === 'save-state' || command === 'state-save') opName = 'state-save';
  if (command === 'restore-state' || command === 'state-restore') opName = 'state-restore';

  try {
    const discovery = command === 'doctor' && options.json
      ? await fetchDoctorDiscovery(options.baseUrl, options.timeoutMs)
      : null;
    const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
      operation: opName,
      arguments: flags,
    }, {
      'Authorization': `Bearer ${token}`
    }, options.timeoutMs);

    const data = parseJsonResponse(res, `${opName} request`);
    const isDoctorAuthInvalid = opName === 'doctor' && data.result?.auth_valid === false;
    const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false && !isDoctorAuthInvalid;
    if (options.json) {
      const output = opName === 'doctor'
        ? withDoctorDiagnostics(data, discovery, doctorNextAction({ credential, anonymous: false }))
        : data;
      console.log(safeJson(output));
      const failureExitCode = isDoctorAuthInvalid
        ? EXIT_CODE.AUTH_ERROR
        : (exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode));
      process.exit(succeeded ? EXIT_CODE.SUCCESS : failureExitCode);
    }

    if (!succeeded) {
      const reqId = extractRequestId(data);
      const reqSuffix = reqId ? ` (request_id: ${reqId})` : '';
      console.error(`Error: ${apiErrorMessage(data)} (Code: ${data.error?.code || `HTTP ${res.statusCode}`})${reqSuffix}`);
      const failureExitCode = exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode);
      process.exit(failureExitCode);
    }

    if (opName === 'doctor') {
      const isValid = !!data.result?.auth_valid;
      if (isValid) {
        console.log(`XMemo Service Status: OK\nAuthentication: Valid\nScopes: ${extractList(data.result?.scopes).join(', ')}`);
      } else {
        console.log(`XMemo Service Status: OK\nAuthentication: Invalid`);
        process.exit(EXIT_CODE.AUTH_ERROR);
      }
    } else if (opName === 'todo-list') {
      const todos = extractList(data.result);
      if (todos.length === 0) {
        console.log('No TODOs found.');
      } else {
        todos.forEach((todo) => {
          console.log(`- [${todo?.status === 'done' ? 'x' : ' '}] ${sanitizeTerminalText(todo?.content || '')} (ID: ${sanitizeTerminalText(todo?.id || todo?.memory_id || '(unknown)')})`);
        });
      }
    } else if (opName === 'state-restore') {
      const state = data.result;
      if (!state || typeof state !== 'object') {
        console.log('No saved working state found for the requested key.');
      } else {
        const stateKey = state.state_key || flags.key || flags.state_key || '(unknown)';
        const content = state.content === undefined || state.content === null || state.content === ''
          ? '(empty)'
          : state.content;
        console.log(`Working State restored:\nKey: ${sanitizeTerminalText(stateKey)}\nContent: ${formatMemoryContent(content, false)}`);
      }
    } else if (opName === 'expense-add') {
      console.log(`✅ Expense recorded.\nID: ${sanitizeTerminalText(extractId(data.result))}`);
    } else if (opName === 'todo-add') {
      const id = extractId(data.result);
      console.log(`✅ TODO added.${id ? `\nID: ${sanitizeTerminalText(id)}` : ''}`);
    } else if (opName === 'todo-done') {
      const id = flags.id || flags.todo_id || extractId(data.result);
      console.log(`✅ TODO completed.${id ? `\nID: ${sanitizeTerminalText(id)}` : ''}`);
    } else {
      console.log(`✅ Operation succeeded.`);
    }
    process.exit(EXIT_CODE.SUCCESS);
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(exitCodeForError(e));
  }
}
