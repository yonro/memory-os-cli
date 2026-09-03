import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMAND_REGISTRY,
  SERVICE_CONTRACT_VERSION,
  commandSpec,
  unavailableCommands
} from '../src/api/contracts/command-registry.js';

test('CLI-00 freezes exactly the 12 planned domain entries', () => {
  const planned = COMMAND_REGISTRY.filter((entry) => entry.domain === 'knowledge' || entry.domain === 'dream' || entry.domain === 'cloud-skill');
  assert.equal(planned.length, 12);
  assert.deepEqual(planned.map((entry) => entry.command), [
    'knowledge.add', 'knowledge.search', 'knowledge.read', 'knowledge.update',
    'dream.preview', 'dream.show', 'dream.apply',
    'cloud-skill.add', 'cloud-skill.list', 'cloud-skill.show', 'cloud-skill.update', 'cloud-skill.run'
  ]);
});

test('CLI-00 marks unsafe Cloud Skill writes as contract-required', () => {
  assert.equal(commandSpec('cloud-skill.add').availability, 'contract-required');
  assert.equal(commandSpec('cloud-skill.update').availability, 'contract-required');
  assert.deepEqual(unavailableCommands().map((entry) => entry.command), ['cloud-skill.add', 'cloud-skill.update']);
});

test('CLI-00 records current routes and side-effect policy', () => {
  assert.equal(SERVICE_CONTRACT_VERSION, 'memory-os-openapi@2026-09-03');
  assert.equal(commandSpec('memory.search').path, '/api/v1/recall');
  assert.equal(commandSpec('context.recall').sideEffect, false);
  assert.equal(commandSpec('context.recall').method, 'POST');
  assert.equal(commandSpec('restart.restore').sideEffect, true);
  assert.equal(commandSpec('cloud-skill.run').retry, 'none');
});
