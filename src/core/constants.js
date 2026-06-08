export const PRODUCT_NAME = 'XMemo';
export const PACKAGE_NAME = '@xmemo/client';
export const FALLBACK_PACKAGE_NAME = '@yonro/xmemo-client';
export const COMMAND_NAME = 'xmemo';
export const LEGACY_COMMAND_NAME = 'memory-os';
export { CLI_VERSION } from './version.js';
export const DEFAULT_SERVICE_URL = 'https://xmemo.dev';
export const TOKEN_ENV_VAR = 'XMEMO_KEY';
export const LEGACY_TOKEN_ENV_VAR = 'MEMORY_OS_MCP_TOKEN';
export const AGENT_ID_ENV_VAR = 'XMEMO_AGENT_ID';
export const AGENT_INSTANCE_ENV_VAR = 'XMEMO_AGENT_INSTANCE_ID';
export const AGENT_ID_HEADER = 'X-Memory-OS-Agent-ID';
export const AGENT_INSTANCE_HEADER = 'X-Memory-OS-Agent-Instance-ID';
export const MCP_SERVER_NAME = 'XMemo';
export const LEGACY_MCP_SERVER_NAMES = ['memory_os', 'memory-os'];
export const CODEX_PROFILE_TARGET = 'AGENTS.md';
export const CODEX_PROFILE_MARKER_START = '<!-- xmemo:profile:start -->';
export const CODEX_PROFILE_MARKER_END = '<!-- xmemo:profile:end -->';
export const CLIENT_PROFILE_TARGETS = {
  cursor: '.cursor/rules/AGENTS.md',
  'gemini-cli': 'GEMINI.md',
  antigravity: 'GEMINI.md',
  trae: '.trae/rules/AGENTS.md',
  'trae-solo': '.trae/rules/AGENTS.md'
};
export const CLIENT_PROFILE_MARKER_START = '<!-- xmemo:profile:start -->';
export const CLIENT_PROFILE_MARKER_END = '<!-- xmemo:profile:end -->';
export const PROFILE_MARKER_PREFIX = 'memory-os:memory-profile';
export const DEVICE_LOGIN_START_PATH = '/api/v1/auth/device/start';
export const DEVICE_LOGIN_TOKEN_PATH = '/api/v1/auth/device/token';
export const DEFAULT_PROXY_HOST = '127.0.0.1';
export const DEFAULT_PROXY_PORT = 8765;
