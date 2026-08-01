import fs from 'node:fs/promises';

const expectedTag = readTagArgument(process.argv.slice(2));
const packageJson = await readJson('package.json');
const packageLock = await readJson('package-lock.json');
const server = await readJson('server.json');
const marketplace = await readJson('lhm.plugin.json');
const expectedVersion = packageJson.version;

const versions = [
  ['package.json', packageJson.version],
  ['package-lock.json', packageLock.version],
  ['package-lock.json packages[""]', packageLock.packages?.['']?.version],
  ['server.json', server.version],
  ['server.json npm package', server.packages?.find((item) => item.identifier === packageJson.name)?.version],
  ['lhm.plugin.json', marketplace.version]
];

const mismatches = versions.filter(([, version]) => version !== expectedVersion);
if (mismatches.length > 0) {
  for (const [file, version] of mismatches) {
    console.error(`${file}: expected ${expectedVersion}, found ${version ?? 'missing'}`);
  }
  process.exitCode = 1;
} else if (expectedTag && expectedTag !== `v${expectedVersion}`) {
  console.error(`Release tag mismatch: expected v${expectedVersion}, found ${expectedTag}`);
  process.exitCode = 1;
} else {
  console.log(`Release metadata is synchronized at ${expectedVersion}${expectedTag ? ` (${expectedTag})` : ''}.`);
}

function readTagArgument(args) {
  const index = args.indexOf('--tag');
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value) {
    console.error('--tag requires a value such as v0.4.179');
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
