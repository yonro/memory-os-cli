import {
  CLI_VERSION,
  COMMAND_NAME
} from './constants.js';
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
import { updateCommand } from './commands/update.js';
import { envCommand, writePrivacy } from './env.js';
import { UsageError } from './errors.js';
import { writeHelp } from './help.js';
import { defaultIo, writeLine } from './io.js';

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

    if (command === 'login') {
      return await loginCommand(args.slice(1), io);
    }

    if (command === 'auth') {
      return await authCommand(args.slice(1), io);
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

    throw new UsageError(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      writeLine(io.stderr, `Error: ${error.message}`);
      writeLine(io.stderr, `Run \`${COMMAND_NAME} help\` for usage.`);
      return 2;
    }

    writeLine(io.stderr, `Unexpected error: ${error.message}`);
    return 1;
  }
}

