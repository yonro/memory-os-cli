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
  writeLine(io.stdout, 'Setup');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup --all [--write] [--profile] [--force]`);
  writeLine(io.stdout, '      Detect clients and prepare XMemo configs. Dry-run unless --write/--yes is set.');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup <client-id> [--url <url>] [--no-profile] [--json] [--force]`);
  writeLine(io.stdout, '      Configure one client, such as cursor, gemini, antigravity, qwen, or opencode.');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup openclaw [--with-mcp|--mcp-only] [--no-skill] [--dry-run] [--json]`);
  writeLine(io.stdout, '      Install or update the native OpenClaw memory plugin and XMemo Skill.');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup hermes [--with-mcp|--mcp-only] [--no-plugin] [--hermes-home <path>]`);
  writeLine(io.stdout, '      Install or update the native Hermes plugin and shared credential.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Authentication');
  writeLine(io.stdout, `  ${COMMAND_NAME} login [--from-stdin] [--base-url <url>]`);
  writeLine(io.stdout, '      Start browser device login or save a token from stdin.');
  writeLine(io.stdout, `  ${COMMAND_NAME} token status [--verify]`);
  writeLine(io.stdout, '      Check the local credential without printing secrets.');
  writeLine(io.stdout, `  ${COMMAND_NAME} token add --from-stdin`);
  writeLine(io.stdout, '      Store an existing XMemo token from stdin.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Operations');
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor [--base-url <url>] [--json]`);
  writeLine(io.stdout, '      Validate runtime, service reachability, and integration readiness.');
  writeLine(io.stdout, `  ${COMMAND_NAME} status [--url <url>] [--json]`);
  writeLine(io.stdout, '      Probe hosted service endpoints and readiness.');
  writeLine(io.stdout, `  ${COMMAND_NAME} update [--dry-run]`);
  writeLine(io.stdout, '      Check or apply the latest npm package update.');
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
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Removal');
  writeLine(io.stdout, `  ${COMMAND_NAME} uninstall --all [--yes] [--profiles] [--dry-run]`);
  writeLine(io.stdout, '      Remove XMemo entries from detected clients. Dry-run unless --yes is set.');
  writeLine(io.stdout, `  ${COMMAND_NAME} uninstall <client-id> [--yes] [--profiles] [--dry-run]`);
  writeLine(io.stdout, '      Remove XMemo from one client config.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, 'Safety');
  writeLine(io.stdout, '  - Dry-run first for setup and uninstall flows.');
  writeLine(io.stdout, '  - Tokens stay in XMEMO_KEY or user-scoped credentials; they are never written to project configs.');
  writeLine(io.stdout, '  - Config writes preserve unrelated servers and settings.');
  writeLine(io.stdout, '');
  writeLine(io.stdout, `Run "${COMMAND_NAME} <command> --help" for command-specific options.`);
}

