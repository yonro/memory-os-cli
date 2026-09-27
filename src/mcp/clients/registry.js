import {
  CLIENT_REGISTRY,
  createMcpClientsMap,
  supportedMcpClientIds as registrySupportedMcpClientIds,
  supportedMcpClients as registrySupportedMcpClients,
  usesClientOAuth as registryUsesClientOAuth
} from '../../clients/registry.js';

export function createMcpClients(_deps) {
  return createMcpClientsMap();
}

export function supportedMcpClients(_mcpClients) {
  return registrySupportedMcpClients();
}

export function supportedMcpClientIds(_mcpClients) {
  return registrySupportedMcpClientIds();
}

export function usesClientOAuth(clientId) {
  return registryUsesClientOAuth(clientId);
}
