import fs from 'node:fs/promises';
import { hasFlag } from '../core/args.js';
import { COMMAND_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { credentialsPath } from '../network/auth.js';
import {
  credentialStatusCommand,
  loginCommand,
  tokenCommand,
  writeLoginHelp,
  writeTokenHelp
} from './auth.js';

async function readLineFromStdin(stdin) {
  if (!stdin) return '';
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
    if (input.includes('\n')) {
      break;
    }
  }
  return input.split(/\r?\n/, 1)[0] ?? '';
}

export function writeAccountHelp(io, subcommand) {
  if (subcommand === 'login') {
    writeLoginHelp(io);
    return 0;
  }
  if (subcommand === 'logout') {
    writeLine(io.stdout, 'Account logout command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} account logout [--yes] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Remove locally stored XMemo credentials owned by the CLI.');
    writeLine(io.stdout, 'Client MCP configurations and agent-managed OAuth sessions are not modified.');
    return 0;
  }
  if (subcommand === 'status') {
    writeLine(io.stdout, 'Account status command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} account status [--verify] [--base-url <url>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Check active authentication state.');
    return 0;
  }
  if (subcommand === 'token') {
    writeTokenHelp(io);
    return 0;
  }

  writeLine(io.stdout, 'Account commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} account login [--base-url <url>] [--allow-plaintext] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} account logout [--yes] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} account status [--verify] [--base-url <url>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} account token <status|add|set> [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Manage XMemo account authentication, stored credentials, and tokens.');
  writeLine(io.stdout, 'Credentials are user-scoped; token values are never printed.');
  return 0;
}

export async function accountLogout(args, io) {
  const yes = hasFlag(args, '--yes') || hasFlag(args, '-y');
  const isJson = hasFlag(args, '--json');
  const credPath = credentialsPath(io.env);

  const stat = await fs.stat(credPath).catch(() => null);
  const exists = Boolean(stat && stat.isFile());

  if (!exists) {
    if (isJson) {
      writeLine(io.stdout, JSON.stringify({
        schemaVersion: '1',
        ok: true,
        command: 'account.logout',
        removed: false,
        path: credPath,
        clientConfigsPreserved: true,
        data: {
          removed: false,
          path: credPath,
          clientConfigsPreserved: true,
          message: 'No local credential file found.'
        },
        error: null
      }, null, 2));
      return 0;
    }
    writeLine(io.stdout, `No local XMemo credential file found at ${credPath}. Already logged out.`);
    writeLine(io.stdout, 'Client MCP configurations and agent-managed OAuth sessions were not modified.');
    return 0;
  }

  if (!yes) {
    if (isJson) {
      throw new UsageError('account logout requires --yes when run with --json.');
    }

    writeLine(io.stdout, 'The following local credential file will be removed:');
    writeLine(io.stdout, `  ${credPath}`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'This will remove your stored XMemo login credentials.');
    writeLine(io.stdout, 'Client MCP configurations and agent-managed OAuth sessions will not be modified.');
    writeLine(io.stdout, 'Token values will not be displayed.');
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Proceed with logout? [y/N]');
    const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      writeLine(io.stdout, 'Logout cancelled. Credential file was not removed.');
      return 0;
    }
  }

  await fs.rm(credPath, { force: true });

  if (isJson) {
    writeLine(io.stdout, JSON.stringify({
      schemaVersion: '1',
      ok: true,
      command: 'account.logout',
      removed: true,
      path: credPath,
      clientConfigsPreserved: true,
      data: {
        removed: true,
        path: credPath,
        clientConfigsPreserved: true
      },
      error: null
    }, null, 2));
    return 0;
  }

  writeLine(io.stdout, '✓ Logged out of XMemo account.');
  writeLine(io.stdout, `  Removed credential file: ${credPath}`);
  writeLine(io.stdout, '  Client MCP configurations and agent-managed OAuth sessions were not modified.');
  return 0;
}

export async function accountCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h' || subcommand.startsWith('-')) {
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify({
        schemaVersion: '1',
        ok: true,
        command: 'account',
        data: {
          subcommands: ['login', 'logout', 'status', 'token'],
          description: 'Manage XMemo account authentication, credentials, and tokens.'
        },
        error: null
      }, null, 2));
      return 0;
    }
    return writeAccountHelp(io, subcommand);
  }

  const optionArgs = args.slice(1);
  if (hasFlag(optionArgs, '--help') || hasFlag(optionArgs, '-h')) {
    return writeAccountHelp(io, subcommand);
  }

  if (subcommand === 'login') {
    return await loginCommand(optionArgs, io);
  }

  if (subcommand === 'logout') {
    return await accountLogout(optionArgs, io);
  }

  if (subcommand === 'status') {
    return await credentialStatusCommand(optionArgs, io, { mode: 'auth' });
  }

  if (subcommand === 'token') {
    const tokenSub = optionArgs[0];
    if (hasFlag(optionArgs, '--help') || hasFlag(optionArgs, '-h')) {
      return writeTokenHelp(io, tokenSub);
    }
    if (!tokenSub || tokenSub === 'help' || tokenSub.startsWith('-')) {
      if (hasFlag(optionArgs, '--json')) {
        writeLine(io.stdout, JSON.stringify({
          schemaVersion: '1',
          ok: true,
          command: 'account.token',
          data: {
            subcommands: ['status', 'add', 'set']
          },
          error: null
        }, null, 2));
        return 0;
      }
      return writeTokenHelp(io, tokenSub);
    }
    if (tokenSub === 'status') {
      return await credentialStatusCommand(optionArgs.slice(1), io, { mode: 'token' });
    }
    if (tokenSub === 'add' || tokenSub === 'set') {
      return await tokenCommand(optionArgs, io);
    }
    throw new UsageError(`Unknown token command: ${tokenSub}`);
  }

  throw new UsageError(`Unknown account command: ${subcommand}`);
}
