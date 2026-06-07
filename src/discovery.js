import { arrayValue, booleanValue, stringValue } from './args.js';
import { TOKEN_ENV_VAR } from './constants.js';
import { UsageError } from './errors.js';
import { endpointUrl, fetchJson } from './http.js';
import { isPlainObject } from './runtime.js';

export function ensureDiscoveryService(discovery, discoveryUrl) {
  const service = stringValue(discovery, ['service']);
  if (service && service !== 'memory-os') {
    throw new UsageError(`Discovery document at ${discoveryUrl} is for '${service}', not 'memory-os'.`);
  }
}

export function buildSetupPlan({ baseUrl, discoveryUrl, statusUrl, discovery, status, localClients }) {
  const apiBase = stringValue(discovery, ['urls', 'api_base'])
    ?? stringValue(discovery, ['api_base_url'])
    ?? baseUrl;
  const mcpUrl = stringValue(discovery, ['urls', 'mcp'])
    ?? stringValue(discovery, ['mcp_url'])
    ?? endpointUrl(apiBase, '/mcp');
  const tokenPortalUrl = stringValue(discovery, ['urls', 'token_portal'])
    ?? stringValue(discovery, ['token_portal_url'])
    ?? stringValue(status, ['requirements', 'token_portal_url']);
  const tokenEnvVar = stringValue(discovery, ['auth', 'token_env_var'])
    ?? stringValue(status, ['requirements', 'token_env_var'])
    ?? TOKEN_ENV_VAR;

  return {
    schemaVersion: '1.0',
    baseUrl,
    discoveryUrl,
    statusUrl,
    apiBase,
    mcpUrl,
    guideUrl: stringValue(discovery, ['urls', 'guide']) ?? endpointUrl(apiBase, '/guide'),
    docsUrl: stringValue(discovery, ['urls', 'docs']),
    tokenPortalUrl,
    tokenEnvVar,
    onboardingReady: booleanValue(status, ['ready']),
    supportedClients: discoveryMcpClients(discovery),
    localClients,
    privacy: {
      telemetry: false,
      tokenSent: false,
      tokenEmbeddedInConfig: false
    },
    boundaries: {
      clientAllowed: arrayValue(discovery, ['agent_boundary', 'client_allowed'])
        ?? arrayValue(status, ['agent_boundary', 'client_allowed'])
        ?? [],
      adminRequired: arrayValue(discovery, ['agent_boundary', 'admin_required'])
        ?? arrayValue(status, ['agent_boundary', 'admin_required'])
        ?? []
    }
  };
}

export async function bestEffortRootVersion(discovery, timeoutMs, io) {
  const rootDiscoveryUrl = stringValue(discovery, ['urls', 'root_discovery']);
  if (!rootDiscoveryUrl) {
    return {};
  }
  try {
    const rootDiscovery = await fetchJson(rootDiscoveryUrl, timeoutMs, io);
    return { version: stringValue(rootDiscovery, ['version']) ?? undefined };
  } catch (error) {
    return { error: error.message };
  }
}

export function discoveryMcpUrl(discovery, baseUrl) {
  return stringValue(discovery, ['api', 'mcp', 'url'])
    ?? stringValue(discovery, ['urls', 'mcp'])
    ?? endpointUrl(baseUrl, '/mcp');
}

export function agentDiscoveryClientIds(discovery) {
  const clients = Array.isArray(discovery?.clients) ? discovery.clients : [];
  const ids = clients
    .filter((client) => isPlainObject(client) && typeof client.id === 'string')
    .map((client) => client.id);
  if (ids.length > 0) {
    return ids;
  }
  const supported = arrayValue(discovery, ['supported_clients']);
  return supported ?? [];
}

export function discoveryMcpClients(discovery) {
  const clients = discovery?.clients?.mcp;
  if (!Array.isArray(clients)) {
    return [];
  }

  return clients
    .filter((client) => isPlainObject(client) && typeof client.id === 'string')
    .map((client) => ({
      id: client.id,
      configEndpoint: typeof client.config_endpoint === 'string' ? client.config_endpoint : null
    }));
}

