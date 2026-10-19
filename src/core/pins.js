/**
 * Pinned third-party installation versions and package specifications.
 *
 * Single source of truth for third-party plugin and skill installs across
 * OpenClaw, Hermes, and the standalone XMemo Skill installer.
 *
 * Release Ordering Requirement (发布顺序约束):
 * Always release XMemo Skill FIRST, and release XMemo CLI SECOND (先发 Skill，再发 CLI；严禁颠倒).
 *
 * Why this order is required:
 * 1. CLI pins the standalone @xmemo/skill version and its SHA-512 SRI integrity string.
 *    The integrity hash must be verified against the published npm package (@xmemo/skill dist.integrity).
 * 2. CLI release gate (`scripts/check-release-version.mjs`) checks git `skill-v*` tags. If
 *    PINNED_SKILL_VERSION in this file is older than the latest `skill-v*` tag in git, CLI release
 *    is blocked with exit code 1.
 * 3. OpenClaw skill pin (`PINNED_OPENCLAW_SKILL_VERSION`) must stay synchronized with PINNED_SKILL_VERSION.
 *
 * Correct Release Workflow Sequence:
 * Step 1: Release XMemo Skill (PR -> merge to main -> tag skill-vX.Y.Z -> GitHub Release Latest -> npm/ClawHub/SkillHub).
 * Step 2: Update this file (PINNED_SKILL_VERSION, PINNED_OPENCLAW_SKILL_VERSION, PINNED_SKILL_INTEGRITY) on a branch.
 * Step 3: Run verification tests (npm test, release:check, verify-release-packaging).
 * Step 4: Release XMemo CLI (PR -> merge to main -> tag cli-vX.Y.Z -> GitHub Release --latest=false -> npm OIDC).
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
 * 3. XMemo Skill (MUST BE PUBLISHED BEFORE BUMPING CLI):
 *    - Check latest release on npm: npm view @xmemo/skill version dist.integrity
 *    - Double-check integrity by downloading tarball and computing sha512 SRI.
 *    - Update PINNED_SKILL_VERSION, PINNED_OPENCLAW_SKILL_VERSION, and PINNED_SKILL_INTEGRITY.
 * 4. Run tests:
 *    npm test
 */

export const PINNED_OPENCLAW_PLUGIN_VERSION = '1.0.18';
export const PINNED_OPENCLAW_PLUGIN_SPEC = `clawhub:@xmemo/openclaw-memory@${PINNED_OPENCLAW_PLUGIN_VERSION}`;
export const PINNED_OPENCLAW_PLUGIN_NAME = '@xmemo/openclaw-memory';

export const PINNED_OPENCLAW_SKILL_VERSION = '1.1.44';
export const PINNED_OPENCLAW_SKILL_NAME = '@xmemo/xmemo';
export const PINNED_OPENCLAW_SKILL_SPEC = `${PINNED_OPENCLAW_SKILL_NAME}@${PINNED_OPENCLAW_SKILL_VERSION}`;

export const PINNED_HERMES_PLUGIN_VERSION = '1.1.3';
export const PINNED_HERMES_CATALOG_ID = 'xmemo';
export const HERMES_CATALOG_ID = PINNED_HERMES_CATALOG_ID;

export const PINNED_SKILL_VERSION = '1.1.44';
export const PINNED_SKILL_INTEGRITY = 'sha512-WlqPDElpc4oYcGHj5UvVQur2xz11c9owl4x1cfhQ/XUzphBkOR5xms5SQGw0tIuPYHFlFwk3e2K2QDO2OCNHog==';

