import {
  hasFlag,
  optionValue,
  parsePositiveInteger,
  stringValue
} from '../core/args.js';
import { baseUrlOption } from '../network/base-url.js';
import {
  DEFAULT_PROXY_PORT
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
import {
  endpointUrl,
  fetchJson,
  normalizeBaseUrl
} from '../network/http.js';
import { writeLine } from '../core/io.js';
import {
  MCP_CLIENTS,
  supportedMcpClients
} from '../mcp/clients.js';
import { mergeCopilotMcpConfig } from '../mcp/proxy/copilot.js';

import {
  agentIdentity,
  envReferenceIdentity
} from '../mcp/identity/device.js';
import {
  confirmProfileInstall,
  defaultProfileTarget,
  profileClientConfig,
  profileInstallResult
} from '../config/profile.js';
import {
  clientSetupPlan,
  copilotSetupPlan,
  normalizeSetupClientId,
  positionalClientArg,
  supportedSetupClientIds,
  writeSetupSummary
} from '../ui/setup.js';

export async function setupCommand(args, io) {
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
      let clientPlan;
      if (scanId === 'copilot-cli') {
        const proxyPort = parsePositiveInteger(optionValue(optionArgs, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
        clientPlan = copilotSetupPlan(setupPlan.mcpUrl, proxyPort, io.env);
        clientPlan.configPath = target.configPath;
        if (writeConfig) {
          await mergeCopilotMcpConfig(clientPlan.configPath, clientPlan.proxyUrl, force);
          clientPlan.written = true;
        }
      } else {
        const client = MCP_CLIENTS.get(scanId);
        const identity = writeConfig ? await agentIdentity(scanId, io.env) : envReferenceIdentity(scanId);
        clientPlan = clientSetupPlan(scanId, client, setupPlan.mcpUrl, io.env, identity);
        clientPlan.configPath = target.configPath;
        if (writeConfig) {
          await client.writeConfig(clientPlan.configPath, setupPlan.mcpUrl, identity, { force });
          clientPlan.written = true;
          if (profileClientConfig(scanId)) {
            const installProfile = hasFlag(optionArgs, '--yes') || hasFlag(optionArgs, '--profile');
            if (installProfile) {
              const profileTarget = defaultProfileTarget(scanId, io.env);
              const profileResult = await profileInstallResult(scanId, profileTarget, { write: true });
              clientPlan.behaviorProfile = profileResult;
              if (scanId === 'codex') {
                clientPlan.codexProfile = profileResult;
              }
            }
          }
        }
      }
      setupPlan.detectedClients.push(clientPlan);
    }
  } else if (clientId) {
    if (clientId === 'copilot-cli') {
      const proxyPort = parsePositiveInteger(optionValue(optionArgs, '--port') ?? String(DEFAULT_PROXY_PORT), '--port');
      setupPlan.selectedClient = copilotSetupPlan(setupPlan.mcpUrl, proxyPort, io.env);
      if (writeConfig) {
        await mergeCopilotMcpConfig(setupPlan.selectedClient.configPath, setupPlan.selectedClient.proxyUrl, force);
        setupPlan.selectedClient.written = true;
      }
    } else {
      const client = MCP_CLIENTS.get(clientId);
      if (!client) {
        throw new UsageError(`Unsupported MCP client: ${clientId}. Supported clients: ${supportedSetupClientIds(MCP_CLIENTS).join(', ')}.`);
      }

      const identity = writeConfig ? await agentIdentity(clientId, io.env) : envReferenceIdentity(clientId);
      setupPlan.selectedClient = clientSetupPlan(clientId, client, setupPlan.mcpUrl, io.env, identity);
      if (writeConfig) {
        await client.writeConfig(setupPlan.selectedClient.configPath, setupPlan.mcpUrl, identity, { force });
        setupPlan.selectedClient.written = true;
      }

      if (shortClientSetup && profileClientConfig(clientId)) {
        const profileTarget = optionValue(optionArgs, '--profile-target')
          ?? optionValue(optionArgs, '--target')
          ?? defaultProfileTarget(clientId, io.env);
        let installProfile = false;
        let prompted = false;
        let skipped = false;
        if (hasFlag(optionArgs, '--no-profile')) {
          skipped = true;
        } else if (dryRun) {
          installProfile = false;
        } else if (writeConfig) {
          installProfile = outputJson || hasFlag(optionArgs, '--yes') || hasFlag(optionArgs, '--profile');
          if (!installProfile && !outputJson) {
            prompted = true;
            installProfile = await confirmProfileInstall(clientId, profileTarget, io);
          }
        }
        const profileResult = await profileInstallResult(clientId, profileTarget, { write: installProfile });
        profileResult.prompted = prompted;
        profileResult.accepted = installProfile;
        profileResult.skipped = skipped;
        setupPlan.selectedClient.behaviorProfile = profileResult;
        if (clientId === 'codex') {
          setupPlan.selectedClient.codexProfile = profileResult;
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

