#!/usr/bin/env node

/**
 * Standalone XMemo Skill Runtime
 * Zero-dependency, self-contained client. Node.js built-ins only.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getStoredToken,
  getStoredCredential,
  bestEffortChmod,
  plaintextStorageAllowed,
  requirePlaintextStorageConsent,
  warnPlaintextStorage,
  saveToken,
  getInstallationFingerprint,
  printMemoryResults,
  requestTemporaryMemoryOperation,
  claimStatus,
} from './lib/auth-state.mjs';

import {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_STATE_TTL_SECONDS,
  DEFAULT_TEMPORARY_LIMITS,
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
  REST_COMMANDS,
  COMMAND_FLAGS,
  AUTH_FLAGS,
  parsePositiveInteger,
  parseIntegerInRange,
  parseJsonObject,
  parseStrictBoolean,
  isLoopbackHostname,
  normalizeBaseUrl,
  credentialsPath,
  registrationPath,
  SCRIPT_COMMAND,
  PLAINTEXT_STORAGE,
} from './lib/core.mjs';

import {
  isStdoutTty,
  rejectBooleanValue,
  readOptionValue,
  parseArgs,
  validateCommandInput,
  readStdin,
  readStdinContent,
  resolveCommandInputs,
} from './lib/cli-input.mjs';

import {
  COMMAND_USAGE_REGISTRY,
  buildTopLevelHelp,
  printUsage,
} from './lib/help.mjs';

import {
  parseJsonResponse,
  extractList,
  extractId,
  apiErrorMessage,
  extractRequestId,
  extractExpiresInSeconds,
  formatRemainingValidity,
  outputRestError,
  handleRestError,
  redactSensitiveResponse,
  safeJson,
  sanitizeTerminalText,
  formatMemoryContent,
  formatDuration,
  makeHttpRequest,
  fetchTemporaryLimits,
} from './lib/api.mjs';

const SKILL_VERSION = '1.1.22';

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


// Command execution dispatcher
async function main() {
  let { command, subcommand, positionals, options, flags } = parseArgs(process.argv.slice(2));

  if (command === 'auth-status') {
    command = 'auth';
    subcommand = 'status';
    positionals = ['auth', 'status', ...positionals.slice(1)];
  }

  if (options.help) {
    printUsage(command);
    process.exit(EXIT_CODE.SUCCESS);
  }

  if (options.version) {
    console.log(SKILL_VERSION);
    process.exit(EXIT_CODE.SUCCESS);
  }

  if (!command) {
    printUsage();
    process.exit(EXIT_CODE.SUCCESS);
  }

  if (!['login', 'register', 'logout', 'auth'].includes(command) && !REST_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(EXIT_CODE.USER_ERROR);
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  options.timeoutMs = parsePositiveInteger(options.timeoutMs, '--timeout-ms', MAX_TIMEOUT_MS);
  validateCommandInput(command, subcommand, positionals, options, flags);
  await resolveCommandInputs(command, flags);

  // 1. LOGIN
  if (command === 'login') {
    try {
      requirePlaintextStorageConsent(options, 'Device login');
      const res = await makeHttpRequest(options.baseUrl, '/v1/auth/device/start', 'POST', {
        client_id: 'xmemo-skill',
        surface: 'standalone_skill',
        token_type: 'skill_token',
        client_version: SKILL_VERSION,
        scopes: ['memory:read', 'memory:write', 'memory:restore', 'ledger:write', 'ledger:read', 'knowledge:read']
      }, {}, options.timeoutMs);
      const data = parseJsonResponse(res, 'Device login start');
      if (res.statusCode !== 200) {
        const reqId = extractRequestId(data);
        const reqSuffix = reqId ? ` (request_id: ${reqId})` : '';
        console.error(`Failed to start device login: ${apiErrorMessage(data, safeJson(data))}${reqSuffix}`);
        process.exit(exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode));
      }
      const verificationUrl = data.verification_uri_complete || data.verification_uri;
      if (!data.device_code || !verificationUrl) {
        console.error('Failed to start device login: the service response omitted the device code or verification URL.');
        process.exit(EXIT_CODE.SERVER_ERROR);
      }
      const expiresInSeconds = extractExpiresInSeconds(data);
      const expiresInMs = Math.max(1, expiresInSeconds * 1000);
      const loginDeadline = Date.now() + expiresInMs;
      const countdownText = formatRemainingValidity(expiresInSeconds);
      console.log(`To verify this device, open the following URL in your browser:\n`);
      console.log(`  ${sanitizeTerminalText(verificationUrl)}\n`);
      console.log(`Or enter the code: ${sanitizeTerminalText(data.user_code)}`);
      console.log(`\nWaiting for authorization... (valid for ${countdownText})`);

      const deviceCode = data.device_code;
      const intervalSeconds = Number(data.interval);
      let pollInterval = Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? Math.max(1, intervalSeconds * 1000)
        : 5000;
      
      const poll = async () => {
        if (Date.now() >= loginDeadline) {
          console.error('Login failed: the device authorization code expired before approval.');
          process.exit(EXIT_CODE.AUTH_ERROR);
        }
        try {
          const pollRes = await makeHttpRequest(options.baseUrl, '/v1/auth/device/token', 'POST', {
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          }, {}, options.timeoutMs);
          const pollData = parseJsonResponse(pollRes, 'Device login polling');
          if (pollData.error) {
            if (pollData.error === 'authorization_pending') {
              setTimeout(poll, Math.min(pollInterval, Math.max(1, loginDeadline - Date.now())));
            } else if (pollData.error === 'slow_down') {
              pollInterval += 5000;
              setTimeout(poll, Math.min(pollInterval, Math.max(1, loginDeadline - Date.now())));
            } else {
              console.error(`Login failed: ${sanitizeTerminalText(pollData.error_description || pollData.error)}`);
              process.exit(EXIT_CODE.AUTH_ERROR);
            }
          } else if (pollData.access_token) {
            try {
              await saveToken(pollData.access_token, { credential_type: 'formal' }, { allowPlaintext: options.allowPlaintext, warn: true });
              console.log(`✅ Authorization successful. Token stored in the explicitly approved user credential file: ${credentialsPath}`);
              console.log('Token value was not printed. Project files were not modified.');
              process.exit(EXIT_CODE.SUCCESS);
            } catch (err) {
              console.error('Failed to save credentials file:', err.message);
              process.exit(EXIT_CODE.USER_ERROR);
            }
          } else {
            console.error('Login failed: the token endpoint returned neither an access token nor a recognized pending status.');
            process.exit(EXIT_CODE.SERVER_ERROR);
          }
        } catch (e) {
          if (Date.now() >= loginDeadline) {
            console.error('Login failed: the device authorization window expired after repeated polling errors.');
            process.exit(EXIT_CODE.AUTH_ERROR);
          }
          console.error('Login polling error:', e.message);
          setTimeout(poll, Math.min(pollInterval, Math.max(1, loginDeadline - Date.now())));
        }
      };
      setTimeout(poll, Math.min(pollInterval, expiresInMs));
    } catch (e) {
      console.error('Login error:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  // 1b. LIMITED NO-ACCOUNT-START REGISTRATION (explicit fallback only)
  if (command === 'register') {
    const reason = flags.reason;
    if (!['unattended', 'declined'].includes(reason)) {
      console.error(`Temporary registration is a conditional fallback. Use "${SCRIPT_COMMAND} register --reason unattended --allow-plaintext" when no human can log in, or "--reason declined --allow-plaintext" after the human explicitly declines formal registration.`);
      process.exit(EXIT_CODE.USER_ERROR);
    }
    try {
      requirePlaintextStorageConsent(options, 'Temporary registration');
    } catch (e) {
      console.error(`Temporary registration refused: ${e.message}`);
      process.exit(EXIT_CODE.USER_ERROR);
    }
    if (await getStoredToken()) {
      console.error(`A credential is already configured. Formal login is the recommended path; use "${SCRIPT_COMMAND} login" to refresh it instead of creating temporary access.`);
      process.exit(EXIT_CODE.USER_ERROR);
    }
    try {
      const limits = await fetchTemporaryLimits(options.baseUrl, options.timeoutMs);
      const installation_fingerprint = await getInstallationFingerprint();
      const res = await makeHttpRequest(options.baseUrl, '/v1/agents/register', 'POST', {
        entry_type: 'skill',
        client_name: 'xmemo-skill',
        client_version: SKILL_VERSION,
        installation_fingerprint,
        runtime: `node ${process.version}`,
        skill_package_id: 'xmemo-memory',
        metadata: { registration_reason: reason },
      }, {}, options.timeoutMs);
      const data = parseJsonResponse(res, 'Temporary registration');
      if (res.statusCode < 200 || res.statusCode >= 300 || !data.temporary_token) {
        const err = new Error(apiErrorMessage(data, safeJson(data)));
        err.statusCode = res.statusCode;
        throw err;
      }
      await saveToken(data.temporary_token, {
        credential_type: 'temporary',
        agent_id: data.agent_id,
        bind_url: data.bind_url,
        registration_reason: reason,
      }, { allowPlaintext: options.allowPlaintext, warn: true });
      if (options.json) {
        console.log(safeJson({ agent_id: data.agent_id, bind_url: data.bind_url, status: data.status, limits }));
      } else {
        console.log(`✅ Temporary XMemo memory enabled for this installation.\nThis is a limited sandbox, not a formal account.\nTemporary limits: up to ${limits.max_items} items; expires after ${formatDuration(limits.ttl_seconds)} without successful memory activity; maximum ${formatDuration(limits.max_lifetime_seconds)} from registration.\nComplete formal registration (recommended): ${sanitizeTerminalText(data.bind_url)}\nDo not share this bind URL publicly. After the human claim, run "${SCRIPT_COMMAND} auth claim-confirm" to accept the formal credential.`);
      }
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Temporary registration failed:', e.message);
      process.exit(exitCodeForError(e));
    }
  }

  // 2. LOGOUT
  if (command === 'logout') {
    const credential = await getStoredCredential();
    const token = credential?.token;
    if (!token) {
      console.log('No active login found.');
      process.exit(EXIT_CODE.SUCCESS);
    }

    if (credential.storage === 'environment' && !options.revokeEnvironmentToken) {
      const result = {
        status: 'environment_credential_unchanged',
        credential_source: 'XMEMO_KEY',
        remote_revoked: false,
        local_file_removed: false,
      };
      if (options.json) {
        console.log(safeJson(result));
      } else {
        console.log('XMEMO_KEY is externally managed. No token was revoked and no local credential file was changed.');
        console.log('Unset XMEMO_KEY in the launching environment to log out, or pass --revoke-environment-token to explicitly revoke that token.');
      }
      process.exit(EXIT_CODE.SUCCESS);
    }

    let remoteRevoked = false;
    let revokeError = null;
    try {
      const revokeRes = await makeHttpRequest(options.baseUrl, '/v1/auth/token/revoke-self', 'POST', {}, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
      remoteRevoked = revokeRes.statusCode >= 200 && revokeRes.statusCode < 300;
      if (!remoteRevoked) revokeError = `HTTP ${revokeRes.statusCode}`;
    } catch (error) {
      revokeError = sanitizeTerminalText(error.message);
    }

    let localFileRemoved = false;
    if (credential.storage !== 'environment') {
      try {
        await fs.unlink(credentialsPath);
        localFileRemoved = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    const result = {
      status: remoteRevoked ? 'logged_out' : 'local_logout_completed',
      credential_source: credential.storage === 'environment' ? 'XMEMO_KEY' : 'user-credential-file',
      remote_revoked: remoteRevoked,
      local_file_removed: localFileRemoved,
      ...(revokeError ? { remote_revoke_error: revokeError } : {}),
    };
    if (options.json) {
      console.log(safeJson(result));
    } else if (credential.storage === 'environment') {
      console.log(remoteRevoked
        ? '✅ The externally managed XMEMO_KEY token was explicitly revoked. Unset XMEMO_KEY in the launching environment.'
        : `The XMEMO_KEY token could not be revoked (${revokeError}). It remains externally managed.`);
    } else if (remoteRevoked) {
      console.log('✅ Logged out successfully. The remote token was revoked and the local credential file was removed.');
    } else {
      console.log(`Local credential file removed. Remote revocation could not be confirmed${revokeError ? ` (${revokeError})` : ''}.`);
    }
    process.exit(EXIT_CODE.SUCCESS);
  }

  // 3. AUTH (status / add)
  if (command === 'auth') {
    if (subcommand === 'status') {
      const credential = await getStoredCredential();
      const token = credential?.token;
      if (!token) {
        if (options.json) {
          console.log(JSON.stringify({ status: 'logged_out' }));
        } else {
          console.log('Status: Logged out.');
        }
        process.exit(EXIT_CODE.SUCCESS);
      }
      
      const credentialSource = credential?.storage === 'environment'
        ? 'XMEMO_KEY'
        : credential?.credential_type === 'temporary'
          ? 'temporary-user-credential-file'
          : 'formal-user-credential-file';
      if (options.verify) {
        try {
          const res = await makeHttpRequest(options.baseUrl, '/v1/auth/token/validate', 'GET', null, {
            'Authorization': `Bearer ${token}`
          }, options.timeoutMs);
          const data = parseJsonResponse(res, 'Token verification');
          if (res.statusCode === 200) {
            if (options.json) {
              console.log(safeJson({ status: 'valid', credential_source: credentialSource, scopes: data.scopes, setup_state: data.setup_state }));
            } else {
              const scopes = Array.isArray(data.scopes) ? data.scopes : [];
              console.log(`Status: Logged in (verified)\nCredential Source: ${credentialSource}\nScopes: ${scopes.join(', ')}`);
            }
          } else {
            if (options.json) {
              console.log(safeJson({ status: 'invalid', credential_source: credentialSource }));
            } else {
              console.error(`Status: Invalid or expired token.${data ? ` ${apiErrorMessage(data, '')}` : ''}`);
            }
            const exitCode = res.statusCode >= 500 ? EXIT_CODE.SERVER_ERROR : EXIT_CODE.AUTH_ERROR;
            process.exit(exitCode);
          }
        } catch (e) {
          console.error('Verification error:', e.message);
          process.exit(exitCodeForError(e));
        }
      } else {
        if (options.json) {
          console.log(safeJson({ status: 'logged_in', credential_source: credentialSource }));
        } else {
          const kind = credential?.credential_type === 'temporary' ? 'Temporary access' : 'Logged in';
          console.log(`Status: ${kind}\nCredential Source: ${credentialSource}`);
        }
      }
      process.exit(EXIT_CODE.SUCCESS);
    }
    
    if (subcommand === 'add') {
      if (flags['from-stdin'] !== undefined || process.argv.includes('--from-stdin')) {
        try {
          requirePlaintextStorageConsent(options, 'auth add');
        } catch (e) {
          console.error(`Credential storage refused: ${e.message}`);
          process.exit(EXIT_CODE.USER_ERROR);
        }
        const token = await readStdin();
        if (!token) {
          console.error('Error: Stdin did not provide a token.');
          process.exit(EXIT_CODE.USER_ERROR);
        }
        try {
          await saveToken(token, { credential_type: 'formal' }, { allowPlaintext: options.allowPlaintext, warn: true });
          console.log(`✅ Credential stored in the explicitly approved user credential file: ${credentialsPath}`);
          console.log('Token value was not printed. Project files were not modified.');
          process.exit(EXIT_CODE.SUCCESS);
        } catch (err) {
          console.error('Failed to save credentials file:', err.message);
          process.exit(EXIT_CODE.USER_ERROR);
        }
      } else {
        console.error(`Error: Run "${SCRIPT_COMMAND} auth add --from-stdin --allow-plaintext" to supply and explicitly store a token.`);
        process.exit(EXIT_CODE.USER_ERROR);
      }
    }

    if (subcommand === 'claim-status' || subcommand === 'claim-confirm' || subcommand === 'claim-deny') {
      const credential = await getStoredCredential();
      if (!credential?.token || credential.credential_type !== 'temporary') {
        console.error('Error: Claim commands require a locally stored temporary credential from "register".');
        process.exit(EXIT_CODE.USER_ERROR);
      }
      try {
        if (subcommand === 'claim-deny') {
          const denyRes = await makeHttpRequest(options.baseUrl, '/v1/agents/bind/deny-current-user', 'POST', {}, {
            Authorization: `Bearer ${credential.token}`,
          }, options.timeoutMs);
          const denyData = parseJsonResponse(denyRes, 'Claim denial');
          if (denyRes.statusCode < 200 || denyRes.statusCode >= 300) {
            const err = new Error(apiErrorMessage(denyData, safeJson(denyData)));
            err.statusCode = denyRes.statusCode;
            throw err;
          }
          const allowPlaintext = plaintextStorageAllowed(options, credential);
          await saveToken(credential.token, {
            credential_type: 'temporary',
            agent_id: credential.agent_id,
            bind_url: credential.bind_url,
            registration_reason: credential.registration_reason,
          }, { allowPlaintext, warn: options.allowPlaintext && !credential.plaintext_storage_consent });
          if (options.json) {
            console.log(safeJson(denyData));
          } else {
            console.log('Pending account binding declined. The credential remains limited to isolated temporary memory; formal account login is still recommended.');
          }
          process.exit(EXIT_CODE.SUCCESS);
        }
        const status = await claimStatus(options.baseUrl, credential, options);
        if (subcommand === 'claim-confirm' && !status.formal_token) {
          const confirmation_token = status.confirmation_token || credential.pending_confirmation_token;
          if (!confirmation_token) {
            console.error(`No pending human claim confirmation is available. Current status: ${sanitizeTerminalText(status.status || 'unknown')}. Open the stored bind URL first: ${sanitizeTerminalText(credential.bind_url || '(unavailable)')}`);
            process.exit(EXIT_CODE.USER_ERROR);
          }
          const confirmRes = await makeHttpRequest(options.baseUrl, '/v1/agents/bind/confirm-current-user', 'POST', { confirmation_token }, {
            Authorization: `Bearer ${credential.token}`,
          }, options.timeoutMs);
          const confirmData = parseJsonResponse(confirmRes, 'Claim confirmation');
          if (confirmRes.statusCode < 200 || confirmRes.statusCode >= 300) {
            const err = new Error(apiErrorMessage(confirmData, safeJson(confirmData)));
            err.statusCode = confirmRes.statusCode;
            throw err;
          }
          if (credential.pending_confirmation_token) {
            const allowPlaintext = plaintextStorageAllowed(options, credential);
            await saveToken(credential.token, {
              credential_type: 'temporary',
              agent_id: credential.agent_id,
              bind_url: credential.bind_url,
              registration_reason: credential.registration_reason,
            }, { allowPlaintext, warn: options.allowPlaintext && !credential.plaintext_storage_consent });
          }
          await claimStatus(options.baseUrl, credential, options);
        }
        process.exit(EXIT_CODE.SUCCESS);
      } catch (e) {
        console.error('Claim flow failed:', e.message);
        process.exit(exitCodeForError(e));
      }
    }
    
    console.error(`Unknown auth subcommand: ${subcommand || '(missing)'}`);
    printUsage('auth');
    process.exit(EXIT_CODE.USER_ERROR);
  }

  // 4. REST OPERATIONS (memory, state, restart continuity, TODO, ledger, and diagnostics)
  const credential = command === 'doctor' && options.anonymous ? null : await getStoredCredential();
  const token = credential?.token;
  
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
    return;
  }

  if (!token) {
    console.error(`Error: No XMemo credential found. Preferred: set XMEMO_KEY. For formal account login with explicit local storage consent, run "${SCRIPT_COMMAND} login --allow-plaintext". For a limited temporary sandbox only when permitted, run "${SCRIPT_COMMAND} register --reason unattended|declined --allow-plaintext".`);
    process.exit(EXIT_CODE.AUTH_ERROR);
  }

  if (credential?.credential_type === 'temporary') {
    if (['remember', 'recall', 'search'].includes(command)) {
      try {
        await requestTemporaryMemoryOperation(command, options, flags, credential);
      } catch (e) {
        console.error('Temporary memory request failed:', e.message);
        process.exit(exitCodeForError(e));
      }
      return;
    }
    console.error(`Temporary access supports only remember, recall, and search in its isolated sandbox. Complete formal registration at ${sanitizeTerminalText(credential.bind_url || 'the bind URL shown at registration')} to use ${command}.`);
    process.exit(EXIT_CODE.USER_ERROR);
  }

  if (command === 'restart-snapshot' || command === 'restart-restore') {
    const endpoint = command === 'restart-snapshot' ? '/v1/restart/snapshot' : '/v1/restart/restore';
    const label = command === 'restart-snapshot' ? 'Restart snapshot' : 'Restart restore';
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', flags, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
      const data = parseJsonResponse(res, `${label} request`);
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      if (options.json) {
        if (succeeded) {
          const payload = (data && typeof data === 'object') ? data : { result: data };
          console.log(safeJson({
            ok: true,
            ...payload,
          }));
          process.exit(EXIT_CODE.SUCCESS);
        }
        console.log(safeJson(data));
        const failCode = exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode);
        process.exit(failCode);
      }
      if (!succeeded) {
        const reqId = extractRequestId(data);
        const reqSuffix = reqId ? ` (request_id: ${reqId})` : '';
        console.error(`${label} failed: ${apiErrorMessage(data)} (HTTP ${res.statusCode})${reqSuffix}`);
        process.exit(exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode));
      }
      if (command === 'restart-snapshot') {
        console.log(`✅ Restart snapshot saved.\nID: ${sanitizeTerminalText(extractId(data))}${data.expires_at ? `\nExpires: ${sanitizeTerminalText(data.expires_at)}` : ''}`);
      } else {
        const isNotRestored = data.restored === false || data.status === 'not_found' || (!extractId(data) && !data.restored_at);
        if (isNotRestored) {
          console.log('ℹ️ No active restart snapshot found to restore.');
        } else {
          console.log(`✅ Restart snapshot restored.\nID: ${sanitizeTerminalText(extractId(data))}${data.restored_at ? `\nRestored: ${sanitizeTerminalText(data.restored_at)}` : ''}`);
        }
      }
    } catch (e) {
      console.error(`${label} failed:`, e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'recall-context') {
    const body = {
      query: flags.query,
      path: flags.path || '%',
      bucket: flags.bucket || '%',
      scope: flags.scope,
      team_id: flags.team_id,
      memory_type: flags.memory_type || 'auto',
      status: flags.status || 'active',
      threshold: flags.threshold === undefined ? undefined : Number(flags.threshold),
      max_items: flags.max_items,
      max_tokens: flags.max_tokens,
      limit: flags.limit,
      prefer_working: flags.prefer_working === undefined ? true : flags.prefer_working,
      include_knowledge: flags.include_knowledge,
    };
    Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/recall/context', 'POST', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
      const data = parseJsonResponse(res, 'Recall context request');
      const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
      if (options.json) {
        console.log(safeJson(data));
        const failCode = exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode);
        process.exit(succeeded ? EXIT_CODE.SUCCESS : failCode);
      }
      if (!succeeded) {
        const reqId = extractRequestId(data);
        const reqSuffix = reqId ? ` (request_id: ${reqId})` : '';
        console.error(`Error: ${apiErrorMessage(data)} (Code: ${data.error?.code || `HTTP ${res.statusCode}`})${reqSuffix}`);
        process.exit(exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode));
      }
      const items = Array.isArray(data.items) ? data.items.length : 0;
      const contextText = sanitizeTerminalText(data.context_text || '');
      console.log(`XMemo Context: ${items} item${items === 1 ? '' : 's'}\n${contextText || 'No matching memories found.'}`);
    } catch (e) {
      console.error('Recall context failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'read') {
    let endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/explain?include_embedding=false`;
    const queryParams = [];
    if (flags.bucket) queryParams.push(`bucket=${encodeURIComponent(flags.bucket)}`);
    if (flags.scope) queryParams.push(`scope=${encodeURIComponent(flags.scope)}`);
    if (queryParams.length > 0) {
      endpoint += `&${queryParams.join('&')}`;
    }
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found.`,
        context: 'Read memory request',
        options,
      });

      const record = (data && typeof data === 'object' && data.result && typeof data.result === 'object')
        ? data.result
        : (data && typeof data === 'object' && data.memory && typeof data.memory === 'object')
          ? data.memory
          : data;

      if (record && record.status && String(record.status).toLowerCase() === 'deleted') {
        outputRestError('not_found', `Memory '${flags.id}' not found or deleted.`, options);
      }

      if (!record || typeof record.content !== 'string') {
        outputRestError('not_found', `Memory '${flags.id}' not found.`, options);
      }

      const fullContent = record.content;
      const totalLength = fullContent.length;
      const offset = flags.offset !== undefined ? Number(flags.offset) : 0;
      const hasLimit = flags.limit !== undefined && flags.limit !== null;
      const limit = hasLimit ? Number(flags.limit) : totalLength;
      const slicedContent = fullContent.slice(offset, offset + limit);
      const truncated = offset > 0 || (offset + slicedContent.length < totalLength);

      const projected = {
        id: record.id || record.memory_id || flags.id,
        path: record.path || record.canonical_path || '',
        content: slicedContent,
        version: record.version || record.updated_at || record.created_at || null,
        truncated,
      };

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...projected,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(`Memory: ${sanitizeTerminalText(projected.id)} | Path: ${sanitizeTerminalText(projected.path || '(unknown)')} | Version: ${sanitizeTerminalText(projected.version || '(unknown)')}${projected.truncated ? ' [truncated]' : ''}`);
      console.log(`Content: ${formatMemoryContent(projected.content, options.compact)}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Read memory failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'update') {
    let endpoint = `/v1/memories/${encodeURIComponent(flags.id)}`;
    const body = {};
    if (flags.content !== undefined) body.content = flags.content;
    if (flags.path !== undefined) body.path = flags.path;
    if (flags.metadata !== undefined) body.metadata = flags.metadata;
    if (flags.bucket !== undefined) body.bucket = flags.bucket;
    if (flags.scope !== undefined) body.scope = flags.scope;

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'PATCH', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      if (res.statusCode === 400) {
        let errData = null;
        try { errData = parseJsonResponse(res, 'Update memory request'); } catch {}
        const code = errData?.error?.code || 'invalid_request';
        const fallbackMsg = code === 'invalid_memory_id'
          ? `Invalid memory ID: '${flags.id}'.`
          : 'Invalid update request.';
        const msg = apiErrorMessage(errData, fallbackMsg);
        outputRestError(code, msg, options, errData, EXIT_CODE.USER_ERROR);
      }

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found.`,
        context: 'Update memory request',
        options,
      });

      const record = (data && typeof data === 'object' && data.result && typeof data.result === 'object')
        ? data.result
        : (data && typeof data === 'object' && data.memory && typeof data.memory === 'object')
          ? data.memory
          : data;

      const memoryId = record?.id || record?.memory_id || flags.id;
      if (options.json) {
        console.log(safeJson({
          ok: true,
          id: memoryId,
          path: record?.path || flags.path || '',
          updated: true,
          ...(typeof record === 'object' ? record : {}),
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(`✅ Memory updated.\nID: ${sanitizeTerminalText(memoryId)}${flags.path ? `\nPath: ${sanitizeTerminalText(flags.path)}` : ''}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Update memory failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'forget') {
    if (!flags.confirm) {
      const msg = `Confirmation required to forget memory or ledger record '${flags.id}'. Pass --confirm to proceed.`;
      if (options.json) {
        console.log(safeJson({ ok: false, error: { code: 'confirmation_required', message: msg, target_id: flags.id } }));
      } else {
        console.error(`Error: ${msg}\nTarget: ${sanitizeTerminalText(flags.id)}`);
      }
      process.exit(EXIT_CODE.USER_ERROR);
    }

    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/forget`;
    const body = {
      mode: 'soft_delete',
    };
    if (flags.reason !== undefined && String(flags.reason).trim() !== '') {
      body.reason = String(flags.reason);
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: `Record '${flags.id}' not found.`,
        context: 'Forget request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          id: flags.id,
          mode: 'soft_delete',
          forgotten: true,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(`✅ Record forgotten (soft-deleted).\nID: ${sanitizeTerminalText(flags.id)}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Forget failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'ledger-list') {
    let dateFrom = flags.from;
    let dateTo = flags.to;
    if (flags.month) {
      const [y, m] = flags.month.split('-').map(Number);
      const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (!dateFrom) dateFrom = `${flags.month}-01`;
      if (!dateTo) dateTo = `${flags.month}-${String(lastDayNum).padStart(2, '0')}`;
    }

    const args = {};
    if (flags.limit !== undefined) {
      const parsed = Number(flags.limit);
      args.limit = Number.isInteger(parsed) ? parsed : flags.limit;
    }
    if (flags.offset !== undefined) {
      const parsed = Number(flags.offset);
      args.offset = Number.isInteger(parsed) ? parsed : flags.offset;
    }
    if (flags.currency) args.currency = String(flags.currency);
    if (dateFrom) args.date_from = String(dateFrom);
    if (dateTo) args.date_to = String(dateTo);
    if (flags.category) args.category = String(flags.category);
    if (flags['min-amount'] !== undefined) {
      const parsed = Number(flags['min-amount']);
      args.min_amount = !isNaN(parsed) ? parsed : flags['min-amount'];
    }
    if (flags['max-amount'] !== undefined) {
      const parsed = Number(flags['max-amount']);
      args.max_amount = !isNaN(parsed) ? parsed : flags['max-amount'];
    }
    if (flags.type) args.transaction_type = String(flags.type);

    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'ledger-list',
        arguments: args,
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Ledger transactions not found.',
        context: 'List ledger transactions request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const transactions = Array.isArray(result.transactions)
        ? result.transactions
        : (Array.isArray(result) ? result : []);

      if (transactions.length === 0) {
        console.log('No ledger transactions found.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      const totalInfo = result.total !== undefined ? ` (total: ${result.total})` : '';
      console.log(`XMemo Ledger Transactions (${transactions.length}${totalInfo}):`);
      transactions.forEach((tx, idx) => {
        const date = tx.transaction_date || tx.date || tx.created_at || '(unknown date)';
        const amount = (tx.amount !== undefined && tx.amount !== null) ? tx.amount : '(unknown)';
        const curr = tx.currency || 'UNKNOWN';
        const type = tx.transaction_type || tx.type || 'expense';
        const cat = tx.category ? ` [${tx.category}]` : '';
        const desc = tx.description || tx.item || tx.note || '';
        console.log(`[${idx + 1}] ${sanitizeTerminalText(date)} | ${type.toUpperCase()} | ${amount} ${curr}${sanitizeTerminalText(cat)}${desc ? ` | ${sanitizeTerminalText(desc)}` : ''}`);
      });
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('List ledger transactions failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'ledger-summary') {
    const args = {};
    if (flags.months !== undefined) {
      const parsed = Number(flags.months);
      args.months = Number.isInteger(parsed) ? parsed : flags.months;
    }
    if (flags.currency) args.currency = String(flags.currency);
    if (flags.type) args.transaction_type = String(flags.type);

    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'ledger-summary',
        arguments: args,
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Ledger monthly summary not found.',
        context: 'Get ledger monthly summary request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const summaryList = Array.isArray(result.summary) ? result.summary : [];
      if (summaryList.length === 0 && result.total === undefined && result.count === undefined) {
        console.log('No ledger monthly summary available.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      if (summaryList.length > 0) {
        console.log(`XMemo Ledger Monthly Summary (${summaryList.length} month${summaryList.length === 1 ? '' : 's'}):`);
        summaryList.forEach((item) => {
          const month = item.month || '(unknown month)';
          const curr = item.currency || 'UNKNOWN';
          const expense = item.expense_total !== undefined ? `${item.expense_total} ${curr}` : null;
          const income = item.income_total !== undefined ? `${item.income_total} ${curr}` : null;
          const net = item.net_total !== undefined ? `${item.net_total} ${curr}` : null;
          const count = item.transaction_count !== undefined ? `${item.transaction_count} tx` : '';
          const parts = [];
          if (expense !== null) parts.push(`Expense: ${expense}`);
          if (income !== null) parts.push(`Income: ${income}`);
          if (net !== null) parts.push(`Net: ${net}`);
          if (count) parts.push(count);
          console.log(`- ${month} (${curr}): ${parts.join(' | ')}`);
        });
        process.exit(EXIT_CODE.SUCCESS);
      }

      const month = result.month || '(unknown month)';
      const curr = result.currency || 'UNKNOWN';
      const total = result.total !== undefined ? result.total : 0;
      const count = result.count !== undefined ? result.count : 0;
      console.log(`XMemo ledger summary for ${sanitizeTerminalText(month)}: ${total} ${curr} across ${count} transaction${count === 1 ? '' : 's'}.`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get ledger monthly summary failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'overview') {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'overview',
        arguments: {},
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Account overview not found.',
        context: 'Get overview request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log('XMemo Account Overview:');
      console.log(`- Memories: ${result.memories_total ?? 0} total (${result.memories_active ?? 0} active, ${result.memories_archived ?? 0} archived, ${result.memories_forgotten ?? 0} forgotten)`);
      console.log(`- Active Agents: ${result.agents_active ?? 0}`);
      console.log(`- Storage: ${result.storage_mb ?? 0} MB`);
      console.log(`- Tokens (30d): ${result.tokens_30d ?? 0}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get overview failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'activity') {
    const args = {};
    if (flags.limit !== undefined) {
      const parsed = Number(flags.limit);
      args.limit = Number.isInteger(parsed) ? parsed : flags.limit;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'activity',
        arguments: args,
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Account activity not found.',
        context: 'Get activity request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const activityList = Array.isArray(result.activity) ? result.activity : [];
      if (activityList.length === 0) {
        console.log('No recent activity found.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      const totalInfo = result.total !== undefined ? ` (total: ${result.total})` : '';
      console.log(`XMemo Recent Activity (${activityList.length}${totalInfo}):`);
      activityList.forEach((item, idx) => {
        const ts = item.ts || '(unknown date)';
        const type = item.type || 'unknown';
        const summary = item.summary || '';
        const ref = item.ref_id ? ` [ref: ${item.ref_id}]` : '';
        console.log(`[${idx + 1}] ${sanitizeTerminalText(ts)} | ${type.toUpperCase()} | ${sanitizeTerminalText(summary)}${ref}`);
      });
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get activity failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
  }

  if (command === 'stats') {
    const scope = flags.scope;
    const path = flags.path;
    const bucket = flags.bucket;
    const memoryType = flags['memory-type'] !== undefined ? flags['memory-type'] : flags.memory_type;
    const status = flags.status;
    const source = flags.source;
    const since = flags.since;
    const until = flags.until;
    const groupBy = flags['group-by'] !== undefined ? flags['group-by'] : flags.group_by;
    const topN = flags['top-n'] !== undefined ? flags['top-n'] : flags.top_n;
    const teamId = flags['team-id'] !== undefined ? flags['team-id'] : flags.team_id;

    const queryParams = [];
    if (scope) queryParams.push(`scope=${encodeURIComponent(scope)}`);
    if (path) queryParams.push(`path=${encodeURIComponent(path)}`);
    if (bucket) queryParams.push(`bucket=${encodeURIComponent(bucket)}`);
    if (memoryType) queryParams.push(`memory_type=${encodeURIComponent(memoryType)}`);
    if (status) queryParams.push(`status=${encodeURIComponent(status)}`);
    if (source) queryParams.push(`source=${encodeURIComponent(source)}`);
    if (since) queryParams.push(`since=${encodeURIComponent(since)}`);
    if (until) queryParams.push(`until=${encodeURIComponent(until)}`);
    if (groupBy) queryParams.push(`group_by=${encodeURIComponent(groupBy)}`);
    if (topN !== undefined) queryParams.push(`top_n=${encodeURIComponent(topN)}`);
    if (teamId) queryParams.push(`team_id=${encodeURIComponent(teamId)}`);

    let endpoint = '/v1/memories/stats';
    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Memory stats not found.',
        context: 'Get memory stats request',
        options,
      });

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...data,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      if ((data.total_count ?? 0) === 0 && (data.filtered_count ?? 0) === 0) {
        console.log('No memory statistics available.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log('XMemo Memory Statistics:');
      console.log(`- Total Memories: ${data.total_count ?? 0} (filtered: ${data.filtered_count ?? 0}, scanned: ${data.scanned_count ?? 0})`);
      if (data.latest_at) console.log(`- Latest Memory: ${data.latest_at}`);
      if (data.oldest_at) console.log(`- Oldest Memory: ${data.oldest_at}`);
      if (data.type_counts && Object.keys(data.type_counts).length > 0) {
        const counts = Object.entries(data.type_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Types: ${counts}`);
      }
      if (data.status_counts && Object.keys(data.status_counts).length > 0) {
        const counts = Object.entries(data.status_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Status: ${counts}`);
      }
      if (data.bucket_counts && Object.keys(data.bucket_counts).length > 0) {
        const counts = Object.entries(data.bucket_counts).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`- Buckets: ${counts}`);
      }
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        console.log(`- Groups (${data.groups.length}):`);
        data.groups.forEach((g) => {
          const dims = g.group_by ? Object.entries(g.group_by).map(([k, v]) => `${k}=${v}`).join(', ') : '';
          console.log(`  * [${dims}]: ${g.count}`);
        });
      }
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get memory stats failed:', e.message);
      process.exit(exitCodeForError(e));
    }
    return;
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
    } else if (opName === 'recall' || opName === 'search') {
      const results = extractList(data.result);
      if (results.length === 0) {
        console.log('No matching memories found.');
      } else {
        results.forEach((item, index) => {
          console.log(`[${index + 1}] ID: ${sanitizeTerminalText(item?.id || item?.memory_id || '(unknown)')} | Path: ${sanitizeTerminalText(item?.path || '(unknown)')}`);
          console.log(`Content: ${formatMemoryContent(item?.content, options.compact)}`);
          console.log(`---`);
        });
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
    } else if (opName === 'remember') {
      console.log(`✅ Saved to XMemo.\nID: ${sanitizeTerminalText(extractId(data.result))}`);
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
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(exitCodeForError(e));
  }
}

export {
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
  formatRemainingValidity,
  extractRequestId,
  extractExpiresInSeconds,
  isStdoutTty,
  COMMAND_USAGE_REGISTRY,
  buildTopLevelHelp,
  parseArgs,
  readStdinContent,
  resolveCommandInputs,
};

const isDirectExecution = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Error: ${sanitizeTerminalText(error?.message || error)}`);
    process.exit(exitCodeForError(error));
  });
}
