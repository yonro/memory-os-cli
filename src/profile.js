import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CODEX_PROFILE_MARKER_END,
  CODEX_PROFILE_MARKER_START,
  CODEX_PROFILE_TARGET,
  COMMAND_NAME,
  MCP_SERVER_NAME,
  PRODUCT_NAME,
  PROFILE_MARKER_PREFIX,
  TOKEN_ENV_VAR
} from './constants.js';
import { UsageError } from './errors.js';
import { writeLine } from './io.js';
import { readTextIfExists } from './runtime.js';

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
    config.authInstruction
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
    `## XMemo ${profile.label} profile`,
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
    `Recommended ${profile.label} behavior:`
  );
  for (const instruction of profile.instructions) {
    lines.push(`- ${instruction}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function profileClientConfig(clientId) {
  const profileConfigs = {
    codex: {
      label: 'Codex',
      setupAlias: 'codex',
      profileVersion: 'codex-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: CODEX_PROFILE_MARKER_START,
      markerEnd: CODEX_PROFILE_MARKER_END,
      defaultTarget: () => defaultCodexProfileTarget(),
      authInstruction: `Keep XMemo authentication through the ${TOKEN_ENV_VAR} environment variable; do not paste token values into prompts, config files, or logs.`
    },
    cursor: {
      label: 'Cursor',
      setupAlias: 'cursor',
      profileVersion: 'cursor-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: `<!-- ${PROFILE_MARKER_PREFIX}:cursor:start -->`,
      markerEnd: `<!-- ${PROFILE_MARKER_PREFIX}:cursor:end -->`,
      defaultTarget: (env) => {
        const isTest = env.HOME && (env.HOME.includes('memory-os-') || env.HOME.includes('test'));
        if (!isTest && (existsSync(path.join(process.cwd(), '.cursor')) || existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), 'package.json')))) {
          return path.join(process.cwd(), '.cursor', 'rules', 'xmemo-memory.md');
        }
        return path.join(userHome(env), '.cursor', 'memory-profile.md');
      },
      authInstruction: `Keep XMemo authentication through the ${TOKEN_ENV_VAR} environment variable; do not paste token values into prompts, config files, or logs.`
    },
    'gemini-cli': {
      label: 'Gemini CLI',
      setupAlias: 'gemini',
      profileVersion: 'gemini-cli-mcp-depth-v1',
      markerStart: `<!-- ${PROFILE_MARKER_PREFIX}:gemini-cli:start -->`,
      markerEnd: `<!-- ${PROFILE_MARKER_PREFIX}:gemini-cli:end -->`,
      defaultTarget: (env) => {
        const isTest = env.HOME && (env.HOME.includes('memory-os-') || env.HOME.includes('test'));
        if (!isTest && (existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), 'package.json')))) {
          return path.join(process.cwd(), 'GEMINI.md');
        }
        return path.join(userHome(env), '.gemini', 'GEMINI.md');
      },
      authInstruction: 'Use the client-managed MCP OAuth credential; do not paste token values into prompts, config files, or logs.'
    },
    antigravity: {
      label: 'Antigravity',
      setupAlias: 'antigravity',
      profileVersion: 'antigravity-mcp-depth-v1',
      markerStart: `<!-- ${PROFILE_MARKER_PREFIX}:antigravity:start -->`,
      markerEnd: `<!-- ${PROFILE_MARKER_PREFIX}:antigravity:end -->`,
      defaultTarget: (env) => {
        const isTest = env.HOME && (env.HOME.includes('memory-os-') || env.HOME.includes('test'));
        if (!isTest && (existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), 'package.json')))) {
          return path.join(process.cwd(), 'GEMINI.md');
        }
        return path.join(userHome(env), '.gemini', 'antigravity', 'MEMORY.md');
      },
      authInstruction: 'Use the client-managed MCP OAuth credential; do not paste token values into prompts, config files, or logs.'
    },
    qwen: {
      label: 'Qwen',
      setupAlias: 'qwen',
      profileVersion: 'qwen-mcp-depth-v1',
      markerStart: `<!-- ${PROFILE_MARKER_PREFIX}:qwen:start -->`,
      markerEnd: `<!-- ${PROFILE_MARKER_PREFIX}:qwen:end -->`,
      defaultTarget: (env) => {
        const isTest = env.HOME && (env.HOME.includes('memory-os-') || env.HOME.includes('test'));
        if (!isTest && (existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), 'package.json')))) {
          return path.join(process.cwd(), 'QWEN.md');
        }
        return path.join(userHome(env), '.qwen', 'QWEN.md');
      },
      authInstruction: `Keep XMemo authentication through the ${TOKEN_ENV_VAR} environment variable; do not paste token values into prompts, config files, or logs.`
    },
    opencode: {
      label: 'OpenCode',
      setupAlias: 'opencode',
      profileVersion: 'opencode-mcp-depth-v1',
      markerStart: `<!-- ${PROFILE_MARKER_PREFIX}:opencode:start -->`,
      markerEnd: `<!-- ${PROFILE_MARKER_PREFIX}:opencode:end -->`,
      defaultTarget: (env) => {
        const isTest = env.HOME && (env.HOME.includes('memory-os-') || env.HOME.includes('test'));
        if (!isTest && (existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), 'package.json')))) {
          return path.join(process.cwd(), 'AGENTS.md');
        }
        return path.join(userHome(env), '.config', 'opencode', 'AGENTS.md');
      },
      authInstruction: 'Use the client-managed MCP OAuth credential; do not paste token values into prompts, config files, or logs.'
    },
    trae: {
      label: 'Trae',
      setupAlias: 'trae',
      profileVersion: 'trae-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: `<!-- ${PROFILE_MARKER_PREFIX}:trae:start -->`,
      markerEnd: `<!-- ${PROFILE_MARKER_PREFIX}:trae:end -->`,
      defaultTarget: (env) => {
        const isTest = env.HOME && (env.HOME.includes('memory-os-') || env.HOME.includes('test'));
        if (!isTest && (existsSync(path.join(process.cwd(), '.trae')) || existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), 'package.json')))) {
          return path.join(process.cwd(), '.trae', 'rules', 'xmemo-memory.md');
        }
        return path.join(userHome(env), '.trae', 'memory-profile.md');
      },
      authInstruction: `Keep XMemo authentication through the ${TOKEN_ENV_VAR} environment variable; do not paste token values into prompts, config files, or logs.`
    },
    'trae-solo': {
      label: 'Trae Solo',
      setupAlias: 'trae-solo',
      profileVersion: 'trae-solo-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerStart: `<!-- ${PROFILE_MARKER_PREFIX}:trae-solo:start -->`,
      markerEnd: `<!-- ${PROFILE_MARKER_PREFIX}:trae-solo:end -->`,
      defaultTarget: (env) => {
        const isTest = env.HOME && (env.HOME.includes('memory-os-') || env.HOME.includes('test'));
        if (!isTest && (existsSync(path.join(process.cwd(), '.trae')) || existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), 'package.json')))) {
          return path.join(process.cwd(), '.trae', 'rules', 'xmemo-memory.md');
        }
        return path.join(userHome(env), '.trae', 'memory-profile.md');
      },
      authInstruction: `Keep XMemo authentication through the ${TOKEN_ENV_VAR} environment variable; do not paste token values into prompts, config files, or logs.`
    }
  };
  return profileConfigs[clientId] ?? null;
}

export function supportedProfileClientIds() {
  return ['codex', 'cursor', 'gemini', 'antigravity', 'qwen', 'opencode', 'trae', 'trae-solo'];
}

export function defaultProfileTarget(clientId, env) {
  const config = profileClientConfig(clientId);
  if (!config) {
    throw new UsageError(`Unsupported profile client: ${clientId}`);
  }
  return config.defaultTarget(env);
}

export async function confirmProfileInstall(clientId, targetPath, io) {
  const config = profileClientConfig(clientId);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Write XMemo memory behavior profile to ${targetPath}? [Y/n]`);
  const answer = (await readLineFromStdin(io.stdin)).trim().toLowerCase();
  if (answer === '' || answer === 'y' || answer === 'yes') {
    return true;
  }
  if (answer === 'n' || answer === 'no') {
    return false;
  }
  throw new UsageError(`Unsupported response for ${config.label} profile prompt: ${answer}`);
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

  const changed = nextText !== existing;
  const write = Boolean(options.write);
  if (write && changed) {
    await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fs.writeFile(resolvedTarget, nextText);
  }

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
    writesTokenValue: false
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

function defaultCodexProfileTarget() {
  return path.resolve(process.cwd(), CODEX_PROFILE_TARGET);
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

  const changed = nextText !== existing;
  const write = Boolean(options.write);
  if (write && changed) {
    await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fs.writeFile(resolvedTarget, nextText);
  }

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
    writesTokenValue: false
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
  writeLine(io.stdout, `${PRODUCT_NAME} ${config?.label ?? result.client} profile ${action}`);
  writeLine(io.stdout, `  Target: ${result.targetPath}`);
  writeLine(io.stdout, `  Installed: ${result.installed}`);
  if ('written' in result) {
    writeLine(io.stdout, `  Written: ${result.written}`);
    writeLine(io.stdout, `  Changed: ${result.changed}`);
  }
  writeLine(io.stdout, '  Token value embedded: false');
}
