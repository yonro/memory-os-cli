import { hasFlag, optionValue, parseIntegerInRange } from '../core/args.js';
import { UsageError } from '../core/errors.js';
import { writeLine } from '../core/io.js';
import { assertKnownOptions, assertNoUnknownInputFields, optionalBooleanInput, readJsonInput, rejectInputFlagConflicts } from '../api/input.js';
import { UnknownOutcomeError, errorToExitCode } from '../api/errors.js';
import { writeFailure, writeSuccess } from '../api/envelope.js';
import { serviceContext } from '../api/service-context.js';
import { writeHumanServiceHelp, writeServiceHelpSchema } from '../api/contracts/help-schema.js';
import { writeHumanServiceFailure, writeHumanServiceResult } from '../api/service-output.js';
import { confirmRemoteAction } from '../api/confirmation.js';
import { processDocumentStubs } from '../api/document-stub.js';
import { memoryTransfer, prepareMemoryTransfer } from './memory-transfer.js';
import { matchesPathPrefix, normalizeMemoryPath, unifyMemoryItem, rerankSearchResults } from '../api/memory-schema.js';

export async function memoryCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (subcommand !== 'help' && hasFlag(args, '--json') && writeServiceHelpSchema(io, `memory.${subcommand}`)) return 0;
    if (subcommand !== 'help' && writeHumanServiceHelp(io, `memory.${subcommand}`)) return 0;
    writeLine(io.stdout, 'Memory commands:');
    writeLine(io.stdout, '  xmemo memory add --content <text> --path <path> [--bucket <name>] [--json]');
    writeLine(io.stdout, '  xmemo memory search <query> [--limit <n>] [--team <id>] [--expand-documents] [--keyword <words>] [--exact <phrase>] [--json]');
    writeLine(io.stdout, '  xmemo memory read <memory-id> [--team <id>] [--json]');
    writeLine(io.stdout, '  xmemo memory list [--path-prefix <prefix>] [--project <name>] [--exact-path] [--query <text>] [--type <type>] [--all] [--limit <n>] [--offset <n>] [--json]');
    writeLine(io.stdout, '  xmemo memory import --file <jsonl> [--dry-run | --idempotency-key <key> --yes]');
    writeLine(io.stdout, '  xmemo memory ledger-delete|expense-delete --id <transaction-uuid> --yes');
    return 0;
  }
  if (subcommand === 'add') return await runServiceCommand('memory.add', args.slice(1), io, memoryAdd, validateMemoryAdd);
  if (subcommand === 'search') return await runServiceCommand('memory.search', args.slice(1), io, memorySearch, validateMemorySearch);
  if (subcommand === 'read') return await runServiceCommand('memory.read', args.slice(1), io, memoryRead, validateMemoryRead);
  if (subcommand === 'list') return await runServiceCommand('memory.list', args.slice(1), io, memoryList, validateMemoryList);
  if (['import', 'ledger-delete', 'expense-delete'].includes(subcommand)) {
    let prepared;
    return await runServiceCommand(`memory.${subcommand}`, args.slice(1), io,
      (options, streams, context) => memoryTransfer(subcommand, options, streams, context, prepared),
      async (options) => { prepared = await prepareMemoryTransfer(subcommand, options); });
  }
  throw new UsageError(`Unknown memory command: ${subcommand}`);
}

export async function contextCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (subcommand !== 'help' && hasFlag(args, '--json') && writeServiceHelpSchema(io, `context.${subcommand}`)) return 0;
    if (subcommand !== 'help' && writeHumanServiceHelp(io, `context.${subcommand}`)) return 0;
    writeLine(io.stdout, 'Context commands:');
    writeLine(io.stdout, '  xmemo context recall <query> [--max-tokens <n>] [--max-items <n>] [--include-knowledge] [--expand-documents] [--json]');
    return 0;
  }
  if (subcommand === 'recall') return await runServiceCommand('context.recall', args.slice(1), io, contextRecall, validateContextRecall);
  throw new UsageError(`Unknown context command: ${subcommand}`);
}

export async function stateCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (subcommand !== 'help' && hasFlag(args, '--json') && writeServiceHelpSchema(io, `state.${subcommand}`)) return 0;
    if (subcommand !== 'help' && writeHumanServiceHelp(io, `state.${subcommand}`)) return 0;
    writeLine(io.stdout, 'State commands:');
    writeLine(io.stdout, '  xmemo state save [--content <text>] [--state-key <key>] [--json]');
    writeLine(io.stdout, '  xmemo state restore [--state-key <key>] [--json]');
    return 0;
  }
  if (subcommand === 'save') return await runServiceCommand('state.save', args.slice(1), io, stateSave, validateStateSave);
  if (subcommand === 'restore') return await runServiceCommand('state.restore', args.slice(1), io, stateRestore, validateStateRestore);
  throw new UsageError(`Unknown state command: ${subcommand}`);
}

export async function restartCommand(args, io) {
  const subcommand = args[0] ?? 'help';
  if (subcommand === 'help' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (subcommand !== 'help' && hasFlag(args, '--json') && writeServiceHelpSchema(io, `restart.${subcommand}`)) return 0;
    if (subcommand !== 'help' && writeHumanServiceHelp(io, `restart.${subcommand}`)) return 0;
    writeLine(io.stdout, 'Restart commands:');
    writeLine(io.stdout, '  xmemo restart snapshot [--state-key <key>] [--json]');
    writeLine(io.stdout, '  xmemo restart restore [--snapshot-id <id>] (--preview|--apply --yes) [--json]');
    return 0;
  }
  if (subcommand === 'snapshot') return await runServiceCommand('restart.snapshot', args.slice(1), io, restartSnapshot, validateRestartSnapshot);
  if (subcommand === 'restore') return await runServiceCommand('restart.restore', args.slice(1), io, restartRestore, validateRestartRestore);
  throw new UsageError(`Unknown restart command: ${subcommand}`);
}

async function memoryAdd(args, io, context) {
  assertKnownOptions(args, ['--content', '--path', '--bucket', '--scope', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['content', 'path', 'bucket', 'scope', 'team_id', 'metadata', 'memory_type']);
  rejectInputFlagConflicts(input, [['--content', 'content'], ['--path', 'path'], ['--bucket', 'bucket'], ['--scope', 'scope'], ['--team', 'team_id']], args);
  const body = {
    content: optionValue(args, '--content') ?? input?.content,
    path: optionValue(args, '--path') ?? input?.path,
    bucket: optionValue(args, '--bucket') ?? input?.bucket,
    scope: optionValue(args, '--scope') ?? input?.scope,
    team_id: optionValue(args, '--team') ?? input?.team_id,
    metadata: input?.metadata,
    memory_type: input?.memory_type
  };
  if (typeof body.content !== 'string' || !body.content.trim()) throw new UsageError('memory add requires non-empty --content or input.content.');
  if (typeof body.path !== 'string' || !body.path.trim()) throw new UsageError('memory add requires non-empty --path or input.path.');
  const response = await context.client.request({ method: 'POST', path: '/api/v1/remember', body: compact(body), sideEffect: true });
  const result = response.data;
  if (!result || typeof result !== 'object' || ![result.id, result.memory_id, result.memoryId].some((value) => typeof value === 'string' && value.length > 0)) {
    throw new UnknownOutcomeError('Memory write returned without a confirmed memory ID.', {
      code: 'WRITE_RECEIPT_MISSING',
      data: { status: response.status },
      nextAction: 'Check whether the memory was created on the server; do not automatically retry this write.'
    });
  }
  if (result && typeof result === 'object' && !result.path && !result.memory_path) {
    result.path = body.path;
  }
  return response;
}

async function validateMemoryAdd(args, io) {
  assertKnownOptions(args, ['--content', '--path', '--bucket', '--scope', '--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['content', 'path', 'bucket', 'scope', 'team_id', 'metadata', 'memory_type']);
  rejectInputFlagConflicts(input, [['--content', 'content'], ['--path', 'path'], ['--bucket', 'bucket'], ['--scope', 'scope'], ['--team', 'team_id']], args);
  if (typeof (optionValue(args, '--content') ?? input?.content) !== 'string' || !(optionValue(args, '--content') ?? input?.content).trim()) throw new UsageError('memory add requires non-empty --content or input.content.');
  if (typeof (optionValue(args, '--path') ?? input?.path) !== 'string' || !(optionValue(args, '--path') ?? input?.path).trim()) throw new UsageError('memory add requires non-empty --path or input.path.');
}

async function memoryRead(args, io, context) {
  const input = await readJsonInput(args, io);
  const memoryId = singlePositional(args, 'memory read') ?? input?.memory_id;
  return await context.client.request({ method: 'GET', path: `/api/v1/memories/${encodeURIComponent(memoryId)}/explain`, query: compact({ team_id: optionValue(args, '--team') ?? input?.team_id }), sideEffect: false, retry: 'bounded' });
}

async function validateMemoryRead(args, io) {
  assertKnownOptions(args, ['--team', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['memory_id', 'team_id']);
  rejectInputFlagConflicts(input, [['--team', 'team_id']], args);
  const positionalId = singlePositional(args, 'memory read');
  if (positionalId && input?.memory_id !== undefined) throw new UsageError('Memory ID cannot be supplied both positionally and in --input.');
  if (typeof (positionalId ?? input?.memory_id) !== 'string' || !(positionalId ?? input?.memory_id).trim()) throw new UsageError('memory read requires a memory ID.');
}

async function memoryList(args, io, context) {
  const input = await readJsonInput(args, io);
  const pathPrefixArg = optionValue(args, '--path-prefix') ?? input?.path_prefix;
  const projectArg = optionValue(args, '--project') ?? input?.project;
  const exactPath = hasFlag(args, '--exact-path') || optionalBooleanInput(input, 'exact_path') === true;
  const filterText = optionValue(args, '--query') ?? optionValue(args, '--filter') ?? input?.query ?? input?.filter ?? null;
  const typeFilter = optionValue(args, '--type') ?? input?.type ?? null;
  const all = hasFlag(args, '--all') || optionalBooleanInput(input, 'all') === true;
  const isHumanMode = !hasFlag(args, '--json');

  const rawLimit = optionValue(args, '--limit') ?? input?.limit;
  const rawOffset = optionValue(args, '--offset') ?? input?.offset;
  const limit = rawLimit !== undefined && rawLimit !== null
    ? parseIntegerInRange(rawLimit, '--limit', { min: 1, max: 500 })
    : 100;
  const offset = rawOffset !== undefined && rawOffset !== null
    ? parseIntegerInRange(rawOffset, '--offset', { min: 0, max: Number.MAX_SAFE_INTEGER })
    : 0;

  let targetPrefix = null;
  let rawPrefixForServer = '';
  if (projectArg) {
    targetPrefix = exactPath ? `projects/${projectArg}` : normalizeMemoryPath(`projects/${projectArg}`);
    rawPrefixForServer = targetPrefix;
  } else if (pathPrefixArg !== undefined && pathPrefixArg !== null) {
    targetPrefix = exactPath ? pathPrefixArg : normalizeMemoryPath(pathPrefixArg);
    rawPrefixForServer = exactPath ? pathPrefixArg : (normalizeMemoryPath(pathPrefixArg) || pathPrefixArg);
  }

  function matchesItem(item) {
    if (targetPrefix !== null) {
      if (!matchesPathPrefix(item?.path ?? item?.memory_path, targetPrefix, exactPath)) {
        return false;
      }
    }
    if (typeFilter) {
      const itemType = String(item?.memory_type ?? item?.type ?? '');
      if (itemType.toLowerCase() !== typeFilter.toLowerCase()) {
        return false;
      }
    }
    if (filterText) {
      const textToSearch = `${item?.content ?? ''} ${item?.path ?? item?.memory_path ?? ''}`.toLowerCase();
      if (!textToSearch.includes(filterText.toLowerCase())) {
        return false;
      }
    }
    return true;
  }

  const warnings = [];

  if (all) {
    const pageSize = 500;
    const maxItems = 10000;
    let totalFetched = 0;
    const allItems = [];

    let useFallback = false;
    if (targetPrefix !== null && !exactPath) {
      const firstPage = await context.client.request({
        method: 'GET', path: '/v1/memories', retry: 'bounded', sideEffect: false,
        query: { path_prefix: rawPrefixForServer, limit: pageSize, offset: 0 }
      });
      const memories = firstPage?.data?.memories ?? (Array.isArray(firstPage?.data) ? firstPage.data : []);
      if (memories.length === 0 && (firstPage?.data?.total === 0 || firstPage?.data?.total === undefined)) {
        useFallback = true;
      } else {
        totalFetched += memories.length;
        if (isHumanMode) writeLine(io.stderr, `Fetching memories... (${totalFetched})`);
        for (const item of memories) {
          if (matchesItem(item)) allItems.push(item);
        }
        let currentOffset = memories.length;
        while (memories.length === pageSize && totalFetched < maxItems) {
          const nextPage = await context.client.request({
            method: 'GET', path: '/v1/memories', retry: 'bounded', sideEffect: false,
            query: { path_prefix: rawPrefixForServer, limit: pageSize, offset: currentOffset }
          });
          const nextMems = nextPage?.data?.memories ?? (Array.isArray(nextPage?.data) ? nextPage.data : []);
          if (nextMems.length === 0) break;
          totalFetched += nextMems.length;
          if (isHumanMode) writeLine(io.stderr, `Fetching memories... (${totalFetched})`);
          for (const item of nextMems) {
            if (matchesItem(item)) allItems.push(item);
          }
          if (nextMems.length < pageSize) break;
          currentOffset += nextMems.length;
        }
      }
    }

    if (useFallback || targetPrefix === null || exactPath) {
      if (!useFallback && (targetPrefix === null || exactPath)) {
        let currentOffset = 0;
        while (totalFetched < maxItems) {
          const query = { limit: pageSize, offset: currentOffset };
          if (targetPrefix !== null) query.path_prefix = rawPrefixForServer;
          const pageRes = await context.client.request({
            method: 'GET', path: '/v1/memories', retry: 'bounded', sideEffect: false,
            query
          });
          const mems = pageRes?.data?.memories ?? (Array.isArray(pageRes?.data) ? pageRes.data : []);
          if (mems.length === 0) break;
          totalFetched += mems.length;
          if (isHumanMode) writeLine(io.stderr, `Fetching memories... (${totalFetched})`);
          for (const item of mems) {
            if (matchesItem(item)) allItems.push(item);
          }
          if (mems.length < pageSize) break;
          currentOffset += mems.length;
        }
      } else if (useFallback) {
        let currentOffset = 0;
        while (totalFetched < maxItems) {
          const pageRes = await context.client.request({
            method: 'GET', path: '/v1/memories', retry: 'bounded', sideEffect: false,
            query: { limit: pageSize, offset: currentOffset }
          });
          const mems = pageRes?.data?.memories ?? (Array.isArray(pageRes?.data) ? pageRes.data : []);
          if (mems.length === 0) break;
          totalFetched += mems.length;
          if (isHumanMode) writeLine(io.stderr, `Fetching memories... (${totalFetched})`);
          for (const item of mems) {
            if (matchesItem(item)) allItems.push(item);
          }
          if (mems.length < pageSize) break;
          currentOffset += mems.length;
        }
      }
    }

    if (totalFetched >= maxItems) {
      warnings.push('Hit 10,000 item limit while fetching all memories; results may be truncated.');
    }

    const unified = allItems.map((item) => unifyMemoryItem(item, { score: null }));
    const responseData = {
      total: unified.length,
      memories: unified,
      items: unified
    };
    for (let i = 0; i < unified.length; i += 1) {
      responseData[i] = unified[i];
    }
    return {
      data: responseData,
      meta: {
        warnings,
        nextCursor: null
      }
    };
  }

  // Non-all: single page with fast try or bounded fallback
  let memories = [];
  let serverTotal = null;
  let useFallback = false;

  const initialQuery = { limit, offset, path_prefix: rawPrefixForServer };

  const res = await context.client.request({
    method: 'GET', path: '/v1/memories', retry: 'bounded', sideEffect: false,
    query: initialQuery
  });
  memories = res?.data?.memories ?? (Array.isArray(res?.data) ? res.data : []);
  serverTotal = res?.data?.total;

  if (targetPrefix !== null && !exactPath && memories.length === 0 && (serverTotal === 0 || serverTotal === undefined) && offset === 0) {
    useFallback = true;
  }

  let finalItems = [];
  if (useFallback) {
    const scanLimit = 500;
    const maxScan = 1000;
    let scanned = 0;
    let scanOffset = 0;
    const matched = [];
    while (scanned < maxScan) {
      const pageRes = await context.client.request({
        method: 'GET', path: '/v1/memories', retry: 'bounded', sideEffect: false,
        query: { limit: scanLimit, offset: scanOffset }
      });
      const mems = pageRes?.data?.memories ?? (Array.isArray(pageRes?.data) ? pageRes.data : []);
      if (mems.length === 0) break;
      scanned += mems.length;
      for (const item of mems) {
        if (matchesItem(item)) matched.push(item);
      }
      if (matched.length >= offset + limit || mems.length < scanLimit) break;
      scanOffset += mems.length;
    }
    finalItems = matched.slice(offset, offset + limit);
    serverTotal = matched.length;
  } else {
    finalItems = memories.filter(matchesItem);
  }

  const unified = finalItems.map((item) => unifyMemoryItem(item, { score: null }));
  const responseData = {
    total: serverTotal ?? unified.length,
    memories: unified,
    items: unified
  };
  for (let i = 0; i < unified.length; i += 1) {
    responseData[i] = unified[i];
  }
  return {
    data: responseData,
    meta: {
      warnings,
      nextCursor: (serverTotal !== null && serverTotal !== undefined && offset + unified.length < serverTotal)
        ? String(offset + unified.length)
        : null
    }
  };
}

async function validateMemoryList(args, io) {
  assertKnownOptions(args, [
    '--path-prefix', '--project', '--exact-path',
    '--query', '--filter', '--type', '--all',
    '--limit', '--offset',
    '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json'
  ]);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, [
    'path_prefix', 'project', 'exact_path',
    'query', 'filter', 'type', 'all',
    'limit', 'offset'
  ]);
  rejectInputFlagConflicts(input, [
    ['--path-prefix', 'path_prefix'],
    ['--project', 'project'],
    ['--query', 'query'],
    ['--filter', 'filter'],
    ['--type', 'type'],
    ['--limit', 'limit'],
    ['--offset', 'offset']
  ], args);

  const pathPrefix = optionValue(args, '--path-prefix') ?? input?.path_prefix;
  const project = optionValue(args, '--project') ?? input?.project;
  if (pathPrefix !== undefined && project !== undefined) {
    throw new UsageError('Cannot supply both --path-prefix and --project.');
  }

  const query = optionValue(args, '--query') ?? input?.query;
  const filter = optionValue(args, '--filter') ?? input?.filter;
  if (query !== undefined && filter !== undefined && query !== filter) {
    throw new UsageError('Cannot supply both --query and --filter.');
  }

  const rawLimit = optionValue(args, '--limit') ?? input?.limit;
  if (rawLimit !== undefined && rawLimit !== null) {
    parseIntegerInRange(rawLimit, '--limit', { min: 1, max: 500 });
  }

  const rawOffset = optionValue(args, '--offset') ?? input?.offset;
  if (rawOffset !== undefined && rawOffset !== null) {
    parseIntegerInRange(rawOffset, '--offset', { min: 0, max: Number.MAX_SAFE_INTEGER });
  }

  optionalBooleanInput(input, 'exact_path');
  optionalBooleanInput(input, 'all');
}

async function memorySearch(args, io, context) {
  assertKnownOptions(args, ['--limit', '--team', '--bucket', '--path', '--prefer-working', '--expand-documents', '--keyword', '--exact', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['query', 'limit', 'team_id', 'bucket', 'path', 'prefer_working', 'expand_documents', 'keyword', 'exact']);
  rejectInputFlagConflicts(input, [['--limit', 'limit'], ['--team', 'team_id'], ['--bucket', 'bucket'], ['--path', 'path'], ['--prefer-working', 'prefer_working'], ['--expand-documents', 'expand_documents'], ['--keyword', 'keyword'], ['--exact', 'exact']], args);
  const queryArg = singlePositional(args, 'memory search');
  const query = queryArg ?? input?.query;
  if (queryArg && input?.query !== undefined) throw new UsageError('Search query cannot be supplied both positionally and in --input.');
  if (typeof query !== 'string' || !query.trim()) throw new UsageError('memory search requires a query.');
  const rawLimit = optionValue(args, '--limit') ?? input?.limit;
  const keyword = optionValue(args, '--keyword') ?? input?.keyword;
  const exact = optionValue(args, '--exact') ?? input?.exact;
  const response = await context.client.request({
    method: 'GET', path: '/api/v1/recall', retry: 'bounded', sideEffect: false,
    query: compact({ query, limit: rawLimit === undefined || rawLimit === null ? undefined : parseIntegerInRange(rawLimit, '--limit', { min: 1, max: 5000 }), team_id: optionValue(args, '--team') ?? input?.team_id, bucket: optionValue(args, '--bucket') ?? input?.bucket, path: optionValue(args, '--path') ?? input?.path, prefer_working: hasFlag(args, '--prefer-working') ? true : optionalBooleanInput(input, 'prefer_working') })
  });
  const data = response?.data ?? response;
  const items = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.items) ? data.items : [];
  const expandDocuments = hasFlag(args, '--expand-documents') || optionalBooleanInput(input, 'expand_documents') === true;
  await processDocumentStubs(items, {
    expandDocuments,
    client: context.client,
    teamId: optionValue(args, '--team') ?? input?.team_id
  });
  const reranked = rerankSearchResults(items, { keyword, exact });
  const unified = reranked.map((item) => unifyMemoryItem(item, { score: item.similarity ?? item.score ?? null }));
  const unifiedData = {
    results: unified,
    items: unified,
    ...(data?.coverage !== undefined ? { coverage: data.coverage } : {})
  };
  for (let i = 0; i < unified.length; i += 1) {
    unifiedData[i] = unified[i];
  }
  response.data = unifiedData;
  return response;
}

async function validateMemorySearch(args, io) {
  assertKnownOptions(args, ['--limit', '--team', '--bucket', '--path', '--prefer-working', '--expand-documents', '--keyword', '--exact', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['query', 'limit', 'team_id', 'bucket', 'path', 'prefer_working', 'expand_documents', 'keyword', 'exact']);
  rejectInputFlagConflicts(input, [['--limit', 'limit'], ['--team', 'team_id'], ['--bucket', 'bucket'], ['--path', 'path'], ['--prefer-working', 'prefer_working'], ['--expand-documents', 'expand_documents'], ['--keyword', 'keyword'], ['--exact', 'exact']], args);
  const queryArg = singlePositional(args, 'memory search');
  if (queryArg && input?.query !== undefined) throw new UsageError('Search query cannot be supplied both positionally and in --input.');
  const query = queryArg ?? input?.query;
  if (typeof query !== 'string' || !query.trim()) throw new UsageError('memory search requires a query.');
  const rawLimit = optionValue(args, '--limit') ?? input?.limit;
  if (rawLimit !== undefined && rawLimit !== null) parseIntegerInRange(rawLimit, '--limit', { min: 1, max: 5000 });
  optionalBooleanInput(input, 'prefer_working');
  optionalBooleanInput(input, 'expand_documents');
}

async function contextRecall(args, io, context) {
  assertKnownOptions(args, ['--include-knowledge', '--max-tokens', '--max-items', '--team', '--expand-documents', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['query', 'include_knowledge', 'team_id', 'scope', 'limit', 'max_items', 'max_tokens', 'path', 'bucket', 'memory_type', 'status', 'threshold', 'prefer_working', 'expand_documents']);
  rejectInputFlagConflicts(input, [['--team', 'team_id'], ['--include-knowledge', 'include_knowledge'], ['--max-tokens', 'max_tokens'], ['--max-items', 'max_items'], ['--expand-documents', 'expand_documents']], args);
  const queryArg = singlePositional(args, 'context recall');
  const query = queryArg ?? input?.query;
  if (queryArg && input?.query !== undefined) throw new UsageError('Context query cannot be supplied both positionally and in --input.');
  if (typeof query !== 'string' || !query.trim()) throw new UsageError('context recall requires a query.');
  const includeKnowledge = hasFlag(args, '--include-knowledge') ? true : optionalBooleanInput(input, 'include_knowledge');
  const body = compact({
    ...input,
    query,
    include_knowledge: includeKnowledge,
    max_tokens: optionalRange(optionValue(args, '--max-tokens') ?? input?.max_tokens, '--max-tokens', 1, 100000),
    max_items: optionalRange(optionValue(args, '--max-items') ?? input?.max_items, '--max-items', 1, 500),
    prefer_working: optionalBooleanInput(input, 'prefer_working'),
    team_id: optionValue(args, '--team') ?? input?.team_id
  });
  delete body.expand_documents;
  const response = await context.client.request({ method: 'POST', path: '/api/v1/recall/context', body, sideEffect: false, retry: 'bounded' });
  const data = response?.data ?? response;
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.memories) ? data.memories : [];
  const expandDocuments = hasFlag(args, '--expand-documents') || optionalBooleanInput(input, 'expand_documents') === true;
  await processDocumentStubs(items, {
    expandDocuments,
    client: context.client,
    teamId: optionValue(args, '--team') ?? input?.team_id
  });
  const unified = items.map((item) => unifyMemoryItem(item, { score: item.score ?? null }));
  const unifiedData = (typeof data === 'object' && data !== null) ? { ...data } : {};
  unifiedData.items = unified;
  unifiedData.memories = unified;
  for (let i = 0; i < unified.length; i += 1) {
    unifiedData[i] = unified[i];
  }
  response.data = unifiedData;
  if (includeKnowledge) {
    const knowledgeSkipped = Boolean(
      data?.knowledge_skipped ||
      data?.knowledge_items_skipped ||
      data?.coverage?.knowledge === false ||
      data?.knowledge_error ||
      data?.knowledge_status === 'skipped' ||
      (Array.isArray(data?.skipped_sources) && data.skipped_sources.includes('knowledge')) ||
      (Array.isArray(data?.warnings) && data.warnings.some((w) => /knowledge/i.test(w)))
    );
    if (knowledgeSkipped) {
      response.meta = response.meta ?? {};
      response.meta.warnings = response.meta.warnings ?? [];
      if (!response.meta.warnings.some((w) => /knowledge/i.test(w))) {
        response.meta.warnings.push('Knowledge search was skipped (requires knowledge:read scope).');
      }
    }
  }
  return response;
}

async function validateContextRecall(args, io) {
  assertKnownOptions(args, ['--include-knowledge', '--max-tokens', '--max-items', '--team', '--expand-documents', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['query', 'include_knowledge', 'team_id', 'scope', 'limit', 'max_items', 'max_tokens', 'path', 'bucket', 'memory_type', 'status', 'threshold', 'prefer_working', 'expand_documents']);
  rejectInputFlagConflicts(input, [['--team', 'team_id'], ['--include-knowledge', 'include_knowledge'], ['--max-tokens', 'max_tokens'], ['--max-items', 'max_items'], ['--expand-documents', 'expand_documents']], args);
  const queryArg = singlePositional(args, 'context recall');
  if (queryArg && input?.query !== undefined) throw new UsageError('Context query cannot be supplied both positionally and in --input.');
  const query = queryArg ?? input?.query;
  if (typeof query !== 'string' || !query.trim()) throw new UsageError('context recall requires a query.');
  optionalBooleanInput(input, 'include_knowledge');
  optionalBooleanInput(input, 'prefer_working');
  optionalBooleanInput(input, 'expand_documents');
  optionalRange(optionValue(args, '--max-tokens') ?? input?.max_tokens, '--max-tokens', 1, 100000);
  optionalRange(optionValue(args, '--max-items') ?? input?.max_items, '--max-items', 1, 500);
}

async function stateSave(args, io, context) {
  assertKnownOptions(args, ['--state-key', '--content', '--current-task', '--next-action', '--blocked-reason', '--bucket', '--scope', '--ttl-seconds', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['state_key', 'content', 'current_task', 'next_action', 'blocked_reason', 'metadata', 'source', 'bucket', 'scope', 'path', 'ttl_seconds']);
  rejectInputFlagConflicts(input, [['--state-key', 'state_key'], ['--content', 'content'], ['--current-task', 'current_task'], ['--next-action', 'next_action'], ['--blocked-reason', 'blocked_reason'], ['--bucket', 'bucket'], ['--scope', 'scope'], ['--ttl-seconds', 'ttl_seconds']], args);
  const ttl = optionValue(args, '--ttl-seconds') ?? input?.ttl_seconds;
  const body = compact({
    ...input,
    state_key: optionValue(args, '--state-key') ?? input?.state_key ?? 'active_task',
    content: optionValue(args, '--content') ?? input?.content,
    current_task: optionValue(args, '--current-task') ?? input?.current_task,
    next_action: optionValue(args, '--next-action') ?? input?.next_action,
    blocked_reason: optionValue(args, '--blocked-reason') ?? input?.blocked_reason,
    bucket: optionValue(args, '--bucket') ?? input?.bucket ?? 'work',
    scope: optionValue(args, '--scope') ?? input?.scope,
    ttl_seconds: ttl === undefined || ttl === null ? undefined : parseIntegerInRange(ttl, '--ttl-seconds', { min: 0, max: 604800 })
  });
  if (!body.content && !body.current_task && !body.next_action && !body.blocked_reason) throw new UsageError('state save requires content or a structured state field.');
  return await context.client.request({ method: 'POST', path: '/api/v1/update_state', body, sideEffect: true });
}

async function stateRestore(args, io, context) {
  assertKnownOptions(args, ['--state-key', '--bucket', '--scope', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['state_key', 'bucket', 'scope']);
  rejectInputFlagConflicts(input, [['--state-key', 'state_key'], ['--bucket', 'bucket'], ['--scope', 'scope']], args);
  const body = compact({ operation: 'state-restore', arguments: compact({
    state_key: optionValue(args, '--state-key') ?? input?.state_key ?? 'active_task',
    bucket: optionValue(args, '--bucket') ?? input?.bucket ?? 'work',
    scope: optionValue(args, '--scope') ?? input?.scope
  }) });
  return await context.client.request({ method: 'POST', path: '/api/v1/skill/operations', body, sideEffect: false, retry: 'bounded' });
}

async function validateStateSave(args, io) {
  assertKnownOptions(args, ['--state-key', '--content', '--current-task', '--next-action', '--blocked-reason', '--bucket', '--scope', '--ttl-seconds', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['state_key', 'content', 'current_task', 'next_action', 'blocked_reason', 'metadata', 'source', 'bucket', 'scope', 'path', 'ttl_seconds']);
  rejectInputFlagConflicts(input, [['--state-key', 'state_key'], ['--content', 'content'], ['--current-task', 'current_task'], ['--next-action', 'next_action'], ['--blocked-reason', 'blocked_reason'], ['--bucket', 'bucket'], ['--scope', 'scope'], ['--ttl-seconds', 'ttl_seconds']], args);
  const ttl = optionValue(args, '--ttl-seconds') ?? input?.ttl_seconds;
  if (ttl !== undefined && ttl !== null) parseIntegerInRange(ttl, '--ttl-seconds', { min: 0, max: 604800 });
  if (!(optionValue(args, '--content') ?? input?.content ?? optionValue(args, '--current-task') ?? input?.current_task ?? optionValue(args, '--next-action') ?? input?.next_action ?? optionValue(args, '--blocked-reason') ?? input?.blocked_reason)) throw new UsageError('state save requires content or a structured state field.');
}

async function validateStateRestore(args, io) {
  assertKnownOptions(args, ['--state-key', '--bucket', '--scope', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['state_key', 'bucket', 'scope']);
  rejectInputFlagConflicts(input, [['--state-key', 'state_key'], ['--bucket', 'bucket'], ['--scope', 'scope']], args);
}

async function validateRestartSnapshot(args, io) {
  assertKnownOptions(args, ['--state-key', '--bucket', '--scope', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['session_id', 'state_key', 'timeline_limit', 'reminder_limit', 'decision_limit', 'metadata', 'source', 'bucket', 'scope', 'path', 'ttl_seconds']);
  rejectInputFlagConflicts(input, [['--state-key', 'state_key'], ['--bucket', 'bucket'], ['--scope', 'scope']], args);
  optionalRange(input?.timeline_limit, 'timeline_limit', 0, 100);
  optionalRange(input?.reminder_limit, 'reminder_limit', 0, 100);
  optionalRange(input?.decision_limit, 'decision_limit', 0, 100);
  optionalRange(input?.ttl_seconds, 'ttl_seconds', 0, 604800);
}

async function restartSnapshot(args, io, context) {
  assertKnownOptions(args, ['--state-key', '--bucket', '--scope', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['session_id', 'state_key', 'timeline_limit', 'reminder_limit', 'decision_limit', 'metadata', 'source', 'bucket', 'scope', 'path', 'ttl_seconds']);
  rejectInputFlagConflicts(input, [['--state-key', 'state_key'], ['--bucket', 'bucket'], ['--scope', 'scope']], args);
  const body = compact({
    ...input,
    state_key: optionValue(args, '--state-key') ?? input?.state_key ?? 'active_task',
    bucket: optionValue(args, '--bucket') ?? input?.bucket ?? 'work',
    scope: optionValue(args, '--scope') ?? input?.scope,
    timeline_limit: optionalRange(input?.timeline_limit, 'timeline_limit', 0, 100),
    reminder_limit: optionalRange(input?.reminder_limit, 'reminder_limit', 0, 100),
    decision_limit: optionalRange(input?.decision_limit, 'decision_limit', 0, 100),
    ttl_seconds: optionalRange(input?.ttl_seconds, 'ttl_seconds', 0, 604800)
  });
  return await context.client.request({ method: 'POST', path: '/api/v1/restart/snapshot', body, sideEffect: true });
}

async function restartRestore(args, io, context) {
  assertKnownOptions(args, ['--snapshot-id', '--state-key', '--bucket', '--scope', '--preview', '--apply', '--yes', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['snapshot_id', 'source_session_id', 'target_session_id', 'state_key', 'restore_state', 'record_restore_event', 'ttl_seconds', 'source', 'bucket', 'scope']);
  rejectInputFlagConflicts(input, [['--snapshot-id', 'snapshot_id'], ['--state-key', 'state_key'], ['--bucket', 'bucket'], ['--scope', 'scope']], args);
  const preview = hasFlag(args, '--preview');
  const apply = hasFlag(args, '--apply');
  if (preview === apply) throw new UsageError('restart restore requires exactly one of --preview or --apply.');
  if (input?.restore_state !== undefined || input?.record_restore_event !== undefined) throw new UsageError('Use --preview or --apply to select restore intent; restore_state and record_restore_event are no longer accepted from --input.');
  if (apply) await confirmRemoteAction(args, io, 'Apply this restart snapshot and record the restore event?');
  const body = compact({ ...input, snapshot_id: optionValue(args, '--snapshot-id') ?? input?.snapshot_id, state_key: optionValue(args, '--state-key') ?? input?.state_key, bucket: optionValue(args, '--bucket') ?? input?.bucket, scope: optionValue(args, '--scope') ?? input?.scope, restore_state: apply, record_restore_event: apply, ttl_seconds: optionalRange(input?.ttl_seconds, 'ttl_seconds', 0, 604800) });
  if (!body.snapshot_id && !body.source_session_id && !body.state_key) throw new UsageError('restart restore requires --snapshot-id <id> or --state-key <key>.');
  return await context.client.request({ method: 'POST', path: '/api/v1/restart/restore', body, sideEffect: apply, retry: preview ? 'bounded' : 'none' });
}

async function validateRestartRestore(args, io) {
  assertKnownOptions(args, ['--snapshot-id', '--state-key', '--bucket', '--scope', '--preview', '--apply', '--yes', '--input', '--timeout-ms', '--base-url', '--url', '--allow-legacy-credential', '--json']);
  const input = await readJsonInput(args, io);
  assertNoUnknownInputFields(input, ['snapshot_id', 'source_session_id', 'target_session_id', 'state_key', 'restore_state', 'record_restore_event', 'ttl_seconds', 'source', 'bucket', 'scope']);
  rejectInputFlagConflicts(input, [['--snapshot-id', 'snapshot_id'], ['--state-key', 'state_key'], ['--bucket', 'bucket'], ['--scope', 'scope']], args);
  if (hasFlag(args, '--preview') === hasFlag(args, '--apply')) throw new UsageError('restart restore requires exactly one of --preview or --apply.');
  if (input?.restore_state !== undefined || input?.record_restore_event !== undefined) throw new UsageError('Use --preview or --apply to select restore intent; restore_state and record_restore_event are no longer accepted from --input.');
  if (!(optionValue(args, '--snapshot-id') ?? input?.snapshot_id ?? input?.source_session_id ?? optionValue(args, '--state-key') ?? input?.state_key)) {
    throw new UsageError('restart restore requires --snapshot-id <id> or --state-key <key>.');
  }
}

async function runServiceCommand(command, args, io, handler, validate = null) {
  const outputJson = hasFlag(args, '--json');
  try {
    if (validate) await validate(args, io);
    const context = await serviceContext(args, io);
    const response = await handler(args, io, context);
    const data = response?.data ?? response;
    const meta = {
      ...(response?.meta ?? {}),
      nextCursor: response?.meta?.nextCursor ?? data?.next_cursor ?? data?.nextCursor ?? null
    };
    if (outputJson) writeSuccess(io, command, data, meta);
    else writeHumanServiceResult(io, command, data, meta);
    return 0;
  } catch (error) {
    if (outputJson) writeFailure(io, command, error);
    else writeHumanServiceFailure(io, error);
    return errorToExitCode(error);
  }
}

function singlePositional(args, command) {
  const optionsWithValue = new Set(['--input', '--content', '--path', '--bucket', '--scope', '--team', '--limit', '--max-tokens', '--max-items', '--state-key', '--current-task', '--next-action', '--blocked-reason', '--ttl-seconds', '--snapshot-id', '--base-url', '--url', '--timeout-ms', '--deadline', '--keyword', '--exact', '--path-prefix', '--project', '--query', '--filter', '--type', '--offset']);
  const values = [];
  let endOfOptions = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--' && !endOfOptions) { endOfOptions = true; continue; }
    if (!endOfOptions && token.startsWith('-') && !token.startsWith('--') && token !== '-') throw new UsageError(`Unsupported short option: ${token}.`);
    if (endOfOptions || (!token.startsWith('--') && token !== '-')) values.push(token);
    if (!endOfOptions && optionsWithValue.has(token)) index += 1;
  }
  if (values.length > 1) throw new UsageError(`${command} accepts exactly one positional argument.`);
  return values[0] ?? null;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function optionalRange(value, name, min, max) {
  return value === undefined || value === null ? undefined : parseIntegerInRange(value, name, { min, max });
}
