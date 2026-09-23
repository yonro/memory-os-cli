import {
  SCRIPT_COMMAND,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
} from './core.mjs';

export const COMMAND_USAGE_REGISTRY = {
  login: {
    usage: 'login --allow-plaintext',
    desc: 'Start formal device login and explicitly permit local token storage',
  },
  register: {
    usage: 'register --reason <unattended|declined> --allow-plaintext',
    desc: 'Start limited temporary memory only when formal login is unavailable',
  },
  logout: {
    usage: 'logout [--revoke-environment-token]',
    desc: 'Revoke and remove a local credential',
  },
  'auth status': {
    usage: 'auth status [--verify]',
    desc: 'Show local or verified auth status (alias: auth-status)',
  },
  'auth add': {
    usage: 'auth add --from-stdin --allow-plaintext',
    desc: 'Store a formal token read from standard input',
  },
  'auth claim-status': {
    usage: 'auth claim-status [--allow-plaintext]',
    desc: 'Check temporary-account claim status',
  },
  'auth claim-confirm': {
    usage: 'auth claim-confirm [--allow-plaintext]',
    desc: 'Confirm a pending human claim and accept formal token handoff',
  },
  'auth claim-deny': {
    usage: 'auth claim-deny [--allow-plaintext]',
    desc: 'Decline a pending bind and keep isolated temporary access',
  },
  read: {
    usage: 'read --id <id> [--offset <n>] [--limit <n>] [--bucket <bucket>] [--scope <scope>]',
  },
  update: {
    usage: 'update --id <id> [--content <text>] [--path <path>] [--metadata <json>] [--bucket <bucket>] [--scope <scope>]',
  },
  forget: {
    usage: 'forget --id <id> [--reason <text>] --confirm',
  },
  'ledger-list': {
    usage: 'ledger-list [--month <YYYY-MM>] [--from <date>] [--to <date>] [--currency <code>] [--category <name>] [--type <type>] [--min-amount <n>] [--max-amount <n>] [--limit <n>] [--offset <n>]',
  },
  'ledger-summary': {
    usage: 'ledger-summary [--months <n>] [--currency <code>] [--type <type>]',
  },
  overview: {
    usage: 'overview',
    desc: 'Show account overview (memories, storage, agents)',
  },
  activity: {
    usage: 'activity [--limit <n>]',
    desc: 'Show recent account activity',
  },
  stats: {
    usage: 'stats [--scope <scope>] [--path <path>] [--bucket <bucket>] [--memory-type <type>] [--status <status>] [--source <src>] [--since <iso>] [--until <iso>] [--group-by <dims>] [--top-n <1..200>] [--team-id <id>]',
    desc: 'Show memory statistics and breakdown',
  },
  remember: {
    usage: 'remember (--content <text> | --content - | --file <path>) [--path <path>] [--metadata <json-object>]',
  },
  recall: {
    usage: 'recall --query <text> [--limit <n>] [--explain <true|false>] [--prefer_working <true|false>] [--compact]',
  },
  search: {
    usage: 'search --query <text> [--limit <n>] [--explain <true|false>] [--prefer_working <true|false>] [--compact]',
  },
  'recall-context': {
    usage: 'recall-context --query <text> [--max_items <n>] [--max_tokens <n>] [--prefer_working <true|false>] [--include_knowledge <true|false>]',
    desc: 'Read-only bounded Memory context; opt into Knowledge with true',
  },
  'save-state': {
    usage: 'save-state --key <key> [--content <text>] [--ttl_seconds <0..604800>]',
    desc: '(alias: state-save)',
  },
  'restore-state': {
    usage: 'restore-state --key <key>',
    desc: '(alias: state-restore)',
  },
  'state-save': {
    usage: 'state-save --key <key> [--content <text>] [--ttl_seconds <0..604800>] (legacy alias)',
    aliasOf: 'save-state',
  },
  'state-restore': {
    usage: 'state-restore --key <key> (legacy alias)',
    aliasOf: 'restore-state',
  },
  'restart-snapshot': {
    usage: 'restart-snapshot [--state_key <key>] [--session_id <id>] [--ttl_seconds <0..2592000>]',
    desc: 'Save a full restart-continuity snapshot',
  },
  'restart-restore': {
    usage: 'restart-restore [--snapshot_id <id> | --source_session_id <id>] [--target_session_id <id>]',
    desc: 'Restore the latest or selected restart snapshot',
  },
  'todo-add': {
    usage: 'todo-add --content <text>',
  },
  'todo-list': {
    usage: 'todo-list',
  },
  'todo-done': {
    usage: 'todo-done --id <todo_id>',
  },
  'expense-add': {
    usage: 'expense-add --item <text> --amount <number> --currency <code>',
  },
  doctor: {
    usage: 'doctor [--anonymous]',
  },
};

export function buildTopLevelHelp() {
  const lines = [
    'XMemo Standalone Skill Runtime',
    '',
    'Usage:',
    `  ${SCRIPT_COMMAND} <command> [options]`,
    '',
    'Commands:',
  ];
  for (const entry of Object.values(COMMAND_USAGE_REGISTRY)) {
    if (entry.aliasOf) continue;
    if (entry.desc) {
      lines.push(`  ${entry.usage.padEnd(35)} ${entry.desc}`);
    } else {
      lines.push(`  ${entry.usage}`);
    }
  }
  lines.push('');
  lines.push('Credential resolution:');
  lines.push('  XMEMO_KEY                          Preferred; never copied to the local credential file');
  lines.push('  User credential file               Read only as a fallback');
  lines.push('');
  lines.push('Global options:');
  lines.push('  --json                             Print the API response as JSON');
  lines.push('  --terminal                         Force human-readable terminal output even when piped');
  lines.push(`  --base-url <url>                   Override ${DEFAULT_BASE_URL}; HTTPS or loopback HTTP only`);
  lines.push(`  --timeout-ms <ms>                  Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})`);
  lines.push('  --compact                          Shorten recall/search content for terminals');
  lines.push('  --allow-plaintext                  Explicitly permit unencrypted user-file credential storage');
  lines.push('  --version                          Show the Skill runtime version');
  lines.push('  --help, -h                         Show this help');
  lines.push('');
  lines.push(`Run \`${SCRIPT_COMMAND} <command> --help\` for command-specific usage.`);
  return lines.join('\n');
}

export function printUsage(command) {
  const commonOptions = '[--json] [--terminal] [--base-url <url>] [--timeout-ms <ms>]';
  if (command === undefined || (!COMMAND_USAGE_REGISTRY[command] && command !== 'auth' && command !== 'auth-status')) {
    console.log(buildTopLevelHelp());
    return;
  }

  if (command === 'auth' || command === 'auth-status') {
    console.log(`Usage:\n  ${SCRIPT_COMMAND} auth status [--verify] ${commonOptions}\n  ${SCRIPT_COMMAND} auth add --from-stdin --allow-plaintext\n  ${SCRIPT_COMMAND} auth claim-status [--allow-plaintext]\n  ${SCRIPT_COMMAND} auth claim-confirm [--allow-plaintext]\n  ${SCRIPT_COMMAND} auth claim-deny [--allow-plaintext]\n\nAlias: ${SCRIPT_COMMAND} auth-status [--verify]\nXMEMO_KEY remains the preferred non-file credential source. --allow-plaintext explicitly permits unencrypted user-file storage.\nRun \`${SCRIPT_COMMAND} --help\` to list all commands.`);
    return;
  }

  const entry = COMMAND_USAGE_REGISTRY[command];
  if (entry) {
    console.log(`Usage:\n  ${SCRIPT_COMMAND} ${entry.usage} ${commonOptions}`);
    if (command === 'logout') {
      console.log('\nXMEMO_KEY is externally managed and is not revoked unless --revoke-environment-token is explicitly passed.');
    }
    return;
  }

  console.log(buildTopLevelHelp());
}
