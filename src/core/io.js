import { spawn } from 'node:child_process';

export function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    signal: undefined,
    spawn
  };
}

export function writeLine(stream, line) {
  try {
    stream.write(`${line}\n`);
  } catch (error) {
    if (error?.code === 'EPIPE' || error?.errno === 'EPIPE') {
      return;
    }
    throw error;
  }
}

export async function readLineFromStdin(stdin) {
  if (!stdin) return '';
  if (typeof stdin[Symbol.asyncIterator] === 'function') {
    let input = '';
    for await (const chunk of stdin) {
      input += chunk;
      if (input.includes('\n')) {
        break;
      }
    }
    return input.split(/\r?\n/, 1)[0] ?? '';
  }
  return await new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += String(chunk);
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        cleanup();
        resolve(buffer.slice(0, nl).trim());
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(buffer.trim());
    };
    function cleanup() {
      stdin?.off?.('data', onData);
      stdin?.off?.('end', onEnd);
    }
    if (typeof stdin.on === 'function') {
      stdin.on('data', onData);
      stdin.on('end', onEnd);
    } else {
      resolve('');
    }
  });
}
