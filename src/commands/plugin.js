import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin install <id> [--dry-run] [--yes] [--open] [--dir <path>] [--json]`);
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
  const includeAll = hasFlag(args, '--all');
  const plugins = allPlugins({ includeLegacy: includeAll });
  if (hasFlag(args, '--json')) {
    writeLine(io.stdout, JSON.stringify(plugins, null, 2));
    return 0;
  }
  writeLine(io.stdout, 'Available XMemo plugins:');
  for (const p of plugins) {
    const vStr = p.version ? ` - v${p.version}` : '';
    writeLine(io.stdout, `  ${p.id.padEnd(16)} ${p.label} (${p.kind}, ${p.status})${vStr}`);
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Use "${COMMAND_NAME} plugin info <id>" for details or "${COMMAND_NAME} plugin install <id>" to install.`);
  return 0;
}

async function pluginInfo(args, io) {
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
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
  if (plugin.install) {
    writeLine(io.stdout, `  Install command: ${plugin.install.join(' ')}`);
  } else if (plugin.kind === 'mcp') {
    writeLine(io.stdout, `  Setup command: ${COMMAND_NAME} setup ${plugin.clientId}`);
  } else {
    writeLine(io.stdout, `  Install instructions: See ${plugin.docs} (run with --open to view)`);
  }
  return 0;
}

async function pluginInstall(args, io) {
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const rawId = positional[0];
  const plugin = validatePluginIdArg(rawId, 'install');

  const dryRun = hasFlag(args, '--dry-run') || hasFlag(args, '--preview');
  const yes = hasFlag(args, '--yes') || hasFlag(args, '-y');
  const open = hasFlag(args, '--open');
  const json = hasFlag(args, '--json');
  const dir = optionValue(args, '--dir');

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
        docs: plugin.docs,
        opened
      }, null, 2));
      return 0;
    }
    writeLine(io.stdout, `${plugin.label} (${plugin.id}): ${plugin.kind === 'marketplace' ? 'Marketplace' : 'Manual'} integration`);
    writeLine(io.stdout, `  Documentation: ${plugin.docs}`);
    if (!open) {
      writeLine(io.stdout, `  Run "${COMMAND_NAME} plugin install ${plugin.id} --open" to open the instructions in your browser.`);
    }
    return 0;
  }

  if (plugin.kind === 'native-cli') {
    const cmdStr = plugin.install.join(' ');
    if (!json) {
      writeLine(io.stdout, `Install plan for ${plugin.label}:`);
      writeLine(io.stdout, `  Command: ${cmdStr}`);
    }
    if (dryRun) {
      if (json) {
        writeLine(io.stdout, JSON.stringify({
          id: plugin.id,
          kind: 'native-cli',
          dryRun: true,
          command: plugin.install,
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
          command: plugin.install,
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

    const [bin, ...cmdArgs] = plugin.install;
    const result = await execPluginProcess(bin, cmdArgs, io);
    if (json) {
      writeLine(io.stdout, JSON.stringify({
        id: plugin.id,
        kind: 'native-cli',
        executed: true,
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr
      }, null, 2));
      return result.code === 0 ? 0 : 1;
    }
    if (result.code !== 0) {
      writeLine(io.stderr, `Error running ${bin} (exit code ${result.code}):\n${result.stderr || result.stdout}`);
      return 1;
    }
    writeLine(io.stdout, `✓ ${plugin.label} installed successfully.`);
    return 0;
  }

  if (plugin.kind === 'git-dir') {
    const targetDir = path.resolve(io.cwd ?? process.cwd(), dir ?? `xmemo-${plugin.platform}-plugin`);
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

    const loadInstructions = plugin.id === 'claude-code'
      ? `claude --plugin-dir ${targetDir}`
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
        writeLine(io.stdout, `  Note: Status is preview (plugin directory review pending).`);
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
    if (plugin.id === 'openclaw') {
      try {
        const res = await execPluginProcess('openclaw', ['--version'], io);
        if (res.code === 0) {
          detail = `openclaw binary present`;
          const pRes = await execPluginProcess('openclaw', ['plugins', 'inspect', 'xmemo-memory', '--runtime', '--json'], io);
          if (pRes.code === 0) {
            installed = true;
            detail = 'plugin installed';
          }
        }
      } catch {
        detail = 'openclaw binary not found';
      }
    } else if (plugin.id === 'hermes') {
      try {
        const res = await execPluginProcess('python', ['-m', 'pip', 'show', 'hermes-xmemo'], io);
        if (res.code === 0 && res.stdout.includes('Name: hermes-xmemo')) {
          installed = true;
          detail = 'hermes-xmemo installed';
        } else {
          detail = 'hermes-xmemo not installed';
        }
      } catch {
        detail = 'python not found';
      }
    } else if (plugin.detect?.command) {
      try {
        const res = await execPluginProcess(plugin.detect.command, plugin.detect.args ?? ['--version'], io);
        if (res.code === 0) {
          detail = `${plugin.detect.command} available`;
        }
      } catch {
        detail = `${plugin.detect.command} not found`;
      }
    }
  } else if (plugin.kind === 'git-dir') {
    const defaultDir = path.resolve(io.cwd ?? process.cwd(), `xmemo-${plugin.platform}-plugin`);
    if (existsSync(defaultDir)) {
      try {
        const res = await execPluginProcess('git', ['rev-parse', 'HEAD'], io, { cwd: defaultDir });
        if (res.stdout.trim().toLowerCase() === plugin.commit.toLowerCase()) {
          installed = true;
          detail = `verified clone at ${defaultDir}`;
        } else {
          detail = `clone present at ${defaultDir}`;
        }
      } catch {
        detail = `directory exists at ${defaultDir}`;
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

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
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
