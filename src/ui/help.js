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
  writeLine(io.stdout, 'Cloud memory setup, diagnostics, and agent integration utilities.');
  writeLine(io.stdout, `Package: ${PACKAGE_NAME}  |  Command: ${COMMAND_NAME}  |  Alias: ${LEGACY_COMMAND_NAME}`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Usage');
  writeLine(io.stdout, `  ${COMMAND_NAME} <command> [options]`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Get started');
  writeLine(io.stdout, `  ${COMMAND_NAME} init [--client <id>...] [--yes] [--dry-run] [--json]`);
  writeLine(io.stdout, '      Guided first-run setup across account, clients, skills, and plugins.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Connect agents');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup <client-id> [--url <url>] [--no-profile] [--json] [--force]`);
  writeLine(io.stdout, '      Configure one client, such as cursor, gemini, antigravity, qwen, or opencode.');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup --all [--write] [--profile] [--force]`);
  writeLine(io.stdout, '      Detect clients and prepare XMemo configs. Dry-run unless --write/--yes is set.');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp list|config|add ...`);
  writeLine(io.stdout, '      Inspect or configure MCP server configurations directly.');
  writeLine(io.stdout, `  ${COMMAND_NAME} profile install|show <client-id> ...`);
  writeLine(io.stdout, '      Install or inspect agent behavior instructions.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Skill');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill install [--client <id>|--all] [--project] [--dir <path>] [--dry-run] [--yes] [--force] [--json]`);
  writeLine(io.stdout, '      Install the verified pinned XMemo Skill into agent skill folders.');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill status [--client <id>|--all] [--json]`);
  writeLine(io.stdout, '      Check installed skill path and version per client.');
  writeLine(io.stdout, `  ${COMMAND_NAME} skill remove --client <id> [--project] [--yes] [--json]`);
  writeLine(io.stdout, '      Remove installed XMemo skill from an agent skill folder.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Plugins');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin list [--all] [--json]`);
  writeLine(io.stdout, '      List available agent plugins from the index.');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin info <id> [--json]`);
  writeLine(io.stdout, '      Show details and install plan for an agent plugin.');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin install <id> [--dry-run] [--yes] [--open] [--json]`);
  writeLine(io.stdout, '      Install an agent plugin from the static index.');
  writeLine(io.stdout, `  ${COMMAND_NAME} plugin status [<id>] [--all] [--json]`);
  writeLine(io.stdout, '      Check installation status of agent plugins.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Memory');
  writeLine(io.stdout, `  ${COMMAND_NAME} memory add|search|read|list ... [--json]`);
  writeLine(io.stdout, '      Save or find memory through the XMemo service.');
  writeLine(io.stdout, `  ${COMMAND_NAME} context recall <query> [--json]`);
  writeLine(io.stdout, '      Build a bounded context pack for the task at hand.');
  writeLine(io.stdout, `  ${COMMAND_NAME} knowledge search|read|add|update ... [--json]`);
  writeLine(io.stdout, '      Query and manage structured knowledge bases.');
  writeLine(io.stdout, `  ${COMMAND_NAME} dream preview|show|apply ... [--json]`);
  writeLine(io.stdout, '      Inspect memory consolidation and optimization previews.');
  writeLine(io.stdout, `  ${COMMAND_NAME} cloud-skill list|show|run ... [--json]`);
  writeLine(io.stdout, '      Work with reviewed Cloud Skills.');
  writeLine(io.stdout, `  ${COMMAND_NAME} state save|restore ... [--json]`);
  writeLine(io.stdout, '      Manage task and workflow session state.');
  writeLine(io.stdout, `  ${COMMAND_NAME} restart snapshot|restore ... [--json]`);
  writeLine(io.stdout, '      Create or restore recovery restart snapshots.');
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
  writeLine(io.stdout, 'Maintenance');
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor [--services ...] [--discovery] [--client <id>] [--smoke] [--json]`);
  writeLine(io.stdout, '      Validate runtime, service reachability, and client configuration.');
  writeLine(io.stdout, `  ${COMMAND_NAME} status [--url <url>] [--json]`);
  writeLine(io.stdout, '      Probe hosted service endpoints and readiness.');
  writeLine(io.stdout, `  ${COMMAND_NAME} update [--dry-run]`);
  writeLine(io.stdout, '      Check or apply the latest npm package update.');
  writeLine(io.stdout, `  ${COMMAND_NAME} uninstall <client-id>|--all [--yes] [--profiles] [--dry-run]`);
  writeLine(io.stdout, '      Remove XMemo configurations from agents.');
  writeLine(io.stdout, `  ${COMMAND_NAME} env [--example]`);
  writeLine(io.stdout, '      Show active environment configuration and overrides.');
  writeLine(io.stdout, `  ${COMMAND_NAME} privacy`);
  writeLine(io.stdout, '      Show data privacy, telemetry-disabled, and security commitments.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Safety');
  writeLine(io.stdout, '  - Dry-run first for setup and uninstall flows.');
  writeLine(io.stdout, '  - XMEMO_KEY is preferred; approved local credentials are unencrypted and never written to project configs.');
  writeLine(io.stdout, '  - Config writes preserve unrelated servers and settings.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Run "${COMMAND_NAME} <command> --help" for command-specific options.`);
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
        'init',
        'setup',
        'mcp',
        'profile',
        'skill',
        'plugin',
        'memory',
        'context',
        'knowledge',
        'dream',
        'cloud-skill',
        'state',
        'restart',
        'account',
        'doctor',
        'status',
        'update',
        'uninstall',
        'env',
        'privacy'
      ]
    },
    error: null
  };
  writeLine(io.stdout, JSON.stringify(envelope, null, 2));
}
