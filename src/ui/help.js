import {
  CLI_VERSION,
  COMMAND_NAME,
  LEGACY_COMMAND_NAME,
  PACKAGE_NAME,
  PRODUCT_NAME
} from '../core/constants.js';
import { writeLine } from '../core/io.js';

export function writeHelp(io) {
  writeLine(io.stdout, `======================================================================`);
  writeLine(io.stdout, ` 🧠  ${PRODUCT_NAME} CLI (Version ${CLI_VERSION}) — Cloud Memory Orchestration Utility`);
  writeLine(io.stdout, `======================================================================`);
  writeLine(io.stdout, `Official package: ${PACKAGE_NAME} | Legacy command: ${LEGACY_COMMAND_NAME}`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, '💡 CORE ONBOARDING & SETUP COMMANDS:');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup --all [--write] [--profile] [--force]`);
  writeLine(io.stdout, `      Auto-detects all local client installations (Cursor, VS Code, Continue, Trae, etc.).`);
  writeLine(io.stdout, `      Merges XMemo MCP configs. Pass --profile to auto-inject workspace prompt rules.`);
  writeLine(io.stdout, `      *Dry-run by default unless --write (or --yes/-y) is specified for safety.*`);
  writeLine(io.stdout, `      Pass --force to overwrite an existing mcpServers.XMemo entry.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${COMMAND_NAME} setup <client-id> [--url <url>] [--no-profile] [--json] [--force]`);
  writeLine(io.stdout, `      Runs interactive setup wizard for a single client (e.g. cursor, gemini, antigravity).`);
  writeLine(io.stdout, `      Detects active workspace to auto-inject project-scoped instruction rules.`);
  writeLine(io.stdout, `      Pass --force to overwrite an existing mcpServers.XMemo entry.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${COMMAND_NAME} login [--from-stdin] [--base-url <url>]`);
  writeLine(io.stdout, `      Starts secure OAuth2 browser-based device login flow to register the CLI.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, '🛡️  DIAGNOSTICS & SYSTEM AUDIT:');
  writeLine(io.stdout, `  ${COMMAND_NAME} doctor [--base-url <url>] [--json]`);
  writeLine(io.stdout, `      Performs structural diagnostics (Node version, Cloud connectivity, API compatibility, security).`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${COMMAND_NAME} status [--url <url>] [--json]`);
  writeLine(io.stdout, `      Probes and audits XMemo core service endpoints, readiness states, and network health.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, '📋 MCP & CREDENTIAL MANAGEMENT:');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp list`);
  writeLine(io.stdout, `      Lists all natively supported client integrations and configurations.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp config --client <client-id> [--base-url <url>] [--json]`);
  writeLine(io.stdout, `      Generates and outputs raw MCP config snippet templates without writing to files.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${COMMAND_NAME} mcp add <client-id> [--write] [--config <path>]`);
  writeLine(io.stdout, `      Directly adds XMemo MCP server config snippet to the specified client settings file.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${COMMAND_NAME} profile install <client-id> [--target <path>] [--dry-run]`);
  writeLine(io.stdout, `      Injects/updates instruction rules prompt in target workspace rules files (Cursor/Gemini).`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${COMMAND_NAME} token status [--verify] | ${COMMAND_NAME} token add --from-stdin`);
  writeLine(io.stdout, `      Checks local static credential states or manually saves XMEMO_KEY for key-auth fallbacks.`);
  writeLine(io.stdout, '');
  writeLine(io.stdout, '🔐 SECURITY & PRIVACY BY DESIGN:');
  writeLine(io.stdout, '  - ZERO Telemetry: We never collect private workspace data or usage metrics.');
  writeLine(io.stdout, '  - Git Protection: API tokens are kept securely in system environment variables (XMEMO_KEY)');
  writeLine(io.stdout, '    or in user-scoped credentials.json file. They are never written to project configs.');
  writeLine(io.stdout, '  - AST Merge Safety: Config writes only touch and append the XMemo keys, preserving all other servers.');
  writeLine(io.stdout, '======================================================================');
}

