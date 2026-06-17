import { hasFlag, optionValue } from '../core/args.js';
import {
  MCP_SERVER_NAME
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { MCP_CLIENTS } from '../mcp/clients.js';
import {
  autoScanClientIds,
  existingUninstallTargets
} from '../mcp/clients/scan.js';
import { removeCopilotMcpConfig } from '../mcp/proxy/copilot.js';
import {
  profileClientConfig,
  profileUninstallResult
} from '../config/profile.js';
import {
  normalizeSetupClientId,
  positionalClientArg,
  supportedSetupClientIds
} from '../ui/setup.js';
import { confirmUninstall, writeUninstallSummary } from '../ui/uninstall.js';

export async function uninstallCommand(args, io) {
  const positionalClientId = positionalClientArg(args, MCP_CLIENTS);
  const optionArgs = positionalClientId ? args.slice(1) : args;
  const uninstallAll = hasFlag(optionArgs, '--all');
  const outputJson = hasFlag(optionArgs, '--json');

  let clientId = null;
  try {
    clientId = normalizeSetupClientId(positionalClientId ?? optionValue(optionArgs, '--client'), MCP_CLIENTS);
  } catch (error) {
    if (!uninstallAll) {
      throw error;
    }
  }

  if (uninstallAll && clientId) {
    throw new UsageError('Cannot specify both --all and a specific client.');
  }

  if (!uninstallAll && !clientId) {
    throw new UsageError(`Uninstall requires --all, --client <${supportedSetupClientIds(MCP_CLIENTS).join('|')}>, or a positional client id.`);
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
    preview: true
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
    preview: false
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
    let result;
    if (target.clientId === 'copilot-cli') {
      result = await removeCopilotMcpConfig(target.configPath, { preview });
    } else {
      const client = MCP_CLIENTS.get(target.clientId);
      if (!client || !client.removeConfig) {
        return { status: 'not_found', reason: 'unsupported' };
      }
      result = await client.removeConfig(target.configPath, { preview });
    }

    if (result.removed) {
      return { status: 'removed', removedNames: result.removedNames ?? [MCP_SERVER_NAME] };
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
    : profileConfig.defaultTarget(env);

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
