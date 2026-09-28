#!/usr/bin/env node
import { run } from '../src/cli.js';

function handleEpipe(err) {
  if (err?.code === 'EPIPE' || err?.errno === 'EPIPE') {
    process.exit(0);
  }
}
process.stdout?.on?.('error', handleEpipe);
process.stderr?.on?.('error', handleEpipe);

const interruptController = new AbortController();
const serviceCommand = ['memory', 'context', 'state', 'restart', 'knowledge', 'dream', 'cloud-skill'].includes(process.argv[2]) || (process.argv[2] === 'doctor' && process.argv.includes('--services'));
const interrupt = () => interruptController.abort();
if (serviceCommand) process.once('SIGINT', interrupt);

try {
  const exitCode = await run(process.argv.slice(2), {
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    signal: interruptController.signal
  });

  process.exitCode = exitCode;
  if (serviceCommand) process.removeListener('SIGINT', interrupt);
  if (exitCode !== 0) process.exit(exitCode);
} catch (err) {
  if (err?.code === 'EPIPE' || err?.errno === 'EPIPE') {
    process.exit(0);
  }
  throw err;
}
