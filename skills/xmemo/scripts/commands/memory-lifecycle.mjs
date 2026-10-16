import { EXIT_CODE, exitCodeForHttpStatus, exitCodeForErrorCode, exitCodeForError } from '../lib/core.mjs';
import { flushJsonAndExit } from '../lib/document-stub.mjs';
import {
  makeHttpRequest, parseJsonResponse, apiErrorMessage, outputRestError,
  handleRestError, safeJson, sanitizeTerminalText, describeError,
} from '../lib/api.mjs';

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

export async function handleMemoryLifecycle(ctx) {
  const { command, options, flags, token } = ctx;

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

      if (res.statusCode === 404) {
        let errData = null;
        try { errData = parseJsonResponse(res, 'Restore request'); } catch {}
        const code = 'not_found';
        const msg = `Memory '${flags.id}' not found or not deleted/visible.`;
        outputRestError(code, msg, options, errData, EXIT_CODE.USER_ERROR);
      }

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

}
