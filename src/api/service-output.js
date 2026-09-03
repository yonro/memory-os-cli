import { writeLine } from '../core/io.js';

export function writeHumanServiceResult(io, command, data, meta = {}) {
  writeLine(io.stdout, `${command} completed.`);
  if (data !== undefined) writeLine(io.stdout, JSON.stringify(data, null, 2));
  if (meta.nextCursor) writeLine(io.stdout, `Next cursor: ${meta.nextCursor}`);
  if (Array.isArray(meta.warnings)) {
    for (const warning of meta.warnings) writeLine(io.stderr, `Warning: ${warning}`);
  }
}
