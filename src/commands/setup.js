import {
  hasFlag,
  optionValue,
  parsePositiveInteger,
  stringValue
} from '../core/args.js';
import { baseUrlOption } from '../network/base-url.js';
import {
  DEFAULT_PROXY_PORT,
  MCP_SERVER_NAME
} from '../core/constants.js';
import {
  autoScanClientIds,
  detectedSetupTargets
} from '../mcp/clients/scan.js';
import {
  buildSetupPlan,
  ensureDiscoveryService
} from '../network/discovery.js';
import { UsageError } from '../core/errors.js';
import { endpointUrl, fetchJson, normalizeBaseUrl } from '../network/http.js';
import { readLineFromStdin, writeLine } from '../core/io.js';
import { isDeepEqual, readTextIfExists } from '../core/runtime.js';
import {
  MCP_CLIENTS,
  supportedMcpClients
} from '../mcp/clients.js';
import { mergeCopilotMcpConfig } from '../mcp/proxy/copilot.js';
import {
  CLIENT_REGISTRY,
  getClient,
  usesClientOAuth
} from '../clients/registry.js';

import {
  agentIdentity,
  envReferenceIdentity
} from '../mcp/identity/device.js';
import {
  confirmProfileInstall,
  defaultProfileTarget,
  isHomeProfileTarget,
  profileBlock,
  profileClientConfig,
  profileInstallResult
} from '../config/profile.js';
import {
  clientSetupPlan,
  copilotSetupPlan,
  normalizeSetupClientId,
  positionalClientArg,
  supportedSetupClientIds,
  writeSetupHelp,
  writeSetupSummary
} from '../ui/setup.js';

export async function setupCommand(args, io) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args[0] === 'help') {
    writeSetupHelp(io);
    return 0;
  }

  const positionalClientId = positionalClientArg(args, MCP_CLIENTS);
  const optionArgs = positionalClientId ? args.slice(1) : args;
  const baseUrl = normalizeBaseUrl(baseUrlOption(optionArgs, io.env));
  const outputJson = hasFlag(optionArgs, '--json');
  const shortClientSetup = Boolean(positionalClientId);
  const setupAll = hasFlag(optionArgs, '--all');
  
  let clientId = null;
  try {
    clientId = normalizeSetupClientId(positionalClientId ?? optionValue(optionArgs, '--client'), MCP_CLIENTS);
  } catch (error) {
    if (!setupAll) {
      throw error;
    }
  }

  if (setupAll && clientId) {
    throw new UsageError('Cannot specify both --all and a specific client.');
  }

  const auth = optionValue(optionArgs, '--auth');
  if (auth) {
    const authClient = clientId ? getClient(clientId) : null;
    if (!authClient?.mcp || authClient.mcp.authentication !== 'oauth' || !['oauth', 'key'].includes(auth)) {
      const oauthClient = CLIENT_REGISTRY.find((c) => c.mcp?.authentication === 'oauth');
      throw new UsageError(`--auth oauth|key requires setup ${oauthClient?.id}.`);
    }
  }
  const dryRun = hasFlag(optionArgs, '--dry-run') || hasFlag(optionArgs, '--preview');
  const force = hasFlag(optionArgs, '--force');
  const writeConfig = !dryRun && (hasFlag(optionArgs, '--write') || hasFlag(optionArgs, '--yes') || shortClientSetup || (setupAll && (hasFlag(optionArgs, '--write') || hasFlag(optionArgs, '--yes'))));
  const timeoutMs = parsePositiveInteger(optionValue(optionArgs, '--timeout-ms') ?? '5000', '--timeout-ms');

  if (writeConfig && !clientId && !setupAll) {
    throw new UsageError(`Setup --write requires --client <${supportedSetupClientIds(MCP_CLIENTS).join('|')}> or --all so the CLI never writes broad config implicitly.`);
  }

  const discoveryUrl = endpointUrl(baseUrl, '/.well-known/memory-os.json');
  const discovery = await fetchJson(discoveryUrl, timeoutMs, io);
  ensureDiscoveryService(discovery, discoveryUrl);

  const statusUrl = stringValue(discovery, ['urls', 'onboarding_status'])
    ?? stringValue(discovery, ['onboarding_status_url'])
    ?? endpointUrl(baseUrl, '/v1/onboarding/status');
  const status = await fetchJson(statusUrl, timeoutMs, io);
  const setupPlan = buildSetupPlan({
    baseUrl,
    discoveryUrl,
    statusUrl,
    discovery,
    status,
    localClients: supportedMcpClients()
  });

  if (setupAll) {
    setupPlan.detectedClients = [];
    const scanIds = autoScanClientIds(MCP_CLIENTS);
    const targets = await detectedSetupTargets(scanIds, io.env, MCP_CLIENTS);
    for (const target of targets) {
      const scanId = target.clientId;
      const client = getClient(scanId) || MCP_CLIENTS.get(scanId);
      let clientPlan;
      if (client?.mcp?.configKind === 'local-proxy') {
        const proxyPort = parsePositiveInteger(optionValue(optionArgs, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
        clientPlan = copilotSetupPlan(setupPlan.mcpUrl, proxyPort, io.env);
        clientPlan.configPath = target.configPath;
        if (writeConfig) {
          await mergeCopilotMcpConfig(clientPlan.configPath, clientPlan.proxyUrl, force);
          clientPlan.written = true;
        }
      } else {
        const identity = writeConfig ? await agentIdentity(scanId, io.env) : envReferenceIdentity(scanId);
        clientPlan = clientSetupPlan(scanId, client, setupPlan.mcpUrl, io.env, identity);
        clientPlan.configPath = target.configPath;
        if (writeConfig) {
          await client.writeConfig(clientPlan.configPath, setupPlan.mcpUrl, identity, { force });
          clientPlan.written = true;
          if (profileClientConfig(scanId)) {
            const installProfile = hasFlag(optionArgs, '--yes') || hasFlag(optionArgs, '--profile');
            if (installProfile) {
              const profileTarget = defaultProfileTarget(scanId, io.env, { cwd: io.cwd });
              const profileResult = await profileInstallResult(scanId, profileTarget, {
                write: true,
                io,
                cwd: io.cwd,
                env: io.env,
                json: outputJson
              });
              clientPlan.behaviorProfile = profileResult;
              if (client.profile?.profileVersion?.startsWith(scanId)) {
                clientPlan[`${scanId}Profile`] = profileResult;
              }
            }
          }
        }
      }
      setupPlan.detectedClients.push(clientPlan);
    }
  } else if (clientId) {
    const client = getClient(clientId) || MCP_CLIENTS.get(clientId);
    if (!client) {
      throw new UsageError(`Unsupported MCP client: ${clientId}. Supported clients: ${supportedSetupClientIds(MCP_CLIENTS).join(', ')}.`);
    }

    if (typeof client.setupRecipe === 'function') {
      const identity = writeConfig ? await agentIdentity(clientId, io.env) : envReferenceIdentity(clientId);
      setupPlan.selectedClient = await client.setupRecipe({
        setupPlan,
        optionArgs,
        io,
        dryRun,
        identity,
        client,
        force
      });
    } else {
      const identity = (writeConfig || !dryRun) ? await agentIdentity(clientId, io.env) : envReferenceIdentity(clientId);
      if (client.mcp?.configKind === 'local-proxy') {
        const proxyPort = parsePositiveInteger(optionValue(optionArgs, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
        setupPlan.selectedClient = copilotSetupPlan(setupPlan.mcpUrl, proxyPort, io.env);
      } else {
        setupPlan.selectedClient = clientSetupPlan(clientId, client, setupPlan.mcpUrl, io.env, identity, { auth });
      }

      // Check MCP component status
      const configPath = setupPlan.selectedClient.configPath;
      let mcpStatus = 'will_install';
      const existingConfig = await readTextIfExists(configPath);
      if (existingConfig && existingConfig.trim().length > 0) {
        if (client.mcp?.configKind === 'local-proxy') {
          try {
            const parsed = JSON.parse(existingConfig);
            if (parsed.mcpServers?.[MCP_SERVER_NAME]?.url === setupPlan.selectedClient.proxyUrl) {
              mcpStatus = 'unchanged';
            } else {
              mcpStatus = 'will_update';
            }
          } catch {
            mcpStatus = 'will_update';
          }
        } else if (client.configKind === 'toml') {
          const snippet = client.mcp?.buildSnippet ? client.mcp.buildSnippet(setupPlan.mcpUrl, identity, { auth }) : '';
          if (typeof snippet === 'string' && existingConfig.includes(snippet.trim())) {
            mcpStatus = 'unchanged';
          } else if (existingConfig.includes('XMemo') || existingConfig.includes('xmemo')) {
            mcpStatus = 'will_update';
          } else {
            mcpStatus = 'will_install';
          }
        } else {
          try {
            const parsed = JSON.parse(existingConfig);
            const section = client.mcp?.section ?? 'mcpServers';
            const servers = parsed[section] || {};
            const targetSnippet = client.mcp?.buildSnippet ? client.mcp.buildSnippet(setupPlan.mcpUrl, identity, { auth }) : null;
            let expectedServer = null;
            if (typeof targetSnippet === 'string') {
              try {
                const parsedSnippet = JSON.parse(targetSnippet);
                expectedServer = parsedSnippet?.[section]?.[MCP_SERVER_NAME] ?? parsedSnippet?.[MCP_SERVER_NAME];
              } catch {}
            } else if (targetSnippet && typeof targetSnippet === 'object') {
              expectedServer = targetSnippet?.[section]?.[MCP_SERVER_NAME] ?? targetSnippet?.[MCP_SERVER_NAME];
            }
            if (servers[MCP_SERVER_NAME] && expectedServer && isDeepEqual(servers[MCP_SERVER_NAME], expectedServer)) {
              mcpStatus = 'unchanged';
            } else if (servers[MCP_SERVER_NAME]) {
              mcpStatus = 'will_update';
            } else {
              mcpStatus = 'will_install';
            }
          } catch {
            mcpStatus = 'will_install';
          }
        }
      }

      // Check Profile component status
      const hasProfileConfig = Boolean(profileClientConfig(clientId));
      const installProfileRequested = !hasFlag(optionArgs, '--no-profile');
      let profileTarget = null;
      let isHomeTarget = false;
      let profileStatus = null;
      if (hasProfileConfig) {
        profileTarget = optionValue(optionArgs, '--profile-target')
          ?? optionValue(optionArgs, '--target')
          ?? defaultProfileTarget(clientId, io.env, { cwd: io.cwd });
        isHomeTarget = isHomeProfileTarget(profileTarget, io.env, { cwd: io.cwd, clientId });
        if (installProfileRequested) {
          const block = profileBlock(clientId);
          const existingProfile = await readTextIfExists(profileTarget);
          if (existingProfile && existingProfile.includes(block.trim())) {
            profileStatus = 'unchanged';
          } else if (existingProfile && existingProfile.trim().length > 0) {
            profileStatus = 'will_update';
          } else {
            profileStatus = 'will_install';
          }
        } else {
          setupPlan.selectedClient.behaviorProfile = {
            client: clientId,
            targetPath: profileTarget,
            written: false,
            changed: false,
            skipped: true,
            accepted: false,
            prompted: false,
            isHomeTarget
          };
          if (client.profile?.profileVersion?.startsWith(clientId)) {
            setupPlan.selectedClient[`${clientId}Profile`] = setupPlan.selectedClient.behaviorProfile;
          }
        }
      }

      // Idempotency: if all requested components are up to date, it's a no-op!
      const isNoop = mcpStatus === 'unchanged' && (!hasProfileConfig || !installProfileRequested || profileStatus === 'unchanged');
      if (isNoop && !force) {
        if (outputJson) {
          writeLine(io.stdout, JSON.stringify({
            ok: true,
            noop: true,
            message: 'Nothing to do (all components are up to date).',
            client: clientId
          }, null, 2));
          return 0;
        }
        writeLine(io.stdout, 'Nothing to do (all components are up to date).');
        return 0;
      }

      // Dry-run preview
      if (dryRun) {
        if (hasProfileConfig && installProfileRequested) {
          const profileResult = await profileInstallResult(clientId, profileTarget, {
            write: false,
            io,
            cwd: io.cwd,
            env: io.env,
            json: outputJson,
            isHomeTarget
          });
          setupPlan.selectedClient.behaviorProfile = profileResult;
          if (client.profile?.profileVersion?.startsWith(clientId)) {
            setupPlan.selectedClient[`${clientId}Profile`] = profileResult;
          }
        }
        if (outputJson) {
          writeLine(io.stdout, JSON.stringify(setupPlan, null, 2));
          return 0;
        }
        writeSetupSummary(setupPlan, io);
        writeLine(io.stdout, '');
        writeLine(io.stdout, '[dry-run] Plan not executed.');
        return 0;
      }

      // Single confirmation in interactive mode
      const autoConsent = hasFlag(optionArgs, '--yes') || hasFlag(optionArgs, '-y') || hasFlag(optionArgs, '--write') || (outputJson && shortClientSetup);
      if (!autoConsent) {
        if (outputJson) {
          writeLine(io.stdout, JSON.stringify({
            ok: false,
            consentRequired: true,
            plan: setupPlan
          }, null, 2));
          return 0;
        }

        if (hasProfileConfig && installProfileRequested) {
          const previewResult = await profileInstallResult(clientId, profileTarget, {
            write: false,
            io,
            cwd: io.cwd,
            env: io.env,
            json: false,
            isHomeTarget
          });
          setupPlan.selectedClient.behaviorProfile = previewResult;
          if (client.profile?.profileVersion?.startsWith(clientId)) {
            setupPlan.selectedClient[`${clientId}Profile`] = previewResult;
          }
        }

        writeSetupSummary(setupPlan, io);
        writeLine(io.stdout, '');
        if (isHomeTarget && profileTarget) {
          writeLine(io.stdout, `Target is in home directory (outside a repository): ${profileTarget}`);
        }
        writeLine(io.stdout, 'Proceed with above changes? [y/N] ');
        const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
        if (answer !== 'y' && answer !== 'yes') {
          writeLine(io.stdout, 'Operation cancelled.');
          return 0;
        }
      }

      // Apply changes
      if (client.mcp?.configKind === 'local-proxy') {
        await mergeCopilotMcpConfig(setupPlan.selectedClient.configPath, setupPlan.selectedClient.proxyUrl, force);
        setupPlan.selectedClient.written = true;
      } else {
        await client.writeConfig(setupPlan.selectedClient.configPath, setupPlan.mcpUrl, identity, { force, auth });
        setupPlan.selectedClient.written = true;
      }

      if (hasProfileConfig && installProfileRequested) {
        const installProfile = hasFlag(optionArgs, '--yes') || hasFlag(optionArgs, '--profile') || !outputJson;
        const profileResult = await profileInstallResult(clientId, profileTarget, {
          write: installProfile,
          io,
          cwd: io.cwd,
          env: io.env,
          json: outputJson,
          isHomeTarget
        });
        profileResult.prompted = false;
        profileResult.accepted = installProfile;
        profileResult.skipped = false;
        profileResult.isHomeTarget = isHomeTarget;
        setupPlan.selectedClient.behaviorProfile = profileResult;
        if (client.profile?.profileVersion?.startsWith(clientId)) {
          setupPlan.selectedClient[`${clientId}Profile`] = profileResult;
        }
      }
    }
  }

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(setupPlan, null, 2));
    return 0;
  }

  writeSetupSummary(setupPlan, io);
  return 0;
}

