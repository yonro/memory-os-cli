import fs from 'node:fs/promises';
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

export function isStdoutTty() {
  if (process.env.XMEMO_FORCE_TTY === '1' || process.env.XMEMO_FORCE_TTY === 'true') {
    return true;
  }
  if (process.env.XMEMO_FORCE_TTY === '0' || process.env.XMEMO_FORCE_TTY === 'false') {
    return false;
  }
  if (process.env.XMEMO_OUTPUT_MODE === 'terminal') {
    return true;
  }
  if (process.env.XMEMO_OUTPUT_MODE === 'json') {
    return false;
  }
  return Boolean(process.stdout && process.stdout.isTTY);
}

export function rejectBooleanValue(key, inlineValue) {
  if (inlineValue !== undefined) {
    throw new Error(`--${key} does not accept a value; pass it as a bare flag.`);
  }
}

export function readOptionValue(args, index, key, inlineValue) {
  if (inlineValue !== undefined) {
    if (!inlineValue) throw new Error(`--${key} requires a value.`);
    return { value: inlineValue, index };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${key} requires a value.`);
  }
  return { value, index: index + 1 };
}

// Helper to parse arguments
export function parseArgs(args) {
  const options = {
    json: false,
    terminal: false,
    baseUrl: process.env.XMEMO_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: process.env.XMEMO_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    verify: false,
    compact: false,
    help: false,
    version: false,
    allowPlaintext: false,
    anonymous: false,
    revokeEnvironmentToken: false,
  };
  const positionals = [];
  const flags = {};
  let explicitJson = false;
  let explicitTerminal = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      const equalsIndex = rawKey.indexOf('=');
      const key = equalsIndex === -1 ? rawKey : rawKey.slice(0, equalsIndex);
      const inlineValue = equalsIndex === -1 ? undefined : rawKey.slice(equalsIndex + 1);
      if (key === 'json') {
        rejectBooleanValue(key, inlineValue);
        explicitJson = true;
      } else if (key === 'terminal' || key === 'no-json' || key === 'plain') {
        rejectBooleanValue(key, inlineValue);
        explicitTerminal = true;
      } else if (key === 'verify') {
        rejectBooleanValue(key, inlineValue);
        options.verify = true;
      } else if (key === 'compact') {
        rejectBooleanValue(key, inlineValue);
        options.compact = true;
      } else if (key === 'help') {
        rejectBooleanValue(key, inlineValue);
        options.help = true;
      } else if (key === 'version') {
        rejectBooleanValue(key, inlineValue);
        options.version = true;
      } else if (key === 'allow-plaintext') {
        rejectBooleanValue(key, inlineValue);
        options.allowPlaintext = true;
      } else if (key === 'from-stdin') {
        rejectBooleanValue(key, inlineValue);
        flags[key] = true;
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
      } else if (key === 'anonymous') {
        rejectBooleanValue(key, inlineValue);
        options.anonymous = true;
      } else if (key === 'revoke-environment-token') {
        rejectBooleanValue(key, inlineValue);
        options.revokeEnvironmentToken = true;
      } else if (key === 'base-url') {
        const parsed = readOptionValue(args, i, key, inlineValue);
        options.baseUrl = parsed.value;
        i = parsed.index;
      } else if (key === 'timeout-ms') {
        const parsed = readOptionValue(args, i, key, inlineValue);
        options.timeoutMs = parsed.value;
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
      if (key === 'j') {
        explicitJson = true;
      } else if (key === 't') {
        explicitTerminal = true;
      } else if (key === 'v') {
        options.verify = true;
      } else if (key === 'h') {
        options.help = true;
      } else {
        throw new Error(`Unknown short option: -${key}`);
      }
    } else {
      positionals.push(arg);
    }
  }

  if (explicitJson && explicitTerminal) {
    throw new Error('Cannot specify both --json and --terminal.');
  }

  const isTty = isStdoutTty();
  if (explicitJson) {
    options.json = true;
  } else if (explicitTerminal) {
    options.json = false;
    options.terminal = true;
  } else {
    options.json = !isTty;
  }

  return { command: positionals[0], subcommand: positionals[1], positionals, options, flags };
}

export function validateCommandInput(command, subcommand, positionals, options, flags) {
  const expectedPositionals = command === 'auth' ? 2 : 1;
  if (positionals.length > expectedPositionals) {
    throw new Error(`Unexpected positional argument: ${positionals[expectedPositionals]}`);
  }
  if (options.anonymous && command !== 'doctor') {
    throw new Error('--anonymous is supported only by doctor.');
  }
  if (options.revokeEnvironmentToken && command !== 'logout') {
    throw new Error('--revoke-environment-token is supported only by logout.');
  }

  const allowedFlags = command === 'auth'
    ? AUTH_FLAGS[subcommand] || new Set()
    : COMMAND_FLAGS[command] || new Set();
  for (const key of Object.keys(flags)) {
    if (/^(token|api[-_]?key|bearer|authorization|cookie|secret|password|passwd|credential|client[-_]?secret|refresh[-_]?token|access[-_]?token|private[-_]?key|xmemo[-_]?key)$/i.test(key) && key !== 'from-stdin') {
      throw new Error(`Refusing sensitive command-line option --${key}. Use XMEMO_KEY or --from-stdin where documented.`);
    }
    if (!allowedFlags.has(key)) {
      throw new Error(`Unknown option for ${command}${subcommand ? ` ${subcommand}` : ''}: --${key}`);
    }
  }

  const required = {
    read: ['id'],
    update: ['id'],
    forget: ['id'],
    remember: ['content|file'],
    recall: ['query'],
    search: ['query'],
    'recall-context': ['query'],
    'todo-add': ['content'],
    'todo-done': ['id|todo_id'],
    'expense-add': ['item', 'amount'],
  };
  for (const requirement of required[command] || []) {
    const alternatives = requirement.split('|');
    if (!alternatives.some((key) => flags[key] !== undefined && String(flags[key]).trim())) {
      throw new Error(`${command} requires --${alternatives.join(' or --')}.`);
    }
  }

  if (command === 'remember') {
    if (flags.content !== undefined && flags.file !== undefined) {
      throw new Error('Cannot specify both --content and --file.');
    }
  }

  if (flags.limit !== undefined) {
    if (command === 'read') {
      flags.limit = parsePositiveInteger(flags.limit, '--limit', 1_000_000);
    } else {
      flags.limit = parsePositiveInteger(flags.limit, '--limit', 100);
    }
  }
  if (flags['top-n'] !== undefined || flags.top_n !== undefined) {
    const rawVal = flags['top-n'] !== undefined ? flags['top-n'] : flags.top_n;
    const parsed = parseIntegerInRange(rawVal, '--top-n', 1, 200);
    flags['top-n'] = parsed;
    flags.top_n = parsed;
  }
  if (flags.offset !== undefined) {
    flags.offset = parseIntegerInRange(flags.offset, '--offset', 0, Number.MAX_SAFE_INTEGER);
  }
  for (const key of ['max_items', 'max_tokens']) {
    if (flags[key] !== undefined) flags[key] = parsePositiveInteger(flags[key], `--${key}`, key === 'max_items' ? 100 : 50_000);
  }
  if (flags.ttl_seconds !== undefined) {
    const ttlMax = command.startsWith('restart-') ? MAX_STATE_TTL_SECONDS : 604_800;
    const parsedTtl = parseIntegerInRange(flags.ttl_seconds, '--ttl_seconds', 0, ttlMax);
    if (command.startsWith('restart-')) flags.ttl_seconds = parsedTtl;
  }
  if (flags.metadata !== undefined) flags.metadata = parseJsonObject(flags.metadata, '--metadata');
  if (flags.explain !== undefined) flags.explain = parseStrictBoolean(flags.explain, '--explain');
  if (flags.prefer_working !== undefined) flags.prefer_working = parseStrictBoolean(flags.prefer_working, '--prefer_working');
  if (flags.include_knowledge !== undefined) flags.include_knowledge = parseStrictBoolean(flags.include_knowledge, '--include_knowledge');
  if (flags.restore_state !== undefined) flags.restore_state = parseStrictBoolean(flags.restore_state, '--restore_state');
  if (flags.record_restore_event !== undefined) flags.record_restore_event = parseStrictBoolean(flags.record_restore_event, '--record_restore_event');
  for (const key of ['timeline_limit', 'reminder_limit', 'decision_limit']) {
    if (flags[key] !== undefined) flags[key] = parseIntegerInRange(flags[key], `--${key}`, 0, 100);
  }
  if (flags.months !== undefined) {
    flags.months = parsePositiveInteger(flags.months, '--months', 24);
  }
  if (flags.month !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(flags.month))) {
      throw new Error('--month must be formatted as YYYY-MM.');
    }
  }
  if (flags['min-amount'] !== undefined) {
    const val = Number(flags['min-amount']);
    if (Number.isNaN(val) || val < 0) {
      throw new Error('--min-amount must be a non-negative number.');
    }
  }
  if (flags['max-amount'] !== undefined) {
    const val = Number(flags['max-amount']);
    if (Number.isNaN(val) || val < 0) {
      throw new Error('--max-amount must be a non-negative number.');
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

// Read stdin helper
export async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
  });
}

// Read full stdin content helper (exact UTF-8 content without trimming)
export function readStdinContent() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
  });
}

export async function resolveCommandInputs(command, flags) {
  if (command === 'remember') {
    if (flags.file !== undefined) {
      try {
        flags.content = await fs.readFile(flags.file, 'utf8');
        delete flags.file;
      } catch (err) {
        throw new Error(`Failed to read file '${flags.file}': ${err.message}`);
      }
    } else if (flags.content === '-') {
      flags.content = await readStdinContent();
    }
    if (flags.content === undefined || !String(flags.content).trim()) {
      throw new Error('remember content must not be empty.');
    }
  }
}
