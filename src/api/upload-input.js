import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { UsageError } from '../core/errors.js';

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_SKILL_FILES = 100;
const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 10 * 1024 * 1024;
const EXCLUDED_DIRECTORY_NAMES = /^(\.git|node_modules|__pycache__|\.venv|venv|dist|build|coverage)$/i;
const SENSITIVE_NAMES = /(^\.env(?:\..*)?$|^\.npmrc$|^\.pypirc$|^\.netrc$|^id_(?:rsa|dsa|ecdsa|ed25519)$|secret|token|credential|private.?key|\.(?:pem|p12|pfx|key)$)/i;

export async function readDocumentInput(filePath) {
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = await fs.lstat(resolved);
  } catch (error) {
    throw new UsageError(`Could not read document input ${filePath}: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new UsageError(`Document input must be a regular non-symlink file: ${filePath}`);
  if (stat.size > MAX_DOCUMENT_BYTES) throw new UsageError(`Document input exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`);
  let bytes;
  try {
    bytes = await readBoundedBytes(resolved, MAX_DOCUMENT_BYTES, stat);
  } catch (error) {
    throw new UsageError(`Could not read document input ${filePath}: ${error.message}`);
  }
  return {
    filename: path.basename(resolved),
    byteSize: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    contentBase64: bytes.toString('base64')
  };
}

export async function collectSkillFiles(directory) {
  const root = path.resolve(directory);
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    throw new UsageError(`Could not read skill input ${directory}: ${error.message}`);
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new UsageError(`Skill input must be a regular directory: ${directory}`);
  const files = [];
  const state = { bytes: 0, entries: 0, excluded: [], paths: new Set() };
  const realRoot = await fs.realpath(root);
  await visit(realRoot, realRoot, files, state);
  if (!files.some((file) => file.logicPath === 'SKILL.md')) throw new UsageError('Skill directory must contain a root SKILL.md file.');
  if (files.length > MAX_SKILL_FILES) throw new UsageError(`Skill directory contains more than ${MAX_SKILL_FILES} eligible files.`);
  const lowerPaths = new Set();
  let totalBytes = 0;
  const subFiles = Object.create(null);
  for (const file of files) {
    const key = file.logicPath.toLowerCase();
    if (lowerPaths.has(key)) throw new UsageError(`Skill directory has a case-colliding path: ${file.logicPath}`);
    lowerPaths.add(key);
    totalBytes += file.bytes.length;
    if (totalBytes > MAX_SKILL_TOTAL_BYTES) throw new UsageError(`Skill directory exceeds the ${MAX_SKILL_TOTAL_BYTES}-byte total limit.`);
    if (file.logicPath !== 'SKILL.md') subFiles[file.logicPath] = decodeUtf8(file.bytes, file.logicPath);
  }
  const rootFile = files.find((file) => file.logicPath === 'SKILL.md');
  return {
    rootMarkdown: decodeUtf8(rootFile.bytes, rootFile.logicPath),
    subFiles,
    included: files.map((file) => ({ path: file.logicPath, bytes: file.bytes.length, sha256: file.sha256 })),
    excluded: state.excluded,
    totalBytes
  };
}

export async function readSkillFile(filePath) {
  const resolved = path.resolve(filePath);
  if (path.basename(resolved).toLowerCase() !== 'skill.md') throw new UsageError('Cloud Skill --file must point to SKILL.md.');
  let stat;
  try {
    stat = await fs.lstat(resolved);
  } catch (error) {
    throw new UsageError(`Could not read skill input ${filePath}: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new UsageError(`Skill input must be a regular non-symlink file: ${filePath}`);
  if (stat.size > MAX_SKILL_FILE_BYTES) throw new UsageError(`Skill file exceeds the ${MAX_SKILL_FILE_BYTES}-byte limit: ${filePath}`);
  let bytes;
  try {
    bytes = await readBoundedBytes(resolved, MAX_SKILL_FILE_BYTES, stat);
  } catch (error) {
    throw new UsageError(`Could not read skill input ${filePath}: ${error.message}`);
  }
  return {
    rootMarkdown: decodeUtf8(bytes, path.basename(resolved)),
    subFiles: {},
    included: [{ path: 'SKILL.md', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }],
    totalBytes: bytes.length
  };
}

async function visit(root, current, files, state, depth = 0) {
  if (depth > 16) throw new UsageError('Skill directory nesting exceeds 16 levels.');
  let entries;
  try {
    entries = await fs.opendir(current);
  } catch (error) {
    throw new UsageError(`Could not read skill input directory ${current}: ${error.message}`);
  }
  for await (const entry of entries) {
    if (++state.entries > 1000) throw new UsageError('Skill directory contains more than 1000 filesystem entries.');
    if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.test(entry.name)) {
      state.excluded.push({ path: path.relative(root, path.join(current, entry.name)).split(path.sep).join('/'), reason: 'dependency or build directory' });
      continue;
    }
    if (SENSITIVE_NAMES.test(entry.name)) throw new UsageError(`Refusing sensitive-looking skill input path: ${entry.name}`);
    const absolute = path.join(current, entry.name);
    const logicPath = path.relative(root, absolute).split(path.sep).join('/');
    if (!logicPath || logicPath.split('/').includes('..') || path.isAbsolute(logicPath)) throw new UsageError(`Unsafe skill input path: ${logicPath}`);
    if (entry.isSymbolicLink()) throw new UsageError(`Refusing symbolic-link skill input: ${logicPath}`);
    const real = await fs.realpath(absolute);
    const relativeReal = path.relative(root, real);
    if (relativeReal === '..' || relativeReal.startsWith(`..${path.sep}`) || path.isAbsolute(relativeReal)) throw new UsageError(`Skill input escapes its root: ${logicPath}`);
    const key = logicPath.toLowerCase();
    if (state.paths.has(key)) throw new UsageError(`Skill directory has a case-colliding path: ${logicPath}`);
    state.paths.add(key);
    if (entry.isDirectory()) {
      await visit(root, absolute, files, state, depth + 1);
      continue;
    }
    if (!entry.isFile()) throw new UsageError(`Unsupported skill input filesystem entry: ${logicPath}`);
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (error) {
      throw new UsageError(`Could not inspect skill input file ${logicPath}: ${error.message}`);
    }
    if (stat.size > MAX_SKILL_FILE_BYTES) throw new UsageError(`Skill file exceeds the ${MAX_SKILL_FILE_BYTES}-byte limit: ${logicPath}`);
    if (files.length >= MAX_SKILL_FILES) throw new UsageError(`Skill directory contains more than ${MAX_SKILL_FILES} eligible files.`);
    if (state.bytes + stat.size > MAX_SKILL_TOTAL_BYTES) throw new UsageError(`Skill directory exceeds the ${MAX_SKILL_TOTAL_BYTES}-byte total limit.`);
    let bytes;
    try {
      bytes = await readBoundedBytes(absolute, Math.min(MAX_SKILL_FILE_BYTES, MAX_SKILL_TOTAL_BYTES - state.bytes), stat);
    } catch (error) {
      throw new UsageError(`Could not read skill input file ${logicPath}: ${error.message}`);
    }
    state.bytes += bytes.length;
    files.push({ logicPath, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
}

function decodeUtf8(bytes, name) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\ufeff/, '');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('binary control characters');
    return text;
  } catch (error) {
    throw new UsageError(`Skill file must be valid UTF-8 text: ${name} (${error.message})`);
  }
}

async function readBoundedBytes(filePath, maxBytes, expectedStat) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new UsageError(`Input must be a regular file no larger than ${maxBytes} bytes.`);
    if (expectedStat && !sameFileIdentity(expectedStat, stat)) {
      throw new UsageError('Input file changed after validation; retry with a stable regular file.');
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new UsageError(`Input exceeds the ${maxBytes}-byte limit.`);
    const finalStat = await handle.stat();
    if (finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) {
      throw new UsageError('Input file changed while it was being read; retry with a stable file.');
    }
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

function sameFileIdentity(pathStat, handleStat) {
  if (pathStat.ino !== handleStat.ino) return false;
  return process.platform === 'win32' || pathStat.dev === handleStat.dev;
}
