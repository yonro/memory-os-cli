import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { hasFlag, optionValue } from '../core/args.js';
import { CLI_VERSION, COMMAND_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { PINNED_SKILL_VERSION, PINNED_SKILL_INTEGRITY } from '../core/pins.js';
import {
  getClient,
  supportedSkillClientIds,
  supportedSkillClients
} from '../clients/registry.js';

const DEFAULT_INSTALL_DIR = 'xmemo-skill';
const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function userHome(env) {
  return env?.USERPROFILE || env?.HOME || os.homedir();
}

function extractPositionalArgs(args, optionsWithValues = []) {
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (optionsWithValues.includes(arg)) {
      i++;
      continue;
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }
  return positionals;
}

async function readLineFromStdin(stdin) {
  if (!stdin) return '';
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
    if (input.includes('\n')) {
      break;
    }
  }
  return input.split(/\r?\n/, 1)[0] ?? '';
}

export function computeTarballIntegrity(buffer) {
  const hash = createHash('sha512').update(buffer).digest('base64');
  return `sha512-${hash}`;
}

export function verifyTarballIntegrity(tarballBufferOrPath, expectedIntegrity = PINNED_SKILL_INTEGRITY) {
  let buffer;
  if (typeof tarballBufferOrPath === 'string') {
    buffer = fsSync.readFileSync(tarballBufferOrPath);
  } else {
    buffer = tarballBufferOrPath;
  }
  const actual = computeTarballIntegrity(buffer);
  if (actual !== expectedIntegrity) {
    throw new UsageError(`Tarball integrity mismatch: expected "${expectedIntegrity}", got "${actual}". Refusing to extract.`);
  }
  return true;
}

export async function isXMemoSkillDirectory(targetDir) {
  try {
    const stat = await fs.stat(targetDir).catch(() => null);
    if (!stat || !stat.isDirectory()) return false;
    const base = path.basename(targetDir);
    if (base !== 'xmemo-memory' && base !== 'xmemo-skill') {
      return false;
    }
    const skillMdPath = path.join(targetDir, 'SKILL.md');
    const skillScriptPath = path.join(targetDir, 'scripts', 'xmemo-skill.mjs');
    const [hasScript, hasMd] = await Promise.all([
      fs.stat(skillScriptPath).then((s) => s.isFile()).catch(() => false),
      fs.stat(skillMdPath).then((s) => s.isFile()).catch(() => false)
    ]);
    if (!hasScript && !hasMd) return false;
    if (hasMd) {
      const content = await fs.readFile(skillMdPath, 'utf8');
      if (!/xmemo/i.test(content)) return false;
    }
    if (hasScript) {
      const scriptContent = await fs.readFile(skillScriptPath, 'utf8');
      if (!/SKILL_VERSION/i.test(scriptContent)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function extractSkillVersionFromDirectory(targetDir) {
  try {
    const skillScriptPath = path.join(targetDir, 'scripts', 'xmemo-skill.mjs');
    const content = await fs.readFile(skillScriptPath, 'utf8');
    const match = content.match(/const SKILL_VERSION = '([^']+)';/);
    if (match?.[1]) return match[1];
  } catch {}
  try {
    const pkgJsonPath = path.join(targetDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));
    if (pkg?.version) return pkg.version;
  } catch {}
  return null;
}

export function clientSkillBackupDir(clientId, env) {
  const home = userHome(env);
  return path.join(home, '.xmemo', 'backups', 'skills', clientId, 'xmemo-memory');
}

export async function backupSkillDirectory(targetDir, options = {}) {
  let backupDir;
  if (options.clientId) {
    backupDir = clientSkillBackupDir(options.clientId, options.env);
  } else {
    const home = userHome(options.env);
    backupDir = path.join(home, '.xmemo', 'backups', 'skills', 'custom', path.basename(targetDir));
  }
  await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(path.dirname(backupDir), { recursive: true });
  await fs.cp(targetDir, backupDir, { recursive: true });
  return backupDir;
}

export function writeSkillHelp(io) {
  writeLine(io.stdout, 'Skill commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill install [--client <id>|--all] [--project] [--dir <path>] [--dry-run] [--yes] [--force] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} skill status [--client <id>|--all] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} skill remove --client <id> [--project] [--yes] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} skill update [--client <id>|--all] [--dry-run] [--yes] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Install, inspect, and manage the verified XMemo Skill for AI agents.');
  return 0;
}

export async function skillCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h' || subcommand.startsWith('-') || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify({
        schemaVersion: '1',
        ok: true,
        command: 'skill',
        data: {
          subcommands: ['install', 'status', 'remove', 'update'],
          supportedClients: supportedSkillClientIds()
        },
        error: null
      }, null, 2));
      return 0;
    }
    return writeSkillHelp(io);
  }

  const optionArgs = args.slice(1);
  if (hasFlag(optionArgs, '--help') || hasFlag(optionArgs, '-h')) {
    return writeSkillHelp(io);
  }

  if (subcommand === 'install') {
    return await skillInstall(optionArgs, io);
  }
  if (subcommand === 'status') {
    return await skillStatus(optionArgs, io);
  }
  if (subcommand === 'remove') {
    return await skillRemove(optionArgs, io);
  }
  if (subcommand === 'update') {
    return await skillInstall([...optionArgs, '--force'], io);
  }

  throw new UsageError(`Unknown skill command: ${subcommand}`);
}

export async function skillInstall(args, io) {
  const options = parseInstallOptions(args);
  const cwd = io.cwd ?? process.cwd();

  // Validate argument combinations
  if (options.client && options.all) {
    throw new UsageError('Cannot specify both --client and --all.');
  }
  if (options.client && options.dir) {
    throw new UsageError('Cannot specify both --client and --dir.');
  }
  if (options.all && options.dir) {
    throw new UsageError('Cannot specify both --all and --dir.');
  }
  if (options.project && !options.client) {
    throw new UsageError('--project requires --client <id>.');
  }

  const isClientInstall = Boolean(options.client || options.all);

  // If not a client install (--client or --all), preserve Phase 5 directory install exactly
  if (!isClientInstall) {
    return await directorySkillInstall(options, cwd, io);
  }

  // Client install flow
  return await clientSkillInstall(options, cwd, io);
}

async function directorySkillInstall(options, cwd, io) {
  const rawTarget = options.dir ?? io.env?.XMEMO_SKILL_DIR ?? DEFAULT_INSTALL_DIR;
  const target = path.resolve(cwd, rawTarget);

  let fromInfo = null;
  if (options.from) {
    fromInfo = await validateFromSource(cwd, options.from);
    if (fromInfo.type === 'tgz' && options.integrity) {
      verifyTarballIntegrity(fromInfo.resolved, options.integrity);
    }
  }

  const installerArgs = ['install', '--target', target];
  if (options.dryRun) {
    installerArgs.push('--dry-run');
  }
  if (options.force) {
    installerArgs.push('--force');
  }
  installerArgs.push('--json');

  let tempPackDir = null;
  const cleanEnv = sanitizeEnv(io.env);

  try {
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
      spec = options.version ?? PINNED_SKILL_VERSION;
      networkUsed = true;
      const npmRunner = resolveNpmRunner();
      if (!npmRunner) {
        throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
      }

      let expectedIntegrity = options.integrity;
      if (!expectedIntegrity) {
        if (!options.version || options.version === PINNED_SKILL_VERSION) {
          expectedIntegrity = PINNED_SKILL_INTEGRITY;
        } else {
          // Explicit --version <semver|latest> requires querying registry dist.integrity
          const viewArgs = [...npmRunner.prefixArgs, 'view', `@xmemo/skill@${spec}`, 'dist.integrity', '--json'];
          const viewCmdText = [npmRunner.command, ...viewArgs].join(' ');
          if (!options.json) {
            writeLine(io.stdout, `${options.dryRun ? 'Would run' : 'Running'}: ${viewCmdText}`);
          }
          let viewResult;
          try {
            viewResult = await executeSubprocess(npmRunner.command, viewArgs, io, cleanEnv, cwd);
          } catch (error) {
            if (error?.code === 'ENOENT') {
              throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
            }
            throw new UsageError(`Failed to execute ${npmRunner.command}: ${error.message}`);
          }
          if (viewResult.code !== 0) {
            const rawError = (viewResult.stderr || viewResult.stdout || '').trim();
            const isNetworkError = /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|request to .* failed|404 Not Found|E404|ERR_SOCKET_TIMEOUT/i.test(rawError);
            if (isNetworkError) {
              throw new UsageError(`Failed to reach npm registry for @xmemo/skill@${spec}.\nError: ${rawError}\nUse --from <dir|tgz> to install offline without network access.`);
            }
            throw new UsageError(`Failed to query npm registry for @xmemo/skill@${spec}: ${rawError}`);
          }
          try {
            const parsed = JSON.parse(viewResult.stdout.trim());
            expectedIntegrity = typeof parsed === 'string' ? parsed.trim() : (parsed?.integrity || parsed?.['dist.integrity'] || '');
          } catch {
            expectedIntegrity = viewResult.stdout.trim().replace(/^"|"$/g, '');
          }
          if (!expectedIntegrity || !/^sha512-[A-Za-z0-9+/=]+$/.test(expectedIntegrity)) {
            throw new UsageError(`Invalid or missing integrity for @xmemo/skill@${spec} from npm registry.`);
          }
        }
      }

      tempPackDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-pack-'));
      const packArgs = [...npmRunner.prefixArgs, 'pack', `@xmemo/skill@${spec}`, '--pack-destination', tempPackDir, '--json'];
      const packCmdText = [npmRunner.command, ...packArgs].join(' ');
      if (!options.json) {
        writeLine(io.stdout, `${options.dryRun ? 'Would run' : 'Running'}: ${packCmdText}`);
      }

      let packResult;
      try {
        packResult = await executeSubprocess(npmRunner.command, packArgs, io, cleanEnv, cwd);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
        }
        throw new UsageError(`Failed to execute ${npmRunner.command}: ${error.message}`);
      }

      if (packResult.code !== 0) {
        const rawError = (packResult.stderr || packResult.stdout || '').trim();
        const isNetworkError = /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|request to .* failed|404 Not Found|E404|ERR_SOCKET_TIMEOUT/i.test(rawError);
        if (isNetworkError) {
          throw new UsageError(`Failed to reach npm registry for @xmemo/skill@${spec}.\nError: ${rawError}\nUse --from <dir|tgz> to install offline without network access.`);
        }
        throw new UsageError(`npm pack failed for @xmemo/skill@${spec}: ${rawError}`);
      }

      let tgzPath = null;
      try {
        const packInfoList = JSON.parse(packResult.stdout.trim());
        if (Array.isArray(packInfoList) && packInfoList[0]?.filename) {
          tgzPath = path.join(tempPackDir, packInfoList[0].filename);
        }
      } catch {}

      if (!tgzPath || !fsSync.existsSync(tgzPath)) {
        const files = await fs.readdir(tempPackDir);
        const tgzFile = files.find((f) => f.endsWith('.tgz') || f.endsWith('.tar.gz'));
        if (tgzFile) {
          tgzPath = path.join(tempPackDir, tgzFile);
        }
      }

      if (!tgzPath || !fsSync.existsSync(tgzPath)) {
        throw new UsageError(`Downloaded tarball not found in ${tempPackDir}. Refusing to install.`);
      }

      verifyTarballIntegrity(tgzPath, expectedIntegrity);

      command = npmRunner.command;
      cmdArgs = [...npmRunner.prefixArgs, 'exec', '--offline', '--package', tgzPath, '--', 'xmemo-skill', ...installerArgs];
    }

    const execCommandText = [command, ...cmdArgs].join(' ');
    if (!options.json) {
      writeLine(io.stdout, `${options.dryRun ? 'Would run' : 'Running'}: ${execCommandText}`);
    }

    let result;
    try {
      result = await executeSubprocess(command, cmdArgs, io, cleanEnv, cwd);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
      }
      throw new UsageError(`Failed to execute child installer: ${error.message}`);
    }

    if (result.code !== 0) {
      const rawError = (result.stderr || result.stdout || '').trim();
      const cleanMsg = rawError.replace(/^Error:\s*/, '').split('\n')[0] ?? `exit code ${result.code}`;
      throw new UsageError(`Skill installation failed: ${cleanMsg}`);
    }

    const childReport = extractJsonReport(result.stdout);
    if (
      !childReport ||
      childReport.package !== '@xmemo/skill' ||
      !STRICT_SEMVER_REGEX.test(childReport.skillVersion) ||
      childReport.target !== target ||
      (options.dryRun && childReport.installed !== false)
    ) {
      throw new UsageError('Child installer did not return a valid installation report.');
    }

    const report = {
      package: childReport.package,
      cliVersion: CLI_VERSION,
      skillVersion: childReport.skillVersion,
      source: sourceType,
      spec,
      target,
      command: execCommandText,
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
  } finally {
    if (tempPackDir) {
      await fs.rm(tempPackDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function clientSkillInstall(options, cwd, io) {
  const targets = [];
  if (options.client) {
    const client = getClient(options.client);
    if (!client) {
      throw new UsageError(`Unknown client: "${options.client}". Supported skill clients: ${supportedSkillClientIds().join(', ')}.`);
    }
    if (!client.skillDir) {
      throw new UsageError(`Client "${client.label}" does not support skill installation. Supported skill clients: ${supportedSkillClientIds().join(', ')}.`);
    }
    if (options.project && !client.supportsProjectSkill) {
      throw new UsageError(`Client "${client.label}" does not support project-level skills.`);
    }
    const resolvedTarget = path.resolve(client.skillDir(io.env, { project: options.project, cwd }));
    targets.push({
      client,
      target: resolvedTarget,
      project: options.project
    });
  } else if (options.all) {
    for (const client of supportedSkillClients()) {
      const clientObj = getClient(client.id);
      const det = await clientObj.detect(io.env, { cwd });
      if (det?.detected) {
        targets.push({
          client: clientObj,
          target: path.resolve(clientObj.skillDir(io.env, { project: false, cwd })),
          project: false
        });
      }
    }
    if (targets.length === 0) {
      if (options.json) {
        writeLine(io.stdout, JSON.stringify({
          ok: true,
          installed: false,
          targets: [],
          message: 'No supported clients with skill directories were detected.'
        }, null, 2));
        return 0;
      }
      writeLine(io.stdout, 'No supported clients with skill directories were detected.');
      return 0;
    }
  }

  // Pre-install checks: existing directories and versions
  for (const t of targets) {
    const stat = await fs.stat(t.target).catch(() => null);
    if (stat) {
      t.exists = true;
      t.existingVersion = await extractSkillVersionFromDirectory(t.target);
      if (!options.force) {
        throw new UsageError(`Skill destination already exists: ${t.target} (version: ${t.existingVersion ?? 'unknown'}). Use --force to replace.`);
      }
    } else {
      t.exists = false;
      t.existingVersion = null;
    }
  }

  // Consent prompt unless --yes or --dry-run
  if (!options.yes && !options.dryRun) {
    if (options.json) {
      writeLine(io.stdout, JSON.stringify({
        ok: false,
        consentRequired: true,
        installed: false,
        targets: targets.map((t) => t.target)
      }, null, 2));
      return 0;
    }

    if (targets.length === 1) {
      writeLine(io.stdout, `Install XMemo skill to ${targets[0].target}? [y/N]`);
    } else {
      writeLine(io.stdout, 'Install XMemo skill to:');
      for (const t of targets) {
        writeLine(io.stdout, `  - ${t.target} (${t.client.label})`);
      }
      writeLine(io.stdout, 'Proceed with installation? [y/N]');
    }
    const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      writeLine(io.stdout, 'Installation cancelled.');
      return 0;
    }
  }

  // Dry run
  const spec = options.version ?? PINNED_SKILL_VERSION;
  if (options.dryRun) {
    if (options.json) {
      writeLine(io.stdout, JSON.stringify({
        ok: true,
        dryRun: true,
        targets: targets.map((t) => ({
          client: t.client.id,
          target: t.target,
          exists: t.exists,
          existingVersion: t.existingVersion,
          backup: t.exists ? clientSkillBackupDir(t.client.id, io.env) : null
        }))
      }, null, 2));
      return 0;
    }

    for (const t of targets) {
      if (t.exists) {
        const backupPath = clientSkillBackupDir(t.client.id, io.env);
        writeLine(io.stdout, `Would backup ${t.target} to ${backupPath}`);
      }
      writeLine(io.stdout, `Would install XMemo Skill ${spec} to ${t.target}`);
    }
    return 0;
  }

  // Real execution
  let fromInfo = null;
  if (options.from) {
    fromInfo = await validateFromSource(cwd, options.from);
    if (fromInfo.type === 'tgz' && options.integrity) {
      verifyTarballIntegrity(fromInfo.resolved, options.integrity);
    }
  }

  let tempPackDir = null;
  const cleanEnv = sanitizeEnv(io.env);

  try {
    let command;
    let baseCmdArgs;
    let sourceType;
    let networkUsed;

    if (fromInfo) {
      sourceType = 'local';
      networkUsed = false;
      if (fromInfo.type === 'dir') {
        command = process.execPath;
        baseCmdArgs = [fromInfo.binPath, 'install'];
      } else {
        const npmRunner = resolveNpmRunner();
        if (!npmRunner) {
          throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
        }
        command = npmRunner.command;
        baseCmdArgs = [...npmRunner.prefixArgs, 'exec', '--offline', '--package', fromInfo.resolved, '--', 'xmemo-skill', 'install'];
      }
    } else {
      sourceType = 'npm';
      networkUsed = true;
      const npmRunner = resolveNpmRunner();
      if (!npmRunner) {
        throw new UsageError('npm is not installed or not available on PATH. Use --from <dir|tgz> to install offline.');
      }

      let expectedIntegrity = options.integrity;
      if (!expectedIntegrity) {
        if (!options.version || options.version === PINNED_SKILL_VERSION) {
          expectedIntegrity = PINNED_SKILL_INTEGRITY;
        } else {
          const viewArgs = [...npmRunner.prefixArgs, 'view', `@xmemo/skill@${spec}`, 'dist.integrity', '--json'];
          const viewResult = await executeSubprocess(npmRunner.command, viewArgs, io, cleanEnv, cwd);
          if (viewResult.code !== 0) {
            const rawError = (viewResult.stderr || viewResult.stdout || '').trim();
            const isNetworkError = /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|request to .* failed|404 Not Found|E404|ERR_SOCKET_TIMEOUT/i.test(rawError);
            if (isNetworkError) {
              throw new UsageError(`Failed to reach npm registry for @xmemo/skill@${spec}.\nError: ${rawError}\nUse --from <dir|tgz> to install offline without network access.`);
            }
            throw new UsageError(`Failed to query npm registry for @xmemo/skill@${spec}: ${rawError}`);
          }
          try {
            const parsed = JSON.parse(viewResult.stdout.trim());
            expectedIntegrity = typeof parsed === 'string' ? parsed.trim() : (parsed?.integrity || parsed?.['dist.integrity'] || '');
          } catch {
            expectedIntegrity = viewResult.stdout.trim().replace(/^"|"$/g, '');
          }
          if (!expectedIntegrity || !/^sha512-[A-Za-z0-9+/=]+$/.test(expectedIntegrity)) {
            throw new UsageError(`Invalid or missing integrity for @xmemo/skill@${spec} from npm registry.`);
          }
        }
      }

      tempPackDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmemo-skill-pack-'));
      const packArgs = [...npmRunner.prefixArgs, 'pack', `@xmemo/skill@${spec}`, '--pack-destination', tempPackDir, '--json'];
      const packResult = await executeSubprocess(npmRunner.command, packArgs, io, cleanEnv, cwd);
      if (packResult.code !== 0) {
        const rawError = (packResult.stderr || packResult.stdout || '').trim();
        const isNetworkError = /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|request to .* failed|404 Not Found|E404|ERR_SOCKET_TIMEOUT/i.test(rawError);
        if (isNetworkError) {
          throw new UsageError(`Failed to reach npm registry for @xmemo/skill@${spec}.\nError: ${rawError}\nUse --from <dir|tgz> to install offline without network access.`);
        }
        throw new UsageError(`npm pack failed for @xmemo/skill@${spec}: ${rawError}`);
      }

      let tgzPath = null;
      try {
        const packInfoList = JSON.parse(packResult.stdout.trim());
        if (Array.isArray(packInfoList) && packInfoList[0]?.filename) {
          tgzPath = path.join(tempPackDir, packInfoList[0].filename);
        }
      } catch {}

      if (!tgzPath || !fsSync.existsSync(tgzPath)) {
        const files = await fs.readdir(tempPackDir);
        const tgzFile = files.find((f) => f.endsWith('.tgz') || f.endsWith('.tar.gz'));
        if (tgzFile) {
          tgzPath = path.join(tempPackDir, tgzFile);
        }
      }

      if (!tgzPath || !fsSync.existsSync(tgzPath)) {
        throw new UsageError(`Downloaded tarball not found in ${tempPackDir}. Refusing to install.`);
      }

      verifyTarballIntegrity(tgzPath, expectedIntegrity);

      command = npmRunner.command;
      baseCmdArgs = [...npmRunner.prefixArgs, 'exec', '--offline', '--package', tgzPath, '--', 'xmemo-skill', 'install'];
    }

    // Backup existing directories outside the agent skills directory
    for (const t of targets) {
      if (t.exists && options.force) {
        t.backup = await backupSkillDirectory(t.target, { clientId: t.client.id, env: io.env });
      }
    }

    // Install to each target
    const reports = [];
    for (const t of targets) {
      const targetArgs = [...baseCmdArgs, '--target', t.target, ...(options.force ? ['--force'] : []), '--json'];
      const result = await executeSubprocess(command, targetArgs, io, cleanEnv, cwd);
      if (result.code !== 0) {
        const rawError = (result.stderr || result.stdout || '').trim();
        const cleanMsg = rawError.replace(/^Error:\s*/, '').split('\n')[0] ?? `exit code ${result.code}`;
        throw new UsageError(`Installation to ${t.target} failed: ${cleanMsg}`);
      }

      const childReport = extractJsonReport(result.stdout);
      if (!childReport || childReport.package !== '@xmemo/skill') {
        throw new UsageError(`Child installer did not return a valid installation report for ${t.target}.`);
      }

      reports.push({
        package: childReport.package,
        cliVersion: CLI_VERSION,
        skillVersion: childReport.skillVersion ?? PINNED_SKILL_VERSION,
        source: sourceType,
        spec,
        client: t.client.id,
        target: t.target,
        backup: t.backup ?? null,
        force: options.force,
        installed: true
      });
    }

    if (options.json) {
      writeLine(io.stdout, JSON.stringify(options.client ? reports[0] : { ok: true, installs: reports }, null, 2));
    } else {
      for (const r of reports) {
        writeLine(io.stdout, `Installed XMemo Skill ${r.skillVersion} to ${r.target}`);
        if (r.backup) {
          writeLine(io.stdout, `  Backup created: ${r.backup}`);
        }
      }
    }
    return 0;
  } finally {
    if (tempPackDir) {
      await fs.rm(tempPackDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function skillStatus(args, io) {
  const optionsWithValues = ['--client'];
  const positionals = extractPositionalArgs(args, optionsWithValues);
  if (positionals.length > 0) {
    throw new UsageError(`Unexpected arguments for skill status: ${positionals.join(', ')}.`);
  }

  const clientId = optionValue(args, '--client');
  const all = hasFlag(args, '--all');
  const project = hasFlag(args, '--project');
  const isJson = hasFlag(args, '--json');
  const cwd = io.cwd ?? process.cwd();

  if (clientId && all) {
    throw new UsageError('Cannot specify both --client and --all.');
  }
  if (project && !clientId) {
    throw new UsageError('--project requires --client <id>.');
  }

  const targets = [];
  if (clientId) {
    const client = getClient(clientId);
    if (!client) {
      throw new UsageError(`Unknown client: "${clientId}". Supported skill clients: ${supportedSkillClientIds().join(', ')}.`);
    }
    if (!client.skillDir) {
      throw new UsageError(`Client "${client.label}" does not support skill installation. Supported skill clients: ${supportedSkillClientIds().join(', ')}.`);
    }
    if (project && !client.supportsProjectSkill) {
      throw new UsageError(`Client "${client.label}" does not support project-level skills.`);
    }
    const resolvedPath = path.resolve(client.skillDir(io.env, { project, cwd }));
    targets.push({
      client: client.id,
      label: client.label,
      scope: project ? 'project' : 'user',
      path: resolvedPath
    });
  } else {
    // All skill clients
    for (const c of supportedSkillClients()) {
      const clientObj = getClient(c.id);
      targets.push({
        client: clientObj.id,
        label: clientObj.label,
        scope: 'user',
        path: path.resolve(clientObj.skillDir(io.env, { project: false, cwd }))
      });
      if (clientObj.supportsProjectSkill) {
        const projectPath = path.resolve(clientObj.skillDir(io.env, { project: true, cwd }));
        targets.push({
          client: clientObj.id,
          label: clientObj.label,
          scope: 'project',
          path: projectPath
        });
      }
    }
  }

  // Check status for each target
  for (const t of targets) {
    const exists = await fs.stat(t.path).catch(() => null);
    if (exists && exists.isDirectory()) {
      t.installed = true;
      t.version = await extractSkillVersionFromDirectory(t.path);
    } else {
      t.installed = false;
      t.version = null;
    }
  }

  if (isJson) {
    writeLine(io.stdout, JSON.stringify({ ok: true, targets }, null, 2));
    return 0;
  }

  for (const t of targets) {
    writeLine(io.stdout, `Client: ${t.label} (${t.client})${t.scope ? ` [${t.scope}]` : ''}`);
    writeLine(io.stdout, `  Status: ${t.installed ? 'installed' : 'not installed'}`);
    writeLine(io.stdout, `  Path: ${t.path}`);
    if (t.installed) {
      writeLine(io.stdout, `  Version: ${t.version ?? 'unknown'}`);
    }
  }
  return 0;
}

export async function skillRemove(args, io) {
  const optionsWithValues = ['--client'];
  const positionals = extractPositionalArgs(args, optionsWithValues);
  if (positionals.length > 0) {
    throw new UsageError(`Unexpected arguments for skill remove: ${positionals.join(', ')}.`);
  }

  const rawClient = optionValue(args, '--client');
  if (!rawClient) {
    throw new UsageError('skill remove requires --client <id>.');
  }

  const client = getClient(rawClient);
  if (!client) {
    throw new UsageError(`Unknown client: "${rawClient}". Supported skill clients: ${supportedSkillClientIds().join(', ')}.`);
  }
  if (!client.skillDir) {
    throw new UsageError(`Client "${client.label}" does not have a skill directory.`);
  }

  const project = hasFlag(args, '--project');
  if (project && !client.supportsProjectSkill) {
    throw new UsageError(`Client "${client.label}" does not support project-level skills.`);
  }

  const cwd = io.cwd ?? process.cwd();
  const targetPath = path.resolve(client.skillDir(io.env, { project, cwd }));
  const isJson = hasFlag(args, '--json');
  const yes = hasFlag(args, '--yes');

  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    if (isJson) {
      writeLine(io.stdout, JSON.stringify({
        ok: true,
        removed: false,
        client: client.id,
        target: targetPath,
        reason: 'not_installed'
      }, null, 2));
      return 0;
    }
    writeLine(io.stdout, `Skill is not installed for ${client.label} at ${targetPath}.`);
    return 0;
  }

  // Safety check: verify folder is an XMemo skill
  const isSkill = await isXMemoSkillDirectory(targetPath);
  if (!isSkill) {
    throw new UsageError(`Refusing to remove "${targetPath}": not an XMemo skill folder.`);
  }

  // Consent prompt
  if (!yes) {
    if (isJson) {
      writeLine(io.stdout, JSON.stringify({
        ok: false,
        removed: false,
        consentRequired: true,
        client: client.id,
        target: targetPath
      }, null, 2));
      return 0;
    }

    writeLine(io.stdout, `Remove XMemo skill for ${client.label} from ${targetPath}? [y/N]`);
    const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      writeLine(io.stdout, 'Removal cancelled.');
      return 0;
    }
  }

  const backupDir = clientSkillBackupDir(client.id, io.env);
  const backupExists = await fs.stat(backupDir).then((s) => s.isDirectory()).catch(() => false);

  await fs.rm(targetPath, { recursive: true, force: true });
  if (isJson) {
    writeLine(io.stdout, JSON.stringify({
      ok: true,
      removed: true,
      client: client.id,
      target: targetPath,
      backup: backupExists ? backupDir : null
    }, null, 2));
  } else {
    writeLine(io.stdout, `✓ Removed XMemo skill for ${client.label} from ${targetPath}`);
    if (backupExists) {
      writeLine(io.stdout, `  Backup preserved at: ${backupDir}`);
    }
  }
  return 0;
}

function parseInstallOptions(args) {
  const flags = new Set(['--dry-run', '--force', '--json', '--yes', '--project', '--all']);
  const optionsWithValues = ['--client', '--dir', '--target', '--version', '--from', '--integrity'];
  const seen = new Set();
  let client = null;
  let dir = null;
  let version = null;
  let from = null;
  let integrity = null;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (optionsWithValues.includes(token)) {
      if (seen.has(token)) throw new UsageError(`Duplicate option: ${token}.`);
      const val = optionValue(args, token);
      if (token === '--client') client = val;
      if (token === '--dir' || token === '--target') dir = val;
      if (token === '--version') version = val;
      if (token === '--from') from = val;
      if (token === '--integrity') integrity = val;
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

  if (version && version !== 'latest' && !STRICT_SEMVER_REGEX.test(version)) {
    throw new UsageError(`Invalid --version: "${version}". Must be a valid semver (e.g. 1.1.25) or "latest".`);
  }

  return {
    client,
    dir,
    version,
    from,
    integrity,
    project: hasFlag(args, '--project'),
    all: hasFlag(args, '--all'),
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
    yes: hasFlag(args, '--yes'),
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
