const TIME_FILTER_COMMANDS = new Set(['recall', 'search', 'recall-context']);

const TIME_FILTER_ALIASES = [
  ['time-order', 'time_order'],
  ['owner-timezone', 'owner_timezone'],
  ['reference-time', 'reference_time'],
  ['hypothetical-answer', 'hypothetical_answer'],
];

export const RECALL_SEARCH_TIME_FILTER_KEYS = ['since', 'until', 'time_order', 'owner_timezone', 'reference_time'];
export const RECALL_SEARCH_QUERY_KEYS = [
  'query', 'limit', 'threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain',
  'prefer_working', ...RECALL_SEARCH_TIME_FILTER_KEYS,
];

export function normalizeTimeFilterAliases(command, flags) {
  if (!TIME_FILTER_COMMANDS.has(command)) return;
  for (const [alias, canonical] of TIME_FILTER_ALIASES) {
    if (flags[alias] === undefined) continue;
    if (flags[canonical] !== undefined) {
      throw new Error(`Cannot specify both --${canonical} and --${alias}.`);
    }
    flags[canonical] = flags[alias];
    delete flags[alias];
  }
}

function parseRFC3339Instant(value, name) {
  const message = `${name} must be an RFC 3339 timestamp with a timezone offset, such as 2026-09-01T00:00:00+09:00.`;
  const text = String(value);
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(text);
  if (!match) throw new Error(message);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) throw new Error(message);

  const normalized = text.replace(/t/i, 'T').replace(/z$/i, 'Z');
  const wholeSecondTimestamp = normalized.replace(/\.\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/, '');
  const epochMilliseconds = Date.parse(wholeSecondTimestamp);
  if (!Number.isFinite(epochMilliseconds) || epochMilliseconds % 1000 !== 0) throw new Error(message);

  return {
    seconds: BigInt(epochMilliseconds / 1000),
    fraction: (match[7] || '').slice(1).replace(/0+$/, ''),
  };
}

function compareRFC3339Instants(left, right) {
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = BigInt((left.fraction || '0').padEnd(scale, '0') || '0');
  const rightFraction = BigInt((right.fraction || '0').padEnd(scale, '0') || '0');
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

export function validateTimeFilters(command, flags) {
  if (!TIME_FILTER_COMMANDS.has(command)) return;
  if (flags.time_order !== undefined && !['desc', 'asc'].includes(flags.time_order)) {
    throw new Error('--time_order must be desc or asc.');
  }

  const since = flags.since === undefined ? undefined : parseRFC3339Instant(flags.since, '--since');
  const until = flags.until === undefined ? undefined : parseRFC3339Instant(flags.until, '--until');
  if (since && until && compareRFC3339Instants(until, since) <= 0) {
    throw new Error('--until must be later than --since.');
  }
}
