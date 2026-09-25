import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { spawn } from 'node:child_process';

import { hasFlag, optionValue } from '../core/args.js';
import { CLI_VERSION, COMMAND_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';

const DEFAULT_INSTALL_DIR = 'xmemo-skill';
const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export async function skillCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return writeHelp(io);
  if (subcommand !== 'install') throw new UsageError(`Unknown skill command: ${subcommand}`);
  const optionArgs = args.slice(1);
  if (hasFlag(optionArgs, '--help') || hasFlag(optionArgs, '-h')) return writeHelp(io);

  const options = parseInstallOptions(optionArgs);
  const cwd = io.cwd ?? process.cwd();

  let fromInfo = null;
  if (options.from) {
    fromInfo = await validateFromSource(cwd, options.from);
  }

  const installerArgs = ['install'];
  if (options.target) {
    installerArgs.push('--target', path.resolve(cwd, options.target));
  }
  if (options.dryRun) {
    installerArgs.push('--dry-run');
  }
  if (options.force) {
    installerArgs.push('--force');
  }
  installerArgs.push('--json');

  let command;
  let cmdArgs;
  let sourceType;
  let spec;
  let networkUsed;

  if (fromInfo) {
    sourceType = 'local';
    spec = options.from;
    networkUsed = false;
    if (fromInfo.type === 'dir') {
      command = process.execPath;
      cmdArgs = [fromInfo.binPath, ...installerArgs];
    } else {
      command = npmExecutable();
      cmdArgs = ['exec', '--offline', '--package', fromInfo.resolved, '--', 'xmemo-skill', ...installerArgs];
    }
  } else {
    sourceType = 'npm';
    spec = options.version ?? 'latest';
    networkUsed = true;
    command = npmExecutable();
    cmdArgs = ['exec', '--yes', '--package', `@xmemo/skill@${spec}`, '--', 'xmemo-skill', ...installerArgs];
  }

  const cleanEnv = sanitizeEnv(io.env);

  let result;
  try {
    result = await executeSubprocess(command, cmdArgs, io, cleanEnv);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      if (command === npmExecutable()) {
        throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
      }
    }
    throw new UsageError(`Failed to execute ${command}: ${error.message}`);
  }

  if (result.code !== 0) {
    const rawError = (result.stderr || result.stdout || '').trim();
    const isNetworkError = networkUsed && (
      /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|request to .* failed|404 Not Found|E404|ERR_SOCKET_TIMEOUT/i.test(rawError)
    );
    if (isNetworkError) {
      throw new UsageError(`Failed to reach npm registry for @xmemo/skill@${spec}.\nError: ${rawError}\nUse --from <dir|tgz> to install offline without network access.`);
    }

    const lines = rawError.split('\n').map((l) => l.trim()).filter(Boolean);
    const matchLine = lines.find((l) => l.startsWith('Error:') || l.includes('Skill destination already exists') || l.includes('Refusing to install'))
      ?? lines[lines.length - 1]
      ?? `exit code ${result.code}`;
    const cleanMessage = matchLine.replace(/^Error:\s*/, '');
    throw new UsageError(cleanMessage);
  }

  const childReport = extractJsonReport(result.stdout);
  const target = childReport?.target ?? (options.target ? path.resolve(cwd, options.target) : path.resolve(cwd, io.env?.XMEMO_SKILL_DIR ?? DEFAULT_INSTALL_DIR));
  const skillVersion = childReport?.skillVersion ?? 'unknown';

  const report = {
    package: childReport?.package ?? '@xmemo/skill',
    cliVersion: CLI_VERSION,
    skillVersion,
    source: sourceType,
    spec,
    target,
    dryRun: options.dryRun,
    force: options.force,
    replaced: childReport?.replaced ?? false,
    installed: childReport?.installed ?? false,
    networkUsed,
    tokenSent: false
  };

  if (options.json) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
  } else {
    writeLine(io.stdout, `${report.dryRun ? 'Would install' : 'Installed'} XMemo Skill ${report.skillVersion} to ${report.target}`);
    if (report.source === 'local') {
      writeLine(io.stdout, `Source: local (${report.spec}) (offline; no credential used)`);
    } else {
      writeLine(io.stdout, `Source: npm (@xmemo/skill@${report.spec}) (no credential used)`);
    }
  }
  return 0;
}

function writeHelp(io) {
  writeLine(io.stdout, 'Skill commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill install [--version <semver>] [--from <dir|tgz>] [--target <directory>] [--dry-run] [--force] [--json]`);
  writeLine(io.stdout, 'Installs the XMemo Skill locally via @xmemo/skill (or --from offline source). It never sends credentials.');
  return 0;
}

function parseInstallOptions(args) {
  const flags = new Set(['--dry-run', '--force', '--json']);
  const seen = new Set();
  let target = null;
  let version = null;
  let from = null;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--target' || token === '--version' || token === '--from') {
      if (seen.has(token)) throw new UsageError(`Duplicate option: ${token}.`);
      const val = optionValue(args, token);
      if (token === '--target') target = val;
      if (token === '--version') version = val;
      if (token === '--from') from = val;
      seen.add(token);
      index += 1;
      continue;
    }
    if (!flags.has(token)) throw new UsageError(`Unknown skill install option: ${token}`);
    if (seen.has(token)) throw new UsageError(`Duplicate option: ${token}.`);
    seen.add(token);
  }

  if (version && from) {
    throw new UsageError('Cannot specify both --version and --from.');
  }

  if (version && !STRICT_SEMVER_REGEX.test(version)) {
    throw new UsageError(`Invalid --version: "${version}". Must be a valid semver (e.g. 1.1.25).`);
  }

  return {
    target,
    version,
    from,
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
    json: hasFlag(args, '--json')
  };
}

async function validateFromSource(cwd, fromArg) {
  const resolved = path.resolve(cwd, fromArg);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new UsageError(`Source specified by --from does not exist: ${resolved}`);
    }
    throw error;
  }

  if (stat.isDirectory()) {
    const pkgPath = path.join(resolved, 'package.json');
    let pkg;
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    } catch {
      throw new UsageError(`Invalid --from directory: ${resolved} is not an @xmemo/skill package (missing or invalid package.json).`);
    }
    if (pkg?.name !== '@xmemo/skill') {
      throw new UsageError(`Invalid --from directory: package.json name must be "@xmemo/skill", got "${pkg?.name}".`);
    }

    const binPath = path.join(resolved, 'bin', 'install.mjs');
    const binStat = await fs.stat(binPath).catch(() => null);
    if (!binStat?.isFile()) {
      throw new UsageError(`Invalid --from directory: ${resolved} missing bin/install.mjs.`);
    }

    const skillPath = path.join(resolved, 'skill');
    const skillStat = await fs.stat(skillPath).catch(() => null);
    if (!skillStat?.isDirectory()) {
      throw new UsageError(`Invalid --from directory: ${resolved} missing skill/ directory.`);
    }

    return { type: 'dir', resolved, binPath };
  }

  if (stat.isFile()) {
    if (!resolved.endsWith('.tgz') && !resolved.endsWith('.tar.gz')) {
      throw new UsageError(`Invalid --from file: ${resolved}. Must be an npm package tarball (.tgz).`);
    }
    return { type: 'tgz', resolved };
  }

  throw new UsageError(`Invalid --from source: ${resolved}. Must be a package directory or .tgz tarball.`);
}

function sanitizeEnv(baseEnv) {
  const env = { ...(baseEnv ?? process.env) };
  for (const key of Object.keys(env)) {
    if (key.startsWith('XMEMO_') && key !== 'XMEMO_SKILL_DIR') {
      delete env[key];
    }
  }
  delete env.XMEMO_KEY;
  delete env.XMEMO_TOKEN;
  delete env.XMEMO_API_KEY;
  return env;
}

function npmExecutable() {
  return os.platform() === 'win32' ? 'npm.cmd' : 'npm';
}

async function executeSubprocess(command, args, io, env) {
  const spawnFn = io.spawn ?? spawn;
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env
      });
    } catch (err) {
      if (process.platform === 'win32' && err?.code === 'EINVAL') {
        try {
          child = spawnFn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
            env
          });
        } catch (innerErr) {
          return reject(innerErr);
        }
      } else {
        return reject(err);
      }
    }

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function extractJsonReport(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch {
      // ignore
    }
  }
  return null;
}
