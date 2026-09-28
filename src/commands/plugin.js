import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { hasFlag, optionValue } from '../core/args.js';
import { COMMAND_NAME } from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import {
  allPlugins,
  getPlugin,
  supportedPluginIds
} from '../plugins/registry.js';

export function writePluginHelp(io) {
  writeLine(io.stdout, 'Plugin commands:');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin list [--all] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin info <id> [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin install <id> [--dry-run] [--yes] [--open] [--dir <path>] [--profile <name>] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin status [<id>] [--all] [--json]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Inspect, install, and manage XMemo agent plugins from the static index.');
  return 0;
}

function validatePluginIdArg(rawId, context) {
  if (!rawId) {
    throw new UsageError(`plugin ${context} requires <id>. Supported plugins: ${supportedPluginIds().join(', ')}.`);
  }
  const isUrl = /^(https?:\/\/|git@|git:\/\/|github:|clawhub:)/i.test(rawId) || rawId.includes('/') || rawId.includes('\\');
  if (isUrl) {
    throw new UsageError(`Invalid plugin ID: URLs are not supported. Supported plugins: ${supportedPluginIds().join(', ')}.`);
  }
  const plugin = getPlugin(rawId);
  if (!plugin) {
    throw new UsageError(`Unknown plugin: "${rawId}". Supported plugins: ${supportedPluginIds().join(', ')}.`);
  }
  return plugin;
}

function userHome(env) {
  return env?.USERPROFILE || env?.HOME || os.homedir();
}

function defaultGitDir(plugin, io) {
  return path.join(userHome(io?.env), '.xmemo', 'plugins', plugin.id);
}

async function readLineFromStdin(stdin) {
  if (!stdin) return '';
  if (!stdin._asyncIterator) {
    if (typeof stdin[Symbol.asyncIterator] !== 'function') return '';
    stdin._asyncIterator = stdin[Symbol.asyncIterator]();
    stdin._buffer = '';
  }
  while (true) {
    const nl = stdin._buffer.indexOf('\n');
    if (nl !== -1) {
      const line = stdin._buffer.slice(0, nl);
      stdin._buffer = stdin._buffer.slice(nl + 1);
      return line.replace(/\r$/, '');
    }
    const { value, done } = await stdin._asyncIterator.next();
    if (done) {
      const line = stdin._buffer;
      stdin._buffer = '';
      return line.replace(/\r$/, '');
    }
    stdin._buffer += typeof value === 'string' ? value : value?.toString('utf8') ?? '';
  }
}

function sanitizeEnv(env = {}) {
  const sanitized = { ...env };
  delete sanitized.XMEMO_KEY;
  delete sanitized.MEMORY_OS_MCP_TOKEN;
  delete sanitized.XMEMO_TOKEN;
  return sanitized;
}

export async function openBrowser(url, io = {}) {
  if (typeof io.openBrowser === 'function') {
    return await io.openBrowser(url);
  }
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function execPluginProcess(command, args, io, options = {}) {
  const spawnFn = io.spawn ?? spawn;
  const env = sanitizeEnv(io.env ?? process.env);
  const cwd = options.cwd ?? io.cwd ?? process.cwd();
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      return reject(err);
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += String(c); });
    child.stderr?.on('data', (c) => { stderr += String(c); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function pluginList(args, io) {
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  if (positional.length > 0) {
    throw new UsageError('plugin list does not accept positional arguments.');
  }
  const includeAll = hasFlag(args, '--all');
  const plugins = allPlugins({ includeLegacy: includeAll });
  if (hasFlag(args, '--json')) {
    writeLine(io.stdout, JSON.stringify(plugins, null, 2));
    return 0;
  }
  writeLine(io.stdout, 'Available XMemo plugins:');
  for (const p of plugins) {
    const vStr = p.version ? ` - v${p.version}` : '';
    const noteStr = p.note ? ` (${p.note})` : '';
    writeLine(io.stdout, `  ${p.id.padEnd(16)} ${p.label} (${p.kind}, ${p.status})${vStr}${noteStr}`);
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Use "${COMMAND_NAME} plugin info <id>" for details or "${COMMAND_NAME} plugin install <id>" to install.`);
  return 0;
}

async function pluginInfo(args, io) {
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new UsageError(`plugin info requires <id>. Supported plugins: ${supportedPluginIds().join(', ')}.`);
  }
  if (positional.length > 1) {
    throw new UsageError('plugin info accepts only one <id>.');
  }
  const rawId = positional[0];
  const plugin = validatePluginIdArg(rawId, 'info');

  if (hasFlag(args, '--json')) {
    writeLine(io.stdout, JSON.stringify(plugin, null, 2));
    return 0;
  }

  writeLine(io.stdout, `Plugin: ${plugin.label} (${plugin.id})`);
  writeLine(io.stdout, `  Platform: ${plugin.platform}`);
  writeLine(io.stdout, `  Kind: ${plugin.kind}`);
  writeLine(io.stdout, `  Status: ${plugin.status}`);
  writeLine(io.stdout, `  Version: ${plugin.version ?? 'n/a'}`);
  writeLine(io.stdout, `  Tag: ${plugin.tag ?? 'n/a'}`);
  writeLine(io.stdout, `  Commit: ${plugin.commit}`);
  writeLine(io.stdout, `  Repository: https://github.com/${plugin.repo}`);
  writeLine(io.stdout, `  Documentation: ${plugin.docs}`);
  if (plugin.clientId) {
    writeLine(io.stdout, `  Client ID: ${plugin.clientId}`);
  }
  if (plugin.note) {
    writeLine(io.stdout, `  Note: ${plugin.note}`);
  }
  if (plugin.install) {
    writeLine(io.stdout, `  Install command: ${plugin.install.join(' ')}`);
  } else if (plugin.kind === 'mcp') {
    writeLine(io.stdout, `  Setup command: ${COMMAND_NAME} setup ${plugin.clientId}`);
  } else {
    writeLine(io.stdout, `  Install instructions: See ${plugin.docs} (run with --open to view)`);
  }
  if (plugin.steps && plugin.steps.length > 0) {
    writeLine(io.stdout, '  Installation steps:');
    for (let i = 0; i < plugin.steps.length; i++) {
      writeLine(io.stdout, `    ${i + 1}. ${plugin.steps[i]}`);
    }
  }
  return 0;
}

function extractPositionalArgs(args, optionsWithValues = []) {
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (optionsWithValues.includes(arg)) {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        i++;
      }
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

async function pluginInstall(args, io) {
  const dir = optionValue(args, '--dir');
  const profile = optionValue(args, '--profile');
  const positional = extractPositionalArgs(args.slice(1), ['--dir', '--profile']);
  if (positional.length === 0) {
    throw new UsageError(`plugin install requires <id>. Supported plugins: ${supportedPluginIds().join(', ')}.`);
  }
  if (positional.length > 1) {
    throw new UsageError('plugin install accepts only one <id>.');
  }
  const rawId = positional[0];
  const plugin = validatePluginIdArg(rawId, 'install');

  const dryRun = hasFlag(args, '--dry-run') || hasFlag(args, '--preview');
  const yes = hasFlag(args, '--yes') || hasFlag(args, '-y');
  const open = hasFlag(args, '--open');
  const json = hasFlag(args, '--json');
  const force = hasFlag(args, '--force');

  if (plugin.kind === 'mcp') {
    const setupCmd = `${COMMAND_NAME} setup ${plugin.clientId}`;
    if (json) {
      writeLine(io.stdout, JSON.stringify({
        id: plugin.id,
        kind: 'mcp',
        status: 'mcp-pointer',
        setupCommand: setupCmd,
        docs: plugin.docs
      }, null, 2));
      return 0;
    }
    writeLine(io.stdout, `${plugin.label} uses MCP integration.`);
    writeLine(io.stdout, `To configure, run: ${setupCmd}`);
    writeLine(io.stdout, `Documentation: ${plugin.docs}`);
    return 0;
  }

  if (plugin.kind === 'marketplace' || plugin.kind === 'manual') {
    let opened = false;
    if (open) {
      if (dryRun) {
        if (!json) {
          writeLine(io.stdout, `[dry-run] Would open documentation: ${plugin.docs}`);
        }
      } else {
        await openBrowser(plugin.docs, io);
        opened = true;
        if (!json) {
          writeLine(io.stdout, `Opened documentation in browser: ${plugin.docs}`);
        }
      }
    }
    if (json) {
      writeLine(io.stdout, JSON.stringify({
        id: plugin.id,
        kind: plugin.kind,
        status: 'manual-instruction',
        steps: plugin.steps ?? [],
        docs: plugin.docs,
        opened
      }, null, 2));
      return 0;
    }
    writeLine(io.stdout, `${plugin.label} (${plugin.id}): ${plugin.kind === 'marketplace' ? 'Marketplace' : 'Manual'} integration`);
    writeLine(io.stdout, `  Documentation: ${plugin.docs}`);
    if (plugin.steps && plugin.steps.length > 0) {
      writeLine(io.stdout, '  Installation steps:');
      for (let i = 0; i < plugin.steps.length; i++) {
        writeLine(io.stdout, `    ${i + 1}. ${plugin.steps[i]}`);
      }
    }
    if (!open) {
      writeLine(io.stdout, `  Run "${COMMAND_NAME} plugin install ${plugin.id} --open" to open the instructions in your browser.`);
    }
    return 0;
  }

  if (plugin.kind === 'native-cli') {
    let installCmd = plugin.install;
    let route = null;
    let pathDescription = null;

    if (plugin.requiresProfile) {
      if (!profile) {
        throw new UsageError(`${plugin.id} requires --profile <name> (e.g. xmemo plugin install ${plugin.id} --profile <name>).`);
      }
      installCmd = plugin.install.map((a) => (a === '<profile>' ? profile : a));
      if (force) installCmd.push('--force');
    } else if (plugin.fallbackInstall) {
      let cliAvailable = false;
      const detectCmd = plugin.detect?.command ?? plugin.install?.[0];
      const detectArgs = plugin.detect?.args ?? ['--version'];
      try {
        const hRes = await execPluginProcess(detectCmd, detectArgs, io);
        if (hRes.code === 0) {
          cliAvailable = true;
        }
      } catch {}

      const catalogEntry = plugin.install?.[plugin.install.length - 1];
      const cliLabel = detectCmd.charAt(0).toUpperCase() + detectCmd.slice(1) + ' CLI';
      if (cliAvailable) {
        route = `${detectCmd}-cli`;
        pathDescription = `${cliLabel} (official catalog entry "${catalogEntry}")`;
        installCmd = [...plugin.install, ...(force ? ['--force'] : [])];
      } else {
        route = 'pip-fallback';
        pathDescription = `pip fallback (${detectCmd} binary not found on PATH)`;
        const pyBin = io.env?.PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
        installCmd = [pyBin, ...plugin.fallbackInstall.slice(1)];
      }
    } else if (plugin.install) {
      installCmd = [...plugin.install, ...(force ? ['--force'] : [])];
    }

    const cmdStr = installCmd.join(' ');
    if (!json) {
      writeLine(io.stdout, `Install plan for ${plugin.label}:`);
      if (pathDescription) {
        writeLine(io.stdout, `  Route: ${pathDescription}`);
      }
      writeLine(io.stdout, `  Command: ${cmdStr}`);
    }
    if (dryRun) {
      if (json) {
        writeLine(io.stdout, JSON.stringify({
          id: plugin.id,
          kind: 'native-cli',
          dryRun: true,
          route: route ?? undefined,
          command: installCmd,
          executed: false
        }, null, 2));
      } else {
        writeLine(io.stdout, '[dry-run] Command not executed.');
      }
      return 0;
    }
    if (!yes) {
      if (json) {
        writeLine(io.stdout, JSON.stringify({
          id: plugin.id,
          kind: 'native-cli',
          dryRun: false,
          route: route ?? undefined,
          command: installCmd,
          executed: false,
          consentRequired: true
        }, null, 2));
        return 0;
      }
      writeLine(io.stdout, '');
      writeLine(io.stdout, `Execute "${cmdStr}"? [y/N]`);
      const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        writeLine(io.stdout, 'Installation cancelled.');
        return 0;
      }
    }

    const [bin, ...cmdArgs] = installCmd;
    const result = await execPluginProcess(bin, cmdArgs, io);

    // If native CLI reports already installed without --force, run update command
    if (result.code !== 0 && !force && plugin.update) {
      const combinedOutput = `${result.stderr || ''}\n${result.stdout || ''}`;
      const isAlreadyInstalled = /already installed|already exists|destination already exists/i.test(combinedOutput);
      if (isAlreadyInstalled) {
        const updateCmd = plugin.update;
        const updateCmdStr = updateCmd.join(' ');
        if (!json) {
          const hostName = plugin.label.split(' ')[0];
          const targetPackage = plugin.update[plugin.update.length - 1];
          writeLine(io.stdout, `${hostName} reports ${targetPackage} is already installed.`);
          writeLine(io.stdout, `Update plan: ${updateCmdStr}`);
        }
        if (!yes) {
          if (json) {
            writeLine(io.stdout, JSON.stringify({
              id: plugin.id,
              kind: 'native-cli',
              alreadyInstalled: true,
              updateCommand: updateCmd,
              executed: false,
              consentRequired: true
            }, null, 2));
            return 0;
          }
          writeLine(io.stdout, '');
          writeLine(io.stdout, `Execute "${updateCmdStr}"? [y/N]`);
          const ans = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
          if (ans !== 'y' && ans !== 'yes') {
            writeLine(io.stdout, 'Update cancelled.');
            return 0;
          }
        }
        const [uBin, ...uArgs] = updateCmd;
        const updateRes = await execPluginProcess(uBin, uArgs, io);
        if (json) {
          writeLine(io.stdout, JSON.stringify({
            id: plugin.id,
            kind: 'native-cli',
            executed: true,
            updated: updateRes.code === 0,
            alreadyInstalled: true,
            code: updateRes.code,
            command: updateCmd,
            stdout: updateRes.stdout,
            stderr: updateRes.stderr
          }, null, 2));
          return updateRes.code === 0 ? 0 : 1;
        }
        if (updateRes.code !== 0) {
          writeLine(io.stderr, `Error running ${uBin} (exit code ${updateRes.code}):\n${updateRes.stderr || updateRes.stdout}`);
          return 1;
        }
        writeLine(io.stdout, `✓ ${plugin.label} updated successfully.`);
        return 0;
      }
    }

    if (json) {
      writeLine(io.stdout, JSON.stringify({
        id: plugin.id,
        kind: 'native-cli',
        executed: true,
        route: route ?? undefined,
        code: result.code,
        command: installCmd,
        stdout: result.stdout,
        stderr: result.stderr
      }, null, 2));
      return result.code === 0 ? 0 : 1;
    }
    if (result.code !== 0) {
      writeLine(io.stderr, `Error running ${bin} (exit code ${result.code}):\n${result.stderr || result.stdout}`);
      return 1;
    }
    const viaStr = pathDescription ? ` via ${pathDescription}` : '';
    writeLine(io.stdout, `✓ ${plugin.label} installed successfully${viaStr}.`);
    return 0;
  }

  if (plugin.kind === 'git-dir') {
    const targetDir = dir
      ? path.resolve(io.cwd ?? process.cwd(), dir)
      : defaultGitDir(plugin, io);
    const cloneCmd = ['git', 'clone', '--branch', plugin.tag, '--depth', '1', `https://github.com/${plugin.repo}.git`, targetDir];
    if (!json) {
      writeLine(io.stdout, `Install plan for ${plugin.label}:`);
      writeLine(io.stdout, `  Target directory: ${targetDir}`);
      writeLine(io.stdout, `  Repository: https://github.com/${plugin.repo}.git`);
      writeLine(io.stdout, `  Tag: ${plugin.tag}`);
      writeLine(io.stdout, `  Expected commit: ${plugin.commit}`);
      writeLine(io.stdout, `  Command: ${cloneCmd.join(' ')}`);
    }
    if (dryRun) {
      if (json) {
        writeLine(io.stdout, JSON.stringify({
          id: plugin.id,
          kind: 'git-dir',
          dryRun: true,
          targetDir,
          tag: plugin.tag,
          commit: plugin.commit,
          command: cloneCmd,
          executed: false
        }, null, 2));
      } else {
        writeLine(io.stdout, '[dry-run] Repository not cloned.');
      }
      return 0;
    }
    if (!yes) {
      if (json) {
        writeLine(io.stdout, JSON.stringify({
          id: plugin.id,
          kind: 'git-dir',
          dryRun: false,
          targetDir,
          executed: false,
          consentRequired: true
        }, null, 2));
        return 0;
      }
      writeLine(io.stdout, '');
      writeLine(io.stdout, `Clone and verify ${plugin.label} into ${targetDir}? [y/N]`);
      const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        writeLine(io.stdout, 'Installation cancelled.');
        return 0;
      }
    }

    if (existsSync(targetDir)) {
      throw new UsageError(`Target directory already exists: ${targetDir}. Use --dir <path> to specify a different path.`);
    }

    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    const cloneRes = await execPluginProcess('git', ['clone', '--branch', plugin.tag, '--depth', '1', `https://github.com/${plugin.repo}.git`, targetDir], io);
    if (cloneRes.code !== 0) {
      throw new UsageError(`Failed to clone plugin repository: ${cloneRes.stderr || cloneRes.stdout}`);
    }

    const revRes = await execPluginProcess('git', ['rev-parse', 'HEAD'], io, { cwd: targetDir });
    const actualCommit = revRes.stdout.trim();
    if (actualCommit.toLowerCase() !== plugin.commit.toLowerCase()) {
      try {
        await fs.rm(targetDir, { recursive: true, force: true });
      } catch {}
      throw new UsageError(`Commit verification failed for ${plugin.id}: expected ${plugin.commit}, got ${actualCommit}. Removed cloned directory.`);
    }

    const loadInstructions = plugin.loadCommandTemplate
      ? plugin.loadCommandTemplate.replace('{targetDir}', targetDir)
      : `Load from: ${targetDir}`;

    if (json) {
      writeLine(io.stdout, JSON.stringify({
        id: plugin.id,
        kind: 'git-dir',
        installed: true,
        targetDir,
        tag: plugin.tag,
        commit: actualCommit,
        verified: true,
        loadCommand: loadInstructions,
        status: plugin.status
      }, null, 2));
    } else {
      writeLine(io.stdout, `✓ ${plugin.label} cloned and commit verified at ${targetDir}`);
      writeLine(io.stdout, `  To load the plugin, run: ${loadInstructions}`);
      if (plugin.status === 'preview') {
        writeLine(io.stdout, '  Note: Status is preview (plugin directory review pending).');
      }
    }
    return 0;
  }

  throw new UsageError(`Unsupported plugin kind: ${plugin.kind}`);
}

async function checkPluginStatus(plugin, io) {
  let installed = false;
  let detail = null;

  if (plugin.kind === 'native-cli') {
    const detectCmd = plugin.detect?.command ?? plugin.install?.[0];
    const detectArgs = plugin.detect?.args ?? ['--version'];
    let cliDetected = false;
    if (detectCmd) {
      try {
        const res = await execPluginProcess(detectCmd, detectArgs, io);
        if (res.code === 0) {
          cliDetected = true;
          detail = `${detectCmd} binary present`;
          if (plugin.verify?.command) {
            const vRes = await execPluginProcess(plugin.verify.command, plugin.verify.args ?? [], io);
            const matches = !plugin.verify.match || (vRes.stdout && new RegExp(plugin.verify.match, 'i').test(vRes.stdout));
            if (vRes.code === 0 && matches) {
              installed = true;
              detail = plugin.verify.match ? `${detectCmd} plugin installed` : 'plugin installed';
            }
          }
        } else {
          detail = `${detectCmd} binary not found`;
        }
      } catch {
        detail = `${detectCmd} binary not found`;
      }
    }
    if (!installed && plugin.fallbackVerify?.command) {
      const fallbackPkg = plugin.fallbackVerify.args?.[plugin.fallbackVerify.args.length - 1] ?? 'fallback';
      try {
        const fRes = await execPluginProcess(plugin.fallbackVerify.command, plugin.fallbackVerify.args ?? [], io);
        const matches = !plugin.fallbackVerify.match || (fRes.stdout && fRes.stdout.includes(plugin.fallbackVerify.match));
        if (fRes.code === 0 && matches) {
          installed = true;
          detail = `${fallbackPkg} installed`;
        } else {
          detail = cliDetected ? `${detectCmd} plugin not installed` : `${fallbackPkg} not installed`;
        }
      } catch {
        detail = cliDetected ? `${detectCmd} plugin not installed` : `${plugin.fallbackVerify.command} not found`;
      }
    }
  } else if (plugin.kind === 'git-dir') {
    const candidateDirs = [
      defaultGitDir(plugin, io),
      path.resolve(io.cwd ?? process.cwd(), `xmemo-${plugin.platform}-plugin`)
    ];
    const foundDir = candidateDirs.find((d) => existsSync(d));
    if (foundDir) {
      try {
        const res = await execPluginProcess('git', ['rev-parse', 'HEAD'], io, { cwd: foundDir });
        if (res.stdout.trim().toLowerCase() === plugin.commit.toLowerCase()) {
          installed = true;
          detail = `verified clone at ${foundDir}`;
        } else {
          detail = `clone present at ${foundDir}`;
        }
      } catch {
        detail = `directory exists at ${foundDir}`;
      }
    } else {
      detail = 'not cloned';
    }
  } else if (plugin.kind === 'mcp') {
    detail = `MCP configuration (${plugin.clientId})`;
  } else {
    detail = `${plugin.kind} integration`;
  }

  return {
    id: plugin.id,
    platform: plugin.platform,
    label: plugin.label,
    kind: plugin.kind,
    status: plugin.status,
    version: plugin.version,
    installed,
    detail,
    docs: plugin.docs
  };
}

async function pluginStatus(args, io) {
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  if (positional.length > 1) {
    throw new UsageError('plugin status accepts at most one <id>.');
  }
  const rawId = positional[0];
  const includeAll = hasFlag(args, '--all');

  let list;
  if (rawId) {
    const plugin = validatePluginIdArg(rawId, 'status');
    list = [plugin];
  } else {
    list = allPlugins({ includeLegacy: includeAll });
  }

  const results = [];
  for (const p of list) {
    results.push(await checkPluginStatus(p, io));
  }

  if (hasFlag(args, '--json')) {
    writeLine(io.stdout, JSON.stringify(rawId ? results[0] : results, null, 2));
    return 0;
  }

  writeLine(io.stdout, 'Plugin status:');
  for (const r of results) {
    const vStr = r.version ? ` (${r.version})` : '';
    const instStr = r.installed ? '✓ installed' : '○ not installed';
    writeLine(io.stdout, `  ${r.id.padEnd(16)} ${r.label}${vStr}: ${instStr} - ${r.detail}`);
  }
  return 0;
}

export async function pluginCommand(args, io) {
  const subcommand = args[0] ?? 'help';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h' || subcommand.startsWith('-') || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (hasFlag(args, '--json')) {
      writeLine(io.stdout, JSON.stringify({
        schemaVersion: '1',
        ok: true,
        command: 'plugin',
        data: {
          subcommands: ['list', 'info', 'install', 'status'],
          plugins: supportedPluginIds()
        },
        error: null
      }, null, 2));
      return 0;
    }
    return writePluginHelp(io);
  }

  if (subcommand === 'list') {
    return await pluginList(args, io);
  }

  if (subcommand === 'info') {
    return await pluginInfo(args, io);
  }

  if (subcommand === 'install') {
    return await pluginInstall(args, io);
  }

  if (subcommand === 'status') {
    return await pluginStatus(args, io);
  }

  throw new UsageError(`Unknown plugin subcommand: "${subcommand}". Supported subcommands: list, info, install, status.`);
}
