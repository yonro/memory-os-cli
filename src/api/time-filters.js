import { hasFlag, optionValue } from '../core/args.js';
import { UsageError } from '../core/errors.js';

export const TIME_FILTER_KNOWN_OPTIONS = Object.freeze([
  '--since',
  '--until',
  '--time-order',
  '--time_order',
  '--owner-timezone',
  '--owner_timezone',
  '--reference-time',
  '--reference_time'
]);

export const CONTEXT_RECALL_TIME_FILTER_KNOWN_OPTIONS = Object.freeze([
  ...TIME_FILTER_KNOWN_OPTIONS,
  '--hypothetical-answer',
  '--hypothetical_answer'
]);

export const TIME_FILTER_INPUT_FIELDS = Object.freeze([
  'since',
  'until',
  'time_order',
  'time-order',
  'owner_timezone',
  'owner-timezone',
  'reference_time',
  'reference-time'
]);

export const CONTEXT_RECALL_TIME_FILTER_INPUT_FIELDS = Object.freeze([
  ...TIME_FILTER_INPUT_FIELDS,
  'hypothetical_answer',
  'hypothetical-answer'
]);

export const TIME_FILTER_CONFLICT_PAIRS = Object.freeze([
  ['--since', 'since'],
  ['--until', 'until'],
  ['--time-order', 'time_order'],
  ['--time-order', 'time-order'],
  ['--time_order', 'time_order'],
  ['--time_order', 'time-order'],
  ['--owner-timezone', 'owner_timezone'],
  ['--owner-timezone', 'owner-timezone'],
  ['--owner_timezone', 'owner_timezone'],
  ['--owner_timezone', 'owner-timezone'],
  ['--reference-time', 'reference_time'],
  ['--reference-time', 'reference-time'],
  ['--reference_time', 'reference_time'],
  ['--reference_time', 'reference-time']
]);

export const CONTEXT_RECALL_TIME_FILTER_CONFLICT_PAIRS = Object.freeze([
  ...TIME_FILTER_CONFLICT_PAIRS,
  ['--hypothetical-answer', 'hypothetical_answer'],
  ['--hypothetical-answer', 'hypothetical-answer'],
  ['--hypothetical_answer', 'hypothetical_answer'],
  ['--hypothetical_answer', 'hypothetical-answer']
]);

export function parseRFC3339Instant(value, name) {
  const message = `${name} must be an RFC 3339 timestamp with a timezone offset, such as 2026-09-01T00:00:00+09:00.`;
  if (typeof value !== 'string' && typeof value !== 'number') throw new UsageError(message);
  const text = String(value).trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(text);
  if (!match) throw new UsageError(message);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) throw new UsageError(message);

  const normalized = text.replace(/t/i, 'T').replace(/z$/i, 'Z');
  const wholeSecondTimestamp = normalized.replace(/\.\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/, '');
  const epochMilliseconds = Date.parse(wholeSecondTimestamp);
  if (!Number.isFinite(epochMilliseconds) || epochMilliseconds % 1000 !== 0) throw new UsageError(message);

  return {
    seconds: BigInt(Math.floor(epochMilliseconds / 1000)),
    fraction: (match[7] || '').slice(1).replace(/0+$/, ''),
    raw: text
  };
}

export function compareRFC3339Instants(left, right) {
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = BigInt((left.fraction || '0').padEnd(scale, '0') || '0');
  const rightFraction = BigInt((right.fraction || '0').padEnd(scale, '0') || '0');
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

export function extractTimeFilterValues(args, input, options = {}) {
  const allowHypothetical = options.allowHypotheticalAnswer === true;

  if (hasFlag(args, '--time-order') && hasFlag(args, '--time_order')) {
    throw new UsageError('Cannot specify both --time_order and --time-order.');
  }
  if (hasFlag(args, '--owner-timezone') && hasFlag(args, '--owner_timezone')) {
    throw new UsageError('Cannot specify both --owner_timezone and --owner-timezone.');
  }
  if (hasFlag(args, '--reference-time') && hasFlag(args, '--reference_time')) {
    throw new UsageError('Cannot specify both --reference_time and --reference-time.');
  }
  if (allowHypothetical && hasFlag(args, '--hypothetical-answer') && hasFlag(args, '--hypothetical_answer')) {
    throw new UsageError('Cannot specify both --hypothetical_answer and --hypothetical-answer.');
  }

  if (input?.['time-order'] !== undefined && input?.time_order !== undefined) {
    throw new UsageError('Cannot specify both time_order and time-order in input.');
  }
  if (input?.['owner-timezone'] !== undefined && input?.owner_timezone !== undefined) {
    throw new UsageError('Cannot specify both owner_timezone and owner-timezone in input.');
  }
  if (input?.['reference-time'] !== undefined && input?.reference_time !== undefined) {
    throw new UsageError('Cannot specify both reference_time and reference-time in input.');
  }
  if (allowHypothetical && input?.['hypothetical-answer'] !== undefined && input?.hypothetical_answer !== undefined) {
    throw new UsageError('Cannot specify both hypothetical_answer and hypothetical-answer in input.');
  }

  const since = optionValue(args, '--since') ?? input?.since;
  const until = optionValue(args, '--until') ?? input?.until;
  const timeOrder = optionValue(args, '--time-order') ?? optionValue(args, '--time_order') ?? input?.time_order ?? input?.['time-order'];
  const ownerTimezone = optionValue(args, '--owner-timezone') ?? optionValue(args, '--owner_timezone') ?? input?.owner_timezone ?? input?.['owner-timezone'];
  const referenceTime = optionValue(args, '--reference-time') ?? optionValue(args, '--reference_time') ?? input?.reference_time ?? input?.['reference-time'];
  const hypotheticalAnswer = allowHypothetical ? (optionValue(args, '--hypothetical-answer') ?? optionValue(args, '--hypothetical_answer') ?? input?.hypothetical_answer ?? input?.['hypothetical-answer']) : undefined;

  validateTimeFilters({ since, until, timeOrder, ownerTimezone, referenceTime, hypotheticalAnswer }, options);

  return {
    since: since !== null && since !== undefined ? String(since).trim() : undefined,
    until: until !== null && until !== undefined ? String(until).trim() : undefined,
    time_order: timeOrder !== null && timeOrder !== undefined ? String(timeOrder).trim() : undefined,
    owner_timezone: ownerTimezone !== null && ownerTimezone !== undefined ? String(ownerTimezone).trim() : undefined,
    reference_time: referenceTime !== null && referenceTime !== undefined ? String(referenceTime).trim() : undefined,
    hypothetical_answer: hypotheticalAnswer !== null && hypotheticalAnswer !== undefined ? String(hypotheticalAnswer).trim() : undefined
  };
}

export function validateTimeFilters({ since, until, timeOrder, ownerTimezone, referenceTime, hypotheticalAnswer }, options = {}) {
  if (timeOrder !== undefined && timeOrder !== null) {
    if (typeof timeOrder !== 'string' || !['desc', 'asc'].includes(timeOrder)) {
      throw new UsageError('--time_order must be desc or asc.');
    }
  }

  let parsedSince;
  if (since !== undefined && since !== null) {
    parsedSince = parseRFC3339Instant(since, '--since');
  }

  let parsedUntil;
  if (until !== undefined && until !== null) {
    parsedUntil = parseRFC3339Instant(until, '--until');
  }

  if (parsedSince && parsedUntil && compareRFC3339Instants(parsedUntil, parsedSince) <= 0) {
    throw new UsageError('--until must be later than --since.');
  }

  if (referenceTime !== undefined && referenceTime !== null) {
    if (typeof referenceTime !== 'string' || !referenceTime.trim()) {
      throw new UsageError('--reference-time cannot be empty.');
    }
  }

  if (ownerTimezone !== undefined && ownerTimezone !== null) {
    if (typeof ownerTimezone !== 'string' || !ownerTimezone.trim()) {
      throw new UsageError('--owner-timezone cannot be empty.');
    }
  }

  if (options.allowHypotheticalAnswer) {
    if (hypotheticalAnswer !== undefined && hypotheticalAnswer !== null) {
      if (typeof hypotheticalAnswer !== 'string' || !hypotheticalAnswer.trim()) {
        throw new UsageError('--hypothetical-answer cannot be empty.');
      }
    }
  }
}
