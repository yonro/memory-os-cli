import fs from 'node:fs/promises';
import path from 'node:path';

import { hasFlag } from '../core/args.js';
import {
  COMMAND_NAME,
  PRODUCT_NAME
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { readStoredCredential, formatAccount } from '../network/auth.js';
import { loginCommand } from './auth.js';
import {
  allClientIds,
  CLIENT_REGISTRY,
  getClient
} from '../clients/registry.js';
import {
  defaultProfileTarget,
  isHomeProfileTarget,
  profileBlock,
  profileInstallResult,
  findAllProfileSections
} from '../config/profile.js';
import { agentIdentity, envReferenceIdentity } from '../mcp/identity/device.js';
import { PINNED_SKILL_VERSION } from '../core/pins.js';
import { skillCommand } from './skill.js';
import { getPlugin } from '../plugins/registry.js';
import { pluginCommand } from './plugin.js';
import { endpointUrl, normalizeBaseUrl } from '../network/http.js';
import { baseUrlOption } from '../network/base-url.js';
import { readTextIfExists } from '../core/runtime.js';

export function parseClientOptions(args) {
  const clients = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--client') {
      const val = args[i + 1];
      if (!val || val.startsWith('--')) {
        throw new UsageError('Option --client requires a value.');
      }
      i++;
      for (const part of val.split(/[\s,]+/)) {
        if (part) clients.push(part.trim().toLowerCase());
      }
    } else if (args[i].startsWith('--client=')) {
      const val = args[i].slice('--client='.length);
      if (!val) {
        throw new UsageError('Option --client requires a value.');
      }
      for (const part of val.split(/[\s,]+/)) {
        if (part) clients.push(part.trim().toLowerCase());
      }
    }
  }
  return clients;
}

async function* getLineIterator(stdin) {
  if (!stdin) return;
  let buffer = '';
  for await (const chunk of stdin) {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      yield line.replace(/\r$/, '');
    }
  }
  if (buffer.length > 0) {
    yield buffer.replace(/\r$/, '');
  }
}

function createSubIo(io) {
  let stdout = '';
  let stderr = '';
  return {
    subIo: {
      ...io,
      stdout: { write: (c) => { stdout += c; } },
      stderr: { write: (c) => { stderr += c; } }
    },
    getStdout: () => stdout,
    getStderr: () => stderr
  };
}

export function writeInitHelp(io) {
  writeLine(io.stdout, 'Init command:');
  writeLine(io.stdout, `  ${COMMAND_NAME} init [--client <id>...] [--yes] [--dry-run] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Guided first-run onboarding across account sign-in, client detection,');
  writeLine(io.stdout, 'agent instructions, MCP configuration, skill installation, and plugins.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Options:');
  writeLine(io.stdout, '  --client <id>   Target specific client(s) instead of all detected clients');
  writeLine(io.stdout, '  --yes, -y       Accept all prompts without prompting');
  writeLine(io.stdout, '  --dry-run       Print full onboarding plan without modifying files or network');
  writeLine(io.stdout, '  --json          Output structured JSON plan or result');
  return 0;
}

export async function initCommand(args, io, options = {}) {
  const commandName = options.commandName ?? 'init';
  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args[0] === 'help') {
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify({
        schemaVersion: '1',
        ok: true,
        command: commandName,
        data: {
          description: 'Guided first-run onboarding across account, clients, skills, and plugins.',
          options: ['--client', '--yes', '--dry-run', '--json']
        },
        error: null
      }, null, 2));
      return 0;
    }
    return writeInitHelp(io);
  }

  const dryRun = hasFlag(args, '--dry-run');
  const json = hasFlag(args, '--json');
  const yes = hasFlag(args, '--yes') || hasFlag(args, '-y');
  const clientFilters = parseClientOptions(args);
  const baseUrl = normalizeBaseUrl(baseUrlOption(args, io.env));

  for (const id of clientFilters) {
    const resolved = getClient(id);
    if (!resolved) {
      throw new UsageError(`Unknown client: "${id}". Supported clients: ${allClientIds().join(', ')}.`);
    }
  }

  const lineIterator = getLineIterator(io.stdin);
  const readLine = async () => {
    const next = await lineIterator.next();
    return next.done ? '' : (next.value ?? '');
  };

  if (!json) {
    writeLine(io.stdout, `=== ${PRODUCT_NAME} Guided Setup ===`);
    if (dryRun) {
      writeLine(io.stdout, '[dry-run mode: no changes will be written]');
    }
    writeLine(io.stdout, '');
  }

  // ----------------------------------------------------
  // Step 1: Account
  // ----------------------------------------------------
  const storedCred = await readStoredCredential(io.env);
  const hasEnvKey = Boolean(io.env?.XMEMO_KEY || io.env?.MEMORY_OS_MCP_TOKEN || io.env?.XMEMO_TOKEN);
  const hasCredential = Boolean(storedCred?.token || hasEnvKey);
  let accountSignedIn = hasCredential;
  let accountAction = 'skipped';
  let accountDetails = storedCred?.account ? formatAccount(storedCred.account) : (hasEnvKey ? 'environment key' : null);

  if (hasCredential) {
    accountAction = 'already-signed-in';
    if (!json) {
      writeLine(io.stdout, 'Step 1: Account');
      writeLine(io.stdout, `  ✓ Already signed in${accountDetails ? ` (${accountDetails})` : ''}.`);
      writeLine(io.stdout, '');
    }
  } else {
    if (!json) {
      writeLine(io.stdout, 'Step 1: Account');
      writeLine(io.stdout, '  No XMemo credential found.');
    }

    if (dryRun) {
      accountAction = 'planned';
      if (!json) {
        writeLine(io.stdout, '  [dry-run] Would prompt: "Sign in now? [y/N]"');
        writeLine(io.stdout, '');
      }
    } else if (json && !yes) {
      accountAction = 'planned';
    } else {
      let shouldSignIn = yes;
      if (!yes) {
        writeLine(io.stdout, '  Sign in now? [y/N]');
        const answer = (await readLine()).trim().toLowerCase();
        shouldSignIn = answer === 'y' || answer === 'yes';
      }

      if (shouldSignIn) {
        if (!json) {
          writeLine(io.stdout, '  Initiating sign in...');
        }
        try {
          const { subIo, getStderr } = createSubIo(io);
          const loginCode = await loginCommand(['--allow-plaintext'], subIo);
          if (loginCode === 0) {
            accountSignedIn = true;
            accountAction = 'completed';
            const reloaded = await readStoredCredential(io.env);
            accountDetails = reloaded?.account ? formatAccount(reloaded.account) : null;
            if (!json) {
              writeLine(io.stdout, '  ✓ Signed in successfully.');
            }
          } else {
            accountAction = 'skipped';
            if (!json) {
              writeLine(io.stdout, '  Sign in was not completed. Continuing without credential.');
            }
          }
        } catch (err) {
          accountAction = 'skipped';
          if (!json) {
            writeLine(io.stdout, `  Sign in failed (${err.message}). Continuing without credential.`);
          }
        }
      } else {
        accountAction = 'skipped';
        if (!json) {
          writeLine(io.stdout, '  Continuing without signing in.');
        }
      }
      if (!json) {
        writeLine(io.stdout, '');
      }
    }
  }

  // ----------------------------------------------------
  // Step 2: Client Detection (read-only)
  // ----------------------------------------------------
  if (!json) {
    writeLine(io.stdout, 'Step 2: Client Detection');
  }

  const candidateClients = clientFilters.length > 0
    ? clientFilters.map((id) => getClient(id))
    : CLIENT_REGISTRY;

  const detectedClients = [];
  for (const client of candidateClients) {
    const detection = await client.detect(io.env, { cwd: io.cwd });
    if (detection?.detected) {
      detectedClients.push({
        client,
        detectionPath: detection.path ?? null
      });
    }
  }

  if (!json) {
    if (detectedClients.length === 0) {
      writeLine(io.stdout, '  No supported clients were automatically detected.');
      writeLine(io.stdout, '  Run "xmemo init --client <id>" to configure a specific client.');
    } else {
      writeLine(io.stdout, `  Detected ${detectedClients.length} client${detectedClients.length > 1 ? 's' : ''}:`);
      for (const d of detectedClients) {
        writeLine(io.stdout, `  - ${d.client.label} (${d.client.id})${d.detectionPath ? ` at ${d.detectionPath}` : ''}`);
      }
    }
    writeLine(io.stdout, '');
  }

  // ----------------------------------------------------
  // Step 3: For each detected client, ask separately
  // ----------------------------------------------------
  if (!json && detectedClients.length > 0) {
    writeLine(io.stdout, 'Step 3: Client Configuration');
  }

  const clientResults = [];

  for (const { client, detectionPath } of detectedClients) {
    if (!json) {
      writeLine(io.stdout, `--- ${client.label} (${client.id}) ---`);
    }

    const actions = {};

    // 3a. Agent instruction section (shown first)
    const hasProfile = Boolean(client.profile);
    if (hasProfile) {
      const profileTarget = defaultProfileTarget(client.id, io.env, { cwd: io.cwd });
      const isHomeTarget = isHomeProfileTarget(profileTarget, io.env, { cwd: io.cwd, clientId: client.id });
      const block = profileBlock(client.id);
      const existing = await readTextIfExists(path.resolve(profileTarget));
      const sections = findAllProfileSections(existing);
      const hadExistingSection = sections.length > 0;
      const isNewFile = existing.trim().length === 0;

      const profilePlan = {
        available: true,
        target: profileTarget,
        isHomeTarget,
        hadExistingSection,
        isNewFile,
        command: `${COMMAND_NAME} profile install ${client.id}`
      };

      if (!json) {
        writeLine(io.stdout, `  a. Agent Instructions:`);
        writeLine(io.stdout, `     Target: ${profileTarget}${isHomeTarget ? ' (home directory; outside repository)' : ''}`);
        if (hadExistingSection) {
          writeLine(io.stdout, '     Status: Existing XMemo section found; would replace in place.');
        } else if (isNewFile) {
          writeLine(io.stdout, '     Status: New file.');
          writeLine(io.stdout, '     Block to write:');
          for (const line of block.trim().split('\n')) {
            writeLine(io.stdout, `       ${line}`);
          }
        } else {
          writeLine(io.stdout, '     Status: Appending to existing file.');
        }
      }

      let acceptProfile = false;
      if (dryRun || (json && !yes)) {
        profilePlan.status = 'planned';
        if (!json) {
          writeLine(io.stdout, `     [dry-run] Would prompt: "Configure agent instructions for ${client.label}? [y/N]"`);
        }
      } else if (yes) {
        acceptProfile = true;
      } else {
        writeLine(io.stdout, `     Configure agent instructions for ${client.label}? [y/N]`);
        const answer = (await readLine()).trim().toLowerCase();
        acceptProfile = answer === 'y' || answer === 'yes';
      }

      if (acceptProfile) {
        const result = await profileInstallResult(client.id, profileTarget, {
          write: true,
          io,
          cwd: io.cwd,
          env: io.env,
          json,
          isHomeTarget
        });
        profilePlan.status = 'completed';
        profilePlan.backupPath = result.backupPath;
        if (!json) {
          writeLine(io.stdout, `     ✓ Configured agent instructions in ${profileTarget}`);
        }
      } else if (!dryRun && (!json || yes)) {
        profilePlan.status = 'skipped';
        if (!json) {
          writeLine(io.stdout, '     Skipped.');
        }
      }
      if (!json) writeLine(io.stdout, '');
      actions.profile = profilePlan;
    } else {
      actions.profile = { available: false };
    }

    // 3b. MCP configuration
    const hasMcp = Boolean(client.mcp);
    if (hasMcp) {
      const configPath = client.mcp.defaultConfigPath(io.env);
      const mcpUrl = endpointUrl(baseUrl, '/mcp');
      const dummyIdentity = envReferenceIdentity(client.id);
      const snippet = client.mcp.buildSnippet(mcpUrl, dummyIdentity);
      const existingConfig = await readTextIfExists(path.resolve(configPath));
      const exists = Boolean(existingConfig.trim());

      const mcpPlan = {
        available: true,
        configPath,
        mcpUrl,
        command: `${COMMAND_NAME} mcp add ${client.id} --write`
      };

      if (!json) {
        writeLine(io.stdout, `  b. MCP Configuration:`);
        writeLine(io.stdout, `     Config path: ${configPath}`);
        writeLine(io.stdout, `     Server URL: ${mcpUrl}`);
        writeLine(io.stdout, '     Snippet:');
        const snippetLines = typeof snippet === 'string'
          ? snippet.trim().split('\n')
          : JSON.stringify(snippet, null, 2).split('\n');
        for (const line of snippetLines) {
          writeLine(io.stdout, `       ${line}`);
        }
      }

      let acceptMcp = false;
      if (dryRun || (json && !yes)) {
        mcpPlan.status = 'planned';
        if (!json) {
          writeLine(io.stdout, `     [dry-run] Would prompt: "Configure MCP server for ${client.label}? [y/N]"`);
        }
      } else if (yes) {
        acceptMcp = true;
      } else {
        writeLine(io.stdout, `     Configure MCP server for ${client.label}? [y/N]`);
        const answer = (await readLine()).trim().toLowerCase();
        acceptMcp = answer === 'y' || answer === 'yes';
      }

      if (acceptMcp) {
        if (exists) {
          const backupPath = `${path.resolve(configPath)}.xmemo.bak`;
          await fs.writeFile(backupPath, existingConfig);
          mcpPlan.backupPath = backupPath;
          if (!json) {
            writeLine(io.stdout, `     Created backup at ${backupPath}`);
          }
        }
        const liveIdentity = await agentIdentity(client.id, io.env);
        await client.mcp.writeConfig(configPath, mcpUrl, liveIdentity, { force: false });
        mcpPlan.status = 'completed';
        if (!json) {
          writeLine(io.stdout, `     ✓ Configured MCP server in ${configPath}`);
        }
      } else if (!dryRun && (!json || yes)) {
        mcpPlan.status = 'skipped';
        if (!json) {
          writeLine(io.stdout, '     Skipped.');
        }
      }
      if (!json) writeLine(io.stdout, '');
      actions.mcp = mcpPlan;
    } else {
      actions.mcp = { available: false };
    }

    // 3c. Skill install
    const hasSkill = Boolean(client.skillDir && typeof client.skillDir === 'function');
    if (hasSkill) {
      const skillTarget = client.skillDir(io.env, { cwd: io.cwd, project: false });
      const skillPlan = {
        available: true,
        target: skillTarget,
        version: PINNED_SKILL_VERSION,
        command: `${COMMAND_NAME} skill install --client ${client.id}`
      };

      if (!json) {
        writeLine(io.stdout, `  c. XMemo Skill:`);
        writeLine(io.stdout, `     Target: ${skillTarget}`);
        writeLine(io.stdout, `     Version: @xmemo/skill@${PINNED_SKILL_VERSION}`);
      }

      let acceptSkill = false;
      if (dryRun || (json && !yes)) {
        skillPlan.status = 'planned';
        if (!json) {
          writeLine(io.stdout, `     [dry-run] Would prompt: "Install XMemo skill for ${client.label}? [y/N]"`);
        }
      } else if (yes) {
        acceptSkill = true;
      } else {
        writeLine(io.stdout, `     Install XMemo skill for ${client.label}? [y/N]`);
        const answer = (await readLine()).trim().toLowerCase();
        acceptSkill = answer === 'y' || answer === 'yes';
      }

      if (acceptSkill) {
        try {
          const { subIo } = createSubIo(io);
          const code = await skillCommand(['install', '--client', client.id, '--yes'], subIo);
          if (code === 0) {
            skillPlan.status = 'completed';
            if (!json) {
              writeLine(io.stdout, `     ✓ Installed XMemo skill to ${skillTarget}`);
            }
          } else {
            skillPlan.status = 'skipped';
            if (!json) {
              writeLine(io.stdout, '     Skill installation encountered an error.');
            }
          }
        } catch (err) {
          skillPlan.status = 'skipped';
          if (!json) {
            writeLine(io.stdout, `     Skill installation error: ${err.message}`);
          }
        }
      } else if (!dryRun && (!json || yes)) {
        skillPlan.status = 'skipped';
        if (!json) {
          writeLine(io.stdout, '     Skipped.');
        }
      }
      if (!json) writeLine(io.stdout, '');
      actions.skill = skillPlan;
    } else {
      actions.skill = { available: false };
    }

    // 3d. Plugin install
    const pluginObj = client.pluginId ? getPlugin(client.pluginId) : null;
    const hasPlugin = Boolean(pluginObj);
    if (hasPlugin) {
      const pluginPlan = {
        available: true,
        pluginId: pluginObj.id,
        label: pluginObj.label,
        kind: pluginObj.kind,
        command: `${COMMAND_NAME} plugin install ${pluginObj.id}`
      };

      if (!json) {
        writeLine(io.stdout, `  d. Agent Plugin:`);
        writeLine(io.stdout, `     Plugin: ${pluginObj.label} (${pluginObj.id})`);
        writeLine(io.stdout, `     Kind: ${pluginObj.kind}`);
        if (pluginObj.kind === 'native-cli') {
          writeLine(io.stdout, `     Install command: ${pluginObj.install.join(' ')}`);
        } else if (pluginObj.kind === 'git-dir') {
          writeLine(io.stdout, `     Git repository: https://github.com/${pluginObj.repo}.git (tag ${pluginObj.tag})`);
        } else if (pluginObj.kind === 'marketplace' || pluginObj.kind === 'manual') {
          writeLine(io.stdout, `     Marketplace / Manual: ${pluginObj.docs || `https://github.com/${pluginObj.repo}`}`);
        } else if (pluginObj.kind === 'mcp') {
          writeLine(io.stdout, '     Configured via MCP server setup.');
        }
      }

      let acceptPlugin = false;
      if (dryRun || (json && !yes)) {
        pluginPlan.status = 'planned';
        if (!json) {
          writeLine(io.stdout, `     [dry-run] Would prompt: "Install/configure plugin for ${client.label}? [y/N]"`);
        }
      } else if (yes) {
        acceptPlugin = true;
      } else {
        writeLine(io.stdout, `     Install/configure plugin for ${client.label}? [y/N]`);
        const answer = (await readLine()).trim().toLowerCase();
        acceptPlugin = answer === 'y' || answer === 'yes';
      }

      if (acceptPlugin) {
        if (pluginObj.kind === 'mcp') {
          pluginPlan.status = 'completed';
          if (!json) {
            writeLine(io.stdout, `     ✓ Plugin uses MCP configuration.`);
          }
        } else {
          try {
            const { subIo } = createSubIo(io);
            const code = await pluginCommand(['install', pluginObj.id, '--yes'], subIo);
            if (code === 0) {
              pluginPlan.status = 'completed';
              if (!json) {
                writeLine(io.stdout, `     ✓ Plugin ${pluginObj.label} installed/configured.`);
              }
            } else {
              pluginPlan.status = 'skipped';
              if (!json) {
                writeLine(io.stdout, '     Plugin installation encountered an error.');
              }
            }
          } catch (err) {
            pluginPlan.status = 'skipped';
            if (!json) {
              writeLine(io.stdout, `     Plugin error: ${err.message}`);
            }
          }
        }
      } else if (!dryRun && (!json || yes)) {
        pluginPlan.status = 'skipped';
        if (!json) {
          writeLine(io.stdout, '     Skipped.');
        }
      }
      if (!json) writeLine(io.stdout, '');
      actions.plugin = pluginPlan;
    } else {
      actions.plugin = { available: false };
    }

    clientResults.push({
      client,
      detectionPath,
      actions
    });
  }

  // ----------------------------------------------------
  // Step 4: Summary & Next Steps
  // ----------------------------------------------------
  const completedItems = [];
  const skippedItems = [];

  if (accountAction === 'completed' || accountAction === 'already-signed-in') {
    completedItems.push({
      item: 'Account sign-in',
      status: accountAction
    });
  } else {
    skippedItems.push({
      item: 'Account sign-in',
      command: `${COMMAND_NAME} account login`
    });
  }

  for (const clientEntry of clientResults) {
    const { client, actions } = clientEntry;
    if (actions.profile?.available) {
      if (actions.profile.status === 'completed') {
        completedItems.push({
          item: `Agent instructions for ${client.label}`,
          target: actions.profile.target
        });
      } else {
        skippedItems.push({
          item: `Agent instructions for ${client.label}`,
          command: actions.profile.command
        });
      }
    }
    if (actions.mcp?.available) {
      if (actions.mcp.status === 'completed') {
        completedItems.push({
          item: `MCP config for ${client.label}`,
          target: actions.mcp.configPath
        });
      } else {
        skippedItems.push({
          item: `MCP config for ${client.label}`,
          command: actions.mcp.command
        });
      }
    }
    if (actions.skill?.available) {
      if (actions.skill.status === 'completed') {
        completedItems.push({
          item: `XMemo skill for ${client.label}`,
          target: actions.skill.target
        });
      } else {
        skippedItems.push({
          item: `XMemo skill for ${client.label}`,
          command: actions.skill.command
        });
      }
    }
    if (actions.plugin?.available) {
      if (actions.plugin.status === 'completed') {
        completedItems.push({
          item: `Plugin for ${client.label}`,
          pluginId: actions.plugin.pluginId
        });
      } else {
        skippedItems.push({
          item: `Plugin for ${client.label}`,
          command: actions.plugin.command
        });
      }
    }
  }

  const quickStartSteps = [
    `${COMMAND_NAME} account login`,
    `${COMMAND_NAME} memory add --content "A useful fact" --path projects/example`,
    `${COMMAND_NAME} memory search "useful fact"`,
    `${COMMAND_NAME} context recall "continue the project" --max-tokens 2000 --max-items 8`
  ];

  if (json) {
    const envelope = {
      schemaVersion: '1',
      ok: true,
      command: commandName,
      data: {
        dryRun,
        executed: !dryRun && yes,
        account: {
          signedIn: accountSignedIn,
          status: accountAction,
          details: accountDetails
        },
        detectedClients: detectedClients.map((d) => d.client.id),
        clients: clientResults.map((r) => ({
          id: r.client.id,
          label: r.client.label,
          actions: r.actions
        })),
        completed: completedItems,
        skipped: skippedItems,
        nextSteps: quickStartSteps
      },
      error: null
    };
    writeLine(io.stdout, JSON.stringify(envelope, null, 2));
    return 0;
  }

  writeLine(io.stdout, '========================================');
  writeLine(io.stdout, 'Summary:');
  if (dryRun) {
    writeLine(io.stdout, '  Mode: Dry Run (no files written, no network calls made).');
  }
  if (completedItems.length > 0) {
    writeLine(io.stdout, '  Completed:');
    for (const c of completedItems) {
      writeLine(io.stdout, `    ✓ ${c.item}${c.target ? ` (${c.target})` : ''}`);
    }
  }
  if (skippedItems.length > 0) {
    writeLine(io.stdout, '  Skipped:');
    for (const s of skippedItems) {
      writeLine(io.stdout, `    - ${s.item}`);
    }
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'To run skipped items later:');
    for (const s of skippedItems) {
      writeLine(io.stdout, `  ${s.command}`);
    }
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, `${PRODUCT_NAME} quick start:`);
  for (let i = 0; i < quickStartSteps.length; i++) {
    writeLine(io.stdout, `  ${i + 1}. ${quickStartSteps[i]}`);
  }
  writeLine(io.stdout, '========================================');

  return 0;
}
