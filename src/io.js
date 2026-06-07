import { spawn } from 'node:child_process';

export function defaultIo() {
  return {
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    spawn
  };
}

export function writeLine(stream, line) {
  stream.write(`${line}\n`);
}
