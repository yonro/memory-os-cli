import {
  EXIT_CODE,
  exitCodeForHttpStatus,
  exitCodeForErrorCode,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  printMemoryResults,
} from '../lib/auth-state.mjs';

import {
  makeHttpRequest,
  parseJsonResponse,
  extractRequestId,
  extractId,
  apiErrorMessage,
  outputRestError,
  handleRestError,
  outputJsonFailure,
  safeJson,
  sanitizeTerminalText,
  formatMemoryContent,
  describeError,
  extractRecord,
} from '../lib/api.mjs';

import {
  printAuthErrorHint,
} from '../lib/auth-hint.mjs';

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

export async function handleMemory(ctx) {
  const { command, options, flags, token } = ctx;

  if (command === 'restart-snapshot' || command === 'restart-restore') {
    const endpoint = command === 'restart-snapshot' ? '/v1/restart/snapshot' : '/v1/restart/restore';
    const label = command === 'restart-snapshot' ? 'Restart snapshot' : 'Restart restore';
    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', flags, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
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
      }).filter(([, v]) => v !== undefined)
    );
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/recall/context', 'POST', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);
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
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'GET', null, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

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

  if (command === 'update') {
    const endpoint = `/v1/memories/${encodeURIComponent(flags.id)}`;
    const body = {};
    for (const k of ['content', 'path', 'metadata', 'bucket', 'scope']) {
      if (flags[k] !== undefined) body[k] = flags[k];
    }

    try {
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'PATCH', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

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
      const res = await makeHttpRequest(options.baseUrl, endpoint, 'POST', body, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

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

  if (command === 'remember' || command === 'recall' || command === 'search') {
    try {
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: command,
        arguments: flags,
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = parseJsonResponse(res, `${command} request`);
      const succeeded = res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false;
      if (options.json) {
        console.log(safeJson(data));
        process.exit(succeeded ? EXIT_CODE.SUCCESS : (exitCodeForErrorCode(data?.error?.code) ?? exitCodeForHttpStatus(res.statusCode)));
      }

      if (!succeeded) {
        failRequest(data, res.statusCode, `Error: ${apiErrorMessage(data)} (Code: ${data.error?.code || `HTTP ${res.statusCode}`})`, options);
      }

      if (command === 'recall' || command === 'search') {
        printMemoryResults(data.result, options.compact);
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
