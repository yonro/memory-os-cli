import fs from 'node:fs/promises';
import { MAX_MEMORY_CONTENT_BYTES, EXIT_CODE } from './core.mjs';
import { outputContentTooLarge } from './api.mjs';

// Maximum bounded payload for single-value stdin inputs: 65536 bytes (64 KiB).
export const MAX_STDIN_INPUT_BYTES = 65536;

/**
 * Read stdin up to a bounded byte limit (default 64 KiB).
 * Reading halts and rejects immediately if stdin exceeds maxBytes.
 *
 * @param {number} maxBytes - Maximum permitted bytes (default 65536)
 * @returns {Promise<string>}
 */
export function readStdin(maxBytes = MAX_STDIN_INPUT_BYTES) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];
    let done = false;

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    };

    const onData = (chunk) => {
      if (done) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      // Explicit byte counter: stop and reject immediately when exceeding maxBytes
      if (totalBytes > maxBytes) {
        done = true;
        cleanup();
        try { process.stdin.pause(); } catch {}
        const err = new Error(`Input exceeds maximum limit of ${maxBytes} bytes.`);
        err.exitCode = EXIT_CODE.USER_ERROR;
        reject(err);
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (done) return;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8').trim());
    };

    const onError = (err) => {
      if (done) return;
      cleanup();
      reject(err);
    };

    process.stdin.on('data', onData).on('end', onEnd).on('error', onError).resume();
  });
}

/**
 * Read memory content from stdin with explicit streaming byte counter.
 * Reading halts and rejects immediately if stdin exceeds MAX_MEMORY_CONTENT_BYTES (524288 bytes).
 *
 * @param {object} options - Command options (json / terminal)
 * @returns {Promise<string>}
 */
export function readStdinContent(options = {}) {
  return new Promise((resolve, reject) => {
    // Explicit byte counter: bounded to MAX_MEMORY_CONTENT_BYTES (524288 bytes / 512 KiB)
    let totalBytes = 0;
    const chunks = [];
    let done = false;

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    };

    const onData = (chunk) => {
      if (done) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      // Explicit byte counter check: stop and reject immediately if stream exceeds 524288 bytes
      if (totalBytes > MAX_MEMORY_CONTENT_BYTES) {
        done = true;
        cleanup();
        try { process.stdin.pause(); } catch {}
        try { process.stdin.destroy(); } catch {}
        outputContentTooLarge(`Memory content exceeds maximum limit of ${MAX_MEMORY_CONTENT_BYTES} bytes.`, options);
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (done) return;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    const onError = (err) => {
      if (done) return;
      cleanup();
      reject(err);
    };

    process.stdin.on('data', onData).on('end', onEnd).on('error', onError).resume();
  });
}

/**
 * Read memory content from a regular file with bounded size verification.
 * Rejects if file exceeds MAX_MEMORY_CONTENT_BYTES (524288 bytes / 512 KiB).
 *
 * @param {string} filePath - Path to file
 * @param {object} options - Command options
 * @returns {Promise<string|null>}
 */
export async function readBoundedFile(filePath, options = {}) {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (err) {
    throw new Error(`Failed to read file '${filePath}': ${err.message}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Failed to read file '${filePath}': --file must be a regular file.`);
  }
  if (stats.size > MAX_MEMORY_CONTENT_BYTES) {
    outputContentTooLarge(`File '${filePath}' exceeds maximum limit of ${MAX_MEMORY_CONTENT_BYTES} bytes.`, options);
    return null;
  }
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
  } catch (err) {
    throw new Error(`Failed to read file '${filePath}': ${err.message}`);
  }
  const chunks = [];
  let totalBytes = 0;
  const chunkBuf = Buffer.alloc(65536);
  try {
    while (true) {
      const toRead = Math.min(65536, (MAX_MEMORY_CONTENT_BYTES + 1) - totalBytes);
      const { bytesRead } = await handle.read(chunkBuf, 0, toRead, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      chunks.push(Buffer.from(chunkBuf.subarray(0, bytesRead)));
      if (totalBytes > MAX_MEMORY_CONTENT_BYTES) break;
    }
  } catch (err) {
    throw new Error(`Failed to read file '${filePath}': ${err.message}`);
  } finally {
    await handle.close();
  }
  if (totalBytes > MAX_MEMORY_CONTENT_BYTES) {
    outputContentTooLarge(`File '${filePath}' exceeds maximum limit of ${MAX_MEMORY_CONTENT_BYTES} bytes.`, options);
    return null;
  }
  return Buffer.concat(chunks).toString('utf8');
}
