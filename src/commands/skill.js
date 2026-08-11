import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { hasFlag, optionValue } from '../core/args.js';
import {
  CLI_VERSION,
  COMMAND_NAME,
  PACKAGE_NAME
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';

const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../../skills/xmemo/', import.meta.url));
const DEFAULT_INSTALL_DIR = 'xmemo-skill';
const REQUIRED_SKILL_FILES = [
  'SKILL.md',
  path.join('scripts', 'xmemo-skill.mjs')
];

export async function skillCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeSkillHelp(io);
    return 0;
  }

  if (subcommand !== 'install') {
    throw new UsageError(`Unknown skill command: ${subcommand}`);
  }

  const optionArgs = args.slice(1);
  if (hasFlag(optionArgs, '--help') || hasFlag(optionArgs, '-h')) {
    writeSkillHelp(io);
    return 0;
  }
  validateInstallArgs(optionArgs);

  const dryRun = hasFlag(optionArgs, '--dry-run');
  const force = hasFlag(optionArgs, '--force');
  const outputJson = hasFlag(optionArgs, '--json');
  const cwd = io.cwd ?? process.cwd();
  const configuredTarget = optionValue(optionArgs, '--target')
    ?? io.env?.XMEMO_SKILL_DIR
    ?? DEFAULT_INSTALL_DIR;
  const targetDir = path.resolve(cwd, configuredTarget);

  validateTarget(BUNDLED_SKILL_DIR, targetDir);
  const skillVersion = await validateBundledSkill(BUNDLED_SKILL_DIR);
  const targetExists = await pathExists(targetDir);
  if (targetExists && !force) {
    throw new UsageError(`Skill destination already exists: ${targetDir}. Use --force to replace it.`);
  }

  const report = {
    package: PACKAGE_NAME,
    cliVersion: CLI_VERSION,
    skillVersion,
    source: BUNDLED_SKILL_DIR,
    target: targetDir,
    dryRun,
    force,
    replaced: targetExists && !dryRun,
    installed: false,
    networkUsed: false,
    tokenSent: false
  };

  if (!dryRun) {
    await installBundledSkill(BUNDLED_SKILL_DIR, targetDir, { replace: targetExists });
    report.installed = true;
  }

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
    return 0;
  }

  const action = dryRun ? 'Would install' : 'Installed';
  writeLine(io.stdout, `${action} bundled XMemo Skill ${skillVersion} to ${targetDir}`);
  writeLine(io.stdout, `Source: ${PACKAGE_NAME} ${CLI_VERSION} (offline; no credential used)`);
  if (dryRun) {
    writeLine(io.stdout, 'Dry run only; no files were changed.');
  }
  return 0;
}

function writeSkillHelp(io) {
  writeLine(io.stdout, 'Skill commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill install [--target <directory>] [--dry-run] [--force] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Installs the XMemo Skill bundled with the current ${PACKAGE_NAME} package.`);
  writeLine(io.stdout, `The default destination is ./${DEFAULT_INSTALL_DIR}; XMEMO_SKILL_DIR can override it.`);
  writeLine(io.stdout, 'Installation is offline and never reads or sends XMemo credentials.');
}

function validateInstallArgs(args) {
  const flags = new Set(['--dry-run', '--force', '--json', '--help', '-h']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--target') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) {
        throw new UsageError('Option --target requires a value.');
      }
      index += 1;
      continue;
    }
    if (!flags.has(arg)) {
      throw new UsageError(`Unknown skill install option: ${arg}`);
    }
  }
}

function validateTarget(sourceDir, targetDir) {
  const root = path.parse(targetDir).root;
  if (targetDir === root) {
    throw new UsageError('Refusing to install a Skill into a filesystem root.');
  }

  const relative = path.relative(sourceDir, targetDir);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new UsageError('Skill destination cannot be the bundled source or a directory inside it.');
  }
}

async function validateBundledSkill(sourceDir) {
  for (const relativePath of REQUIRED_SKILL_FILES) {
    const sourcePath = path.join(sourceDir, relativePath);
    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new UsageError(`The npm package is missing bundled Skill file: ${relativePath}`);
    }
  }

  await rejectSymlinks(sourceDir);
  const runtimeSource = await fs.readFile(path.join(sourceDir, 'scripts', 'xmemo-skill.mjs'), 'utf8');
  const skillVersion = runtimeSource.match(/const SKILL_VERSION = '([^']+)'/)?.[1];
  if (!skillVersion) {
    throw new UsageError('The bundled XMemo Skill version could not be determined.');
  }
  return skillVersion;
}

async function rejectSymlinks(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new UsageError(`The bundled XMemo Skill contains a symbolic link: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      await rejectSymlinks(entryPath);
    }
  }
}

async function installBundledSkill(sourceDir, targetDir, { replace }) {
  const parentDir = path.dirname(targetDir);
  const baseName = path.basename(targetDir);
  const nonce = `${process.pid}-${randomUUID()}`;
  const stagingDir = path.join(parentDir, `.${baseName}.xmemo-tmp-${nonce}`);
  const backupDir = path.join(parentDir, `.${baseName}.xmemo-backup-${nonce}`);
  let backupCreated = false;

  await fs.mkdir(parentDir, { recursive: true });
  try {
    await fs.cp(sourceDir, stagingDir, { recursive: true, errorOnExist: true, force: false });
    if (replace) {
      await fs.rename(targetDir, backupDir);
      backupCreated = true;
    }
    await fs.rename(stagingDir, targetDir);
    if (backupCreated) {
      await fs.rm(backupDir, { recursive: true, force: true });
      backupCreated = false;
    }
  } catch (error) {
    if (backupCreated && !await pathExists(targetDir)) {
      await fs.rename(backupDir, targetDir).catch(() => {});
      backupCreated = false;
    }
    throw error;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
    if (backupCreated && await pathExists(targetDir)) {
      await fs.rm(backupDir, { recursive: true, force: true });
    }
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
