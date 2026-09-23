import { readTextFileBounded } from '../api/text-input.js';
import { hasFlag, optionValue, parseIntegerInRange } from '../core/args.js';
import { UsageError } from '../core/errors.js';
import { assertKnownOptions } from '../api/input.js';
import { confirmRemoteAction } from '../api/confirmation.js';

const common = ['--json', '--base-url', '--url', '--timeout-ms', '--allow-legacy-credential'];
const number = (args, flag, fallback, max) => parseIntegerInRange(optionValue(args, flag) ?? String(fallback), flag, { min: flag === '--offset' ? 0 : 1, max });

export async function prepareMemoryTransfer(command, args) {
  if (command.endsWith('-delete')) {
    assertKnownOptions(args, [...common, '--id', '--yes']);
    const id = optionValue(args, '--id');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) throw new UsageError('An exact transaction UUID is required with --id.');
    return { method: 'POST', path: '/v1/skill/operations', body: { operation: command, arguments: { id } }, sideEffect: true };
  }
  if (command === 'list') {
    assertKnownOptions(args, [...common, '--path-prefix', '--limit', '--offset']);
    return { method: 'GET', path: '/v1/memories', query: {
      path_prefix: optionValue(args, '--path-prefix') ?? '', limit: number(args, '--limit', 100, 500),
      offset: number(args, '--offset', 0, Number.MAX_SAFE_INTEGER),
    }};
  }
  assertKnownOptions(args, [...common, '--limit', '--bucket', '--scope', ...(command === 'import' ? ['--file', '--dry-run', '--idempotency-key', '--yes'] : [])]);
  const limit = number(args, '--limit', 500, 5000);
  const body = { limit, bucket: optionValue(args, '--bucket') ?? (command === 'import' ? 'private' : '%') };
  const scope = optionValue(args, '--scope');
  if (scope !== undefined) body.scope = scope;
  if (command === 'import') {
    const file = optionValue(args, '--file');
    if (!file) throw new UsageError('Import requires --file containing memory JSONL.');
    body.jsonl = await readTextFileBounded(file, 'memory JSONL');
    for (const line of body.jsonl.split(/\r?\n/).filter(x => x.trim())) {
      let value;
      try { value = JSON.parse(line); } catch { throw new UsageError('Invalid JSONL record.'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UsageError('JSONL records must be objects.');
    }
    body.dry_run = hasFlag(args, '--dry-run');
    body.idempotency_key = optionValue(args, '--idempotency-key');
    if (!body.dry_run) {
      if (!body.idempotency_key?.trim()) throw new UsageError('Applied import requires --idempotency-key for safe manual retries.');
    }
  }
  return body;
}

export async function memoryTransfer(command, args, io, context, prepared) {
  const body = prepared ?? await prepareMemoryTransfer(command, args);
  if (command.endsWith('-delete')) {
    await confirmRemoteAction(args, io, 'Soft-delete this ledger transaction?');
    return context.client.request(body);
  }
  if (command === 'list') return context.client.request(body);
  if (command === 'import' && !body.dry_run) await confirmRemoteAction(args, io, 'Import these memories into the selected space?');
  const pages = [];
  let cursor = 0;
  do {
    const response = await context.client.request({ method: 'POST', path: `/v1/memories/${command}`, body: { ...body, cursor }, sideEffect: command === 'import' && !body.dry_run });
    const page = response.data;
    if (!page || !Object.hasOwn(page, 'next_cursor')) throw new UsageError('Missing pagination receipt; inspect the server before retrying.');
    pages.push(page);
    const next = page.next_cursor;
    if (next === null) break;
    if (!Number.isSafeInteger(next) || next <= cursor) throw new UsageError('Non-advancing pagination receipt; inspect the server before retrying.');
    cursor = next;
  } while (true);
  if (command === 'export') {
    if (pages.some(page => typeof page.jsonl !== 'string')) throw new UsageError('Invalid export response.');
    return { data: { format: 'jsonl', jsonl: pages.map(page => page.jsonl).join(''), next_cursor: null, pages: pages.length } };
  }
  return { data: { dry_run: body.dry_run, pages, next_cursor: null } };
}
