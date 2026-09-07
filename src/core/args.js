import { UsageError } from './errors.js';

export function sameMajorMinor(left, right) {
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  return leftParts[0] === rightParts[0] && leftParts[1] === rightParts[1];
}

export function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new UsageError(`Option ${name} requires a value.`);
  }

  return value;
}

export function stringValue(source, keys) {
  const value = valueAtPath(source, keys);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function booleanValue(source, keys) {
  const value = valueAtPath(source, keys);
  return typeof value === 'boolean' ? value : null;
}

export function arrayValue(source, keys) {
  const value = valueAtPath(source, keys);
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : null;
}

export function valueAtPath(source, keys) {
  let current = source;
  for (const key of keys) {
    if (!isPlainObject(current) || !(key in current)) {
      return null;
    }
    current = current[key];
  }
  return current;
}

export function hasFlag(args, name) {
  return args.includes(name);
}

export function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function parseIntegerInRange(value, name, { min, max }) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new UsageError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

export function parseDurationMs(value, name) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  const match = typeof value === 'string' ? /^(\d+)(ms|s|m)?$/u.exec(value.trim()) : null;
  if (!match) throw new UsageError(`${name} must be a positive duration such as 250ms, 15s, or 2m.`);
  const amount = Number(match[1]);
  const multiplier = match[2] === 'm' ? 60_000 : match[2] === 's' ? 1_000 : 1;
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new UsageError(`${name} is out of range.`);
  return milliseconds;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
