import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const tag = readTagArgument(args);
const channel = readChannelArgument(args);
const packageJson = await readJson('package.json');
const packageLock = await readJson('package-lock.json');
const server = await readJson('server.json');
const marketplace = await readJson('lhm.plugin.json');
const npmPackage = server.packages?.find((item) => item.identifier === packageJson.name);

const cliVersion = packageJson.version;
const registryVersion = server.version;
const cliMismatches = [
  ['package-lock.json', packageLock.version],
  ['package-lock.json packages[""].version', packageLock.packages?.['']?.version],
  ['server.json npm package', npmPackage?.version]
].filter(([, version]) => version !== cliVersion);
const registryMismatches = [
  ['lhm.plugin.json', marketplace.version]
].filter(([, version]) => version !== registryVersion);

const activeChecks = [
  ...(channel !== 'mcp' ? [['CLI/npm', cliVersion, cliMismatches]] : []),
  ...(channel !== 'cli' ? [['MCP Registry', registryVersion, registryMismatches]] : [])
];

if (activeChecks.some(([, , mismatches]) => mismatches.length)) {
  for (const [scope, expectedVersion, mismatches] of activeChecks) {
    reportMismatches(scope, expectedVersion, mismatches);
  }
  process.exitCode = 1;
} else if (tag && !matchesReleaseTag(tag, channel, cliVersion, registryVersion)) {
  console.error(
    `Release tag mismatch: expected cli-v${cliVersion} for npm or mcp-v${registryVersion} for MCP Registry, found ${tag}`
  );
  process.exitCode = 1;
} else {
  if (channel !== 'mcp') console.log(`CLI/npm metadata is synchronized at ${cliVersion}.`);
  if (channel !== 'cli') console.log(`MCP Registry metadata is synchronized at ${registryVersion}.`);
}

function matchesReleaseTag(value, selectedChannel, cli, registry) {
  if (selectedChannel === 'cli') return value === `cli-v${cli}`;
  if (selectedChannel === 'mcp') return value === `mcp-v${registry}`;
  return value === `cli-v${cli}` || value === `mcp-v${registry}`;
}

function reportMismatches(scope, expectedVersion, mismatches) {
  for (const [file, version] of mismatches) {
    console.error(`${scope} ${file}: expected ${expectedVersion}, found ${version ?? 'missing'}`);
  }
}

function readTagArgument(args) {
  const index = args.indexOf('--tag');
  if (index === -1) return null;

  const value = args[index + 1];
  if (!value) {
    console.error('--tag requires a value such as cli-v0.4.181 or mcp-v0.4.345');
    process.exit(2);
  }
  return value;
}

function readChannelArgument(args) {
  const index = args.indexOf('--channel');
  if (index === -1) return null;

  const value = args[index + 1];
  if (value !== 'cli' && value !== 'mcp') {
    console.error('--channel requires cli or mcp');
    process.exit(2);
  }
  return value;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
}
