#!/usr/bin/env node

/**
 * XMemo Standalone Skill Runtime
 * Module Architecture Map:
 * - lib/core.mjs: Constants, error mapping, and validation primitives.
 * - lib/cli-input.mjs: CLI argument parsing and I/O resolution.
 * - lib/help.mjs: Command usage registry and help text generators.
 * - lib/api.mjs: HTTP transport, JSON parsing, and response formatting.
 * - lib/auth-state.mjs: Credential storage and state persistence.
 * - commands/*.mjs: Command handlers (auth-login, auth-manage, memory, ledger, account, ops).
 */

import path from 'node:path';

import {
  MAX_TIMEOUT_MS,
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
  REST_COMMANDS,
  SCRIPT_COMMAND,
  parsePositiveInteger,
  normalizeBaseUrl,
} from './lib/core.mjs';

import {
  isStdoutTty,
  parseArgs,
  validateCommandInput,
  readStdinContent,
  resolveCommandInputs,
} from './lib/cli-input.mjs';

import {
  COMMAND_USAGE_REGISTRY,
  buildTopLevelHelp,
  printUsage,
} from './lib/help.mjs';

import {
  extractRequestId,
  extractExpiresInSeconds,
  formatRemainingValidity,
  sanitizeTerminalText,
  describeError,
} from './lib/api.mjs';

import {
  getStoredCredential,
  requestTemporaryMemoryOperation,
} from './lib/auth-state.mjs';

import { handleAuthLogin } from './commands/auth-login.mjs';
import { handleAuthManage } from './commands/auth-manage.mjs';
import { handleMemory } from './commands/memory.mjs';
import { handleLedger } from './commands/ledger.mjs';
import { handleAccount } from './commands/account.mjs';
import { handleOps } from './commands/ops.mjs';

const SKILL_VERSION = '1.1.28';

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
  await resolveCommandInputs(command, flags, options);

  const ctx = { command, subcommand, positionals, options, flags, skillVersion: SKILL_VERSION };

  // 1. Auth commands executed before credential check
  if (['login', 'register', 'logout'].includes(command)) {
    await handleAuthLogin(ctx);
    return;
  }

  if (command === 'auth') {
    await handleAuthManage(ctx);
    return;
  }

  // 2. Doctor anonymous check
  const credential = command === 'doctor' && options.anonymous ? null : await getStoredCredential();
  const token = credential?.token;
  if (credential) {
    options.credential = credential;
  }

  if (command === 'doctor' && !token) {
    await handleOps({ ...ctx, credential, token });
    return;
  }

  // 3. Credential requirement
  if (!token) {
    console.error(`Error: No XMemo credential found. Preferred: set XMEMO_KEY. For formal account login with explicit local storage consent, run "${SCRIPT_COMMAND} login --allow-plaintext". For a limited temporary sandbox only when permitted, run "${SCRIPT_COMMAND} register --reason unattended|declined --allow-plaintext".`);
    process.exit(EXIT_CODE.AUTH_ERROR);
  }

  // 4. Temporary token isolation
  if (credential?.credential_type === 'temporary') {
    if (['remember', 'recall', 'search'].includes(command)) {
      try {
        await requestTemporaryMemoryOperation(command, options, flags, credential);
      } catch (e) {
        console.error('Temporary memory request failed:', describeError(e));
        process.exit(exitCodeForError(e));
      }
      return;
    }
    console.error(`Temporary access supports only remember, recall, and search in its isolated sandbox. Complete formal registration at ${sanitizeTerminalText(credential.bind_url || 'the bind URL shown at registration')} to use ${command}.`);
    process.exit(EXIT_CODE.USER_ERROR);
  }

  // 5. Formal credential commands
  const authCtx = { ...ctx, credential, token };
  if (['restart-snapshot', 'restart-restore', 'recall-context', 'read', 'update', 'forget', 'remember', 'recall', 'search'].includes(command)) {
    await handleMemory(authCtx);
    return;
  }

  if (['ledger-list', 'ledger-summary'].includes(command)) {
    await handleLedger(authCtx);
    return;
  }

  if (['overview', 'activity', 'stats'].includes(command)) {
    await handleAccount(authCtx);
    return;
  }

  await handleOps(authCtx);
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
    console.error(`Error: ${describeError(error)}`);
    process.exit(exitCodeForError(error));
  });
}
