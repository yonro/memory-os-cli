/**
 * The deliberately small REST surface for XMemo CLI service commands.
 *
 * This registry is source-level scope, not a promise that every entry is
 * implemented. `availability` records whether the current service contract
 * can support the command safely; commands marked contract-required must not
 * fall back to an older upsert endpoint.
 */

const read = Object.freeze({ sideEffect: false, retry: 'bounded' });
const readPost = Object.freeze({ sideEffect: false, retry: 'bounded' });
const write = Object.freeze({ sideEffect: true, retry: 'none' });

export const SERVICE_CONTRACT_VERSION = 'memory-os-openapi@2026-09-03';

export const COMMAND_REGISTRY = Object.freeze([
  {
    command: 'memory.add',
    domain: 'memory',
    method: 'POST',
    path: '/api/v1/remember',
    scopes: ['memory:write'],
    availability: 'current',
    ...write
  },
  {
    command: 'memory.search',
    domain: 'memory',
    method: 'GET',
    path: '/api/v1/recall',
    scopes: ['memory:read'],
    availability: 'current',
    ...read
  },
  {
    command: 'context.recall',
    domain: 'context',
    method: 'POST',
    path: '/api/v1/recall/context',
    scopes: ['memory:read'],
    availability: 'current',
    ...readPost
  },
  {
    command: 'state.save',
    domain: 'state',
    method: 'POST',
    path: '/api/v1/update_state',
    scopes: ['memory:write'],
    availability: 'current',
    ...write
  },
  {
    command: 'state.restore',
    domain: 'state',
    method: 'POST',
    path: '/api/v1/skill/operations',
    operation: 'state-restore',
    scopes: ['memory:read'],
    availability: 'current',
    ...readPost
  },
  {
    command: 'restart.snapshot',
    domain: 'restart',
    method: 'POST',
    path: '/api/v1/restart/snapshot',
    scopes: ['memory:write'],
    availability: 'current',
    ...write
  },
  {
    command: 'restart.restore',
    domain: 'restart',
    method: 'POST',
    path: '/api/v1/restart/restore',
    scopes: ['memory:read', 'memory:restore'],
    availability: 'current',
    ...write
  },
  {
    command: 'knowledge.add',
    domain: 'knowledge',
    method: 'POST',
    path: [
      '/api/v1/knowledge-bases',
      '/api/v1/documents',
      '/api/v1/knowledge-bases/{knowledge_base_id}/items',
      '/api/v1/knowledge-bases/{knowledge_base_id}/items/from-document'
    ],
    scopes: ['knowledge:write'],
    conditionalScopes: ['memory:write', 'memory:read', 'knowledge:read'],
    scopeNotes: ['Document upload requires memory:write; extraction and existing-Document checks require memory:read. Base selection/default validation requires knowledge:read.'],
    availability: 'current',
    ...write
  },
  {
    command: 'knowledge.search',
    domain: 'knowledge',
    method: 'POST',
    path: '/api/v1/knowledge/search',
    scopes: ['knowledge:read'],
    availability: 'current',
    ...readPost
  },
  {
    command: 'knowledge.read',
    domain: 'knowledge',
    method: 'GET',
    path: [
      '/api/v1/knowledge-items/{knowledge_item_id}',
      '/api/v1/knowledge-items/{knowledge_item_id}/revisions/{knowledge_revision_id}'
    ],
    scopes: ['knowledge:read'],
    availability: 'current',
    ...read
  },
  {
    command: 'knowledge.update',
    domain: 'knowledge',
    method: 'PUT/PATCH',
    path: [
      '/api/v1/knowledge-items/{knowledge_item_id}/content',
      '/api/v1/knowledge-items/{knowledge_item_id}/content/from-document',
      '/api/v1/knowledge-items/{knowledge_item_id}'
    ],
    scopes: ['knowledge:write'],
    availability: 'current',
    ...write
  },
  {
    command: 'dream.preview',
    domain: 'dream',
    method: 'GET/POST',
    path: ['/api/v1/me/dream/settings', '/api/v1/me/dream/runs'],
    scopes: ['memory:read', 'memory:write'],
    availability: 'current',
    ...write
  },
  {
    command: 'dream.show',
    domain: 'dream',
    method: 'GET',
    path: '/api/v1/me/dream/runs/{run_id}',
    scopes: ['memory:read'],
    availability: 'current',
    ...read
  },
  {
    command: 'dream.apply',
    domain: 'dream',
    method: 'POST',
    path: '/api/v1/me/dream/runs/{run_id}/confirm',
    scopes: ['memory:write'],
    availability: 'current',
    ...write
  },
  {
    command: 'cloud-skill.add',
    domain: 'cloud-skill',
    method: 'POST',
    path: '/v1/skills/create',
    scopes: ['memory:write'],
    availability: 'contract-required',
    ...write
  },
  {
    command: 'cloud-skill.list',
    domain: 'cloud-skill',
    method: 'GET',
    path: '/v1/skills',
    scopes: ['memory:read'],
    availability: 'current',
    ...read
  },
  {
    command: 'cloud-skill.show',
    domain: 'cloud-skill',
    method: 'GET',
    path: ['/v1/skills/{skill_id}', '/v1/skills/{skill_id}/components'],
    scopes: ['memory:read'],
    availability: 'current',
    ...read
  },
  {
    command: 'cloud-skill.update',
    domain: 'cloud-skill',
    method: 'PUT',
    path: '/v1/skills/{skill_id}/content',
    scopes: ['memory:write'],
    availability: 'contract-required',
    ...write
  },
  {
    command: 'cloud-skill.run',
    domain: 'cloud-skill',
    method: 'POST',
    path: '/v1/skills/{skill_id}/execute',
    scopes: ['memory:write'],
    availability: 'current',
    ...write
  }
]);

export function commandSpec(command) {
  return COMMAND_REGISTRY.find((entry) => entry.command === command) ?? null;
}

export function commandsForDomain(domain) {
  return COMMAND_REGISTRY.filter((entry) => entry.domain === domain);
}

export function unavailableCommands() {
  return COMMAND_REGISTRY.filter((entry) => entry.availability !== 'current');
}
