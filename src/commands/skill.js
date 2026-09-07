import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { hasFlag, optionValue } from '../core/args.js';
import { CLI_VERSION, COMMAND_NAME, PACKAGE_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';

const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../../skills/xmemo/', import.meta.url));
const DEFAULT_INSTALL_DIR = 'xmemo-skill';

export async function skillCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') return writeHelp(io);
  if (subcommand !== 'install') throw new UsageError(`Unknown skill command: ${subcommand}`);
  const optionArgs = args.slice(1);
  if (hasFlag(optionArgs, '--help') || hasFlag(optionArgs, '-h')) return writeHelp(io);
  assertInstallOptions(optionArgs);

  const cwd = io.cwd ?? process.cwd();
  const target = path.resolve(cwd, optionValue(optionArgs, '--target') ?? io.env?.XMEMO_SKILL_DIR ?? DEFAULT_INSTALL_DIR);
  const source = BUNDLED_SKILL_DIR;
  assertSafeTarget(source, target);
  const skillVersion = await bundledSkillVersion(source);
  const exists = await pathExists(target);
  const force = hasFlag(optionArgs, '--force');
  const dryRun = hasFlag(optionArgs, '--dry-run');
  if (exists && !force) throw new UsageError(`Skill destination already exists: ${target}. Use --force to replace it.`);

  const report = { package: PACKAGE_NAME, cliVersion: CLI_VERSION, skillVersion, source, target, dryRun, force, replaced: exists && !dryRun, installed: false, networkUsed: false, tokenSent: false };
  if (!dryRun) {
    await install(source, target, exists);
    report.installed = true;
  }
  if (hasFlag(optionArgs, '--json')) writeLine(io.stdout, JSON.stringify(report, null, 2));
  else {
    writeLine(io.stdout, `${dryRun ? 'Would install' : 'Installed'} bundled XMemo Skill ${skillVersion} to ${target}`);
    writeLine(io.stdout, `Source: ${PACKAGE_NAME} ${CLI_VERSION} (offline; no credential used)`);
  }
  return 0;
}

function writeHelp(io) {
  writeLine(io.stdout, 'Skill commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill install [--target <directory>] [--dry-run] [--force] [--json]`);
  writeLine(io.stdout, 'Installs the bundled XMemo Skill locally. It never uses the network or credentials.');
  return 0;
}

function assertInstallOptions(args) {
  const flags = new Set(['--dry-run', '--force', '--json']);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--target') {
      if (seen.has(token)) throw new UsageError('Duplicate option: --target.');
      optionValue(args, token);
      seen.add(token);
      index += 1;
      continue;
    }
    if (!flags.has(token)) throw new UsageError(`Unknown skill install option: ${token}`);
    if (seen.has(token)) throw new UsageError(`Duplicate option: ${token}.`);
    seen.add(token);
  }
}

function assertSafeTarget(source, target) {
  if (target === path.parse(target).root) throw new UsageError('Refusing to install a Skill into a filesystem root.');
  const relative = path.relative(source, target);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new UsageError('Skill destination cannot be the bundled source or a directory inside it.');
}

async function bundledSkillVersion(source) {
  for (const required of ['SKILL.md', path.join('scripts', 'xmemo-skill.mjs')]) {
    const stat = await fs.stat(path.join(source, required)).catch(() => null);
    if (!stat?.isFile()) throw new UsageError(`The npm package is missing bundled Skill file: ${required}`);
  }
  const runtime = await fs.readFile(path.join(source, 'scripts', 'xmemo-skill.mjs'), 'utf8');
  const version = runtime.match(/const SKILL_VERSION = '([^']+)'/)?.[1];
  if (!version) throw new UsageError('The bundled XMemo Skill version could not be determined.');
  return version;
}

async function install(source, target, replace) {
  const parent = path.dirname(target);
  const base = path.basename(target);
  const nonce = `${process.pid}-${randomUUID()}`;
  const staging = path.join(parent, `.${base}.xmemo-staging-${nonce}`);
  const backup = path.join(parent, `.${base}.xmemo-backup-${nonce}`);
  let movedExisting = false;
  await fs.mkdir(parent, { recursive: true });
  try {
    await fs.cp(source, staging, { recursive: true, errorOnExist: true, force: false });
    if (replace) { await fs.rename(target, backup); movedExisting = true; }
    await fs.rename(staging, target);
    if (movedExisting) { await fs.rm(backup, { recursive: true, force: true }); movedExisting = false; }
  } catch (error) {
    if (movedExisting && !await pathExists(target)) await fs.rename(backup, target).catch(() => {});
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

async function pathExists(target) {
  try { await fs.access(target); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}
