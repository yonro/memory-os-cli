import { hasFlag, optionValue, parsePositiveInteger } from '../core/args.js';
import {
  formatAccount,
  pollDeviceLogin,
  readStoredCredential,
  resolveCredentialToken,
  startDeviceLogin,
  storeTokenFromStdin,
  storeTokenValue,
  validateToken,
  credentialsPath
} from '../network/auth.js';
import { baseUrlOption } from '../network/base-url.js';
import {
  COMMAND_NAME,
  LEGACY_TOKEN_ENV_VAR,
  PRODUCT_NAME,
  TOKEN_ENV_VAR
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { normalizeBaseUrl, verifyTokenWithMcp } from '../network/http.js';
import { writeLine } from '../core/io.js';
import { readAll } from '../core/runtime.js';
import { createInterface } from 'node:readline/promises';

export async function loginCommand(args, io) {
  if (hasHelpFlag(args)) {
    writeLoginHelp(io);
    return 0;
  }
  const outputJson = hasFlag(args, '--json');
  const fromStdin = hasFlag(args, '--from-stdin') || hasFlag(args, '--token-stdin');
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const httpTimeoutMs = parsePositiveInteger(optionValue(args, '--http-timeout-ms') ?? '30000', '--http-timeout-ms');
  const loginTimeoutOption = optionValue(args, '--timeout-ms');
  const pollOnce = hasFlag(args, '--poll-once');

  if (fromStdin) {
    const consented = await authorizePlaintextStorage(args, io, {
      action: 'Importing a token from stdin',
      interactive: false
    });
    if (!consented) {
      return 0;
    }
    const result = await storeTokenFromStdin(io, { source: 'stdin' }, { allowPlaintext: true });
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(result, null, 2));
    } else {
      writeLine(io.stdout, `${PRODUCT_NAME} login complete.`);
      writeLine(io.stdout, `Credential stored in the approved user file: ${result.credentialPath}`);
      writeLine(io.stdout, 'Storage: unencrypted; file access is restricted to the current OS user where supported.');
      writeLine(io.stdout, 'Token value was not printed. Project files were not modified.');
    }
    return 0;
  }

  const consented = await authorizePlaintextStorage(args, io, {
    action: 'Browser login',
    interactive: !outputJson
  });
  if (!consented) {
    return 0;
  }

  const start = await startDeviceLogin(baseUrl, httpTimeoutMs, io);
  const loginTimeoutMs = loginTimeoutOption
    ? parsePositiveInteger(loginTimeoutOption, '--timeout-ms')
    : Math.max(1000, start.expiresIn * 1000);
  if (!outputJson) {
    writeLine(io.stdout, `${PRODUCT_NAME} device login`);
    writeLine(io.stdout, `Open: ${start.verificationUriComplete ?? start.verificationUri}`);
    if (start.userCode) {
      writeLine(io.stdout, `Code: ${start.userCode}`);
    }
    writeLine(io.stdout, 'Waiting for authorization...');
  }

  const token = await pollDeviceLogin(baseUrl, start, loginTimeoutMs, httpTimeoutMs, io, { pollOnce });
  const result = await storeTokenValue(
    token.accessToken,
    { source: 'device-login', account: token.account },
    io.env,
    { allowPlaintext: true }
  );
  const payload = {
    ...result,
    baseUrl,
    verificationUri: start.verificationUri,
    account: token.account,
    deviceLogin: true
  };

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(payload, null, 2));
  } else {
    writeLine(io.stdout, `${PRODUCT_NAME} login complete.`);
    if (token.account) {
      writeLine(io.stdout, `Signed in as: ${formatAccount(token.account)}`);
    }
    writeLine(io.stdout, `Credential stored in the approved user file: ${result.credentialPath}`);
    writeLine(io.stdout, 'Storage: unencrypted; token value was not printed.');
    writeLine(io.stdout, `Optional check: ${COMMAND_NAME} auth status --verify`);
  }
  return 0;
}

export async function authCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Auth commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} auth status [--verify] [--base-url <url>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Use \`${COMMAND_NAME} login\` to sign in and \`${COMMAND_NAME} token add --from-stdin --allow-plaintext\` to store an existing token.`);
    return 0;
  }

  if (subcommand === 'status') {
    return await credentialStatusCommand(args.slice(1), io, { mode: 'auth' });
  }

  throw new UsageError(`Unknown auth command: ${subcommand}`);
}

export async function tokenCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Token commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} token status [--verify]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} token add --from-stdin --allow-plaintext`);
    writeLine(io.stdout, `  ${COMMAND_NAME} token set --from-stdin [--allow-plaintext]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, `${COMMAND_NAME} login is the recommended personal-user path.`);
    writeLine(io.stdout, `${COMMAND_NAME} token add --from-stdin requires explicit consent to unencrypted user-file storage.`);
    return 0;
  }

  if (subcommand === 'status') {
    return await credentialStatusCommand(args.slice(1), io, { mode: 'token' });
  }

  if (subcommand === 'add') {
    if (!hasFlag(args, '--from-stdin')) {
      throw new UsageError('Refusing command-line token input. Pipe the token through stdin with --from-stdin.');
    }
    await authorizePlaintextStorage(args, io, {
      action: 'Adding an existing token',
      interactive: false
    });
    const result = await storeTokenFromStdin(io, { source: 'token-add' }, { allowPlaintext: true });
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(result, null, 2));
    } else {
      writeLine(io.stdout, `Credential stored in the approved user file: ${result.credentialPath}`);
      writeLine(io.stdout, 'Storage: unencrypted; file access is restricted to the current OS user where supported.');
      writeLine(io.stdout, 'Token value was not printed. Project files were not modified.');
    }
    return 0;
  }

  if (subcommand === 'set') {
    if (!hasFlag(args, '--from-stdin')) {
      throw new UsageError('Refusing command-line token input. Pipe the token through stdin with --from-stdin.');
    }
    await authorizePlaintextStorage(args, io, {
      action: 'Setting a token',
      interactive: false
    });
    const token = (await readAll(io.stdin)).trim();
    validateToken(token);
    const result = await storeTokenValue(token, { source: 'token-set' }, io.env, { allowPlaintext: true });
    writeLine(io.stdout, `Credential stored in the approved user file: ${result.credentialPath}`);
    writeLine(io.stdout, 'Storage: unencrypted; file access is restricted to the current OS user where supported.');
    writeLine(io.stdout, 'Token value was not printed. Do not commit this file.');
    return 0;
  }

  throw new UsageError(`Unknown token command: ${subcommand}`);
}

async function credentialStatusCommand(args, io, { mode }) {
  const outputJson = hasFlag(args, '--json');
  const verify = hasFlag(args, '--verify');
  const credential = await readStoredCredential(io.env);
  const environmentToken = io.env[TOKEN_ENV_VAR] ?? io.env[LEGACY_TOKEN_ENV_VAR] ?? '';
  const hasEnvironmentToken = Boolean(environmentToken);
  const hasUserCredential = Boolean(credential.token);
  const tokenSource = hasEnvironmentToken ? 'environment' : hasUserCredential ? 'user-credential-file' : 'missing';
  const report = {
    loggedIn: hasEnvironmentToken || hasUserCredential,
    tokenSource,
    environmentToken: {
      present: hasEnvironmentToken,
      variable: hasEnvironmentToken && io.env[TOKEN_ENV_VAR] ? TOKEN_ENV_VAR : hasEnvironmentToken ? LEGACY_TOKEN_ENV_VAR : TOKEN_ENV_VAR
    },
    userCredentialFile: {
      present: hasUserCredential,
      path: credential.path,
      storage: credential.storage ?? null,
      encryption: credential.encryption ?? (hasUserCredential ? 'unknown' : null),
      plaintextStorageConsent: credential.plaintextStorageConsent ?? false
    },
    account: credential.account ?? null,
    privacy: {
      tokenPrinted: false,
      projectFilesModified: false
    }
  };

  if (verify) {
    const token = await resolveCredentialToken(io.env);
    if (!token) {
      if (outputJson) {
        writeLine(io.stdout, JSON.stringify({ ...report, verification: { ok: false, detail: 'no token found' } }, null, 2));
      } else {
        writeCredentialStatus(report, io, { mode });
        writeLine(io.stderr, `No token found. Run \`${COMMAND_NAME} login\` or \`${COMMAND_NAME} token add --from-stdin --allow-plaintext\`.`);
      }
      return 1;
    }
    const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
    const timeoutMs = parsePositiveInteger(optionValue(args, '--timeout-ms') ?? '10000', '--timeout-ms');
    const verification = await verifyTokenWithMcp(baseUrl, token, timeoutMs, io);
    report.verification = verification;
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(report, null, 2));
      return verification.ok ? 0 : 1;
    }
    writeCredentialStatus(report, io, { mode });
    writeLine(io.stdout, `Remote token verification: ${verification.ok ? 'ok' : 'failed'} (${verification.detail})`);
    return verification.ok ? 0 : 1;
  }

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
  } else {
    writeCredentialStatus(report, io, { mode });
  }
  return report.loggedIn ? 0 : 1;
}

function writeCredentialStatus(report, io, { mode }) {
  if (mode === 'auth') {
    writeLine(io.stdout, `${PRODUCT_NAME} auth status`);
    writeLine(io.stdout, `Logged in: ${report.loggedIn ? 'yes' : 'no'}`);
    writeLine(io.stdout, `Credential source: ${report.tokenSource}`);
    if (report.account) {
      writeLine(io.stdout, `Account: ${formatAccount(report.account)}`);
    }
    writeLine(io.stdout, report.loggedIn ? 'Credential is ready; token value remains hidden.' : `Run \`${COMMAND_NAME} login\` to sign in.`);
    return;
  }
  writeLine(io.stdout, `Environment token: ${report.environmentToken.present ? 'present' : 'missing'} (${report.environmentToken.variable})`);
  writeLine(io.stdout, `User credential file: ${report.userCredentialFile.present ? 'present' : 'missing'} (${report.userCredentialFile.path})`);
  if (report.userCredentialFile.present) {
    writeLine(io.stdout, `Credential encryption: ${report.userCredentialFile.encryption}`);
  }
  if (report.account) {
    writeLine(io.stdout, `Account: ${formatAccount(report.account)}`);
  }
  writeLine(io.stdout, report.loggedIn ? 'Credential is ready; token value remains hidden.' : `Run \`${COMMAND_NAME} login\` to sign in.`);
}

function hasHelpFlag(args) {
  return hasFlag(args, '--help') || hasFlag(args, '-h');
}

function writeLoginHelp(io) {
  writeLine(io.stdout, 'Login command:');
  writeLine(io.stdout, `  ${COMMAND_NAME} login [--base-url <url>] [--allow-plaintext]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} login --from-stdin --allow-plaintext [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Interactive browser login asks once before storing the issued token unencrypted.');
  writeLine(io.stdout, 'Use --allow-plaintext to record that consent non-interactively. XMEMO_KEY remains preferred for managed environments.');
}

async function authorizePlaintextStorage(args, io, { action, interactive }) {
  const credentialPath = credentialsPath(io.env);
  writeLine(io.stderr, `${action} will store the XMemo token unencrypted at:`);
  writeLine(io.stderr, `  ${credentialPath}`);
  writeLine(io.stderr, 'File access is restricted to the current OS user where supported. Prefer XMEMO_KEY or a managed secret store on shared systems.');

  if (hasFlag(args, '--allow-plaintext')) {
    return true;
  }

  if (!interactive) {
    throw new UsageError('Unencrypted credential storage requires --allow-plaintext in non-interactive mode.');
  }

  let accepted;
  if (typeof io.confirm === 'function') {
    accepted = await io.confirm('Continue with unencrypted credential storage? [y/N] ');
  } else {
    if (!io.stdin?.isTTY) {
      throw new UsageError('Interactive confirmation is unavailable. Re-run with --allow-plaintext after reviewing the storage notice.');
    }
    const prompt = createInterface({ input: io.stdin, output: io.stderr });
    try {
      const answer = await prompt.question('Continue with unencrypted credential storage? [y/N] ');
      accepted = /^(y|yes)$/i.test(answer.trim());
    } finally {
      prompt.close();
    }
  }

  if (!accepted) {
    writeLine(io.stderr, 'Login cancelled. No credential was stored.');
    return false;
  }
  return true;
}

