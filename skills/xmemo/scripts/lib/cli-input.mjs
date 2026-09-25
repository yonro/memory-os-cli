import {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_STATE_TTL_SECONDS,
  COMMAND_FLAGS,
  AUTH_FLAGS,
  parseStrictBoolean,
  parsePositiveInteger,
  parseIntegerInRange,
  parseJsonObject,
} from './core.mjs';
import {
  readStdin,
  readStdinContent,
  readBoundedFile,
} from './bounded-read.mjs';

export function isStdoutTty() {
  const env = process.env;
  if (['1', 'true'].includes(env.XMEMO_FORCE_TTY)) return true;
  if (['0', 'false'].includes(env.XMEMO_FORCE_TTY)) return false;
  if (env.XMEMO_OUTPUT_MODE === 'terminal') return true;
  if (env.XMEMO_OUTPUT_MODE === 'json') return false;
  return Boolean(process.stdout?.isTTY);
}

export function rejectBooleanValue(key, inlineValue) {
  if (inlineValue !== undefined) throw new Error(`--${key} does not accept a value; pass it as a bare flag.`);
}

export function readOptionValue(args, index, key, inlineValue) {
  if (inlineValue !== undefined) {
    if (!inlineValue) throw new Error(`--${key} requires a value.`);
    return { value: inlineValue, index };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
  return { value, index: index + 1 };
}

// Helper to parse arguments
export function parseArgs(args) {
  const options = {
    json: false, terminal: false,
    baseUrl: process.env.XMEMO_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: process.env.XMEMO_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    verify: false, compact: false, help: false, version: false,
    allowPlaintext: false, anonymous: false, revokeEnvironmentToken: false,
  };
  const positionals = [];
  const flags = {};
  let explicitJson = false;
  let explicitTerminal = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      const eq = rawKey.indexOf('=');
      const key = eq === -1 ? rawKey : rawKey.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : rawKey.slice(eq + 1);
      const isBoolFlag = ['json', 'terminal', 'no-json', 'plain', 'verify', 'compact', 'help', 'version', 'allow-plaintext', 'from-stdin', 'anonymous', 'revoke-environment-token'].includes(key);
      if (isBoolFlag) {
        rejectBooleanValue(key, inlineValue);
        if (key === 'json') explicitJson = true;
        else if (['terminal', 'no-json', 'plain'].includes(key)) explicitTerminal = true;
        else if (key === 'from-stdin') flags[key] = true;
        else if (key === 'allow-plaintext') options.allowPlaintext = true;
        else if (key === 'revoke-environment-token') options.revokeEnvironmentToken = true;
        else options[key] = true;
      } else if (key === 'confirm') {
        if (inlineValue !== undefined) {
          flags.confirm = parseStrictBoolean(inlineValue, '--confirm');
        } else {
          const nextArg = args[i + 1];
          if (nextArg === 'true' || nextArg === 'false') {
            flags.confirm = nextArg === 'true';
            i++;
          } else {
            flags.confirm = true;
          }
        }
      } else if (key === 'base-url' || key === 'timeout-ms') {
        const parsed = readOptionValue(args, i, key, inlineValue);
        options[key === 'base-url' ? 'baseUrl' : 'timeoutMs'] = parsed.value;
        i = parsed.index;
      } else {
        const parsed = readOptionValue(args, i, key, inlineValue);
        if (flags[key] !== undefined && (key === 'content' || key === 'file')) {
          throw new Error(`Cannot specify multiple --${key} options.`);
        }
        flags[key] = parsed.value;
        i = parsed.index;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (key === 'j') explicitJson = true;
      else if (key === 't') explicitTerminal = true;
      else if (key === 'v') options.verify = true;
      else if (key === 'h') options.help = true;
      else throw new Error(`Unknown short option: -${key}`);
    } else {
      positionals.push(arg);
    }
  }

  if (explicitJson && explicitTerminal) throw new Error('Cannot specify both --json and --terminal.');
  const isTty = isStdoutTty();
  if (explicitJson) options.json = true;
  else if (explicitTerminal) { options.json = false; options.terminal = true; }
  else options.json = !isTty;

  return { command: positionals[0], subcommand: positionals[1], positionals, options, flags };
}

export function validateCommandInput(command, subcommand, positionals, options, flags) {
  const expectedPositionals = command === 'auth' ? 2 : 1;
  if (positionals.length > expectedPositionals) {
    throw new Error(`Unexpected positional argument: ${positionals[expectedPositionals]}`);
  }
  if (options.anonymous && command !== 'doctor') throw new Error('--anonymous is supported only by doctor.');
  if (options.revokeEnvironmentToken && command !== 'logout') throw new Error('--revoke-environment-token is supported only by logout.');

  const allowedFlags = command === 'auth' ? AUTH_FLAGS[subcommand] || new Set() : COMMAND_FLAGS[command] || new Set();
  for (const key of Object.keys(flags)) {
    if (/^(token|api[-_]?key|bearer|authorization|cookie|secret|password|passwd|credential|client[-_]?secret|refresh[-_]?token|access[-_]?token|private[-_]?key|xmemo[-_]?key)$/i.test(key) && key !== 'from-stdin') {
      throw new Error(`Refusing sensitive command-line option --${key}. Use XMEMO_KEY or --from-stdin where documented.`);
    }
    if (!allowedFlags.has(key)) throw new Error(`Unknown option for ${command}${subcommand ? ` ${subcommand}` : ''}: --${key}`);
  }

  const required = {
    read: ['id'], update: ['id'], forget: ['id'], remember: ['content|file'],
    recall: ['query'], search: ['query'], 'recall-context': ['query'],
    'todo-add': ['content'], 'todo-done': ['id|todo_id'], 'expense-add': ['item', 'amount'],
  };
  for (const requirement of required[command] || []) {
    const alternatives = requirement.split('|');
    if (!alternatives.some((key) => flags[key] !== undefined && String(flags[key]).trim())) {
      throw new Error(`${command} requires --${alternatives.join(' or --')}.`);
    }
  }

  if (command === 'remember' && flags.content !== undefined && flags.file !== undefined) {
    throw new Error('Cannot specify both --content and --file.');
  }

  if (flags.limit !== undefined) flags.limit = parsePositiveInteger(flags.limit, '--limit', command === 'read' ? 1_000_000 : 100);
  if (flags['top-n'] !== undefined || flags.top_n !== undefined) {
    const rawVal = flags['top-n'] !== undefined ? flags['top-n'] : flags.top_n;
    const parsed = parseIntegerInRange(rawVal, '--top-n', 1, 200);
    flags['top-n'] = parsed;
    flags.top_n = parsed;
  }
  if (flags.offset !== undefined) flags.offset = parseIntegerInRange(flags.offset, '--offset', 0, Number.MAX_SAFE_INTEGER);
  for (const key of ['max_items', 'max_tokens']) {
    if (flags[key] !== undefined) flags[key] = parsePositiveInteger(flags[key], `--${key}`, key === 'max_items' ? 100 : 50_000);
  }
  if (flags.ttl_seconds !== undefined) {
    const parsedTtl = parseIntegerInRange(flags.ttl_seconds, '--ttl_seconds', 0, command.startsWith('restart-') ? MAX_STATE_TTL_SECONDS : 604_800);
    if (command.startsWith('restart-')) flags.ttl_seconds = parsedTtl;
  }
  if (flags.metadata !== undefined) flags.metadata = parseJsonObject(flags.metadata, '--metadata');
  for (const b of ['explain', 'prefer_working', 'include_knowledge', 'restore_state', 'record_restore_event']) {
    if (flags[b] !== undefined) flags[b] = parseStrictBoolean(flags[b], `--${b}`);
  }
  for (const key of ['timeline_limit', 'reminder_limit', 'decision_limit']) {
    if (flags[key] !== undefined) flags[key] = parseIntegerInRange(flags[key], `--${key}`, 0, 100);
  }
  if (flags.months !== undefined) flags.months = parsePositiveInteger(flags.months, '--months', 24);
  if (flags.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(flags.month))) {
    throw new Error('--month must be formatted as YYYY-MM.');
  }
  for (const m of ['min-amount', 'max-amount']) {
    if (flags[m] !== undefined && (Number.isNaN(Number(flags[m])) || Number(flags[m]) < 0)) {
      throw new Error(`--${m} must be a non-negative number.`);
    }
  }
  if (flags.threshold !== undefined) {
    const threshold = Number(flags.threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error('--threshold must be a number between 0 and 1.');
    }
  }
  if (flags.amount !== undefined && !Number.isFinite(Number(flags.amount))) {
    throw new Error('--amount must be numeric.');
  }
}

export {
  readStdin,
  readStdinContent,
  readBoundedFile,
};

export async function resolveCommandInputs(command, flags, options = {}) {
  if (command === 'remember') {
    if (flags.file !== undefined) {
      const content = await readBoundedFile(flags.file, options);
      if (content === null) return;
      flags.content = content;
      delete flags.file;
    } else if (flags.content === '-') {
      flags.content = await readStdinContent(options);
    }
    if (flags.content === undefined || !String(flags.content).trim()) {
      throw new Error('remember content must not be empty.');
    }
  }
}
