import {
  CLI_VERSION,
  COMMAND_NAME,
  LEGACY_COMMAND_NAME,
  PACKAGE_NAME,
  PRODUCT_NAME
} from '../core/constants.js';
import { writeLine } from '../core/io.js';

export function writeHelp(io) {
  writeLine(io.stdout, `${PRODUCT_NAME} CLI ${CLI_VERSION}`);
  writeLine(io.stdout, `Cloud memory setup, diagnostics, and agent integration utilities.`);
  writeLine(io.stdout, `Package: ${PACKAGE_NAME}  |  Command: ${COMMAND_NAME}  |  Alias: ${LEGACY_COMMAND_NAME}`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Usage');
  writeLine(io.stdout, `  ${COMMAND_NAME} <command> [options]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Daily Memory');
  writeLine(io.stdout, `  ${COMMAND_NAME} start`);
  writeLine(io.stdout, '      Show a local, no-network first-memory walkthrough.');
  writeLine(io.stdout, `  ${COMMAND_NAME} memory add|search|read ... [--json]`);
  writeLine(io.stdout, '      Save or find memory through the XMemo service.');
  writeLine(io.stdout, `  ${COMMAND_NAME} context recall <query> [--json]`);
  writeLine(io.stdout, '      Build a bounded context pack for the task at hand.');
  writeLine(io.stdout, `  ${COMMAND_NAME} knowledge|dream|cloud-skill ... [--json]`);
  writeLine(io.stdout, '      Work with knowledge, cleanup previews, and reviewed Cloud Skills.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Setup');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup --all [--write] [--profile] [--force]`);
  writeLine(io.stdout, '      Detect clients and prepare XMemo configs. Dry-run unless --write/--yes is set.');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup <client-id> [--url <url>] [--no-profile] [--json] [--force]`);
  writeLine(io.stdout, '      Configure one client, such as cursor, gemini, antigravity, qwen, or opencode.');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup openclaw [--with-mcp|--mcp-only] [--no-skill] [--dry-run] [--force] [--json]`);
  writeLine(io.stdout, '      Install or update the native OpenClaw memory plugin and XMemo Skill. Use --force to reinstall.');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup hermes [--with-mcp|--mcp-only] [--no-plugin] [--hermes-home <path>]`);
  writeLine(io.stdout, '      Install or update the native Hermes plugin and shared credential.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Plugins');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin list [--all] [--json]`);
  writeLine(io.stdout, '      List available agent plugins from the index.');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin info <id> [--json]`);
  writeLine(io.stdout, '      Show details and install plan for an agent plugin.');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin install <id> [--dry-run] [--yes] [--open] [--dir <path>] [--json]`);
  writeLine(io.stdout, '      Install an agent plugin from the static index.');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin status [<id>] [--all] [--json]`);
  writeLine(io.stdout, '      Check installation status of agent plugins.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Account');
  writeLine(io.stdout, `  ${COMMAND_NAME} account login [--base-url <url>] [--allow-plaintext] [--json]`);
  writeLine(io.stdout, '      Start browser login or import token from stdin.');
  writeLine(io.stdout, `  ${COMMAND_NAME} account logout [--yes] [--json]`);
  writeLine(io.stdout, '      Remove locally stored XMemo credentials owned by the CLI.');
  writeLine(io.stdout, `  ${COMMAND_NAME} account status [--verify] [--base-url <url>] [--json]`);
  writeLine(io.stdout, '      Check active authentication state and optionally verify credential.');
  writeLine(io.stdout, `  ${COMMAND_NAME} account token <status|add|set> [--json]`);
  writeLine(io.stdout, '      Check or store token credentials.');
  writeLine(io.stdout, `      (Legacy aliases: ${COMMAND_NAME} login, auth status, auth-status, token status)`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Operations');
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor --client kiro [--config <path>] [--auth oauth|key] [--fix] [--json]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} setup kiro [--auth oauth|key]`);
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor [--services [memory,dream,knowledge,cloud-skill]] [--base-url <url>] [--json]`);
  writeLine(io.stdout, '      Validate runtime, service reachability, and integration readiness.');
  writeLine(io.stdout, `  ${COMMAND_NAME} status [--url <url>] [--json]`);
  writeLine(io.stdout, '      Probe hosted service endpoints and readiness.');
  writeLine(io.stdout, `  ${COMMAND_NAME} update [--dry-run]`);
  writeLine(io.stdout, '      Check or apply the latest npm package update.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Skills');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill install [--client <id>|--all] [--project] [--dir <path>] [--dry-run] [--yes] [--force] [--json]`);
  writeLine(io.stdout, '      Install the verified pinned XMemo Skill into agent skill folders or a target directory.');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill status [--client <id>|--all] [--json]`);
  writeLine(io.stdout, '      Check installed skill path and version per client.');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill remove --client <id> [--project] [--yes] [--json]`);
  writeLine(io.stdout, '      Remove installed XMemo skill from an agent skill folder.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'MCP And Profiles');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp list`);
  writeLine(io.stdout, '      List supported MCP clients.');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client <client-id> [--base-url <url>] [--json]`);
  writeLine(io.stdout, '      Print a config snippet without writing files.');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <client-id> [--write] [--config <path>]`);
  writeLine(io.stdout, '      Add XMemo to a client config file.');
  writeLine(io.stdout, `  ${COMMAND_NAME} profile install <client-id> [--target <path>] [--dry-run]`);
  writeLine(io.stdout, '      Install behavior profile instructions for a workspace.');
  writeLine(io.stdout, `  ${COMMAND_NAME} profile show <client-id> [--target <path>] [--json]`);
  writeLine(io.stdout, '      Show behavior profile instructions and target path without writing.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Removal');
  writeLine(io.stdout, `  ${COMMAND_NAME} uninstall --all [--yes] [--profiles] [--dry-run]`);
  writeLine(io.stdout, '      Remove XMemo entries from detected clients. Dry-run unless --yes is set.');
  writeLine(io.stdout, `  ${COMMAND_NAME} uninstall <client-id> [--yes] [--profiles] [--dry-run]`);
  writeLine(io.stdout, '      Remove XMemo from one client config.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Safety');
  writeLine(io.stdout, '  - Dry-run first for setup and uninstall flows.');
  writeLine(io.stdout, '  - XMEMO_KEY is preferred; approved local credentials are unencrypted and never written to project configs.');
  writeLine(io.stdout, '  - Config writes preserve unrelated servers and settings.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Run "${COMMAND_NAME} <command> --help" for command-specific options.`);
}

export function writeStart(io, options = {}) {
  const isJson = options.json ?? false;
  if (isJson) {
    writeLine(io.stdout, JSON.stringify({
      schemaVersion: '1',
      ok: true,
      command: 'start',
      data: {
        steps: [
          'account login',
          'memory add --content "A useful fact" --path projects/example',
          'memory search "useful fact"',
          'context recall "continue the project" --max-tokens 2000 --max-items 8'
        ]
      },
      error: null
    }, null, 2));
    return;
  }
  writeLine(io.stdout, `${PRODUCT_NAME} quick start`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `1. ${COMMAND_NAME} account login`);
  writeLine(io.stdout, `2. ${COMMAND_NAME} memory add --content "A useful fact" --path projects/example`);
  writeLine(io.stdout, `3. ${COMMAND_NAME} memory search "useful fact"`);
  writeLine(io.stdout, `4. ${COMMAND_NAME} context recall "continue the project" --max-tokens 2000 --max-items 8`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'This guide is local only; it does not sign in, scan clients, or create test memory.');
}

export function writeHelpJson(io, subArgs = []) {
  const envelope = {
    schemaVersion: '1',
    ok: true,
    command: subArgs.length > 0 ? `help.${subArgs.join('.')}` : 'help',
    data: {
      package: PACKAGE_NAME,
      version: CLI_VERSION,
      description: 'Cloud memory setup, diagnostics, and agent integration utilities.',
      commands: [
        'start',
        'account',
        'memory',
        'context',
        'knowledge',
        'dream',
        'cloud-skill',
        'setup',
        'plugin',
        'skill',
        'doctor',
        'status',
        'update',
        'mcp',
        'profile',
        'uninstall',
        'env',
        'privacy'
      ]
    },
    error: null
  };
  writeLine(io.stdout, JSON.stringify(envelope, null, 2));
}

