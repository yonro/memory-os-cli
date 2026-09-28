import { hasFlag, optionValue } from '../core/args.js';
import { COMMAND_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import {
  resolveClientId,
  supportedProfileClientIds
} from '../clients/registry.js';
import {
  defaultProfileTarget,
  isHomeProfileTarget,
  profileBlock,
  profileClientConfig,
  profileInstallResult,
  profileStatusResult,
  profileUninstallResult,
  writeProfileResult
} from '../config/profile.js';

export function writeProfileHelp(io, subcommand) {
  const clients = supportedProfileClientIds().join('|');
  if (subcommand === 'install') {
    writeLine(io.stdout, 'Profile install command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} profile install <${clients}> [--target <path>] [--dry-run|--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Install behavior profile instructions for an agent workspace.');
    return 0;
  }
  if (subcommand === 'show') {
    writeLine(io.stdout, 'Profile show command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} profile show <${clients}> [--target <path>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Show behavior profile instructions and target path without writing.');
    return 0;
  }
  if (subcommand === 'status') {
    writeLine(io.stdout, 'Profile status command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} profile status <${clients}> [--target <path>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Check behavior profile installation status.');
    return 0;
  }
  if (subcommand === 'remove' || subcommand === 'uninstall') {
    writeLine(io.stdout, 'Profile remove command:');
    writeLine(io.stdout, `  ${COMMAND_NAME} profile remove <${clients}> [--target <path>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Remove behavior profile instructions.');
    return 0;
  }
  writeLine(io.stdout, 'Profile commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} profile install <${clients}> [--target <path>] [--dry-run|--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} profile show <${clients}> [--target <path>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} profile status <${clients}> [--target <path>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} profile remove <${clients}> [--target <path>] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Profile installs are section-scoped and never write token values.');
  return 0;
}

export async function profileCommand(args, io) {
  let subcommand = args[0] ?? 'help';
  if (subcommand === 'uninstall') {
    if (!hasFlag(args, '--json') && io.stderr?.isTTY) {
      writeLine(io.stderr, "Hint: 'xmemo profile uninstall' is an alias for 'xmemo profile remove'.");
    }
    subcommand = 'remove';
  }

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h' || subcommand.startsWith('-') || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify({
        schemaVersion: '1',
        ok: true,
        command: 'profile',
        data: {
          subcommands: ['install', 'show', 'status', 'remove', 'uninstall'],
          supportedClients: supportedProfileClientIds()
        },
        error: null
      }, null, 2));
      return 0;
    }
    return writeProfileHelp(io, subcommand);
  }

  const rawClient = args[1] ?? '';
  const clientId = resolveClientId(rawClient);
  if (!clientId || !profileClientConfig(clientId)) {
    throw new UsageError(`Unsupported profile client: ${args[1] ?? 'missing'}. Supported clients: ${supportedProfileClientIds().join(', ')}.`);
  }

  const optionArgs = args.slice(2);
  const outputJson = hasFlag(optionArgs, '--json');
  const targetPath = optionValue(optionArgs, '--target') ?? defaultProfileTarget(clientId, io.env, { cwd: io.cwd });
  const isHomeTarget = isHomeProfileTarget(targetPath, io.env, { cwd: io.cwd, clientId });
  let result;

  if (subcommand === 'install') {
    result = await profileInstallResult(clientId, targetPath, {
      write: !hasFlag(optionArgs, '--dry-run'),
      io,
      cwd: io.cwd,
      env: io.env,
      json: outputJson,
      isHomeTarget
    });
  } else if (subcommand === 'show') {
    result = {
      client: clientId,
      action: 'show',
      targetPath,
      isHomeTarget,
      block: profileBlock(clientId)
    };
  } else if (subcommand === 'status') {
    result = await profileStatusResult(clientId, targetPath);
  } else if (subcommand === 'remove') {
    result = await profileUninstallResult(clientId, targetPath, { write: !hasFlag(optionArgs, '--dry-run') });
  } else {
    throw new UsageError(`Unknown profile command: ${subcommand}`);
  }

  result.isHomeTarget = isHomeTarget;

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(result, null, 2));
    return 0;
  }

  writeProfileResult(subcommand, result, io);
  return 0;
}
