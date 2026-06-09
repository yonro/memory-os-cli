import os from 'node:os';
import path from 'node:path';

export function configRoot(env) {
  if (env.XMEMO_CONFIG_HOME) {
    return env.XMEMO_CONFIG_HOME;
  }

  if (env.MEMORY_OS_CONFIG_HOME) {
    return env.MEMORY_OS_CONFIG_HOME;
  }

  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'XMemo', 'CLI');
  }

  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, 'xmemo');
  }

  const home = env.HOME || os.homedir();
  return path.join(home, '.config', 'xmemo');
}

export function defaultCodexConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.codex', 'config.toml');
}

export function defaultCursorConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.cursor', 'mcp.json');
}

export function defaultGeminiConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.gemini', 'settings.json');
}

export function defaultAntigravityConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.gemini', 'config', 'mcp_config.json');
}

export function defaultAntigravityIdeConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.gemini', 'config', 'mcp_config.json');
}

export function defaultAntigravity2ConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.gemini', 'config', 'mcp_config.json');
}

export function defaultAntigravityCliConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.gemini', 'config', 'mcp_config.json');
}

export function defaultCopilotConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(env.COPILOT_HOME ?? path.join(home, '.copilot'), 'mcp-config.json');
}

export function defaultWindsurfConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
}

export function defaultClineConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, 'Documents', 'Cline', 'MCP', 'cline_mcp_settings.json');
}

export function defaultContinueConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.continue', 'config.json');
}

export function defaultClaudeConfigPath(env) {
  if (process.platform === 'win32' && env.APPDATA) {
    return path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json');
  }
  const home = env.HOME || os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export function defaultOpenclawConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.openclaw', 'openclaw.json');
}

export function defaultKiroConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.kiro', 'settings', 'mcp.json');
}

export function defaultZedConfigPath(env) {
  if (process.platform === 'win32' && env.APPDATA) {
    return path.join(env.APPDATA, 'Zed', 'settings.json');
  }
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, '.config', 'zed', 'settings.json');
}

export function defaultJetbrainsConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.continue', 'config.json');
}

export function defaultOpencodeConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.config', 'opencode', 'opencode.json');
}

export function defaultHermesConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.hermes', 'config.yaml');
}

export function defaultQwenConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.qwen', 'settings.json');
}

export function defaultTraeConfigPath(env) {
  if (process.platform === 'win32' && env.APPDATA) {
    return path.join(env.APPDATA, 'Trae', 'User', 'mcp.json');
  }
  const home = env.USERPROFILE || env.HOME || os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Trae', 'User', 'mcp.json');
  }
  return path.join(home, '.config', 'Trae', 'User', 'mcp.json');
}

export function defaultTraeSoloConfigPath(env) {
  if (process.platform === 'win32' && env.APPDATA) {
    return path.join(env.APPDATA, 'TRAE SOLO', 'User', 'mcp.json');
  }
  const home = env.USERPROFILE || env.HOME || os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'TRAE SOLO', 'User', 'mcp.json');
  }
  return path.join(home, '.config', 'TRAE SOLO', 'User', 'mcp.json');
}

export function defaultClaudecodeConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.claude.json');
}

export function defaultGrokConfigPath(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.grok', 'config.toml');
}

