import {
  credentialsPath,
  SCRIPT_COMMAND,
  EXIT_CODE,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  readStdin,
} from '../lib/cli-input.mjs';

import {
  printUsage,
} from '../lib/help.mjs';

import {
  getStoredCredential,
  requirePlaintextStorageConsent,
  plaintextStorageAllowed,
  saveToken,
  claimStatus,
} from '../lib/auth-state.mjs';

import {
  isOpenClawSentinel,
} from '../lib/openclaw-egress.mjs';

import {
  makeHttpRequest,
  parseJsonResponse,
  apiErrorMessage,
  safeJson,
  sanitizeTerminalText,
} from '../lib/api.mjs';

export async function handleAuthManage(ctx) {
  const { subcommand, options, flags } = ctx;

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
    
    const credentialSource = credential?.storage === 'openclaw-secret'
      ? 'openclaw-secret'
      : credential?.storage === 'vault'
        ? 'muse-vault'
        : credential?.storage === 'environment'
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
      if (typeof token === 'string' && token.startsWith('hsurr:')) {
        console.error('Error: Refusing to store Meta Muse surrogate token. Surrogate tokens are dynamic and managed by Meta Muse.');
        process.exit(EXIT_CODE.USER_ERROR);
      }
      if (isOpenClawSentinel(token)) {
        console.error('Error: Refusing to store OpenClaw sentinel token. Sentinels are dynamic and managed by OpenClaw.');
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
