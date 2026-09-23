import fs from 'node:fs/promises';

import {
  credentialsPath,
  SCRIPT_COMMAND,
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  requirePlaintextStorageConsent,
  saveToken,
  getStoredToken,
  getStoredCredential,
  getInstallationFingerprint,
} from '../lib/auth-state.mjs';

import {
  makeHttpRequest,
  parseJsonResponse,
  extractRequestId,
  apiErrorMessage,
  safeJson,
  extractExpiresInSeconds,
  formatRemainingValidity,
  sanitizeTerminalText,
  formatDuration,
  fetchTemporaryLimits,
} from '../lib/api.mjs';

export async function handleAuthLogin(ctx) {
  const { command, options, flags } = ctx;
  const skillVersion = ctx.skillVersion || '1.1.22';

  // 1. LOGIN
  if (command === 'login') {
    try {
      requirePlaintextStorageConsent(options, 'Device login');
      const res = await makeHttpRequest(options.baseUrl, '/v1/auth/device/start', 'POST', {
        client_id: 'xmemo-skill',
        surface: 'standalone_skill',
        token_type: 'skill_token',
        client_version: skillVersion,
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
        client_version: skillVersion,
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
}
