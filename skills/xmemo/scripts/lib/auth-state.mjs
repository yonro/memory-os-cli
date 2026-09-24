import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  credentialsPath,
  registrationPath,
  PLAINTEXT_STORAGE,
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
} from './core.mjs';

import {
  makeHttpRequest,
  parseJsonResponse,
  extractRequestId,
  apiErrorMessage,
  safeJson,
  sanitizeTerminalText,
  formatMemoryContent,
  extractList,
  extractId,
  warnedCredentialOrigins,
} from './api.mjs';

export { warnedCredentialOrigins };

// Read credential helper
export async function getStoredToken() {
  const credential = await getStoredCredential();
  return credential?.token || null;
}

export async function getStoredCredential() {
  if (process.env.XMEMO_KEY) {
    return { token: process.env.XMEMO_KEY, credential_type: 'environment', storage: 'environment' };
  }
  try {
    const data = await fs.readFile(credentialsPath, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed.token) return null;
    if (parsed.storage !== PLAINTEXT_STORAGE || parsed.plaintext_storage_consent !== true) {
      console.error(`⚠️ Legacy plaintext XMemo credential detected at ${credentialsPath}. Rotate it with XMEMO_KEY, or explicitly recreate it with --allow-plaintext.`);
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function bestEffortChmod(targetPath, mode) {
  try {
    await fs.chmod(targetPath, mode);
  } catch {
    // Some platforms do not implement POSIX permission bits. Never claim this is encryption.
  }
}

export function plaintextStorageAllowed(options, credential = null) {
  return options?.allowPlaintext === true
    || (credential?.storage === PLAINTEXT_STORAGE && credential?.plaintext_storage_consent === true);
}

export function requirePlaintextStorageConsent(options, action) {
  if (options?.allowPlaintext === true) return;
  throw new Error(`${action} needs to persist a token between commands. XMEMO_KEY is preferred and is never copied to disk. To explicitly permit unencrypted storage in ${credentialsPath}, rerun with --allow-plaintext.`);
}

export function warnPlaintextStorage() {
  console.error(`⚠️ Plaintext credential storage explicitly enabled. The token will be stored unencrypted at ${credentialsPath} and may be read by processes running as your OS user. Prefer XMEMO_KEY or a managed secret store; never share or commit this file.`);
}

// Save credential helper. Every caller must prove explicit consent or carry forward recorded consent.
export async function saveToken(token, details = {}, { allowPlaintext = false, warn = false } = {}) {
  if (!allowPlaintext) {
    throw new Error(`Refusing unencrypted credential storage without --allow-plaintext. Prefer XMEMO_KEY.`);
  }
  if (warn) warnPlaintextStorage();
  const credentialDir = path.dirname(credentialsPath);
  await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 });
  await bestEffortChmod(credentialDir, 0o700);
  const {
    token: _discardToken,
    created_at: _discardCreatedAt,
    storage: _discardStorage,
    plaintext_storage_consent: _discardConsent,
    plaintext_storage_consent_at: _discardConsentAt,
    claim_code: _discardClaimCode,
    ...safeDetails
  } = details;
  const data = JSON.stringify({
    token,
    created_at: new Date().toISOString(),
    credential_type: 'formal',
    ...safeDetails,
    storage: PLAINTEXT_STORAGE,
    plaintext_storage_consent: true,
    plaintext_storage_consent_at: new Date().toISOString(),
  }, null, 2);
  await fs.writeFile(credentialsPath, `${data}\n`, { encoding: 'utf8', mode: 0o600 });
  await bestEffortChmod(credentialsPath, 0o600);
}

export async function getInstallationFingerprint() {
  try {
    const data = JSON.parse(await fs.readFile(registrationPath, 'utf8'));
    if (typeof data.installation_fingerprint === 'string' && data.installation_fingerprint) {
      return data.installation_fingerprint;
    }
  } catch {
    // Create a non-secret stable ID below when no local registration file exists.
  }

  const installation_fingerprint = randomUUID();
  const registrationDir = path.dirname(registrationPath);
  await fs.mkdir(registrationDir, { recursive: true, mode: 0o700 });
  await bestEffortChmod(registrationDir, 0o700);
  await fs.writeFile(registrationPath, `${JSON.stringify({ installation_fingerprint, created_at: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await bestEffortChmod(registrationPath, 0o600);
  return installation_fingerprint;
}

export function printMemoryResults(result, compact) {
  const results = extractList(result);
  if (results.length === 0) {
    console.log('No matching memories found.');
    return;
  }
  results.forEach((item, index) => {
    console.log(`[${index + 1}] ID: ${sanitizeTerminalText(item?.id || item?.memory_id || '(unknown)')} | Path: ${sanitizeTerminalText(item?.path || '(unknown)')}`);
    console.log(`Content: ${formatMemoryContent(item?.content, compact)}`);
    console.log('---');
  });
}

export async function requestTemporaryMemoryOperation(command, options, flags, credential) {
  const headers = { Authorization: `Bearer ${credential.token}` };
  let res;
  if (command === 'remember') {
    const body = Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined));
    body.content = flags.content || '';
    body.path = flags.path || 'memories';
    res = await makeHttpRequest(options.baseUrl, '/v1/remember', 'POST', body, headers, options.timeoutMs);
  } else {
    const params = new URLSearchParams({ query: flags.query || '', limit: String(flags.limit || 5) });
    for (const key of ['threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain', 'prefer_working']) {
      if (flags[key] !== undefined) params.set(key, String(flags[key]));
    }
    const apiPath = command === 'search' ? '/v1/memories/search' : '/v1/recall';
    res = await makeHttpRequest(options.baseUrl, `${apiPath}?${params}`, 'GET', null, headers, options.timeoutMs);
  }

  const data = parseJsonResponse(res, `Temporary ${command} request`);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const challenge = data?.detail;
    if (res.statusCode === 428 && challenge?.errorType === 'binding_confirmation_required') {
      const allowPlaintext = plaintextStorageAllowed(options, credential);
      const pending = {
        credential_type: 'temporary',
        agent_id: credential.agent_id,
        bind_url: credential.bind_url,
        registration_reason: credential.registration_reason,
        pending_confirmation_token: challenge.confirmation_token,
      };
      await saveToken(credential.token, pending, { allowPlaintext, warn: options.allowPlaintext && !credential.plaintext_storage_consent });
      if (options.json) {
        console.log(safeJson(data));
      } else {
        console.error('Your human account has a pending bind confirmation. Run "auth claim-confirm" to finish the formal-token handoff. Do not share the bind URL or confirmation value.');
      }
    } else {
      const reqId = extractRequestId(data);
      const reqSuffix = reqId ? ` (request_id: ${reqId})` : '';
      console.error(`Temporary ${command} failed: ${apiErrorMessage(data, safeJson(data))}${reqSuffix}`);
    }
    const exitCode = exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode);
    process.exit(exitCode);
  }

  if (options.json) {
    console.log(safeJson(data));
    process.exit(EXIT_CODE.SUCCESS);
  }

  if (command === 'remember') {
    console.log(`✅ Saved to temporary XMemo memory.\nID: ${sanitizeTerminalText(extractId(data.result || data))}`);
  } else {
    printMemoryResults(data.result || data, options.compact);
  }
}

export async function claimStatus(baseUrl, credential, options) {
  const res = await makeHttpRequest(baseUrl, '/v1/agents/status', 'GET', null, {
    Authorization: `Bearer ${credential.token}`,
  }, options.timeoutMs);
  const data = parseJsonResponse(res, 'Claim status request');
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const err = new Error(`Claim status request failed: ${apiErrorMessage(data, safeJson(data))}`);
    err.statusCode = res.statusCode;
    throw err;
  }
  if (typeof data.formal_token === 'string' && data.formal_token) {
    const allowPlaintext = plaintextStorageAllowed(options, credential);
    await saveToken(data.formal_token, { credential_type: 'formal', agent_id: credential.agent_id }, {
      allowPlaintext,
      warn: options.allowPlaintext && !credential.plaintext_storage_consent,
    });
    console.log('✅ Formal XMemo credential received and stored in the explicitly approved user credential file. Temporary access has been replaced.');
    return data;
  }
  if (options.json) {
    console.log(safeJson(data));
  } else {
    console.log(`Claim status: ${sanitizeTerminalText(data.status || 'unknown')}`);
  }
  return data;
}
