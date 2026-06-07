import { hasFlag } from '../args.js';
import {
  COMMAND_NAME,
  PACKAGE_NAME
} from '../constants.js';
import { UsageError } from '../errors.js';
import { writeLine } from '../io.js';
import {
  npmExecutable,
  runProcess
} from '../runtime.js';

export async function updateCommand(args, io) {
  const outputJson = hasFlag(args, '--json');
  const dryRun = hasFlag(args, '--dry-run');
  const npmCommand = npmExecutable();
  const npmArgs = ['install', '-g', `${PACKAGE_NAME}@latest`];
  const report = {
    package: PACKAGE_NAME,
    command: [npmCommand, ...npmArgs],
    dryRun,
    tokenSent: false,
    projectFilesModified: false
  };

  const commandToDisplay = report.command.map(c => c === 'npm.cmd' ? 'npm' : c).join(' ');

  if (dryRun) {
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(report, null, 2));
    } else {
      writeLine(io.stdout, `Update command: ${commandToDisplay}`);
      writeLine(io.stdout, 'Dry run only; no changes made.');
    }
    return 0;
  }

  if (!outputJson) {
    writeLine(io.stdout, `Updating ${PACKAGE_NAME} to the latest version...`);
    writeLine(io.stdout, `Running: ${commandToDisplay}`);
  }
  const result = await runProcess(npmCommand, npmArgs, io, { stream: !outputJson });
  report.exitCode = result.code;
  report.completed = result.code === 0;

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new UsageError(`Update failed: ${detail}`);
  }
  if (!outputJson) {
    writeLine(io.stdout, `Update complete. Run \`${COMMAND_NAME} --version\` to confirm.`);
  }
  return 0;
}
