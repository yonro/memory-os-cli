import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_PATH = path.join(__dirname, 'index.json');

const VALID_KINDS = Object.freeze(['native-cli', 'git-dir', 'marketplace', 'manual', 'mcp']);
const VALID_STATUSES = Object.freeze(['stable', 'preview', 'legacy']);
const COMMIT_HEX_RE = /^[0-9a-f]{40}$/i;
const PLUGIN_ID_RE = /^[a-z0-9_-]+$/i;

let cachedPlugins = null;

export function loadPluginIndex() {
  if (!cachedPlugins) {
    const raw = readFileSync(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    for (const plugin of parsed) {
      validatePluginSchema(plugin);
    }
    cachedPlugins = Object.freeze(parsed.map((p) => Object.freeze({ ...p })));
  }
  return cachedPlugins;
}

export function validatePluginSchema(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin entry must be an object');
  }

  if (typeof plugin.id !== 'string' || !PLUGIN_ID_RE.test(plugin.id)) {
    throw new Error(`Invalid plugin id: ${JSON.stringify(plugin.id)}`);
  }

  if (typeof plugin.platform !== 'string' || !plugin.platform) {
    throw new Error(`Plugin ${plugin.id}: platform must be a non-empty string`);
  }

  if (typeof plugin.label !== 'string' || !plugin.label) {
    throw new Error(`Plugin ${plugin.id}: label must be a non-empty string`);
  }

  if (typeof plugin.repo !== 'string' || !plugin.repo.startsWith('yonro/')) {
    throw new Error(`Plugin ${plugin.id}: repo must be a string starting with yonro/`);
  }

  if (!VALID_KINDS.includes(plugin.kind)) {
    throw new Error(`Plugin ${plugin.id}: kind must be one of ${VALID_KINDS.join(', ')}`);
  }

  if (plugin.version !== null && typeof plugin.version !== 'string') {
    throw new Error(`Plugin ${plugin.id}: version must be a string or null`);
  }

  if (plugin.tag !== null && typeof plugin.tag !== 'string') {
    throw new Error(`Plugin ${plugin.id}: tag must be a string or null`);
  }

  if (typeof plugin.commit !== 'string' || !COMMIT_HEX_RE.test(plugin.commit)) {
    throw new Error(`Plugin ${plugin.id}: commit must be a 40-character hex string`);
  }

  if (plugin.install !== null) {
    if (!Array.isArray(plugin.install) || plugin.install.length === 0 || !plugin.install.every((a) => typeof a === 'string')) {
      throw new Error(`Plugin ${plugin.id}: install must be an argv array of strings or null`);
    }
  }

  if (plugin.detect !== null && typeof plugin.detect !== 'object') {
    throw new Error(`Plugin ${plugin.id}: detect must be an object or null`);
  }

  if (plugin.verify !== null && typeof plugin.verify !== 'object') {
    throw new Error(`Plugin ${plugin.id}: verify must be an object or null`);
  }

  if (typeof plugin.docs !== 'string' || !plugin.docs.startsWith('https://')) {
    throw new Error(`Plugin ${plugin.id}: docs must be an https URL`);
  }

  if (!VALID_STATUSES.includes(plugin.status)) {
    throw new Error(`Plugin ${plugin.id}: status must be one of ${VALID_STATUSES.join(', ')}`);
  }

  if (plugin.clientId !== null && typeof plugin.clientId !== 'string') {
    throw new Error(`Plugin ${plugin.id}: clientId must be a string or null`);
  }
}

export function allPlugins({ includeLegacy = false } = {}) {
  const list = loadPluginIndex();
  if (includeLegacy) {
    return [...list];
  }
  return list.filter((p) => p.status !== 'legacy');
}

export function getPlugin(id) {
  if (typeof id !== 'string') return null;
  const list = loadPluginIndex();
  return list.find((p) => p.id === id) ?? null;
}

export function isValidPluginId(id) {
  return Boolean(getPlugin(id));
}

export function supportedPluginIds({ includeLegacy = false } = {}) {
  return allPlugins({ includeLegacy }).map((p) => p.id);
}
