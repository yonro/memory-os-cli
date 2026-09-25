import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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
  const rawTarget = options.target ?? io.env?.XMEMO_SKILL_DIR ?? DEFAULT_INSTALL_DIR;
  const target = path.resolve(cwd, rawTarget);

  let fromInfo = null;
  if (options.from) {
    fromInfo = await validateFromSource(cwd, options.from);
  }

  const installerArgs = ['install', '--target', target];
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
      const npmRunner = resolveNpmRunner();
      if (!npmRunner) {
        throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
      }
      command = npmRunner.command;
      cmdArgs = [...npmRunner.prefixArgs, 'exec', '--offline', '--package', fromInfo.resolved, '--', 'xmemo-skill', ...installerArgs];
    }
  } else {
    sourceType = 'npm';
    spec = options.version ?? 'latest';
    networkUsed = true;
    const npmRunner = resolveNpmRunner();
    if (!npmRunner) {
      throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
    }
    command = npmRunner.command;
    cmdArgs = [...npmRunner.prefixArgs, 'exec', '--yes', '--package', `@xmemo/skill@${spec}`, '--', 'xmemo-skill', ...installerArgs];
  }

  const cleanEnv = sanitizeEnv(io.env);

  let result;
  try {
    result = await executeSubprocess(command, cmdArgs, io, cleanEnv, cwd);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
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
  const isValidReport = Boolean(
    childReport &&
    childReport.package === '@xmemo/skill' &&
    typeof childReport.skillVersion === 'string' &&
    STRICT_SEMVER_REGEX.test(childReport.skillVersion) &&
    typeof childReport.target === 'string' &&
    path.resolve(childReport.target) === path.resolve(target) &&
    childReport.installed === !options.dryRun
  );

  if (!isValidReport) {
    const rawOutput = (result.stderr || result.stdout || '').trim();
    const detail = rawOutput ? `\nInstaller output: ${rawOutput}` : '';
    throw new UsageError(`Skill installation failed: installer did not return a valid installation report.${detail}`);
  }

  const report = {
    package: childReport.package,
    cliVersion: CLI_VERSION,
    skillVersion: childReport.skillVersion,
    source: sourceType,
    spec,
    target,
    dryRun: options.dryRun,
    force: options.force,
    replaced: Boolean(childReport.replaced),
    installed: childReport.installed,
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
  const source = baseEnv ?? process.env;
  const env = { ...source };
  const hasPath = Object.keys(env).some((k) => k.toUpperCase() === 'PATH');
  if (!hasPath) {
    if (process.env.PATH) env.PATH = process.env.PATH;
    if (process.env.Path) env.Path = process.env.Path;
  }
  if (!env.HOME && process.env.HOME) env.HOME = process.env.HOME;
  if (!env.USERPROFILE && process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE;
  if (!env.SYSTEMROOT && process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
  if (!env.SystemRoot && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  if (!env.ComSpec && process.env.ComSpec) env.ComSpec = process.env.ComSpec;

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

function resolveNpmRunner() {
  if (process.platform === 'win32') {
    const execPath = process.env.npm_execpath;
    if (execPath && (execPath.endsWith('npm-cli.js') || execPath.endsWith('npm-cli.mjs')) && fsSync.existsSync(execPath)) {
      return { command: process.execPath, prefixArgs: [execPath] };
    }
    const standardNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fsSync.existsSync(standardNpmCli)) {
      return { command: process.execPath, prefixArgs: [standardNpmCli] };
    }
    const appDataNpmCli = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : null;
    if (appDataNpmCli && fsSync.existsSync(appDataNpmCli)) {
      return { command: process.execPath, prefixArgs: [appDataNpmCli] };
    }
    return null;
  }
  return { command: 'npm', prefixArgs: [] };
}

async function executeSubprocess(command, args, io, env, cwd) {
  const spawnFn = io.spawn ?? spawn;
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env,
        cwd
      });
    } catch (err) {
      return reject(err);
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
  let lastReport = null;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < stdout.length; i++) {
    const ch = stdout[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            const parsed = JSON.parse(stdout.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              lastReport = parsed;
            }
          } catch {
            // ignore non-JSON or invalid syntax
          }
          start = -1;
        }
      }
    }
  }
  return lastReport;
}
