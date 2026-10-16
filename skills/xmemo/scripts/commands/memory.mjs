import { EXIT_CODE, exitCodeForHttpStatus, exitCodeForErrorCode, exitCodeForError } from '../lib/core.mjs';
import { printMemoryResults } from '../lib/auth-state.mjs';
import { processDocumentStubs, flushJsonAndExit } from '../lib/document-stub.mjs';
import {
  makeHttpRequest, parseJsonResponse, extractRequestId, extractId,
  apiErrorMessage, outputRestError, handleRestError, outputJsonFailure,
  safeJson, sanitizeTerminalText, formatMemoryContent, describeError, extractRecord,
} from '../lib/api.mjs';
import { printAuthErrorHint } from '../lib/auth-hint.mjs';

const RECALL_SEARCH_TIME_FILTER_KEYS = ['since', 'until', 'time_order', 'owner_timezone', 'reference_time'];
const RECALL_SEARCH_QUERY_KEYS = [
  'query', 'limit', 'threshold', 'path', 'bucket', 'scope', 'team_id', 'memory_type', 'explain',
  'prefer_working', ...RECALL_SEARCH_TIME_FILTER_KEYS,
];

function reqSuffix(data) {
  const reqId = extractRequestId(data);
  return reqId ? ` (request_id: ${reqId})` : '';
}

function failRequest(data, statusCode, prefix, options) {
  console.error(`${prefix}${reqSuffix(data)}`);
  const exitCode = exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(statusCode);
  if (exitCode === EXIT_CODE.AUTH_ERROR && (!options || !options.json)) {
    printAuthErrorHint(options?.credential);
  }
  process.exit(exitCode);
}

function failRelationshipsRequest(data, statusCode, options) {
  const knownErrors = {
    NotFound: {
      code: 'not_found',
      message: 'Memory was not found or is not visible. Ensure --id is the logical memory_id (the memory_id field from recall/search --json, not the row id).',
      exitCode: EXIT_CODE.USER_ERROR,
    },
    InvalidArgument: {
      code: 'invalid_argument',
      message: 'The relationship request was invalid.',
      exitCode: EXIT_CODE.USER_ERROR,
    },
    Unavailable: {
      code: 'service_unavailable',
      message: 'Memory relationship service is unavailable.',
      exitCode: EXIT_CODE.SERVER_ERROR,
    },
  };
  const known = knownErrors[data?.detail?.code];
  const fallbackCode = statusCode === 404 ? 'not_found'
    : statusCode === 422 ? 'invalid_argument'
      : `HTTP ${statusCode}`;
  const code = known?.code || data?.error?.code || fallbackCode;
  const message = known?.message || apiErrorMessage(data, `Relationships request failed (HTTP ${statusCode}).`);
  const fallbackExitCode = statusCode >= 400
    ? exitCodeForHttpStatus(statusCode)
    : (exitCodeForErrorCode(data?.error?.code) ?? EXIT_CODE.USER_ERROR);
  outputRestError(code, message, options, data, known?.exitCode ?? fallbackExitCode);
}

function printRelationships(data, memoryId) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) {
    console.log('No memory relationships found.');
  } else {
    const rootId = String(memoryId).toLowerCase();
    for (const item of items) {
      const fromId = typeof item?.from_memory_id === 'string' ? item.from_memory_id : '';
      const toId = typeof item?.to_memory_id === 'string' ? item.to_memory_id : '';
      const targetId = fromId.toLowerCase() === rootId ? toId
        : toId.toLowerCase() === rootId ? fromId : '';
      const edgeKind = sanitizeTerminalText(String(item?.edge_kind || '(unknown)'));
      const target = sanitizeTerminalText(targetId || '(unknown)');
      const version = sanitizeTerminalText(item?.version === undefined || item?.version === null
        ? '(unknown)' : String(item.version));
      console.log(`- ${edgeKind} | target: ${target} | version: ${version}`);
    }
  }

  if (typeof data?.next_cursor === 'string' && data.next_cursor) {
    console.log(`Next cursor: ${sanitizeTerminalText(data.next_cursor)}`);
  }
}

export async function handleMemory(ctx) {
  const { command, options, flags, token } = ctx;

  if (command === 'restart-snapshot' || command === 'restart-restore') {
    const endpoint = command === 'restart-snapshot' ? '/v1/restart/snapshot' : '/v1/restart/restore';
    const label = command === 'restart-snapshot' ? 'Restart snapshot' : 'Restart restore';
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', flags, { Authorization: `Bearer ${token}` }, options.timeoutMs);
      const data = parseJsonResponse(res, `${label} request`);
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      if (options.json) {
        if (succeeded) {
          const payload = (data && typeof data === 'object') ? data : { result: data };
          console.log(safeJson({ ok: true, ...payload }));
          process.exit(EXIT_CODE.SUCCESS);
        }
        outputJsonFailure(data, res.statusCode);
      }
      if (!succeeded) {
        failRequest(data, res.statusCode, `${label} failed: ${apiErrorMessage(data)} (HTTP ${res.statusCode})`, options);
      }
      if (command === 'restart-snapshot') {
        console.log(`✅ Restart snapshot saved.\nID: ${sanitizeTerminalText(extractId(data))}${data.expires_at ? `\nExpires: ${sanitizeTerminalText(data.expires_at)}` : ''}`);
      } else {
        const isNotRestored = data.restored === false || data.status === 'not_found' || (!extractId(data) && !data.restored_at);
        if (isNotRestored) {
          console.log('ℹ️ No active restart snapshot found to restore.');
        } else {
          console.log(`✅ Restart snapshot restored.\nID: ${sanitizeTerminalText(extractId(data))}${data.restored_at ? `\nRestored: ${sanitizeTerminalText(data.restored_at)}` : ''}`);
        }
      }
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error(`${label} failed:`, describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'recall-context') {
    const body = Object.fromEntries(
      Object.entries({
        query: flags.query,
        path: flags.path || '%',
        bucket: flags.bucket || '%',
        scope: flags.scope,
        team_id: flags.team_id,
        memory_type: flags.memory_type || 'auto',
        status: flags.status || 'active',
        threshold: flags.threshold === undefined ? undefined : Number(flags.threshold),
        max_items: flags.max_items,
        max_tokens: flags.max_tokens,
        limit: flags.limit,
        prefer_working: flags.prefer_working === undefined ? true : flags.prefer_working,
        include_knowledge: flags.include_knowledge,
        since: flags.since,
        until: flags.until,
        time_order: flags.time_order,
        owner_timezone: flags.owner_timezone,
        reference_time: flags.reference_time,
        hypothetical_answer: flags.hypothetical_answer,
      }).filter(([, v]) => v !== undefined)
    );
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/recall/context', 'POST', body, { Authorization: `Bearer ${token}` }, options.timeoutMs);
      const data = parseJsonResponse(res, 'Recall context request');
      const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
      if (options.json) {
        console.log(safeJson(data));
        process.exit(succeeded ? EXIT_CODE.SUCCESS : (exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode)));
      }
      if (!succeeded) {
        failRequest(data, res.statusCode, `Error: ${apiErrorMessage(data)} (Code: ${data.error?.code || `HTTP ${res.statusCode}`})`, options);
      }
      const items = Array.isArray(data.items) ? data.items.length : 0;
      const contextText = sanitizeTerminalText(data.context_text || '');
      console.log(`XMemo Context: ${items} item${items === 1 ? '' : 's'}\n${contextText || 'No matching memories found.'}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Recall context failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'read') {
    const queryParams = [
      flags.bucket ? `bucket=${encodeURIComponent(flags.bucket)}` : null,
      flags.scope ? `scope=${encodeURIComponent(flags.scope)}` : null,
    ].filter(Boolean);
    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/explain?include_embedding=false${queryParams.length ? `&${queryParams.join('&')}` : ''}`;
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, { Authorization: `Bearer ${token}` }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found.`,
        context: 'Read memory request',
        options,
      });

      const record = extractRecord(data);
      if (record && record.status && String(record.status).toLowerCase() === 'deleted') {
        outputRestError('not_found', `Memory '${flags.id}' not found or deleted.`, options);
      }

      if (!record || typeof record.content !== 'string') {
        outputRestError('not_found', `Memory '${flags.id}' not found.`, options);
      }

      const fullContent = record.content;
      const totalLength = fullContent.length;
      const offset = flags.offset !== undefined ? Number(flags.offset) : 0;
      const hasLimit = flags.limit !== undefined && flags.limit !== null;
      const limit = hasLimit ? Number(flags.limit) : totalLength;
      const slicedContent = fullContent.slice(offset, offset + limit);
      const truncated = offset > 0 || (offset + slicedContent.length < totalLength);

      const projected = {
        id: record.id || record.memory_id || flags.id,
        path: record.path || record.canonical_path || '',
        content: slicedContent,
        version: record.version || record.updated_at || record.created_at || null,
        truncated,
      };

      if (options.json) {
        console.log(safeJson({ ok: true, ...projected }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(`Memory: ${sanitizeTerminalText(projected.id)} | Path: ${sanitizeTerminalText(projected.path || '(unknown)')} | Version: ${sanitizeTerminalText(projected.version || '(unknown)')}${projected.truncated ? ' [truncated]' : ''}`);
      console.log(`Content: ${formatMemoryContent(projected.content, options.compact)}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Read memory failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'relationships') {
    const params = new URLSearchParams();
    if (flags.limit !== undefined) params.set('limit', String(flags.limit));
    if (flags.cursor !== undefined) params.set('cursor', String(flags.cursor));
    const query = params.toString();
    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/relationships${query ? `?${query}` : ''}`;
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, { Authorization: `Bearer ${token}` }, options.timeoutMs);
      const data = parseJsonResponse(res, 'Memory relationships request');
      const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
      if (!succeeded) failRelationshipsRequest(data, res.statusCode, options);

      if (options.json) return flushJsonAndExit(data, EXIT_CODE.SUCCESS);
      printRelationships(data, flags.id);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Memory relationships request failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'update') {
    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}`;
    const body = {};
    for (const k of ['content', 'path', 'metadata', 'bucket', 'scope']) {
      if (flags[k] !== undefined) body[k] = flags[k];
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'PATCH', body, { Authorization: `Bearer ${token}` }, options.timeoutMs);

      if (res.statusCode === 400) {
        let errData = null;
        try { errData = parseJsonResponse(res, 'Update memory request'); } catch {}
        const code = errData?.error?.code || 'invalid_request';
        const fallbackMsg = code === 'invalid_memory_id'
          ? `Invalid memory ID: '${flags.id}'.`
          : 'Invalid update request.';
        const msg = apiErrorMessage(errData, fallbackMsg);
        outputRestError(code, msg, options, errData, EXIT_CODE.USER_ERROR);
      }

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found.`,
        context: 'Update memory request',
        options,
      });

      const record = extractRecord(data);
      const memoryId = record?.id || record?.memory_id || flags.id;
      if (options.json) {
        console.log(safeJson({
          ok: true,
          id: memoryId,
          path: record?.path || flags.path || '',
          updated: true,
          ...(typeof record === 'object' ? record : {}),
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(`✅ Memory updated.\nID: ${sanitizeTerminalText(memoryId)}${flags.path ? `\nPath: ${sanitizeTerminalText(flags.path)}` : ''}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Update memory failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'forget') {
    if (!flags.confirm) {
      const msg = `Confirmation required to forget memory or ledger record '${flags.id}'. Pass --confirm to proceed.`;
      if (options.json) {
        console.log(safeJson({ ok: false, error: { code: 'confirmation_required', message: msg, target_id: flags.id } }));
      } else {
        console.error(`Error: ${msg}\nTarget: ${sanitizeTerminalText(flags.id)}`);
      }
      process.exit(EXIT_CODE.USER_ERROR);
    }

    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/forget`;
    const body = { mode: 'soft_delete' };
    if (flags.reason !== undefined && String(flags.reason).trim() !== '') {
      body.reason = String(flags.reason);
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', body, { Authorization: `Bearer ${token}` }, options.timeoutMs);

      handleRestError(res, {
        notFoundMessage: `Record '${flags.id}' not found.`,
        context: 'Forget request',
        options,
      });

      if (options.json) {
        console.log(safeJson({ ok: true, id: flags.id, mode: 'soft_delete', forgotten: true }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      console.log(`✅ Record forgotten (soft-deleted).\nID: ${sanitizeTerminalText(flags.id)}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Forget failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'restore') {
    if (!flags.confirm) {
      const msg = `Confirmation required to restore memory '${flags.id}'. Pass --confirm to proceed.`;
      if (options.json) {
        console.log(safeJson({ ok: false, error: { code: 'confirmation_required', message: msg, target_id: flags.id } }));
      } else {
        console.error(`Error: ${msg}\nTarget: ${sanitizeTerminalText(flags.id)}`);
      }
      process.exit(EXIT_CODE.USER_ERROR);
    }

    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}/restore`;
    const body = {};
    if (flags.reason !== undefined && String(flags.reason).trim() !== '') {
      body.reason = String(flags.reason).trim();
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', body, { Authorization: `Bearer ${token}` }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: `Memory '${flags.id}' not found or not deleted/visible.`,
        context: 'Restore request',
        options,
      });

      if (options.json) {
        return flushJsonAndExit(data, EXIT_CODE.SUCCESS);
      }

      console.log(`✅ Memory restored: ${sanitizeTerminalText(flags.id)}`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Restore failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'remember' || command === 'recall' || command === 'search') {
    try {
      const useFilteredReadEndpoint = command !== 'remember'
        && RECALL_SEARCH_TIME_FILTER_KEYS.some((key) => flags[key] !== undefined);
      let endpoint = '/v1/skill/operations';
      let method = 'POST';
      let body = { operation: command, arguments: flags };
      if (useFilteredReadEndpoint) {
        const params = new URLSearchParams();
        for (const key of RECALL_SEARCH_QUERY_KEYS) {
          if (flags[key] !== undefined) params.set(key, String(flags[key]));
        }
        endpoint = `${command === 'search' ? '/v1/memories/search' : '/v1/recall'}?${params}`;
        method = 'GET';
        body = null;
      }
      const res = await makeHttpRequest(options.baseUrl, endpoint, method, body, { Authorization: `Bearer ${token}` }, options.timeoutMs);

      const data = parseJsonResponse(res, `${command} request`);
      const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
      const result = useFilteredReadEndpoint ? (data.result || data) : data.result;
      if (succeeded && (command === 'recall' || command === 'search')) {
        await processDocumentStubs(data.result || data, {
          expandDocuments: flags['expand-documents'] || flags.expand_documents,
          baseUrl: options.baseUrl, token, timeoutMs: options.timeoutMs, flags,
        });
      }
      if (options.json) {
        return flushJsonAndExit(data, succeeded ? EXIT_CODE.SUCCESS : (exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode)));
      }

      if (!succeeded) {
        failRequest(data, res.statusCode, `Error: ${apiErrorMessage(data)} (Code: ${data.error?.code || `HTTP ${res.statusCode}`})`, options);
      }

      if (command === 'recall' || command === 'search') {
        printMemoryResults(result, options.compact);
        process.exit(EXIT_CODE.SUCCESS);
      } else if (command === 'remember') {
        console.log(`✅ Saved to XMemo.\nID: ${sanitizeTerminalText(extractId(data.result))}`);
        process.exit(EXIT_CODE.SUCCESS);
      }
    } catch (e) {
      console.error('Request failed:', describeError(e));
      process.exit(exitCodeForError(e));
    }
  }
}
