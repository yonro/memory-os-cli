import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseSemver,
  compareSemver,
  getGitSkillTags,
  getLatestSkillTag,
  verifySkillPinGate
} from '../scripts/check-release-version.mjs';
import { PINNED_SKILL_VERSION } from '../src/core/pins.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/check-release-version.mjs');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const CLI_VERSION = packageJson.version;

test('check-release-version: parseSemver parses valid semver and rejects invalid strings', () => {
  const v1 = parseSemver('1.1.44');
  assert.equal(v1.major, 1);
  assert.equal(v1.minor, 1);
  assert.equal(v1.patch, 44);
  assert.equal(v1.prerelease, null);

  const v2 = parseSemver('v2.0.1-beta.2');
  assert.equal(v2.major, 2);
  assert.equal(v2.minor, 0);
  assert.equal(v2.patch, 1);
  assert.equal(v2.prerelease, 'beta.2');

  assert.equal(parseSemver('invalid-version'), null);
  assert.equal(parseSemver(''), null);
  assert.equal(parseSemver(null), null);
});

test('check-release-version: compareSemver correctly orders semver numerically', () => {
  assert.ok(compareSemver('1.1.44', '1.1.35') > 0);
  assert.ok(compareSemver('1.1.35', '1.1.44') < 0);
  assert.equal(compareSemver('1.1.44', '1.1.44'), 0);
  assert.ok(compareSemver('1.1.44', '1.1.9') > 0, '1.1.44 must be greater than 1.1.9');
  assert.ok(compareSemver('2.0.0', '1.9.99') > 0);
});

test('check-release-version: getLatestSkillTag finds the highest semver skill tag', () => {
  const sampleTags = [
    'skill-v1.1.9',
    'skill-v1.1.35',
    'skill-v1.1.44',
    'skill-v1.1.10',
    'cli-v0.4.191',
    'random-tag'
  ];
  const latest = getLatestSkillTag(sampleTags);
  assert.ok(latest);
  assert.equal(latest.tag, 'skill-v1.1.44');
  assert.equal(latest.version, '1.1.44');
});

test('check-release-version: verifySkillPinGate passes when pinned version is current or newer', () => {
  const tags = ['skill-v1.1.35', 'skill-v1.1.44'];

  const passEqual = verifySkillPinGate({ pinnedVersion: '1.1.44', tagList: tags });
  assert.equal(passEqual.ok, true);
  assert.equal(passEqual.latestVersion, '1.1.44');

  const passNewer = verifySkillPinGate({ pinnedVersion: '1.1.45', tagList: tags });
  assert.equal(passNewer.ok, true);
});

test('check-release-version: verifySkillPinGate fails closed when pinned version is older than latest skill tag', () => {
  const tags = ['skill-v1.1.35', 'skill-v1.1.44'];

  const failOlder = verifySkillPinGate({ pinnedVersion: '1.1.35', tagList: tags });
  assert.equal(failOlder.ok, false);
  assert.equal(failOlder.latestVersion, '1.1.44');
  assert.match(failOlder.error, /older than the latest skill tag/);
});

test('check-release-version CLI gate: process passes with current repo tags', () => {
  const currentTags = getGitSkillTags();
  const env = currentTags.length > 0
    ? process.env
    : { ...process.env, XMEMO_OVERRIDE_SKILL_TAGS: `skill-v${PINNED_SKILL_VERSION}` };
  const res = spawnSync(process.execPath, [scriptPath, '--channel', 'cli'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, `Script failed: ${res.stderr}`);
  assert.match(res.stdout, new RegExp(`CLI pinned skill version is synchronized \\(${PINNED_SKILL_VERSION} >= skill-v`));
});

test('check-release-version CLI gate: fails closed with exit code 1 when pinned version is older than latest skill tag', () => {
  const res = spawnSync(process.execPath, [scriptPath, '--channel', 'cli'], {
    cwd: repoRoot,
    env: { ...process.env, XMEMO_OVERRIDE_SKILL_TAGS: 'skill-v9.9.9' },
    encoding: 'utf8'
  });
  assert.equal(res.status, 1, 'Must exit with code 1 on outdated skill pin');
  assert.match(res.stderr, /CLI release gate failed: PINNED_SKILL_VERSION/);
  assert.match(res.stderr, /is older than the latest skill tag \(skill-v9\.9\.9 -> 9\.9\.9\)/);
});

test('check-release-version: compareSemver throws when either version is invalid', () => {
  assert.throws(() => compareSemver('invalid', '1.1.44'), /Cannot compare invalid semver/);
  assert.throws(() => compareSemver('1.1.44', 'bad'), /Cannot compare invalid semver/);
  assert.throws(() => compareSemver('', '1.1.44'), /Cannot compare invalid semver/);
  assert.throws(() => compareSemver(null, '1.1.44'), /Cannot compare invalid semver/);
});

test('check-release-version: verifySkillPinGate fails when pinnedVersion is invalid semver', () => {
  const res = verifySkillPinGate({ pinnedVersion: 'invalid', tagList: ['skill-v1.1.44'] });
  assert.equal(res.ok, false);
  assert.match(res.error, /not a valid semver/);
});

test('check-release-version: verifySkillPinGate fails closed when requireTags is true and no tags found', () => {
  const res = verifySkillPinGate({ pinnedVersion: '1.1.44', tagList: [], requireTags: true });
  assert.equal(res.ok, false);
  assert.match(res.error, /No skill-v tags found/);
});

test('check-release-version: verifySkillPinGate skips with explicit warning when requireTags is false and no tags found', () => {
  const res = verifySkillPinGate({ pinnedVersion: '1.1.44', tagList: [], requireTags: false });
  assert.equal(res.ok, true);
  assert.equal(res.skipped, true);
  assert.match(res.warning, /No skill-v tags found in git repository; skill pin gate check was skipped/);
});

test('check-release-version CLI gate: in release mode (--tag), fails closed with exit code 1 when tags cannot be obtained', () => {
  const res = spawnSync(process.execPath, [scriptPath, '--channel', 'cli', '--tag', `cli-v${CLI_VERSION}`], {
    cwd: repoRoot,
    env: { ...process.env, XMEMO_OVERRIDE_SKILL_TAGS: ' ' },
    encoding: 'utf8'
  });
  assert.equal(res.status, 1, 'Release mode must fail when tags are missing');
  assert.match(res.stderr, /CLI release gate failed: No skill-v tags found in git repository/);
});

test('check-release-version CLI gate: in non-release mode without tags, logs explicit warning', () => {
  const res = spawnSync(process.execPath, [scriptPath, '--channel', 'cli'], {
    cwd: repoRoot,
    env: { ...process.env, XMEMO_OVERRIDE_SKILL_TAGS: ' ' },
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, `Non-release check without tags should succeed with warning: ${res.stderr}`);
  assert.match(res.stderr, /Warning: No skill-v tags found in git repository; skill pin gate check was skipped/);
});

test('check-release-version CLI gate: skips skill pin check when channel is mcp', () => {
  const res = spawnSync(process.execPath, [scriptPath, '--channel', 'mcp'], {
    cwd: repoRoot,
    env: { ...process.env, XMEMO_OVERRIDE_SKILL_TAGS: 'skill-v9.9.9' },
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, `MCP channel check must not fail on skill tags: ${res.stderr}`);
  assert.match(res.stdout, /MCP Registry metadata is synchronized/);
  assert.doesNotMatch(res.stdout, /CLI pinned skill version/);
});
