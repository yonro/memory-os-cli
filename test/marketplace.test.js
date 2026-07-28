import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  STATIC_PROMPTS,
  STATIC_RESOURCES,
  STATIC_TOOLS
} from '../src/mcp/stdio-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('LobeHub manifest uses the dedicated MCP server and mirrors its catalog', async () => {
  const [manifest, packageJson, serverJson] = await Promise.all([
    readJson('lhm.plugin.json'),
    readJson('package.json'),
    readJson('server.json')
  ]);

  assert.equal(manifest.version, packageJson.version);
  assert.equal(serverJson.version, packageJson.version);
  assert.equal(serverJson.packages[0].version, packageJson.version);
  assert.equal(packageJson.bin['xmemo-mcp'], 'bin/mcp-stdio.js');

  const npmDeployment = manifest.deploymentOptions.find(
    (option) => option.installationMethod === 'npm'
  );
  assert.ok(npmDeployment);
  assert.equal(npmDeployment.installationDetails.packageName, packageJson.name);
  assert.deepEqual(npmDeployment.connection, {
    type: 'stdio',
    command: 'xmemo-mcp',
    args: []
  });

  const remoteDeployment = manifest.deploymentOptions.find(
    (option) => option.connection?.type === 'http'
  );
  assert.equal(remoteDeployment.connection.url, 'https://xmemo.dev/mcp');
  assert.equal(manifest.cloudEndpoint, remoteDeployment.connection.url);

  assert.deepEqual(
    manifest.tools.map((tool) => tool.name),
    STATIC_TOOLS.map((tool) => tool.name)
  );
  assert.deepEqual(
    manifest.prompts.map((prompt) => prompt.name),
    STATIC_PROMPTS.map((prompt) => prompt.name)
  );
  assert.deepEqual(
    manifest.resources.map((resource) => resource.uri),
    STATIC_RESOURCES.map((resource) => resource.uri)
  );
});

async function readJson(fileName) {
  return JSON.parse(await readFile(path.join(root, fileName), 'utf8'));
}
