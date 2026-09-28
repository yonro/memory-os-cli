/**
 * Pinned third-party installation versions and package specifications.
 *
 * Single source of truth for third-party plugin and skill installs across
 * OpenClaw, Hermes, and the standalone XMemo Skill installer.
 *
 * How to bump pinned versions:
 * 1. OpenClaw plugin:
 *    - Check latest release at https://github.com/yonro/xmemo-openclaw-memory/releases
 *      or on ClawHub: clawhub inspect @xmemo/openclaw-memory
 *    - Update PINNED_OPENCLAW_PLUGIN_VERSION and PINNED_OPENCLAW_PLUGIN_SPEC.
 * 2. Hermes plugin:
 *    - Check latest release at https://github.com/yonro/hermes-xmemo-plugin/releases
 *      or on PyPI: pip index versions hermes-xmemo
 *    - Update PINNED_HERMES_PLUGIN_VERSION.
 * 3. XMemo Skill:
 *    - Check latest release on npm: npm view @xmemo/skill version dist.integrity
 *    - Update PINNED_SKILL_VERSION and PINNED_SKILL_INTEGRITY (sha512 SRI string).
 * 4. Run tests:
 *    npm test
 */

export const PINNED_OPENCLAW_PLUGIN_VERSION = '1.0.18';
export const PINNED_OPENCLAW_PLUGIN_SPEC = `clawhub:@xmemo/openclaw-memory@${PINNED_OPENCLAW_PLUGIN_VERSION}`;
export const PINNED_OPENCLAW_PLUGIN_NAME = '@xmemo/openclaw-memory';

export const PINNED_OPENCLAW_SKILL_VERSION = '1.1.35';
export const PINNED_OPENCLAW_SKILL_NAME = '@xmemo/xmemo';
export const PINNED_OPENCLAW_SKILL_SPEC = `${PINNED_OPENCLAW_SKILL_NAME}@${PINNED_OPENCLAW_SKILL_VERSION}`;

export const PINNED_HERMES_PLUGIN_VERSION = '1.1.3';
export const PINNED_HERMES_CATALOG_ID = 'xmemo';
export const HERMES_CATALOG_ID = PINNED_HERMES_CATALOG_ID;

export const PINNED_SKILL_VERSION = '1.1.33';
export const PINNED_SKILL_INTEGRITY = 'sha512-1+nfcHczdEM8YNyASWMu5ntJ2RQ5q+CvoJHwq6vObvHGkRSXe4tBFdYpooRW45NYp7xMjZIwrnRAiMZ/V+cgaw==';

