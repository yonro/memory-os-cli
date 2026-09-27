import { hasFlag, optionValue } from '../core/args.js';
import { COMMAND_NAME, PRODUCT_NAME } from '../core/constants.js';
import { defaultCodexConfigPath } from '../config/paths.js';
import { codexSmokeReport } from '../mcp/formats/toml.js';
import { writeLine } from '../core/io.js';

export async function codexDoctor(args, io) {
  const configPath = optionValue(args, '--config') ?? defaultCodexConfigPath(io.env);
  const report = await codexSmokeReport(configPath, io.env);
  const outputJson = hasFlag(args, '--json');

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  writeLine(io.stdout, `${PRODUCT_NAME} Codex MCP smoke: ${report.ok ? 'ok' : 'failed'}`);
  writeLine(io.stdout, `Config: ${report.configPath}`);
  writeLine(io.stdout, `Token env: ${report.tokenEnvVar}`);
  for (const check of report.checks) {
    const status = check.ok ? 'OK' : check.required ? 'FAIL' : 'WARN';
    writeLine(io.stdout, `  ${status} ${check.name}: ${check.detail}`);
  }
  return report.ok ? 0 : 1;
}
