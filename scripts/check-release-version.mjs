import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_SKILL_VERSION, PINNED_OPENCLAW_SKILL_VERSION } from '../src/core/pins.js';

export function parseSemver(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    raw: str
  };
}

export function compareSemver(a, b) {
  const pa = typeof a === 'string' ? parseSemver(a) : a;
  const pb = typeof b === 'string' ? parseSemver(b) : b;
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.localeCompare(pb.prerelease);
  }
  return 0;
}

export function getGitSkillTags() {
  if (process.env.XMEMO_OVERRIDE_SKILL_TAGS) {
    return process.env.XMEMO_OVERRIDE_SKILL_TAGS.split(',').map((t) => t.trim()).filter(Boolean);
  }
  try {
    const out = execFileSync('git', ['tag', '-l', 'skill-v*'], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function getLatestSkillTag(tagList) {
  const tags = tagList ?? getGitSkillTags();
  const valid = tags
    .map((tag) => {
      const version = tag.replace(/^skill-v/, '');
      const semver = parseSemver(version);
      return semver ? { tag, version, semver } : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareSemver(a.semver, b.semver));

  return valid.length > 0 ? valid[valid.length - 1] : null;
}

export function verifySkillPinGate({ pinnedVersion = PINNED_SKILL_VERSION, tagList } = {}) {
  const latestTag = getLatestSkillTag(tagList);
  if (!latestTag) {
    return { ok: true, skipped: true, reason: 'no_skill_tags_found' };
  }
  const cmp = compareSemver(pinnedVersion, latestTag.version);
  if (cmp < 0) {
    return {
      ok: false,
      pinnedVersion,
      latestTag: latestTag.tag,
      latestVersion: latestTag.version,
      error: `CLI release gate failed: PINNED_SKILL_VERSION (${pinnedVersion}) in src/core/pins.js is older than the latest skill tag (${latestTag.tag} -> ${latestTag.version}). Bump PINNED_SKILL_VERSION before releasing CLI.`
    };
  }
  return {
    ok: true,
    pinnedVersion,
    latestTag: latestTag.tag,
    latestVersion: latestTag.version
  };
}

export async function checkReleaseVersion(args = process.argv.slice(2)) {
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

  let hasErrors = false;

  if (activeChecks.some(([, , mismatches]) => mismatches.length)) {
    for (const [scope, expectedVersion, mismatches] of activeChecks) {
      reportMismatches(scope, expectedVersion, mismatches);
    }
    hasErrors = true;
  }

  if (tag && !matchesReleaseTag(tag, channel, cliVersion, registryVersion)) {
    console.error(
      `Release tag mismatch: expected cli-v${cliVersion} for npm or mcp-v${registryVersion} for MCP Registry, found ${tag}`
    );
    hasErrors = true;
  }

  // CLI release gate: locked skill version in pins.js must not be older than the latest skill-v tag
  if (channel !== 'mcp') {
    const pinGateResult = verifySkillPinGate();
    if (!pinGateResult.ok) {
      console.error(pinGateResult.error);
      hasErrors = true;
    } else if (pinGateResult.latestTag) {
      console.log(`CLI pinned skill version is synchronized (${PINNED_SKILL_VERSION} >= ${pinGateResult.latestTag}).`);
    }

    if (PINNED_OPENCLAW_SKILL_VERSION !== PINNED_SKILL_VERSION) {
      console.error(
        `CLI release gate failed: PINNED_OPENCLAW_SKILL_VERSION (${PINNED_OPENCLAW_SKILL_VERSION}) does not match PINNED_SKILL_VERSION (${PINNED_SKILL_VERSION}).`
      );
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exitCode = 1;
    return false;
  }

  if (channel !== 'mcp') console.log(`CLI/npm metadata is synchronized at ${cliVersion}.`);
  if (channel !== 'cli') console.log(`MCP Registry metadata is synchronized at ${registryVersion}.`);
  return true;
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

const isMain = process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();

if (isMain) {
  await checkReleaseVersion();
}
