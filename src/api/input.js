import { optionValue } from '../core/args.js';
import { UsageError } from '../core/errors.js';
import { readTextFileBounded, readTextStreamBounded } from './text-input.js';

const jsonInputCache = new WeakMap();

export async function readJsonInput(args, io) {
  const inputPath = optionValue(args, '--input');
  if (!inputPath) return null;
  const cacheKey = io.inputCacheKey ?? io;
  const cached = jsonInputCache.get(cacheKey);
  if (cached?.inputPath === inputPath) return cached.value;
  const normalized = inputPath === '-'
    ? await readTextStreamBounded(io.stdin, 'JSON input stdin')
    : await readTextFileBounded(inputPath, 'JSON input');
  try {
    const value = JSON.parse(normalized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('top-level value must be a JSON object');
    }
    jsonInputCache.set(cacheKey, { inputPath, value });
    return value;
  } catch (error) {
    throw new UsageError(`Invalid JSON input ${inputPath}: ${error.message}`);
  }
}

export function rejectInputFlagConflicts(input, flagEntries, args = null) {
  if (!input) return;
  for (const [flag, key] of flagEntries) {
    if (args && !args.includes(flag)) continue;
    if (input[key] !== undefined) {
      throw new UsageError(`Input field '${key}' conflicts with command option ${flag}; provide it in one place only.`);
    }
  }
}

export function assertNoUnknownInputFields(input, allowed) {
  if (!input) return;
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new UsageError(`Unsupported input field(s): ${unknown.join(', ')}.`);
}

export function booleanInput(input, key) {
  const value = input?.[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new UsageError(`Input field '${key}' must be a boolean.`);
  return value;
}

export function optionalBooleanInput(input, key) {
  const value = input?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new UsageError(`Input field '${key}' must be a boolean.`);
  return value;
}

export function assertKnownOptions(args, allowed) {
  const allowedSet = new Set([...allowed, '--deadline']);
  const optionsWithValue = new Set(allowed.filter((option) => !['--services', '--json', '--yes', '--wait', '--publish', '--draft', '--include-knowledge', '--prefer-working', '--allow-legacy-credential', '--preview', '--apply'].includes(option)));
  const seen = new Set();
  let endOfOptions = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') {
      endOfOptions = true;
      continue;
    }
    if (endOfOptions) continue;
    if (token.startsWith('-') && !token.startsWith('--') && token !== '-') throw new UsageError(`Unsupported short option: ${token}.`);
    if (!token.startsWith('--')) continue;
    if (!allowedSet.has(token)) throw new UsageError(`Unsupported option: ${token}.`);
    if (seen.has(token)) throw new UsageError(`Duplicate option: ${token}.`);
    seen.add(token);
    if (optionsWithValue.has(token)) {
      optionValue(args, token);
      index += 1;
    }
  }
}
