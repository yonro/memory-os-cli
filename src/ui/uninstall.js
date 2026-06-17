import {
  COMMAND_NAME,
  PRODUCT_NAME
} from '../core/constants.js';
import { writeLine } from '../core/io.js';

export async function confirmUninstall(plan, io) {
  const targets = plan.removed.length;
  if (targets === 0) {
    return false;
  }

  const prompt = plan.dryRun
    ? `${PRODUCT_NAME} would remove entries from ${targets} client config(s). Continue? [y/N]`
    : `Remove ${PRODUCT_NAME} entries from ${targets} client config(s)? [y/N]`;
  writeLine(io.stdout, prompt);
  const answer = (await readLine(io.stdin)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

async function readLine(stdin) {
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
    if (input.includes('\n')) {
      break;
    }
  }
  return input.split(/\r?\n/, 1)[0] ?? '';
}

export function writeUninstallSummary(plan, io) {
  writeLine(io.stdout, `${PRODUCT_NAME} uninstall summary`);

  if (plan.dryRun) {
    writeLine(io.stdout, '  (dry run — no files were modified)');
  }

  if (plan.profiles) {
    writeLine(io.stdout, '  Behavior profiles: included in removal');
  }

  if (plan.removed.length === 0 && plan.skipped.length === 0 && plan.errors.length === 0) {
    writeLine(io.stdout, '  No local client configurations were detected.');
    return;
  }

  if (plan.removed.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `${plan.dryRun ? 'Would remove' : 'Removed'} from ${plan.removed.length} client(s):`);
    for (const entry of plan.removed) {
      writeLine(io.stdout, `  [✔] ${entry.label}`);
      writeLine(io.stdout, `      Config: ${entry.configPath}`);
      if ('profilePath' in entry && entry.profilePath) {
        const profileStatus = entry.profileStatus === 'removed' ? 'removed' : 'not found';
        writeLine(io.stdout, `      Profile: ${entry.profilePath} (${profileStatus})`);
      }
    }
  }

  if (plan.skipped.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Skipped ${plan.skipped.length} client(s) (XMemo entry not found):`);
    for (const entry of plan.skipped) {
      writeLine(io.stdout, `  [ ] ${entry.label}`);
      writeLine(io.stdout, `      Config: ${entry.configPath}`);
      if (entry.configStatus) {
        writeLine(io.stdout, `      Reason: ${entry.configStatus}`);
      }
    }
  }

  if (plan.errors.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Encountered ${plan.errors.length} error(s):`);
    for (const error of plan.errors) {
      writeLine(io.stdout, `  [✘] ${error.label} (${error.phase})`);
      writeLine(io.stdout, `      Path: ${error.configPath ?? error.profilePath}`);
      writeLine(io.stdout, `      Error: ${error.error}`);
    }
  }

  if (!plan.dryRun && plan.removed.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Restart your IDEs or reload their MCP configurations to apply the changes.');
  }

  if (plan.removed.length === 0 && plan.skipped.length > 0 && plan.errors.length === 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `Run \`${COMMAND_NAME} setup --all --write\` to re-install if needed.`);
  }
}
