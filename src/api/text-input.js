import fs from 'node:fs/promises';
import path from 'node:path';

import { UsageError } from '../core/errors.js';

export const MAX_JSON_INPUT_BYTES = 2 * 1024 * 1024;

export async function readTextFileBounded(filePath, label, maxBytes = MAX_JSON_INPUT_BYTES) {
  try {
    const resolved = path.resolve(filePath);
    const stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new UsageError(`${label} must be a regular non-symlink file.`);
    if (stat.size > maxBytes) throw new UsageError(`${label} exceeds the ${maxBytes}-byte limit.`);
    const handle = await fs.open(resolved, 'r');
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile() || !sameFileIdentity(stat, openedStat)) {
        throw new UsageError(`${label} changed after validation; retry with a stable regular file.`);
      }
      const buffer = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > maxBytes) throw new UsageError(`${label} exceeds the ${maxBytes}-byte limit.`);
      const finalStat = await handle.stat();
      if (finalStat.size !== openedStat.size || finalStat.mtimeMs !== openedStat.mtimeMs) {
        throw new UsageError(`${label} changed while it was being read; retry with a stable file.`);
      }
      return decodeTextBytes(buffer.subarray(0, offset), label, maxBytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new UsageError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function sameFileIdentity(pathStat, handleStat) {
  if (pathStat.ino !== handleStat.ino) return false;
  return process.platform === 'win32' || pathStat.dev === handleStat.dev;
}

export async function readTextStreamBounded(stream, label, maxBytes = MAX_JSON_INPUT_BYTES) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      total += bytes.length;
      if (total > maxBytes) throw new UsageError(`${label} exceeds the ${maxBytes}-byte limit.`);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Could not read ${label}: ${error.message}`);
  }
  return decodeTextBytes(Buffer.concat(chunks), label, maxBytes);
}

export function decodeTextBytes(value, label, maxBytes = MAX_JSON_INPUT_BYTES) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (bytes.length > maxBytes) throw new UsageError(`${label} exceeds the ${maxBytes}-byte limit.`);
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    try { return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(bytes.subarray(2)); }
    catch { throw new UsageError(`${label} has invalid UTF-16 encoding.`); }
  }
  const offset = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset));
  } catch (error) {
    throw new UsageError(`${label} must be UTF-8 or BOM-marked UTF-16 text: ${error.message}`);
  }
}
