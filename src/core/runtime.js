import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';

import { UsageError } from './errors.js';
import { writeLine } from './io.js';

export function npmExecutable() {
  return os.platform() === 'win32' ? 'npm.cmd' : 'npm';
}

export async function runProcess(command, args, io, { stream = true } = {}) {
  const spawnFn = io.spawn ?? spawn;
  return await new Promise((resolve, reject) => {
    const child = spawnFn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: os.platform() === 'win32'
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (stream) {
        io.stdout.write(text);
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (stream) {
        io.stderr.write(text);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

export async function waitForShutdown(server, io) {
  await new Promise((resolve) => {
    let resolved = false;
    const finish = async () => {
      if (resolved) {
        return;
      }
      resolved = true;
      await closeServer(server);
      resolve();
    };
    const onSigint = () => {
      writeLine(io.stdout, 'Shutting down XMemo MCP proxy...');
      void finish();
    };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigint);
    server.once('close', () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigint);
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });
  });
}

export async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export async function readAll(stream) {
  let content = '';
  for await (const chunk of stream) {
    content += chunk;
  }
  return content;
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export function parseJsonConfig(content, configPath) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new UsageError(`Invalid JSON in ${configPath}: ${error.message}`);
  }
}

export async function bestEffortChmod(filePath, mode) {
  try {
    await fs.chmod(filePath, mode);
  } catch {
    // Windows and managed environments may ignore POSIX chmod.
  }
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function unescapeTomlString(value) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
