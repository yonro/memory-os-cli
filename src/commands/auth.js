import { hasFlag, optionValue, parsePositiveInteger } from '../core/args.js';
import {
  formatAccount,
  pollDeviceLogin,
  readStoredCredential,
  resolveCredentialToken,
  startDeviceLogin,
  storeTokenFromStdin,
  storeTokenValue,
  validateToken
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

export async function loginCommand(args, io) {
  const outputJson = hasFlag(args, '--json');
  const fromStdin = hasFlag(args, '--from-stdin') || hasFlag(args, '--token-stdin');
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));
  const httpTimeoutMs = parsePositiveInteger(optionValue(args, '--http-timeout-ms') ?? '30000', '--http-timeout-ms');
  const loginTimeoutOption = optionValue(args, '--timeout-ms');
  const pollOnce = hasFlag(args, '--poll-once');

  if (fromStdin) {
    const result = await storeTokenFromStdin(io, { source: 'stdin' });
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(result, null, 2));
    } else {
      writeLine(io.stdout, `${PRODUCT_NAME} login complete.`);
      writeLine(io.stdout, `Stored token in user-scoped credential file: ${result.credentialPath}`);
      writeLine(io.stdout, 'Token value was not printed. Project files were not modified.');
    }
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
  const result = await storeTokenValue(token.accessToken, { source: 'device-login', account: token.account }, io.env);
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
    writeLine(io.stdout, 'Login complete. Token stored securely in the user-scoped XMemo CLI config directory.');
    if (token.account) {
      writeLine(io.stdout, `Signed in as: ${formatAccount(token.account)}`);
    }
    writeLine(io.stdout, `Credential path: ${result.credentialPath}`);
    writeLine(io.stdout, 'No extra token configuration is required.');
    writeLine(io.stdout, `Optional check: ${COMMAND_NAME} token status --verify`);
  }
  return 0;
}

export async function authCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Auth commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} auth status [--verify] [--base-url <url>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Use \`${COMMAND_NAME} login\` to sign in and \`${COMMAND_NAME} token add --from-stdin\` to store an existing token.`);
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
    writeLine(io.stdout, `  ${COMMAND_NAME} token add --from-stdin`);
    writeLine(io.stdout, `  ${COMMAND_NAME} token set --from-stdin [--allow-plaintext]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, `${COMMAND_NAME} login is the recommended personal-user path.`);
    writeLine(io.stdout, `${COMMAND_NAME} token add --from-stdin stores a token in the user-scoped XMemo CLI config directory.`);
    return 0;
  }

  if (subcommand === 'status') {
    return await credentialStatusCommand(args.slice(1), io, { mode: 'token' });
  }

  if (subcommand === 'add') {
    if (!hasFlag(args, '--from-stdin')) {
      throw new UsageError('Refusing command-line token input. Pipe the token through stdin with --from-stdin.');
    }
    const result = await storeTokenFromStdin(io, { source: 'token-add' });
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify(result, null, 2));
    } else {
      writeLine(io.stdout, `Stored token in user-scoped credential file: ${result.credentialPath}`);
      writeLine(io.stdout, 'Token value was not printed. Project files were not modified.');
    }
    return 0;
  }

  if (subcommand === 'set') {
    if (!hasFlag(args, '--from-stdin')) {
      throw new UsageError('Refusing command-line token input. Pipe the token through stdin with --from-stdin.');
    }
    const token = (await readAll(io.stdin)).trim();
    validateToken(token);
    if (!hasFlag(args, '--allow-plaintext')) {
      writeLine(io.stderr, 'Token was read from stdin but was not stored.');
      writeLine(io.stderr, 'Enterprise default refuses plaintext token storage without --allow-plaintext.');
      writeLine(io.stderr, `Preferred personal-user path: ${COMMAND_NAME} login or ${COMMAND_NAME} token add --from-stdin.`);
      return 2;
    }

    const result = await storeTokenValue(token, { source: 'token-set' }, io.env);
    writeLine(io.stdout, `Stored token in user-scoped credential file: ${result.credentialPath}`);
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
      storage: credential.storage ?? null
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
        writeLine(io.stderr, `No token found. Run \`${COMMAND_NAME} login\` or \`${COMMAND_NAME} token add --from-stdin\`.`);
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
  if (report.account) {
    writeLine(io.stdout, `Account: ${formatAccount(report.account)}`);
  }
  writeLine(io.stdout, report.loggedIn ? 'Credential is ready; token value remains hidden.' : `Run \`${COMMAND_NAME} login\` to sign in.`);
}

