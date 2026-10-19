import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { EXIT_CODE } from '../lib/core.mjs';
import {
  fetchLatestSkillVersion,
  compareSemver,
} from '../lib/update-check.mjs';

const GITHUB_RELEASE_ARCHIVE_URL = 'https://github.com/yonro/memory-os-cli/releases/latest/download/xmemo-skill.tar.gz';

export function getSkillRoot(metaUrl = import.meta.url) {
  const currentDir = path.dirname(fileURLToPath(metaUrl));
  const base = path.basename(currentDir);
  const root = base === 'commands' || base === 'lib'
    ? path.resolve(currentDir, '../..')
    : (base === 'scripts' ? path.resolve(currentDir, '..') : currentDir);
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

function isUnderDirectory(childPath, parentPath, platform = process.platform) {
  let child = path.resolve(childPath);
  let parent = path.resolve(parentPath);
  if (platform === 'win32') {
    child = child.toLowerCase();
    parent = parent.toLowerCase();
  }
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function hasProjectClaudeSkills(targetPath) {
  const normalized = targetPath.replace(/\\/g, '/').toLowerCase();
  return /\.claude\/skills(\/|$)/.test(normalized);
}

export function detectInstallChannel(skillRoot, env = process.env, platform = process.platform) {
  const normalizedRoot = path.resolve(skillRoot);
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const normalizedHome = path.resolve(home);

  // 1. Path in ~/.claude/skills/ -> claude-code (global)
  const userClaudeSkills = path.resolve(normalizedHome, '.claude', 'skills');
  if (isUnderDirectory(normalizedRoot, userClaudeSkills, platform)) {
    return 'claude-code';
  }

  // 2. Path in ${CODEX_HOME:-~/.codex}/skills/ -> codex
  const codexHome = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.resolve(normalizedHome, '.codex');
  const userCodexSkills = path.resolve(codexHome, 'skills');
  if (isUnderDirectory(normalizedRoot, userCodexSkills, platform)) {
    return 'codex';
  }

  // 3. Path in ~/.openclaw/ -> openclaw
  const userOpenClaw = path.resolve(normalizedHome, '.openclaw');
  if (isUnderDirectory(normalizedRoot, userOpenClaw, platform)) {
    return 'openclaw';
  }

  // 4. Project-level .claude/skills/ -> claude-code-project
  if (hasProjectClaudeSkills(normalizedRoot)) {
    return 'claude-code-project';
  }

  // 5. Any other location -> manual
  return 'manual';
}

export function getChannelInstructions(channel, skillRoot, platform = process.platform) {
  const isWindows = platform === 'win32';
  const doctorScript = path.join(skillRoot, 'scripts', 'xmemo-skill.mjs');
  const verifyCommand = `node "${doctorScript}" doctor --anonymous`;

  let primary = '';
  let fallback = '';
  let reloadHint = '';

  switch (channel) {
    case 'claude-code': {
      primary = 'xmemo skill update --client claude-code --yes';
      fallback = isWindows
        ? '$env:XMEMO_SKILL_AGENT="claude-code"; $env:XMEMO_SKILL_FORCE="1"; irm https://xmemo.dev/skill/install.ps1 | iex'
        : 'curl -fsSL https://xmemo.dev/skill/install | XMEMO_SKILL_AGENT=claude-code XMEMO_SKILL_FORCE=1 sh';
      reloadHint = 'Restart your Claude Code session to reload the updated skill.';
      break;
    }
    case 'codex': {
      primary = 'xmemo skill update --client codex --yes';
      fallback = isWindows
        ? '$env:XMEMO_SKILL_AGENT="codex"; $env:XMEMO_SKILL_FORCE="1"; irm https://xmemo.dev/skill/install.ps1 | iex'
        : 'curl -fsSL https://xmemo.dev/skill/install | XMEMO_SKILL_AGENT=codex XMEMO_SKILL_FORCE=1 sh';
      reloadHint = 'Restart your Codex session to reload the updated skill.';
      break;
    }
    case 'openclaw': {
      primary = 'openclaw skills install @xmemo/xmemo --force';
      fallback = 'openclaw skills install @xmemo/xmemo';
      reloadHint = 'Restart your OpenClaw session to reload the updated skill.';
      break;
    }
    case 'claude-code-project': {
      primary = 'xmemo skill update --client claude-code --project --yes';
      fallback = isWindows
        ? `$env:XMEMO_SKILL_DIR="${skillRoot}"; $env:XMEMO_SKILL_FORCE="1"; irm https://xmemo.dev/skill/install.ps1 | iex`
        : `curl -fsSL https://xmemo.dev/skill/install | XMEMO_SKILL_DIR="${skillRoot}" XMEMO_SKILL_FORCE=1 sh`;
      reloadHint = 'Restart your Claude Code session in this project to reload the updated skill.';
      break;
    }
    case 'manual':
    default: {
      primary = GITHUB_RELEASE_ARCHIVE_URL;
      fallback = isWindows
        ? `irm "${GITHUB_RELEASE_ARCHIVE_URL}" -OutFile xmemo-skill.tar.gz; tar -xzf xmemo-skill.tar.gz -C "${skillRoot}"`
        : `curl -fsSL -o xmemo-skill.tar.gz "${GITHUB_RELEASE_ARCHIVE_URL}" && tar -xzf xmemo-skill.tar.gz -C "${skillRoot}"`;
      reloadHint = 'Restart your agent session to reload the updated skill.';
      break;
    }
  }

  const fullReloadHint = `${reloadHint} Verify connectivity: ${verifyCommand}`;
  const commands = [primary];
  if (fallback) commands.push(fallback);

  return {
    channel,
    commands,
    primary,
    fallback,
    reloadHint: fullReloadHint,
    verifyCommand,
  };
}

export async function handleUpgrade(ctx) {
  const { options, skillVersion } = ctx;
  const isJson = Boolean(options.json);

  const skillRoot = getSkillRoot(import.meta.url);
  const channel = detectInstallChannel(skillRoot, process.env, process.platform);
  const instructions = getChannelInstructions(channel, skillRoot, process.platform);

  let latest = null;
  let updateAvailable = false;
  try {
    latest = await fetchLatestSkillVersion(options.baseUrl, options.timeoutMs);
    const cmp = compareSemver(skillVersion, latest);
    updateAvailable = cmp < 0;
  } catch {
    latest = 'unknown';
    updateAvailable = false;
  }

  if (isJson) {
    const payload = {
      installed: skillVersion,
      latest,
      update_available: updateAvailable,
      channel,
      skill_root: skillRoot,
      commands: instructions.commands,
      reload_hint: instructions.reloadHint,
    };
    console.log(JSON.stringify(payload));
    process.exit(EXIT_CODE.SUCCESS);
  }

  const latestText = latest === 'unknown' ? 'unknown (fetch failed)' : latest;
  console.log(`Installed version:     ${skillVersion}`);
  console.log(`Latest version:        ${latestText}`);
  console.log(`Update available:      ${updateAvailable ? 'yes' : 'no'}`);
  console.log(`Installation channel:  ${channel}`);
  console.log(`Skill directory:       ${skillRoot}`);
  console.log('');
  console.log('Recommended update command:');
  console.log(`  ${instructions.primary}`);
  if (instructions.fallback) {
    console.log('');
    console.log('Fallback update command:');
    console.log(`  ${instructions.fallback}`);
  }
  if (channel === 'manual') {
    console.log('');
    console.log('Note: Please backup your skill directory before extracting new files.');
  }
  console.log('');
  console.log(`After updating:`);
  console.log(`  ${instructions.reloadHint}`);

  process.exit(EXIT_CODE.SUCCESS);
}
