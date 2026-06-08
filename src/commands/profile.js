import { hasFlag, optionValue } from '../core/args.js';
import { COMMAND_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { MCP_CLIENTS } from '../mcp/clients.js';
import {
  defaultProfileTarget,
  profileClientConfig,
  profileInstallResult,
  profileStatusResult,
  profileUninstallResult,
  supportedProfileClientIds,
  writeProfileResult
} from '../config/profile.js';
import { normalizeSetupClientId } from '../ui/setup.js';

export async function profileCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Profile commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} profile install <codex|cursor|gemini|antigravity|qwen|opencode> [--target <path>] [--dry-run|--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} profile status <codex|cursor|gemini|antigravity|qwen|opencode> [--target <path>] [--json]`);
    writeLine(io.stdout, `  ${COMMAND_NAME} profile uninstall <codex|cursor|gemini|antigravity|qwen|opencode> [--target <path>] [--json]`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Profile installs are marker-scoped and never write token values.');
    return 0;
  }

  const clientId = normalizeSetupClientId(args[1], MCP_CLIENTS);
  if (!profileClientConfig(clientId)) {
    throw new UsageError(`Unsupported profile client: ${args[1] ?? 'missing'}. Supported clients: ${supportedProfileClientIds().join(', ')}.`);
  }

  const optionArgs = args.slice(2);
  const outputJson = hasFlag(optionArgs, '--json');
  const targetPath = optionValue(optionArgs, '--target') ?? defaultProfileTarget(clientId, io.env);
  let result;

  if (subcommand === 'install') {
    result = await profileInstallResult(clientId, targetPath, { write: !hasFlag(optionArgs, '--dry-run') });
  } else if (subcommand === 'status') {
    result = await profileStatusResult(clientId, targetPath);
  } else if (subcommand === 'uninstall') {
    result = await profileUninstallResult(clientId, targetPath, { write: !hasFlag(optionArgs, '--dry-run') });
  } else {
    throw new UsageError(`Unknown profile command: ${subcommand}`);
  }

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(result, null, 2));
    return 0;
  }

  writeProfileResult(subcommand, result, io);
  return 0;
}

