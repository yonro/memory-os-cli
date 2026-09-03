import { writeLine } from '../core/io.js';
import { errorEnvelope } from './errors.js';

export function successEnvelope(command, data, meta = {}) {
  return {
    schemaVersion: '1',
    ok: true,
    command,
    data,
    meta: {
      readReceipt: meta.readReceipt ?? null,
      warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
      nextCursor: meta.nextCursor ?? null,
      ...(meta.uploadManifest ? { uploadManifest: meta.uploadManifest } : {})
    },
    error: null
  };
}

export function writeEnvelope(io, envelope) {
  writeLine(io.stdout, JSON.stringify(envelope));
}

export function writeSuccess(io, command, data, meta) {
  const envelope = successEnvelope(command, data, meta);
  writeEnvelope(io, envelope);
  return envelope;
}

export function writeFailure(io, command, error) {
  const envelope = errorEnvelope(error, command);
  writeEnvelope(io, envelope);
  return envelope;
}
