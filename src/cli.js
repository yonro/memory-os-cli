import {
  CLI_VERSION,
  COMMAND_NAME
} from './core/constants.js';
import {
  authCommand,
  loginCommand,
  tokenCommand
} from './commands/auth.js';
import {
  discoveryCommand,
  doctorCommand,
  smokeCommand,
  statusCommand
} from './commands/diagnostics.js';
import { mcpCommand } from './commands/mcp.js';
import { profileCommand } from './commands/profile.js';
import { setupCommand } from './commands/setup.js';
import { uninstallCommand } from './commands/uninstall.js';
import { updateCommand } from './commands/update.js';
import { envCommand, writePrivacy } from './config/env.js';
import { UsageError } from './core/errors.js';
import { writeHelp } from './ui/help.js';
import { defaultIo, writeLine } from './core/io.js';
import { contextCommand, memoryCommand, restartCommand, stateCommand } from './commands/service.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { dreamCommand } from './commands/dream.js';
import { cloudSkillCommand } from './commands/cloud-skill.js';
import { hasFlag } from './core/args.js';
import { errorToExitCode } from './api/errors.js';
import { writeFailure } from './api/envelope.js';

export async function run(args, io = defaultIo()) {
  try {
    const command = args[0] ?? 'help';

    if (command === '--help' || command === '-h' || command === 'help') {
      writeHelp(io);
      return 0;
    }

    if (command === '--version' || command === '-v' || command === 'version') {
      writeLine(io.stdout, CLI_VERSION);
      return 0;
    }

    if (command === 'update' || command === '--update') {
      return await updateCommand(args.slice(1), io);
    }

    if (command === 'doctor') {
      return await doctorCommand(args.slice(1), io);
    }

    if (command === 'discovery') {
      return await discoveryCommand(args.slice(1), io);
    }

    if (command === 'status') {
      return await statusCommand(args.slice(1), io);
    }

    if (command === 'setup') {
      return await setupCommand(args.slice(1), io);
    }

    if (command === 'uninstall') {
      return await uninstallCommand(args.slice(1), io);
    }

    if (command === 'login') {
      return await loginCommand(args.slice(1), io);
    }

    if (command === 'auth') {
      return await authCommand(args.slice(1), io);
    }

    if (command === 'auth-status') {
      return await authCommand(['status', ...args.slice(1)], io);
    }

    if (command === 'token') {
      return await tokenCommand(args.slice(1), io);
    }

    if (command === 'mcp') {
      return await mcpCommand(args.slice(1), io);
    }

    if (command === 'profile') {
      return await profileCommand(args.slice(1), io);
    }

    if (command === 'smoke') {
      return await smokeCommand(args.slice(1), io);
    }

    if (command === 'env') {
      return envCommand(args.slice(1), io);
    }

    if (command === 'privacy') {
      writePrivacy(io);
      return 0;
    }

    if (command === 'memory') {
      return await memoryCommand(args.slice(1), io);
    }

    if (command === 'context') {
      return await contextCommand(args.slice(1), io);
    }

    if (command === 'state') {
      return await stateCommand(args.slice(1), io);
    }

    if (command === 'restart') {
      return await restartCommand(args.slice(1), io);
    }

    if (command === 'knowledge') {
      return await knowledgeCommand(args.slice(1), io);
    }

    if (command === 'dream') {
      return await dreamCommand(args.slice(1), io);
    }

    if (command === 'cloud-skill') {
      return await cloudSkillCommand(args.slice(1), io);
    }

    throw new UsageError(`Unknown command: ${command}`);
  } catch (error) {
    if (hasFlag(args, '--json') && ['memory', 'context', 'state', 'restart', 'knowledge', 'dream', 'cloud-skill'].includes(args[0])) {
      const command = [args[0] ?? 'help', args[1]].filter(Boolean).join('.');
      writeFailure(io, command, error);
      return errorToExitCode(error);
    }
    if (error instanceof UsageError) {
      writeLine(io.stderr, `Error: ${error.message}`);
      writeLine(io.stderr, `Run \`${COMMAND_NAME} help\` for usage.`);
      return 2;
    }

    writeLine(io.stderr, `Unexpected error: ${error.message}`);
    return 1;
  }
}

