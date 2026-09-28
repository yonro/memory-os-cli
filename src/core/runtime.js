import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

export function userHome(env = process.env) {
  return env?.USERPROFILE || env?.HOME || os.homedir();
}

export function isRepo(cwd, env = process.env, markerDir = null) {
  if (!cwd) return false;
  const resolvedCwd = path.resolve(cwd);
  const resolvedHome = path.resolve(userHome(env));
  if (resolvedCwd === resolvedHome) {
    return existsSync(path.join(cwd, '.git'));
  }
  if (markerDir && existsSync(path.join(cwd, markerDir))) {
    return true;
  }
  return existsSync(path.join(cwd, '.git')) || existsSync(path.join(cwd, 'package.json'));
}

export function isDeepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => isDeepEqual(val, b[idx]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isDeepEqual(a[k], b[k]));
}
