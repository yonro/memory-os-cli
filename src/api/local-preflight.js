import { baseUrlOption } from '../network/base-url.js';
import { ConfirmationRequiredError } from './errors.js';

class LocalPreflightComplete extends Error {}

// Executes a command handler only until its first business request. This
// shares the real input cache, but replaces output and interactivity, so all
// local parsing, file, receipt, and range failures are reported before any
// credential lookup or HTTP operation.
export async function preflightServiceHandler(handler, args, io) {
  const quietIo = Object.assign(Object.create(io), {
    inputCacheKey: io,
    preflightOnly: true,
    stdin: io.stdin,
    stdout: { write() {} },
    stderr: { write() {} }
  });
  const context = {
    baseUrl: baseUrlOption(args, io.env ?? {}),
    signal: io.signal,
    client: { request() { throw new LocalPreflightComplete(); } }
  };
  try {
    await handler(args, quietIo, context);
  } catch (error) {
    if (error instanceof LocalPreflightComplete || error instanceof ConfirmationRequiredError) return;
    throw error;
  }
}
