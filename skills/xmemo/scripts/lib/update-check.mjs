import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { makeHttpRequest, parseJsonResponse, describeError } from './api.mjs';
import { EXIT_CODE, exitCodeForError } from './core.mjs';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const NOTIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DEFAULT_CHECK_TIMEOUT_MS = 1500; // 1500 ms

export function parseSemver(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function compareSemver(a, b) {
  const pa = typeof a === 'string' ? parseSemver(a) : a;
  const pb = typeof b === 'string' ? parseSemver(b) : b;
  if (!pa || !pb) {
    const invalid = !pa ? a : b;
    throw new Error(`Cannot compare invalid semver: ${JSON.stringify(invalid)}`);
  }
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

export function isUpdateCheckDisabled() {
  const env = process.env;
  const noCheck = env.XMEMO_NO_UPDATE_CHECK;
  if (noCheck === '1' || String(noCheck).toLowerCase() === 'true') return true;
  const ci = env.CI;
  if (ci !== undefined && ci !== null && ci !== '' && ci !== '0' && String(ci).toLowerCase() !== 'false') {
    return true;
  }
  return false;
}

export function getUpdateCheckCachePath() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.xmemo', 'skill-update-check.json');
}

export async function readUpdateCheckCache(cachePath = getUpdateCheckCachePath()) {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeUpdateCheckCache(cachePath = getUpdateCheckCachePath(), data) {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch {
    // Fail silently on cache write failure
  }
}

export function parseTimestamp(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const ts = Date.parse(val);
  return Number.isNaN(ts) ? 0 : ts;
}

export async function fetchLatestSkillVersion(baseUrl, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS) {
  const res = await makeHttpRequest(baseUrl, '/.well-known/agent-discovery.json', 'GET', null, {}, timeoutMs);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const err = new Error(`Server returned HTTP ${res.statusCode}`);
    err.statusCode = res.statusCode;
    throw err;
  }
  const data = parseJsonResponse(res, 'Agent discovery');
  const standalone = data?.standalone_skill ?? data?.integrations?.standalone_skill ?? {};
  const rawVersion = standalone.package?.version;
  if (!rawVersion || typeof rawVersion !== 'string') {
    throw new Error('No skill package version found in agent-discovery.json');
  }
  const cleaned = rawVersion.replace(/^skill-v/i, '').trim();
  const parsed = parseSemver(cleaned);
  if (!parsed) {
    throw new Error(`Invalid skill package version in agent-discovery.json: ${rawVersion}`);
  }
  return cleaned;
}

export async function checkSkillUpdateOnDemand({ baseUrl, localVersion, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS }) {
  const latest = await fetchLatestSkillVersion(baseUrl, timeoutMs);
  const cmp = compareSemver(latest, localVersion);
  const hasUpdate = cmp > 0;

  try {
    const cachePath = getUpdateCheckCachePath();
    const existing = await readUpdateCheckCache(cachePath);
    await writeUpdateCheckCache(cachePath, {
      lastCheck: new Date().toISOString(),
      latestVersion: latest,
      notifiedVersion: existing?.notifiedVersion ?? null,
      notifiedAt: existing?.notifiedAt ?? null,
    });
  } catch {
    // Fail silently on cache update
  }

  return {
    installed: localVersion,
    latest,
    update_available: hasUpdate,
  };
}

export async function maybeCheckForSkillUpdate({ baseUrl, localVersion, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS }) {
  if (isUpdateCheckDisabled()) return;

  try {
    const cachePath = getUpdateCheckCachePath();
    const cache = await readUpdateCheckCache(cachePath);
    const now = Date.now();

    const lastCheckTs = parseTimestamp(cache?.lastCheck);
    if (lastCheckTs > 0 && (now - lastCheckTs < CHECK_INTERVAL_MS)) {
      return;
    }

    let latestVersion = null;
    try {
      latestVersion = await fetchLatestSkillVersion(baseUrl, timeoutMs);
    } catch {
      await writeUpdateCheckCache(cachePath, {
        lastCheck: new Date(now).toISOString(),
        latestVersion: cache?.latestVersion ?? null,
        notifiedVersion: cache?.notifiedVersion ?? null,
        notifiedAt: cache?.notifiedAt ?? null,
      });
      return;
    }

    if (!latestVersion) return;

    const hasUpdate = compareSemver(latestVersion, localVersion) > 0;
    if (!hasUpdate) {
      await writeUpdateCheckCache(cachePath, {
        lastCheck: new Date(now).toISOString(),
        latestVersion,
        notifiedVersion: cache?.notifiedVersion ?? null,
        notifiedAt: cache?.notifiedAt ?? null,
      });
      return;
    }

    const notifiedAtTs = parseTimestamp(cache?.notifiedAt);
    const isDifferentVersion = cache?.notifiedVersion !== latestVersion;
    const isSevenDaysPassed = notifiedAtTs === 0 || (now - notifiedAtTs >= NOTIFY_INTERVAL_MS);

    if (isDifferentVersion || isSevenDaysPassed) {
      console.error(
        `XMEMO_UPDATE_AVAILABLE: XMemo Skill ${latestVersion} is available (installed ${localVersion}). Ask the user once before updating; run: node scripts/xmemo-skill.mjs upgrade`
      );
      await writeUpdateCheckCache(cachePath, {
        lastCheck: new Date(now).toISOString(),
        latestVersion,
        notifiedVersion: latestVersion,
        notifiedAt: new Date(now).toISOString(),
      });
    } else {
      await writeUpdateCheckCache(cachePath, {
        lastCheck: new Date(now).toISOString(),
        latestVersion,
        notifiedVersion: cache?.notifiedVersion ?? null,
        notifiedAt: cache?.notifiedAt ?? null,
      });
    }
  } catch {
    // Fail closed/silent: never crash or interfere with command execution
  }
}

export async function checkUpdate(ctx) {
  if (!ctx) return;
  return maybeCheckForSkillUpdate({
    baseUrl: ctx.options?.baseUrl,
    localVersion: ctx.skillVersion,
  });
}

export async function handleVersionCheck({ options, skillVersion }) {
  try {
    const result = await checkSkillUpdateOnDemand({
      baseUrl: options.baseUrl,
      localVersion: skillVersion,
      timeoutMs: options.timeoutMs ? Math.min(options.timeoutMs, 5000) : DEFAULT_CHECK_TIMEOUT_MS,
    });
    if (options.json) {
      console.log(JSON.stringify(result));
      process.exit(EXIT_CODE.SUCCESS);
    }
    console.log(`Installed: ${result.installed}`);
    console.log(`Latest:    ${result.latest}`);
    console.log(`Update available: ${result.update_available ? 'yes' : 'no'}`);
    process.exit(EXIT_CODE.SUCCESS);
  } catch (err) {
    const exitCode = exitCodeForError(err) || EXIT_CODE.SERVER_ERROR;
    const finalExitCode = exitCode === EXIT_CODE.SUCCESS ? EXIT_CODE.SERVER_ERROR : exitCode;
    if (options.json) {
      console.log(JSON.stringify({
        ok: false,
        error: {
          code: 'update_check_failed',
          message: err?.message || 'Version check failed',
        },
      }));
    } else {
      console.error(`Error: Version check failed: ${describeError(err)}`);
    }
    process.exit(finalExitCode);
  }
}
