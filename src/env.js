import { hasFlag, optionValue } from './args.js';
import { baseUrlOption } from './base-url.js';
import {
  AGENT_ID_ENV_VAR,
  AGENT_INSTANCE_ENV_VAR,
  COMMAND_NAME,
  PRODUCT_NAME,
  TOKEN_ENV_VAR
} from './constants.js';
import { UsageError } from './errors.js';
import { normalizeBaseUrl } from './http.js';
import { writeLine } from './io.js';

export function envCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    writeLine(io.stdout, 'Env commands:');
    writeLine(io.stdout, `  ${COMMAND_NAME} env example [--shell bash|powershell|cmd] [--base-url <url>] [--json]`);
    return 0;
  }
  if (subcommand !== 'example') {
    throw new UsageError(`Unknown env command: ${subcommand}`);
  }

  const baseUrl = normalizeBaseUrl(baseUrlOption(args.slice(1), io.env));
  const outputJson = hasFlag(args, '--json');
  const shell = optionValue(args, '--shell') ?? (process.platform === 'win32' ? 'powershell' : 'bash');
  const placeholder = '<paste-token-from-your-secret-store>';
  const payload = {
    XMEMO_URL: baseUrl,
    XMEMO_BASE_URL: baseUrl,
    MEMORY_OS_URL: baseUrl,
    MEMORY_OS_BASE_URL: baseUrl,
    [TOKEN_ENV_VAR]: placeholder,
    [AGENT_ID_ENV_VAR]: '<agent-family>',
    [AGENT_INSTANCE_ENV_VAR]: '<stable-random-id-for-this-local-agent>'
  };

  if (outputJson) {
    writeLine(io.stdout, JSON.stringify(payload, null, 2));
    return 0;
  }

  if (shell === 'powershell') {
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('XMEMO_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('XMEMO_BASE_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('MEMORY_OS_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('MEMORY_OS_BASE_URL', '${baseUrl}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('${TOKEN_ENV_VAR}', '${placeholder}', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('${AGENT_ID_ENV_VAR}', '<agent-family>', 'User')`);
    writeLine(io.stdout, `[Environment]::SetEnvironmentVariable('${AGENT_INSTANCE_ENV_VAR}', '<stable-random-id-for-this-local-agent>', 'User')`);
  } else if (shell === 'cmd') {
    writeLine(io.stdout, `setx XMEMO_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx XMEMO_BASE_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx MEMORY_OS_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx MEMORY_OS_BASE_URL "${baseUrl}"`);
    writeLine(io.stdout, `setx ${TOKEN_ENV_VAR} "${placeholder}"`);
    writeLine(io.stdout, `setx ${AGENT_ID_ENV_VAR} "<agent-family>"`);
    writeLine(io.stdout, `setx ${AGENT_INSTANCE_ENV_VAR} "<stable-random-id-for-this-local-agent>"`);
  } else {
    writeLine(io.stdout, `export XMEMO_URL="${baseUrl}"`);
    writeLine(io.stdout, `export XMEMO_BASE_URL="${baseUrl}"`);
    writeLine(io.stdout, `export MEMORY_OS_URL="${baseUrl}"`);
    writeLine(io.stdout, `export MEMORY_OS_BASE_URL="${baseUrl}"`);
    writeLine(io.stdout, `export ${TOKEN_ENV_VAR}="${placeholder}"`);
    writeLine(io.stdout, `export ${AGENT_ID_ENV_VAR}="<agent-family>"`);
    writeLine(io.stdout, `export ${AGENT_INSTANCE_ENV_VAR}="<stable-random-id-for-this-local-agent>"`);
  }
  return 0;
}

export function writePrivacy(io) {
  writeLine(io.stdout, `${PRODUCT_NAME} CLI privacy and security defaults:`);
  writeLine(io.stdout, '- No telemetry or analytics.');
  writeLine(io.stdout, '- `status` does not send tokens.');
  writeLine(io.stdout, `- MCP configs reference ${TOKEN_ENV_VAR}; token values are not embedded.`);
  writeLine(io.stdout, `- Agent instance IDs are non-secret and stored in user-scoped config outside git.`);
  writeLine(io.stdout, '- `login` and `token add` store credentials in the user-scoped XMemo CLI config directory.');
  writeLine(io.stdout, '- Legacy `token set` plaintext storage requires explicit --allow-plaintext.');
  writeLine(io.stdout, '- npm publishing is restricted by package.json files whitelist.');
}
