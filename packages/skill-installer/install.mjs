#!/usr/bin/env node

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const PACKAGE_NAME = '@xmemo/skill';
const DEFAULT_INSTALL_DIR = 'xmemo-skill';

export async function locateSkillSource(metaUrl = import.meta.url) {
  const currentDir = path.dirname(fileURLToPath(metaUrl));
  const candidateStaged = path.resolve(currentDir, '..', 'skill');

  const stagedStat = await fs.stat(candidateStaged).catch(() => null);
  if (stagedStat?.isDirectory()) return candidateStaged;

  throw new Error(`Could not locate bundled skill directory: ${candidateStaged}`);
}

export async function readSkillVersion(source) {
  for (const required of ['SKILL.md', path.join('scripts', 'xmemo-skill.mjs')]) {
    const stat = await fs.stat(path.join(source, required)).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Missing required Skill file: ${required}`);
  }
  const runtime = await fs.readFile(path.join(source, 'scripts', 'xmemo-skill.mjs'), 'utf8');
  const match = runtime.match(/const SKILL_VERSION = '([^']+)';/);
  if (!match?.[1]) throw new Error('The XMemo Skill version could not be determined from scripts/xmemo-skill.mjs.');
  return match[1];
}

function resolveRealPath(p) {
  try {
    return realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    try {
      return path.join(realpathSync(parent), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
}

export function assertSafeTarget(packageRoot, source, target) {
  if (target === path.parse(target).root) {
    throw new Error('Refusing to install a Skill into a filesystem root.');
  }
  const realPkg = resolveRealPath(packageRoot);
  const realSource = resolveRealPath(source);
  const realTarget = resolveRealPath(target);

  const relPkg = path.relative(realPkg, realTarget);
  if (!relPkg || (!relPkg.startsWith('..') && !path.isAbsolute(relPkg))) {
    throw new Error('Skill destination cannot be the package root or a directory inside it.');
  }
  const relSource = path.relative(realSource, realTarget);
  if (!relSource || (!relSource.startsWith('..') && !path.isAbsolute(relSource))) {
    throw new Error('Skill destination cannot be the skill source or a directory inside it.');
  }
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function atomicInstall(source, target, replace, { rename = fs.rename } = {}) {
  const parent = path.dirname(target);
  const base = path.basename(target);
  const nonce = `${process.pid}-${randomUUID()}`;
  const staging = path.join(parent, `.${base}.xmemo-staging-${nonce}`);
  const backup = path.join(parent, `.${base}.xmemo-backup-${nonce}`);
  let movedExisting = false;

  await fs.mkdir(parent, { recursive: true });
  try {
    await fs.cp(source, staging, { recursive: true, errorOnExist: true, force: false });
    if (replace) {
      await rename(target, backup);
      movedExisting = true;
    }
    await rename(staging, target);
    if (movedExisting) {
      await fs.rm(backup, { recursive: true, force: true });
      movedExisting = false;
    }
  } catch (error) {
    if (movedExisting && !(await pathExists(target))) {
      await rename(backup, target).catch(() => {});
    }
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

export function parseInstallOptions(args) {
  const flags = new Set(['--dry-run', '--force', '--json']);
  const seen = new Set();
  let target = undefined;
  let dryRun = false;
  let force = false;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--help' || token === '-h') {
      return { help: true };
    }
    if (token === '--target') {
      if (seen.has(token)) throw new Error('Duplicate option: --target.');
      const val = args[i + 1];
      if (!val || val.startsWith('-')) throw new Error('Option --target requires a value.');
      target = val;
      seen.add(token);
      i += 1;
      continue;
    }
    if (!flags.has(token)) {
      throw new Error(`Unknown skill install option: ${token}`);
    }
    if (seen.has(token)) {
      throw new Error(`Duplicate option: ${token}.`);
    }
    seen.add(token);
    if (token === '--dry-run') dryRun = true;
    if (token === '--force') force = true;
    if (token === '--json') json = true;
  }

  return { help: false, target, dryRun, force, json };
}

export function printHelp(stdout = console.log) {
  stdout('XMemo Skill installer (@xmemo/skill)');
  stdout('');
  stdout('Usage:');
  stdout('  xmemo-skill install [--target <dir>] [--dry-run] [--force] [--json]');
  stdout('  xmemo-skill version [--json]');
  stdout('  xmemo-skill help');
  stdout('');
  stdout('Commands:');
  stdout('  install   Install the XMemo Skill locally (offline, zero-network)');
  stdout('  version   Print the skill version');
  stdout('  help      Print this help message');
  stdout('');
  stdout('Options:');
  stdout('  --target <dir>   Installation directory (default: xmemo-skill, or $XMEMO_SKILL_DIR)');
  stdout('  --dry-run        Simulate installation without writing files');
  stdout('  --force          Overwrite destination directory if it already exists');
  stdout('  --json           Output results as JSON');
}

export async function runCli(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env, metaUrl = import.meta.url } = {}) {
  const subcommand = argv[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return 0;
  }

  const source = await locateSkillSource(metaUrl);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(metaUrl)), '..');
  const skillVersion = await readSkillVersion(source);

  if (subcommand === 'version' || subcommand === '--version' || subcommand === '-v') {
    const isJson = argv.includes('--json');
    if (isJson) {
      console.log(JSON.stringify({ package: PACKAGE_NAME, version: skillVersion, skillVersion }, null, 2));
    } else {
      console.log(skillVersion);
    }
    return 0;
  }

  if (subcommand !== 'install') {
    throw new Error(`Unknown command: ${subcommand}. Run "xmemo-skill help" for usage.`);
  }

  const optionArgs = argv.slice(1);
  const options = parseInstallOptions(optionArgs);
  if (options.help) {
    printHelp();
    return 0;
  }

  const targetDir = options.target ?? env.XMEMO_SKILL_DIR ?? DEFAULT_INSTALL_DIR;
  const target = path.resolve(cwd, targetDir);

  assertSafeTarget(packageRoot, source, target);

  const exists = await pathExists(target);
  if (exists && !options.force) {
    throw new Error(`Skill destination already exists: ${target}. Use --force to replace it.`);
  }

  const report = {
    package: PACKAGE_NAME,
    skillVersion,
    source,
    target,
    dryRun: options.dryRun,
    force: options.force,
    replaced: exists && !options.dryRun,
    installed: false,
    networkUsed: false,
    tokenSent: false,
  };

  if (!options.dryRun) {
    await atomicInstall(source, target, exists);
    report.installed = true;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${options.dryRun ? 'Would install' : 'Installed'} XMemo Skill ${skillVersion} to ${target}`);
    console.log(`Source: ${PACKAGE_NAME} ${skillVersion} (offline; no credential used)`);
  }

  return 0;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  const currentPath = fileURLToPath(import.meta.url);
  if (process.argv[1] === currentPath || path.resolve(process.argv[1]) === currentPath) {
    return true;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(currentPath);
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  runCli().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
