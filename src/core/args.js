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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
