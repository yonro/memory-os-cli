import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CLIENT_PROFILE_MARKER_END,
  CLIENT_PROFILE_MARKER_START,
  CODEX_PROFILE_MARKER_END,
  CODEX_PROFILE_MARKER_START,
  CODEX_PROFILE_TARGET,
  COMMAND_NAME,
  MCP_SERVER_NAME,
  PRODUCT_NAME,
  PROFILE_MARKER_PREFIX,
  TOKEN_ENV_VAR
} from '../core/constants.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { readTextIfExists } from '../core/runtime.js';

export function codexMemoryProfile() {
  return memoryBehaviorProfile('codex');
}

export function writeCodexMemoryProfile(profile, io) {
  writeLine(io.stdout, `${PRODUCT_NAME} Codex memory behavior profile`);
  writeLine(io.stdout, `Profile: ${profile.profileVersion}`);
  writeLine(io.stdout, `MCP server: ${profile.mcpServerName}`);
  writeLine(io.stdout, `Token env: ${profile.requiredTokenEnv}`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Recommended Codex instructions:');
  for (const instruction of profile.instructions) {
    writeLine(io.stdout, `- ${instruction}`);
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Setup: ${profile.setupCommand}`);
  writeLine(io.stdout, `Smoke test: ${profile.smokeCommand}`);
}

function codexProfileInstructionText() {
  return profileInstructionText('codex');
}

function memoryBehaviorProfile(clientId) {
  const config = profileClientConfig(clientId);
  if (!config) {
    throw new UsageError(`Unsupported profile client: ${clientId}`);
  }
  const instructions = [
    'At the start of a non-trivial task, call XMemo recall/search for relevant project decisions, conventions, prior fixes, and active context unless the user explicitly asks not to use memory.',
    'Use recalled memories as evidence, not as unquestioned truth. Prefer current repository files when memory conflicts with code.',
    'After meaningful decisions, bug fixes, release steps, or durable conventions, write a concise XMemo memory with scope, source, and no secret values.',
    'Never store tokens, API keys, cookies, private keys, raw credentials, or sensitive customer data in XMemo.',
    'For routine or low-signal output, skip durable writes. Prefer summarized procedural or semantic memories over verbose logs.',
    'Keep XMemo authentication secure (using the XMEMO_KEY environment variable or client-managed OAuth); do not paste token values into prompts, config files, or logs.'
  ];
  return {
    client: clientId,
    label: config.label,
    profileVersion: config.profileVersion,
    mcpServerName: MCP_SERVER_NAME,
    requiredTokenEnv: config.requiredTokenEnv ?? null,
    objective: 'Use XMemo deliberately through MCP for project context recall and high-signal write-back.',
    instructions,
    setupCommand: `${COMMAND_NAME} setup ${config.setupAlias} --url "$XMEMO_URL"`,
    smokeCommand: clientId === 'codex' ? `${COMMAND_NAME} smoke --client codex` : null
  };
}

function profileInstructionText(clientId) {
  const profile = memoryBehaviorProfile(clientId);
  const lines = [
    '## XMemo Agent profile',
    '',
    `MCP server: \`${profile.mcpServerName}\``,
  ];
  if (profile.requiredTokenEnv) {
    lines.push(`Token env var: \`${profile.requiredTokenEnv}\``);
  }
  lines.push(
    '',
    profile.objective,
    '',
    'Recommended Agent behavior:'
  );
  for (const instruction of profile.instructions) {
    lines.push(`- ${instruction}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function isRepo(cwd, env = process.env, markerDir = null) {
  if (!cwd) return false;
  const resolvedCwd = path.resolve(cwd);
  const resolvedHome = path.resolve(userHome(env));
  if (resolvedCwd === resolvedHome) {
    return existsSync(path.join(cwd, '.git'));
  }
  if (markerDir && existsSync(path.join(cwd, markerDir))) {
    return true;
  }
  return existsSync(path.join(cwd, '.git')) || existsSync(path.join(cwd, 'package.json'));
}

export function isHomeProfileTarget(targetPath, env = process.env, options = {}) {
  const home = userHome(env);
  const resolvedTarget = path.resolve(targetPath);
  const resolvedHome = path.resolve(home);
  const cwd = options.cwd ?? env.CWD ?? process.cwd();
  const resolvedCwd = path.resolve(cwd);

  const config = options.clientId ? profileClientConfig(options.clientId) : null;
  const markerDir = config?.setupAlias ? `.${config.setupAlias}` : null;
  if (isRepo(cwd, env, markerDir) && (resolvedTarget === resolvedCwd || resolvedTarget.startsWith(resolvedCwd + path.sep))) {
    return false;
  }
  return resolvedTarget === resolvedHome || resolvedTarget.startsWith(resolvedHome + path.sep);
}

export function profileBlock(clientId) {
  if (clientId === 'codex') {
    return codexProfileMarkerBlock();
  }
  return genericProfileMarkerBlock(clientId);
}

function splitLines(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function generateUnifiedDiff(filePath, oldText, newText) {
  if (!oldText || oldText.trim().length === 0) {
    return '(new file)';
  }
  if (oldText === newText) {
    return '';
  }
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const edits = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      edits.push({ type: 'equal', line: oldLines[i - 1], oldIndex: i - 1, newIndex: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push({ type: 'add', line: newLines[j - 1], newIndex: j - 1 });
      j--;
    } else {
      edits.push({ type: 'remove', line: oldLines[i - 1], oldIndex: i - 1 });
      i--;
    }
  }
  edits.reverse();
  if (!edits.some(e => e.type !== 'equal')) {
    return '';
  }
  const normalizedPath = filePath.replace(/\\/g, '/');
  const header = `--- a/${normalizedPath}\n+++ b/${normalizedPath}`;
  const contextSize = 3;
  const hunks = [];
  let currentHunk = null;
  for (let k = 0; k < edits.length; k++) {
    const edit = edits[k];
    if (edit.type !== 'equal') {
      if (!currentHunk) {
        const start = Math.max(0, k - contextSize);
        currentHunk = { edits: edits.slice(start, k) };
      }
      currentHunk.edits.push(edit);
    } else if (currentHunk) {
      let nextChange = -1;
      for (let look = k + 1; look < Math.min(edits.length, k + contextSize * 2 + 1); look++) {
        if (edits[look].type !== 'equal') {
          nextChange = look;
          break;
        }
      }
      if (nextChange !== -1) {
        currentHunk.edits.push(edit);
      } else {
        const end = Math.min(edits.length, k + contextSize);
        for (let look = k; look < end; look++) {
          currentHunk.edits.push(edits[look]);
        }
        hunks.push(currentHunk);
        currentHunk = null;
        k = end - 1;
      }
    }
  }
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  const output = [header];
  for (const hunk of hunks) {
    let oldStart = null;
    let oldCount = 0;
    let newStart = null;
    let newCount = 0;
    const hunkBody = [];
    for (const edit of hunk.edits) {
      if (edit.type === 'equal') {
        if (oldStart === null) oldStart = edit.oldIndex + 1;
        if (newStart === null) newStart = edit.newIndex + 1;
        oldCount++;
        newCount++;
        hunkBody.push(` ${edit.line}`);
      } else if (edit.type === 'remove') {
        if (oldStart === null) oldStart = edit.oldIndex + 1;
        oldCount++;
        hunkBody.push(`-${edit.line}`);
      } else if (edit.type === 'add') {
        if (newStart === null) newStart = edit.newIndex + 1;
        newCount++;
        hunkBody.push(`+${edit.line}`);
      }
    }
    if (oldStart === null) oldStart = 1;
    if (newStart === null) newStart = 1;
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    output.push(...hunkBody);
  }
  return output.join('\n');
}

export function profileClientConfig(clientId) {
  const profileConfigs = {
    codex: {
      label: 'Codex',
      setupAlias: 'codex',
      profileVersion: 'codex-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => defaultCodexProfileTarget(options.cwd ?? env?.CWD)
    },
    cursor: {
      label: 'Cursor',
      setupAlias: 'cursor',
      profileVersion: 'cursor-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.cursor')) {
          return path.join(cwd, '.cursor', 'rules', 'AGENTS.md');
        }
        return path.join(userHome(env), '.cursor', 'memory-profile.md');
      }
    },
    kiro: {
      label: 'Kiro',
      setupAlias: 'kiro',
      profileVersion: 'kiro-mcp-depth-v1',
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.kiro')) {
          return path.join(cwd, '.kiro', 'steering', 'AGENTS.md');
        }
        return path.join(userHome(env), '.kiro', 'steering', 'AGENTS.md');
      }
    },
    'kimi-code': {
      label: 'Kimi Code',
      setupAlias: 'kimi',
      profileVersion: 'kimi-code-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.kimi-code')) {
          return path.join(cwd, '.kimi-code', 'AGENTS.md');
        }
        return path.join(userHome(env), '.kimi-code', 'AGENTS.md');
      }
    },
    'gemini-cli': {
      label: 'Gemini CLI',
      setupAlias: 'gemini',
      profileVersion: 'gemini-cli-mcp-depth-v1',
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'GEMINI.md');
        }
        return path.join(userHome(env), '.gemini', 'GEMINI.md');
      }
    },
    antigravity: {
      label: 'Antigravity',
      setupAlias: 'antigravity',
      profileVersion: 'antigravity-mcp-depth-v1',
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'GEMINI.md');
        }
        return path.join(userHome(env), '.gemini', 'antigravity', 'MEMORY.md');
      }
    },
    qwen: {
      label: 'Qwen',
      setupAlias: 'qwen',
      profileVersion: 'qwen-mcp-depth-v1',
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'QWEN.md');
        }
        return path.join(userHome(env), '.qwen', 'QWEN.md');
      }
    },
    opencode: {
      label: 'OpenCode',
      setupAlias: 'opencode',
      profileVersion: 'opencode-mcp-depth-v1',
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'AGENTS.md');
        }
        return path.join(userHome(env), '.config', 'opencode', 'AGENTS.md');
      }
    },
    trae: {
      label: 'Trae',
      setupAlias: 'trae',
      profileVersion: 'trae-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.trae')) {
          return path.join(cwd, '.trae', 'rules', 'AGENTS.md');
        }
        return path.join(userHome(env), '.trae', 'memory-profile.md');
      }
    },
    'trae-solo': {
      label: 'Trae Solo',
      setupAlias: 'trae-solo',
      profileVersion: 'trae-solo-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: CLIENT_PROFILE_MARKER_START,
      markerEnd: CLIENT_PROFILE_MARKER_END,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.trae')) {
          return path.join(cwd, '.trae', 'rules', 'AGENTS.md');
        }
        return path.join(userHome(env), '.trae', 'memory-profile.md');
      }
    }
  };
  return profileConfigs[clientId] ?? null;
}

export function supportedProfileClientIds() {
  return ['codex', 'cursor', 'kiro', 'kimi-code', 'gemini', 'antigravity', 'qwen', 'opencode', 'trae', 'trae-solo'];
}

export function defaultProfileTarget(clientId, env, options = {}) {
  const config = profileClientConfig(clientId);
  if (!config) {
    throw new UsageError(`Unsupported profile client: ${clientId}`);
  }
  return config.defaultTarget(env, options);
}

export async function confirmProfileInstall(clientId, targetPath, io, options = {}) {
  const config = profileClientConfig(clientId);
  const block = options.block ?? profileBlock(clientId);
  const isHomeTarget = options.isHomeTarget ?? isHomeProfileTarget(targetPath, io.env, { cwd: io.cwd, clientId });

  writeLine(io.stdout, '');
  if (isHomeTarget) {
    writeLine(io.stdout, `Target is in home directory (outside a repository): ${targetPath}`);
  } else {
    writeLine(io.stdout, `Target: ${targetPath}`);
  }
  writeLine(io.stdout, 'Agent instruction block to add:');
  writeLine(io.stdout, block.trimEnd());
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Write XMemo memory behavior profile to ${targetPath}? [y/N]`);
  const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    return true;
  }
  return false;
}

async function readLineFromStdin(stdin) {
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
    if (input.includes('\n')) {
      break;
    }
  }
  return input.split(/\r?\n/, 1)[0] ?? '';
}

function genericProfileMarkerBlock(clientId) {
  const config = profileClientConfig(clientId);
  return `${config.markerStart}\n${profileInstructionText(clientId)}${config.markerEnd}\n`;
}

export async function profileInstallResult(clientId, targetPath, options = {}) {
  if (clientId === 'codex') {
    return codexProfileInstallResult(targetPath, options);
  }
  const config = profileClientConfig(clientId);
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = profileMarkerBounds(existing, config);
  const block = genericProfileMarkerBlock(clientId);
  let nextText;

  if (marker.present) {
    nextText = `${existing.slice(0, marker.start)}${block}${existing.slice(marker.end)}`;
  } else if (existing.trim().length === 0) {
    nextText = block;
  } else {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    nextText = `${existing}${separator}${block}`;
  }

  const isNewFile = existing.trim().length === 0;
  const changed = nextText !== existing;
  const write = Boolean(options.write);
  let backupPath = null;

  if (write && changed) {
    if (!isNewFile) {
      backupPath = `${resolvedTarget}.xmemo.bak`;
      await fs.writeFile(backupPath, existing);
      if (options.io && !options.json) {
        writeLine(options.io.stdout, `Created backup at ${backupPath}`);
      }
    }
    await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fs.writeFile(resolvedTarget, nextText);
  }

  const diff = isNewFile ? '(new file)' : generateUnifiedDiff(resolvedTarget, existing, nextText);
  const isHomeTarget = options.isHomeTarget ?? isHomeProfileTarget(resolvedTarget, options.env ?? process.env, { cwd: options.cwd, clientId });

  return {
    client: clientId,
    action: 'install',
    targetPath: resolvedTarget,
    markerStart: config.markerStart,
    markerEnd: config.markerEnd,
    installed: marker.present || (write && changed),
    written: write,
    changed,
    markerPresent: marker.present,
    writesTokenValue: false,
    backupPath,
    isHomeTarget,
    block,
    diff
  };
}

export async function profileStatusResult(clientId, targetPath) {
  if (clientId === 'codex') {
    return codexProfileStatusResult(targetPath);
  }
  const config = profileClientConfig(clientId);
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = profileMarkerBounds(existing, config);
  return {
    client: clientId,
    action: 'status',
    targetPath: resolvedTarget,
    installed: marker.present,
    markerPresent: marker.present,
    markerStart: config.markerStart,
    markerEnd: config.markerEnd,
    writesTokenValue: false
  };
}

export async function profileUninstallResult(clientId, targetPath, options = {}) {
  if (clientId === 'codex') {
    return codexProfileUninstallResult(targetPath, options);
  }
  const config = profileClientConfig(clientId);
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = profileMarkerBounds(existing, config);
  const write = Boolean(options.write);
  let changed = false;

  if (marker.present) {
    let nextText = `${existing.slice(0, marker.start)}${existing.slice(marker.end)}`;
    nextText = nextText.replace(/\n{3,}/g, '\n\n');
    if (nextText.trim().length === 0) {
      nextText = '';
    } else if (!nextText.endsWith('\n')) {
      nextText = `${nextText}\n`;
    }
    changed = nextText !== existing;
    if (write && changed) {
      await fs.writeFile(resolvedTarget, nextText);
    }
  }

  return {
    client: clientId,
    action: 'uninstall',
    targetPath: resolvedTarget,
    installed: marker.present && !(write && changed),
    written: write,
    changed,
    markerPresent: marker.present,
    markerStart: config.markerStart,
    markerEnd: config.markerEnd,
    writesTokenValue: false
  };
}

function profileMarkerBounds(content, config) {
  const start = content.indexOf(config.markerStart);
  const end = content.indexOf(config.markerEnd);
  if (start === -1 && end === -1) {
    return { present: false, start: -1, end: -1 };
  }

  if (start === -1 || end === -1 || end < start) {
    throw new UsageError(`${config.label} profile markers are incomplete or out of order; edit the target file manually before retrying.`);
  }

  if (
    content.indexOf(config.markerStart, start + config.markerStart.length) !== -1
    || content.indexOf(config.markerEnd, end + config.markerEnd.length) !== -1
  ) {
    throw new UsageError(`${config.label} profile markers appear more than once; edit the target file manually before retrying.`);
  }

  const afterEnd = end + config.markerEnd.length;
  const trailingNewlineLength = content.slice(afterEnd, afterEnd + 2) === '\r\n'
    ? 2
    : content.slice(afterEnd, afterEnd + 1) === '\n'
      ? 1
      : 0;

  return {
    present: true,
    start,
    end: afterEnd + trailingNewlineLength
  };
}

function userHome(env) {
  return env.USERPROFILE || env.HOME || os.homedir();
}

function codexProfileMarkerBlock() {
  return `${CODEX_PROFILE_MARKER_START}\n${codexProfileInstructionText()}${CODEX_PROFILE_MARKER_END}\n`;
}

function defaultCodexProfileTarget(cwd = process.cwd()) {
  return path.resolve(cwd, CODEX_PROFILE_TARGET);
}

async function codexProfileInstallResult(targetPath, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = markerBounds(existing);
  const block = codexProfileMarkerBlock();
  let nextText;

  if (marker.present) {
    nextText = `${existing.slice(0, marker.start)}${block}${existing.slice(marker.end)}`;
  } else if (existing.trim().length === 0) {
    nextText = block;
  } else {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    nextText = `${existing}${separator}${block}`;
  }

  const isNewFile = existing.trim().length === 0;
  const changed = nextText !== existing;
  const write = Boolean(options.write);
  let backupPath = null;

  if (write && changed) {
    if (!isNewFile) {
      backupPath = `${resolvedTarget}.xmemo.bak`;
      await fs.writeFile(backupPath, existing);
      if (options.io && !options.json) {
        writeLine(options.io.stdout, `Created backup at ${backupPath}`);
      }
    }
    await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fs.writeFile(resolvedTarget, nextText);
  }

  const diff = isNewFile ? '(new file)' : generateUnifiedDiff(resolvedTarget, existing, nextText);
  const isHomeTarget = options.isHomeTarget ?? isHomeProfileTarget(resolvedTarget, options.env ?? process.env, { cwd: options.cwd, clientId: 'codex' });

  return {
    client: 'codex',
    action: 'install',
    targetPath: resolvedTarget,
    markerStart: CODEX_PROFILE_MARKER_START,
    markerEnd: CODEX_PROFILE_MARKER_END,
    installed: marker.present || (write && changed),
    written: write,
    changed,
    markerPresent: marker.present,
    writesTokenValue: false,
    backupPath,
    isHomeTarget,
    block,
    diff
  };
}

async function codexProfileStatusResult(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = markerBounds(existing);
  return {
    client: 'codex',
    action: 'status',
    targetPath: resolvedTarget,
    installed: marker.present,
    markerPresent: marker.present,
    markerStart: CODEX_PROFILE_MARKER_START,
    markerEnd: CODEX_PROFILE_MARKER_END,
    writesTokenValue: false
  };
}

async function codexProfileUninstallResult(targetPath, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const existing = await readTextIfExists(resolvedTarget);
  const marker = markerBounds(existing);
  const write = Boolean(options.write);
  let changed = false;

  if (marker.present) {
    let nextText = `${existing.slice(0, marker.start)}${existing.slice(marker.end)}`;
    nextText = nextText.replace(/\n{3,}/g, '\n\n');
    if (nextText.trim().length === 0) {
      nextText = '';
    } else if (!nextText.endsWith('\n')) {
      nextText = `${nextText}\n`;
    }
    changed = nextText !== existing;
    if (write && changed) {
      await fs.writeFile(resolvedTarget, nextText);
    }
  }

  return {
    client: 'codex',
    action: 'uninstall',
    targetPath: resolvedTarget,
    installed: marker.present && !(write && changed),
    written: write,
    changed,
    markerPresent: marker.present,
    markerStart: CODEX_PROFILE_MARKER_START,
    markerEnd: CODEX_PROFILE_MARKER_END,
    writesTokenValue: false
  };
}

function markerBounds(content) {
  const start = content.indexOf(CODEX_PROFILE_MARKER_START);
  const end = content.indexOf(CODEX_PROFILE_MARKER_END);
  if (start === -1 && end === -1) {
    return { present: false, start: -1, end: -1 };
  }

  if (start === -1 || end === -1 || end < start) {
    throw new UsageError('Codex profile markers are incomplete or out of order; edit the target file manually before retrying.');
  }

  if (
    content.indexOf(CODEX_PROFILE_MARKER_START, start + CODEX_PROFILE_MARKER_START.length) !== -1
    || content.indexOf(CODEX_PROFILE_MARKER_END, end + CODEX_PROFILE_MARKER_END.length) !== -1
  ) {
    throw new UsageError('Codex profile markers appear more than once; edit the target file manually before retrying.');
  }

  const afterEnd = end + CODEX_PROFILE_MARKER_END.length;
  const trailingNewlineLength = content.slice(afterEnd, afterEnd + 2) === '\r\n'
    ? 2
    : content.slice(afterEnd, afterEnd + 1) === '\n'
      ? 1
      : 0;

  return {
    present: true,
    start,
    end: afterEnd + trailingNewlineLength
  };
}

export function writeProfileResult(action, result, io) {
  const config = profileClientConfig(result.client);
  const dryRun = result.written === false && action === 'install';
  writeLine(io.stdout, `${PRODUCT_NAME} ${config?.label ?? result.client} profile ${action}${dryRun ? ' (dry run)' : ''}`);
  if (result.isHomeTarget) {
    writeLine(io.stdout, `  Target: ${result.targetPath} (home directory, outside a repository)`);
  } else {
    writeLine(io.stdout, `  Target: ${result.targetPath}`);
  }
  writeLine(io.stdout, `  Installed: ${result.installed}`);
  if ('written' in result) {
    writeLine(io.stdout, `  Written: ${result.written}`);
    writeLine(io.stdout, `  Changed: ${result.changed}`);
  }
  if (result.backupPath) {
    writeLine(io.stdout, `  Backup created: ${result.backupPath}`);
  }
  writeLine(io.stdout, '  Token value embedded: false');
  if (dryRun) {
    if (result.block) {
      writeLine(io.stdout, '');
      writeLine(io.stdout, 'Profile block:');
      writeLine(io.stdout, result.block.trimEnd());
    }
    if (result.diff) {
      writeLine(io.stdout, '');
      writeLine(io.stdout, 'Diff:');
      writeLine(io.stdout, result.diff);
    }
  }
}

