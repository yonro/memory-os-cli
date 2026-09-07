import crypto from 'node:crypto';
import { access, link, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { UsageError } from '../core/errors.js';
import { readTextFileBounded } from './text-input.js';

export function createReadReceipt({ baseUrl, resource, scope, revision, latestRevision, version, itemStatus, settingsVersion, content, revisionStatus, revisionKind, candidateItemIds, sourceType, sourceRef }) {
  const receipt = {
    schemaVersion: '1',
    serviceOrigin: new URL(baseUrl).origin,
    resource,
    scope: scope ?? null,
    displayedRevision: revision ?? null,
    latestRevision: latestRevision ?? revision ?? null,
    version: version ?? null,
    sourceType: sourceType ?? null,
    sourceRef: sourceRef ?? null,
    itemStatus: itemStatus ?? null,
    revisionStatus: revisionStatus ?? null,
    revisionKind: revisionKind ?? null,
    settingsVersion: settingsVersion ?? null,
    candidateItemIds: Array.isArray(candidateItemIds) ? candidateItemIds.map(String) : null,
    contentSha256: typeof content === 'string'
      ? crypto.createHash('sha256').update(content, 'utf8').digest('hex')
      : null
  };
  return Object.freeze(receipt);
}

export async function readAndValidateReceipt(filePath, { baseUrl, resource, scope } = {}) {
  const normalized = await readTextFileBounded(filePath, 'receipt file');
  let receipt;
  try {
    const parsed = JSON.parse(normalized);
    receipt = parsed?.meta?.readReceipt ?? parsed;
  } catch (error) {
    throw new UsageError(`Invalid read receipt JSON in ${filePath}: ${error.message}`);
  }
  if (!receipt || typeof receipt !== 'object' || receipt.schemaVersion !== '1') {
    throw new UsageError(`Invalid read receipt in ${filePath}: schemaVersion 1 is required.`);
  }
  if (baseUrl && receipt.serviceOrigin !== new URL(baseUrl).origin) {
    throw new UsageError('Read receipt belongs to a different service origin.');
  }
  if (resource && receipt.resource !== resource) {
    throw new UsageError('Read receipt belongs to a different resource.');
  }
  if (scope !== undefined && receipt.scope !== scope) {
    throw new UsageError('Read receipt belongs to a different scope.');
  }
  if (typeof receipt.displayedRevision !== 'string' || !receipt.displayedRevision.trim()) throw new UsageError('Read receipt has no valid displayed revision; read the resource again.');
  return receipt;
}

export async function writeReadReceipt(filePath, receipt) {
  await prepareReadReceiptOut(filePath);
  const temporaryPath = path.join(path.dirname(path.resolve(filePath)), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await link(temporaryPath, filePath);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new UsageError(`Receipt file already exists: ${filePath}. Choose a new path; XMemo will not overwrite it.`);
    throw new UsageError(`Could not save receipt to ${filePath}: ${error.message}`);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

// Validate the user-selected destination before an otherwise successful read
// performs remote work. The final write remains no-clobber and atomic, so a
// file created by another process after this probe is still never replaced.
export async function prepareReadReceiptOut(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new UsageError('--receipt-out requires a file path.');
  try {
    await access(filePath);
    throw new UsageError(`Receipt file already exists: ${filePath}. Choose a new path; XMemo will not overwrite it.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const directory = path.dirname(path.resolve(filePath));
  const probePath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.probe`);
  try {
    await writeFile(probePath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    throw new UsageError(`Could not save receipt to ${filePath}: ${error.message}`);
  } finally {
    await unlink(probePath).catch(() => {});
  }
}
