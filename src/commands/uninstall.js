import { hasFlag, optionValue } from '../core/args.js';
import {
  COMMAND_NAME,
  MCP_SERVER_NAME
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import {
  getClient,
  resolveClientId,
  supportedUninstallClientIds
} from '../clients/registry.js';
import { MCP_CLIENTS } from '../mcp/clients.js';
import {
  autoScanClientIds,
  existingUninstallTargets
} from '../mcp/clients/scan.js';
import {
  profileClientConfig,
  profileUninstallResult
} from '../config/profile.js';
import { confirmUninstall, writeUninstallSummary } from '../ui/uninstall.js';

export function writeUninstallHelp(io) {
  writeLine(io.stdout, 'Uninstall commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} uninstall --all [--yes] [--profiles] [--dry-run]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} uninstall <client-id> [--yes] [--profiles] [--dry-run]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Remove XMemo configurations and behavior profiles from supported clients.');
  return 0;
}

export async function uninstallCommand(args, io) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args[0] === 'help') {
    return writeUninstallHelp(io);
  }

  const positionalCandidate = args[0] && !args[0].startsWith('--') && args[0] !== 'help' ? args[0] : null;
  const optionArgs = positionalCandidate ? args.slice(1) : args;
  const uninstallAll = hasFlag(optionArgs, '--all');
  const outputJson = hasFlag(optionArgs, '--json');

  const rawClientId = positionalCandidate ?? optionValue(optionArgs, '--client');
  let clientId = null;
  if (rawClientId) {
    clientId = resolveClientId(rawClientId);
    if (!clientId && !uninstallAll) {
      throw new UsageError(`Unsupported uninstall client: ${rawClientId}. Supported clients: ${supportedUninstallClientIds().join(', ')}.`);
    }
  }

  if (uninstallAll && clientId) {
    throw new UsageError('Cannot specify both --all and a specific client.');
  }

  if (!uninstallAll && !clientId) {
    throw new UsageError(`Uninstall requires --all, --client <${supportedUninstallClientIds().join('|')}>, or a positional client id.`);
  }

  const dryRun = hasFlag(optionArgs, '--dry-run') || hasFlag(optionArgs, '--preview');
  const skipConfirm = hasFlag(optionArgs, '--yes') || hasFlag(optionArgs, '-y');
  const removeProfiles = hasFlag(optionArgs, '--profiles');
  const profileTargetOverride = optionValue(optionArgs, '--target') ?? optionValue(optionArgs, '--profile-target');

  if (uninstallAll && profileTargetOverride) {
    throw new UsageError('Cannot specify --target or --profile-target with --all.');
  }

  const targetIds = uninstallAll ? autoScanClientIds(MCP_CLIENTS) : [clientId];
  let targets = await existingUninstallTargets(targetIds, io.env, MCP_CLIENTS);

  if (targets.length === 0 && removeProfiles && !uninstallAll) {
    const client = MCP_CLIENTS.get(clientId);
    targets.push({
      clientId,
      label: client?.label ?? clientId,
      configPath: null,
      configKind: 'none'
    });
  }

  const previewOptions = {
    removeProfiles,
    profileTargetOverride,
    preview: true,
    cwd: io.cwd
  };
  const plan = await buildUninstallPlan(targets, io, previewOptions);

  if (dryRun || (outputJson && !skipConfirm)) {
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(plan, null, 2));
    } else {
      writeUninstallSummary(plan, io);
    }
    return plan.errors.length > 0 ? 1 : 0;
  }

  if (plan.removed.length === 0 && plan.errors.length === 0) {
    if (outputJson) {
      writeLine(io.stdout, JSON.stringify(plan, null, 2));
    } else {
      writeUninstallSummary(plan, io);
    }
    return 0;
  }

  if (!outputJson) {
    writeUninstallSummary(plan, io);
  }

  if (!skipConfirm) {
    if (io.stdin.isTTY === false) {
      throw new UsageError('Uninstall requires --yes or --dry-run when stdin is not interactive.');
    }
    const confirmed = await confirmUninstall(plan, io);
    if (!confirmed) {
      writeLine(io.stdout, 'Uninstall cancelled.');
      return 0;
    }
  }

  const result = await buildUninstallPlan(targets, io, {
    removeProfiles,
    profileTargetOverride,
    preview: false,
    cwd: io.cwd
  });
  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(result, null, 2));
  } else {
    writeUninstallSummary(result, io);
  }
  return result.errors.length > 0 ? 1 : 0;
}

async function buildUninstallPlan(targets, io, options) {
  const plan = {
    dryRun: options.preview,
    write: !options.preview,
    profiles: options.removeProfiles,
    removed: [],
    skipped: [],
    errors: []
  };

  for (const target of targets) {
    const configResult = await removeConfigForTarget(target, options.preview);
    const entry = {
      id: target.clientId,
      label: target.label,
      configPath: target.configPath,
      configStatus: configResult.status,
      removedNames: configResult.removedNames ?? []
    };

    if (configResult.status === 'removed') {
      entry.configChanged = true;
    } else if (configResult.status === 'not_found' || configResult.status === 'missing') {
      entry.configChanged = false;
    } else if (configResult.status === 'error') {
      entry.error = configResult.error;
      plan.errors.push({
        id: target.clientId,
        label: target.label,
        configPath: target.configPath,
        phase: 'config',
        error: configResult.error
      });
    }

    if (options.removeProfiles) {
      const profileResult = await removeProfileForTarget(target, io.env, options);
      entry.profilePath = profileResult.targetPath;
      entry.profileStatus = profileResult.status;
      if (profileResult.status === 'removed') {
        entry.profileChanged = true;
      } else if (profileResult.status === 'not_found') {
        entry.profileChanged = false;
      } else if (profileResult.status === 'error') {
        entry.profileError = profileResult.error;
        plan.errors.push({
          id: target.clientId,
          label: target.label,
          profilePath: profileResult.targetPath,
          phase: 'profile',
          error: profileResult.error
        });
      }
    }

    if (configResult.status === 'removed' ||
        (options.removeProfiles && entry.profileStatus === 'removed')) {
      plan.removed.push(entry);
    } else if (configResult.status === 'not_found' || configResult.status === 'missing') {
      if (!options.removeProfiles || entry.profileStatus !== 'removed') {
        plan.skipped.push(entry);
      }
    }
  }

  return plan;
}

async function removeConfigForTarget(target, preview) {
  if (!target.configPath) {
    return { status: 'not_found', reason: 'no_config_path' };
  }

  try {
    const client = getClient(target.clientId) || MCP_CLIENTS.get(target.clientId);
    if (!client || !client.removeConfig) {
      return { status: 'not_found', reason: 'unsupported' };
    }
    const result = await client.removeConfig(target.configPath, { preview });

    if (result.removed) {
      return { status: 'removed', removedNames: result.removedNames ?? [MCP_SERVER_NAME] };
    }
    if (result.reason === 'manual-edit-required') {
      return { status: 'error', error: 'Config shape requires manual edit to remove XMemo safely.' };
    }
    return { status: result.reason ?? 'not_found' };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

async function removeProfileForTarget(target, env, options) {
  const profileConfig = profileClientConfig(target.clientId);
  if (!profileConfig) {
    return { status: 'not_found', reason: 'unsupported', targetPath: null };
  }

  const targetPath = options.profileTargetOverride
    ? options.profileTargetOverride
    : profileConfig.defaultTarget(env, { cwd: options.cwd });

  try {
    const result = await profileUninstallResult(target.clientId, targetPath, { write: !options.preview });
    if (result.changed) {
      return { status: 'removed', targetPath: result.targetPath };
    }
    return { status: 'not_found', targetPath: result.targetPath };
  } catch (error) {
    return { status: 'error', targetPath, error: error.message };
  }
}
