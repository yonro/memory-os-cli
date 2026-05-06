#!/usr/bin/env node
import { run } from '../src/cli.js';

const exitCode = await run(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  fetch: globalThis.fetch
});

process.exitCode = exitCode;
