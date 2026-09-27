import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CODEX_PROFILE_TARGET,
  MCP_SERVER_NAME,
  TOKEN_ENV_VAR
} from '../core/constants.js';
import { fileExists } from '../core/runtime.js';
import {
  defaultAntigravity2ConfigPath,
  defaultAntigravityCliConfigPath,
  defaultAntigravityConfigPath,
  defaultAntigravityIdeConfigPath,
  defaultClaudeConfigPath,
  defaultClaudecodeConfigPath,
  defaultClineConfigPath,
  defaultCodexConfigPath,
  defaultContinueConfigPath,
  defaultCursorConfigPath,
  defaultGeminiConfigPath,
  defaultGrokConfigPath,
  defaultHermesConfigPath,
  defaultJetbrainsConfigPath,
  defaultKimiCodeConfigPath,
  defaultKiroConfigPath,
  defaultOpencodeConfigPath,
  defaultOpenclawConfigPath,
  defaultQwenConfigPath,
  defaultTraeConfigPath,
  defaultTraeSoloConfigPath,
  defaultWindsurfConfigPath,
  defaultZedConfigPath
} from '../config/paths.js';
import { defaultCopilotConfigPath } from '../mcp/identity/paths.js';
import {
  appendGrokServerConfig,
  appendTomlServerConfig,
  codexTomlSnippet,
  grokTomlSnippet,
  removeTomlServerConfig
} from '../mcp/formats/toml.js';
import {
  hermesYamlSnippet,
  mergeHermesMcpConfig,
  removeHermesMcpConfig
} from '../mcp/formats/yaml.js';
import {
  jsonClientSnippet,
  mergeJsonClientMcpConfig,
  removeJsonClientMcpConfig
} from '../mcp/formats/json.js';
import {
  mergeCopilotMcpConfig,
  removeCopilotMcpConfig
} from '../mcp/proxy/copilot.js';
import { kiroDoctor } from '../commands/kiro-doctor.js';
import { codexDoctor } from '../commands/codex-doctor.js';
import { isRepo, userHome } from '../core/runtime.js';

export const CLIENT_REGISTRY = Object.freeze([
  // 1. Codex
  {
    id: 'codex',
    label: 'Codex',
    aliases: [],
    setupAlias: 'codex',
    mcp: {
      configKind: 'toml',
      defaultConfigPath: defaultCodexConfigPath,
      configPathCandidates: (env) => [defaultCodexConfigPath(env)],
      buildSnippet: codexTomlSnippet,
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        appendTomlServerConfig(configPath, mcpUrl, identity, options.force),
      removeConfig: (configPath, options = {}) =>
        removeTomlServerConfig(configPath, options),
      authentication: 'env-bearer'
    },
    profile: {
      label: 'Codex',
      setupAlias: 'codex',
      profileVersion: 'codex-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerDir: null,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        return path.resolve(cwd, CODEX_PROFILE_TARGET);
      }
    },
    skillDir: (env) => path.join(userHome(env), '.codex', 'skills', 'xmemo-memory'),
    pluginId: 'codex',
    doctor: codexDoctor,
    detect: async (env, options = {}) => detectClientByCandidates('codex', env, options)
  },
  // 2. Grok
  {
    id: 'grok',
    label: 'Grok',
    aliases: ['grok-cli', 'grok-build'],
    setupAlias: 'grok',
    mcp: {
      configKind: 'toml',
      defaultConfigPath: defaultGrokConfigPath,
      configPathCandidates: (env) => [defaultGrokConfigPath(env)],
      buildSnippet: grokTomlSnippet,
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        appendGrokServerConfig(configPath, mcpUrl, identity, options.force),
      removeConfig: (configPath, options = {}) =>
        removeTomlServerConfig(configPath, options),
      authentication: 'env-bearer'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('grok', env, options)
  },
  // 3. Cursor
  {
    id: 'cursor',
    label: 'Cursor',
    aliases: [],
    setupAlias: 'cursor',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultCursorConfigPath,
      configPathCandidates: (env) => [defaultCursorConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('cursor', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('cursor', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('cursor', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'url',
      authentication: 'env-bearer',
      bearerSyntax: 'env-colon'
    },
    profile: {
      label: 'Cursor',
      setupAlias: 'cursor',
      profileVersion: 'cursor-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerDir: '.cursor',
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.cursor')) {
          return path.join(cwd, '.cursor', 'rules', 'AGENTS.md');
        }
        return path.join(userHome(env), '.cursor', 'memory-profile.md');
      }
    },
    skillDir: null,
    pluginId: 'cursor',
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('cursor', env, options)
  },
  // 4. Gemini CLI
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    aliases: ['gemini'],
    setupAlias: 'gemini',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultGeminiConfigPath,
      configPathCandidates: (env) => [defaultGeminiConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('gemini-cli', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('gemini-cli', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('gemini-cli', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'httpUrl',
      authentication: 'oauth',
      bearerSyntax: 'env-colon'
    },
    profile: {
      label: 'Gemini CLI',
      setupAlias: 'gemini',
      profileVersion: 'gemini-cli-mcp-depth-v1',
      requiredTokenEnv: null,
      markerDir: null,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'GEMINI.md');
        }
        return path.join(userHome(env), '.gemini', 'GEMINI.md');
      }
    },
    skillDir: null,
    pluginId: 'gemini-cli',
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('gemini-cli', env, options)
  },
  // 5. Antigravity
  {
    id: 'antigravity',
    label: 'Antigravity',
    aliases: [],
    setupAlias: 'antigravity',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultAntigravityConfigPath,
      configPathCandidates: (env) => [defaultAntigravityConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('antigravity', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('antigravity', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('antigravity', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'serverUrl',
      authentication: 'oauth',
      bearerSyntax: 'env-colon'
    },
    profile: {
      label: 'Antigravity',
      setupAlias: 'antigravity',
      profileVersion: 'antigravity-mcp-depth-v1',
      requiredTokenEnv: null,
      markerDir: null,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'GEMINI.md');
        }
        return path.join(userHome(env), '.gemini', 'antigravity', 'MEMORY.md');
      }
    },
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('antigravity', env, options)
  },
  // 6. Antigravity IDE
  {
    id: 'antigravity-ide',
    label: 'Antigravity IDE',
    aliases: [],
    setupAlias: 'antigravity-ide',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultAntigravityIdeConfigPath,
      configPathCandidates: (env) => [defaultAntigravityIdeConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('antigravity-ide', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('antigravity-ide', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('antigravity-ide', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'serverUrl',
      authentication: 'oauth',
      defaultIdentityId: 'antigravity',
      bearerSyntax: 'env-colon'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('antigravity-ide', env, options)
  },
  // 7. Antigravity 2.0
  {
    id: 'antigravity2',
    label: 'Antigravity 2.0',
    aliases: [],
    setupAlias: 'antigravity2',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultAntigravity2ConfigPath,
      configPathCandidates: (env) => [defaultAntigravity2ConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('antigravity2', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('antigravity2', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('antigravity2', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'serverUrl',
      authentication: 'oauth',
      defaultIdentityId: 'antigravity',
      bearerSyntax: 'env-colon'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('antigravity2', env, options)
  },
  // 8. Antigravity CLI
  {
    id: 'antigravity-cli',
    label: 'Antigravity CLI',
    aliases: [],
    setupAlias: 'antigravity-cli',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultAntigravityCliConfigPath,
      configPathCandidates: (env) => [defaultAntigravityCliConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('antigravity-cli', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('antigravity-cli', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('antigravity-cli', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'serverUrl',
      authentication: 'oauth',
      defaultIdentityId: 'antigravity',
      bearerSyntax: 'env-colon'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('antigravity-cli', env, options)
  },
  // 9. Windsurf (Devin Desktop)
  {
    id: 'windsurf',
    label: 'Devin Desktop (formerly Windsurf)',
    aliases: ['devin-desktop'],
    setupAlias: 'windsurf',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultWindsurfConfigPath,
      configPathCandidates: (env) => {
        const home = userHome(env);
        return [
          path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
          defaultWindsurfConfigPath(env)
        ];
      },
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('windsurf', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('windsurf', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('windsurf', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'serverUrl',
      authentication: 'env-bearer',
      bearerSyntax: 'env-colon'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('windsurf', env, options)
  },
  // 10. Cline
  {
    id: 'cline',
    label: 'Cline',
    aliases: [],
    setupAlias: 'cline',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultClineConfigPath,
      configPathCandidates: (env) => {
        const candidates = [];
        if (process.platform === 'win32' && env?.APPDATA) {
          candidates.push(path.join(env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
        } else {
          const home = userHome(env);
          if (process.platform === 'darwin') {
            candidates.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
          }
          candidates.push(path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
        }
        candidates.push(defaultClineConfigPath(env));
        return candidates;
      },
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('cline', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('cline', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('cline', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'httpUrl',
      authentication: 'env-bearer',
      bearerSyntax: 'env-colon'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('cline', env, options)
  },
  // 11. Continue
  {
    id: 'continue',
    label: 'Continue',
    aliases: [],
    setupAlias: 'continue',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultContinueConfigPath,
      configPathCandidates: (env) => [defaultContinueConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('continue', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('continue', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('continue', configPath, options),
      section: 'mcpServers',
      serverKind: 'nested-transport',
      authentication: 'env-bearer',
      bearerSyntax: 'plain',
      mergeExperimentalModelContextProtocolServers: true
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('continue', env, options)
  },
  // 12. Claude Desktop
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    aliases: ['claude'],
    setupAlias: 'claude',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultClaudeConfigPath,
      configPathCandidates: (env) => [defaultClaudeConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('claude-desktop', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('claude-desktop', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('claude-desktop', configPath, options),
      section: 'mcpServers',
      serverKind: 'mcp-remote-command',
      authentication: 'env-bearer'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('claude-desktop', env, options)
  },
  // 13. OpenClaw
  {
    id: 'openclaw',
    label: 'OpenClaw',
    aliases: [],
    setupAlias: 'openclaw',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultOpenclawConfigPath,
      configPathCandidates: (env) => [defaultOpenclawConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('openclaw', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('openclaw', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('openclaw', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'url',
      authentication: 'env-bearer',
      bearerSyntax: 'env-colon'
    },
    profile: null,
    skillDir: (env) => path.join(userHome(env), '.openclaw', 'skills', 'xmemo-memory'),
    pluginId: 'openclaw',
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('openclaw', env, options)
  },
  // 14. Kiro
  {
    id: 'kiro',
    label: 'Kiro',
    aliases: [],
    setupAlias: 'kiro',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultKiroConfigPath,
      configPathCandidates: (env) => [defaultKiroConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('kiro', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('kiro', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('kiro', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'url',
      authentication: 'oauth',
      bearerSyntax: 'env-colon'
    },
    profile: {
      label: 'Kiro',
      setupAlias: 'kiro',
      profileVersion: 'kiro-mcp-depth-v1',
      requiredTokenEnv: null,
      markerDir: '.kiro',
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.kiro')) {
          return path.join(cwd, '.kiro', 'steering', 'AGENTS.md');
        }
        return path.join(userHome(env), '.kiro', 'steering', 'AGENTS.md');
      }
    },
    skillDir: null,
    pluginId: 'kiro',
    doctor: kiroDoctor,
    detect: async (env, options = {}) => detectClientByCandidates('kiro', env, options)
  },
  // 15. Kimi Code
  {
    id: 'kimi-code',
    label: 'Kimi Code',
    aliases: ['kimi', 'kimi-cli'],
    setupAlias: 'kimi',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultKimiCodeConfigPath,
      configPathCandidates: (env) => [defaultKimiCodeConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('kimi-code', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('kimi-code', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('kimi-code', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'url',
      authentication: 'bearer-token-env-var',
      bearerTokenEnvVar: 'XMEMO_KEY',
      bearerSyntax: 'env-colon'
    },
    profile: {
      label: 'Kimi Code',
      setupAlias: 'kimi',
      profileVersion: 'kimi-code-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerDir: '.kimi-code',
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.kimi-code')) {
          return path.join(cwd, '.kimi-code', 'AGENTS.md');
        }
        return path.join(userHome(env), '.kimi-code', 'AGENTS.md');
      }
    },
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('kimi-code', env, options)
  },
  // 16. Zed
  {
    id: 'zed',
    label: 'Zed',
    aliases: [],
    setupAlias: 'zed',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultZedConfigPath,
      configPathCandidates: (env) => [defaultZedConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('zed', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('zed', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('zed', configPath, options),
      section: 'context_servers',
      serverKind: 'mcp-remote-command',
      authentication: 'env-bearer'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('zed', env, options)
  },
  // 17. JetBrains
  {
    id: 'jetbrains',
    label: 'JetBrains',
    aliases: [],
    setupAlias: 'jetbrains',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultJetbrainsConfigPath,
      configPathCandidates: (env) => [defaultJetbrainsConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('jetbrains', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('jetbrains', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('jetbrains', configPath, options),
      section: 'mcpServers',
      serverKind: 'nested-transport',
      authentication: 'env-bearer',
      bearerSyntax: 'plain',
      mergeExperimentalModelContextProtocolServers: true
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('jetbrains', env, options)
  },
  // 18. OpenCode
  {
    id: 'opencode',
    label: 'OpenCode',
    aliases: [],
    setupAlias: 'opencode',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultOpencodeConfigPath,
      configPathCandidates: (env) => [defaultOpencodeConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('opencode', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('opencode', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('opencode', configPath, options),
      section: 'mcp',
      serverKind: 'remote',
      authentication: 'oauth'
    },
    profile: {
      label: 'OpenCode',
      setupAlias: 'opencode',
      profileVersion: 'opencode-mcp-depth-v1',
      requiredTokenEnv: null,
      markerDir: null,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'AGENTS.md');
        }
        return path.join(userHome(env), '.config', 'opencode', 'AGENTS.md');
      }
    },
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('opencode', env, options)
  },
  // 19. Hermes
  {
    id: 'hermes',
    label: 'Hermes',
    aliases: [],
    setupAlias: 'hermes',
    mcp: {
      configKind: 'yaml',
      defaultConfigPath: defaultHermesConfigPath,
      configPathCandidates: (env) => [defaultHermesConfigPath(env)],
      buildSnippet: hermesYamlSnippet,
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeHermesMcpConfig(configPath, mcpUrl, identity, options.force),
      removeConfig: (configPath, options = {}) =>
        removeHermesMcpConfig(configPath, options),
      authentication: 'env-bearer'
    },
    profile: null,
    skillDir: null,
    pluginId: 'hermes',
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('hermes', env, options)
  },
  // 20. Qwen
  {
    id: 'qwen',
    label: 'Qwen',
    aliases: ['qwencli', 'qwen-cli'],
    setupAlias: 'qwen',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultQwenConfigPath,
      configPathCandidates: (env) => [defaultQwenConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('qwen', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('qwen', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('qwen', configPath, options),
      section: 'mcpServers',
      serverKind: 'http',
      urlKey: 'httpUrl',
      authentication: 'oauth',
      bearerSyntax: 'env-colon'
    },
    profile: {
      label: 'Qwen',
      setupAlias: 'qwen',
      profileVersion: 'qwen-mcp-depth-v1',
      requiredTokenEnv: null,
      markerDir: null,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env)) {
          return path.join(cwd, 'QWEN.md');
        }
        return path.join(userHome(env), '.qwen', 'QWEN.md');
      }
    },
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('qwen', env, options)
  },
  // 21. Trae
  {
    id: 'trae',
    label: 'Trae',
    aliases: [],
    setupAlias: 'trae',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultTraeConfigPath,
      configPathCandidates: (env) => [defaultTraeConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('trae', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('trae', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('trae', configPath, options),
      section: 'mcpServers',
      serverKind: 'mcp-remote-command',
      authentication: 'env-bearer'
    },
    profile: {
      label: 'Trae',
      setupAlias: 'trae',
      profileVersion: 'trae-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerDir: '.trae',
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.trae')) {
          return path.join(cwd, '.trae', 'rules', 'AGENTS.md');
        }
        return path.join(userHome(env), '.trae', 'memory-profile.md');
      }
    },
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('trae', env, options)
  },
  // 22. Trae Solo
  {
    id: 'trae-solo',
    label: 'Trae Solo',
    aliases: ['traesolo'],
    setupAlias: 'trae-solo',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultTraeSoloConfigPath,
      configPathCandidates: (env) => [defaultTraeSoloConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('trae-solo', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('trae-solo', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('trae-solo', configPath, options),
      section: 'mcpServers',
      serverKind: 'mcp-remote-command',
      authentication: 'env-bearer'
    },
    profile: {
      label: 'Trae Solo',
      setupAlias: 'trae-solo',
      profileVersion: 'trae-solo-mcp-depth-v1',
      requiredTokenEnv: TOKEN_ENV_VAR,
      markerDir: '.trae',
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.trae')) {
          return path.join(cwd, '.trae', 'rules', 'AGENTS.md');
        }
        return path.join(userHome(env), '.trae', 'memory-profile.md');
      }
    },
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('trae-solo', env, options)
  },
  // 23. Claude Code
  {
    id: 'claude-code',
    label: 'Claude Code',
    aliases: ['claudecode', 'claude-cli', 'claudecode-cli'],
    setupAlias: 'claude-code',
    mcp: {
      configKind: 'json',
      defaultConfigPath: defaultClaudecodeConfigPath,
      configPathCandidates: (env) => [defaultClaudecodeConfigPath(env)],
      buildSnippet: (mcpUrl, identity, options = {}) =>
        jsonClientSnippet('claude-code', mcpUrl, identity, options),
      writeConfig: (configPath, mcpUrl, identity, options = {}) =>
        mergeJsonClientMcpConfig('claude-code', configPath, mcpUrl, identity, options.force, options),
      removeConfig: (configPath, options = {}) =>
        removeJsonClientMcpConfig('claude-code', configPath, options),
      section: 'mcpServers',
      serverKind: 'mcp-remote-command',
      authentication: 'env-bearer'
    },
    profile: {
      label: 'Claude Code',
      setupAlias: 'claude-code',
      markerDir: '.claude',
      profileVersion: 'claude-code-mcp-depth-v1',
      requiredTokenEnv: null,
      defaultTarget: (env, options = {}) => {
        const cwd = options.cwd ?? env?.CWD ?? process.cwd();
        if (isRepo(cwd, env, '.claude')) {
          return path.join(cwd, 'CLAUDE.md');
        }
        return path.join(userHome(env), '.claude', 'CLAUDE.md');
      }
    },
    skillDir: (env, options = {}) =>
      options?.project
        ? path.join(options.cwd ?? process.cwd(), '.claude', 'skills', 'xmemo-memory')
        : path.join(userHome(env), '.claude', 'skills', 'xmemo-memory'),
    supportsProjectSkill: true,
    pluginId: 'claude-code',
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('claude-code', env, options)
  },
  // 24. Copilot CLI
  {
    id: 'copilot-cli',
    label: 'Copilot CLI',
    aliases: ['copilot'],
    setupAlias: 'copilot',
    mcp: {
      configKind: 'local-proxy',
      defaultConfigPath: defaultCopilotConfigPath,
      configPathCandidates: (env) => {
        const candidates = [];
        if (process.platform === 'win32' && env?.APPDATA) {
          candidates.push(path.join(env.APPDATA, 'Code', 'User', 'mcp.json'));
        } else {
          const home = userHome(env);
          if (process.platform === 'darwin') {
            candidates.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
          }
          candidates.push(path.join(home, '.config', 'Code', 'User', 'mcp.json'));
        }
        candidates.push(defaultCopilotConfigPath(env));
        return candidates;
      },
      buildSnippet: null,
      writeConfig: async (configPath, proxyUrl, _identity, options = {}) => {
        await mergeCopilotMcpConfig(configPath, proxyUrl, options.force);
      },
      removeConfig: async (configPath, options = {}) => {
        return await removeCopilotMcpConfig(configPath, options);
      },
      authentication: 'local-proxy'
    },
    profile: null,
    skillDir: null,
    pluginId: null,
    doctor: null,
    detect: async (env, options = {}) => detectClientByCandidates('copilot-cli', env, options)
  }
]);

const CLIENTS_BY_ID = new Map();
const ALIAS_TO_ID = new Map();

for (const client of CLIENT_REGISTRY) {
  CLIENTS_BY_ID.set(client.id, client);
  ALIAS_TO_ID.set(client.id, client.id);
  if (client.setupAlias) {
    ALIAS_TO_ID.set(client.setupAlias, client.id);
  }
  for (const alias of client.aliases) {
    ALIAS_TO_ID.set(alias, client.id);
  }
}

async function detectClientByCandidates(clientId, env, options = {}) {
  const client = CLIENTS_BY_ID.get(clientId);
  if (!client) {
    return { detected: false };
  }
  const cwd = options.cwd ?? env?.CWD ?? process.cwd();
  if (client.profile?.markerDir && existsSync(path.join(cwd, client.profile.markerDir))) {
    return { detected: true, path: path.join(cwd, client.profile.markerDir) };
  }
  const candidates = client.mcp?.configPathCandidates ? client.mcp.configPathCandidates(env) : [];
  for (const filePath of candidates) {
    if (await fileExists(filePath)) {
      return { detected: true, path: filePath };
    }
    const parentDir = path.dirname(filePath);
    if (await fileExists(parentDir)) {
      return { detected: true, path: filePath };
    }
  }
  return { detected: false };
}

export function resolveClientId(idOrAlias) {
  if (typeof idOrAlias !== 'string') {
    return null;
  }
  return ALIAS_TO_ID.get(idOrAlias.trim().toLowerCase()) ?? null;
}

export function resolveClientAlias(idOrAlias) {
  return resolveClientId(idOrAlias) ?? idOrAlias;
}

export function getClient(idOrAlias) {
  const resolved = resolveClientId(idOrAlias);
  return resolved ? CLIENTS_BY_ID.get(resolved) ?? null : null;
}

export function allClients() {
  return [...CLIENT_REGISTRY];
}

export function allClientIds() {
  return CLIENT_REGISTRY.map((c) => c.id);
}

export function supportedSetupClientIds() {
  return CLIENT_REGISTRY.map((c) => c.id);
}

export function supportedMcpClientIds() {
  return CLIENT_REGISTRY.filter((c) => c.mcp !== null).map((c) => c.id);
}

export function supportedMcpClients() {
  return CLIENT_REGISTRY.filter((c) => c.mcp !== null).map((c) => ({
    id: c.id,
    label: c.label,
    configKind: c.mcp.configKind
  }));
}

export function supportedProfileClientIds() {
  return CLIENT_REGISTRY.filter((c) => c.profile !== null).map((c) => c.id);
}

export function supportedUninstallClientIds() {
  return CLIENT_REGISTRY.map((c) => c.id);
}

export function supportedDoctorClientIds() {
  return CLIENT_REGISTRY.filter((c) => c.doctor !== null).map((c) => c.id);
}

export function supportedSkillClientIds() {
  return CLIENT_REGISTRY.filter((c) => c.skillDir !== null).map((c) => c.id);
}

export function supportedSkillClients() {
  return CLIENT_REGISTRY.filter((c) => c.skillDir !== null).map((c) => ({
    id: c.id,
    label: c.label,
    supportsProjectSkill: Boolean(c.supportsProjectSkill)
  }));
}

export function usesClientOAuth(idOrAlias) {
  const client = getClient(idOrAlias);
  return client?.mcp?.authentication === 'oauth';
}

export function createMcpClientsMap() {
  const map = new Map();
  for (const client of CLIENT_REGISTRY) {
    if (client.mcp) {
      map.set(client.id, {
        id: client.id,
        label: client.label,
        defaultConfigPath: client.mcp.defaultConfigPath,
        buildSnippet: client.mcp.buildSnippet,
        writeConfig: client.mcp.writeConfig,
        removeConfig: client.mcp.removeConfig,
        configKind: client.mcp.configKind,
        authentication: client.mcp.authentication,
        section: client.mcp.section,
        serverKind: client.mcp.serverKind,
        pluginId: client.pluginId
      });
    }
  }
  return map;
}

export const MCP_CLIENTS = createMcpClientsMap();
