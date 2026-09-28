import {
  makeHttpRequest,
  parseJsonResponse,
  extractList,
  safeJson,
} from './api.mjs';

export const MAX_EXPAND_DOCUMENTS = 3;
export const MAX_EXPAND_CHARS = 20000;

/**
 * Safely outputs JSON to stdout and drains the stream before exiting.
 * Prevents truncated JSON output when writing to pipes on macOS / POSIX.
 *
 * @param {any} data
 * @param {number} [exitCode=0]
 */
export function flushJsonAndExit(data, exitCode = 0) {
  const flushed = process.stdout.write(safeJson(data) + '\n', () => {
    process.exit(exitCode);
  });
  if (!flushed) {
    const timer = setTimeout(() => process.exit(exitCode), 1000);
    if (timer.unref) timer.unref();
  }
}

/**
 * Determines whether a memory item is a document-backed memory stub.
 * Checks for metadata.document_ref or "Document-backed memory:" content prefix.
 *
 * @param {any} item
 * @returns {boolean}
 */
export function isDocumentStub(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.metadata) {
    if (typeof item.metadata === 'object' && item.metadata.document_ref) {
      return true;
    }
    if (typeof item.metadata === 'string') {
      try {
        const parsed = JSON.parse(item.metadata);
        if (parsed && typeof parsed === 'object' && parsed.document_ref) {
          return true;
        }
      } catch {}
    }
  }
  const content = typeof item.content === 'string' ? item.content : '';
  return content.startsWith('Document-backed memory:');
}

/**
 * Formats the next command to read the full document text.
 *
 * @param {any} item
 * @returns {string}
 */
export function buildNextCommand(item) {
  const id = item?.id || item?.memory_id || '';
  return `node scripts/xmemo-skill.mjs read --id ${id}`;
}

/**
 * Augments memory items with document-stub guidance and handles --expand-documents.
 *
 * @param {any} rawItems
 * @param {object} context
 * @returns {Promise<void>}
 */
export async function processDocumentStubs(rawItems, { expandDocuments, baseUrl, token, timeoutMs, flags } = {}) {
  const items = extractList(rawItems);
  if (!Array.isArray(items) || items.length === 0) return;

  for (const item of items) {
    if (isDocumentStub(item)) {
      item.document_backed = true;
      item.next_command = buildNextCommand(item);
    }
  }

  if (!expandDocuments || !token || !baseUrl) return;

  const stubs = items.filter(isDocumentStub).slice(0, MAX_EXPAND_DOCUMENTS);
  for (const stub of stubs) {
    const id = stub.id || stub.memory_id;
    if (!id) continue;

    const queryParams = [
      flags?.bucket ? `bucket=${encodeURIComponent(flags.bucket)}` : null,
      flags?.scope ? `scope=${encodeURIComponent(flags.scope)}` : null,
    ].filter(Boolean);
    const endpoint = `/v1/memories/${encodeURIComponent(id)}/explain?include_embedding=false${queryParams.length ? `&${queryParams.join('&')}` : ''}`;

    try {
      const res = await makeHttpRequest(baseUrl, endpoint, 'GET', null, {
        Authorization: `Bearer ${token}`,
      }, timeoutMs);

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const data = parseJsonResponse(res, 'Expand document request');
        const record = (data && typeof data === 'object' && (data.memory || data.record || data.result)) || data;
        if (record && typeof record.content === 'string') {
          const fullText = record.content;
          stub.expanded = true;
          if (fullText.length > MAX_EXPAND_CHARS) {
            stub.content = fullText.slice(0, MAX_EXPAND_CHARS);
            stub.content_truncated = true;
            stub.next_command = buildNextCommand(stub);
          } else {
            stub.content = fullText;
            delete stub.next_command;
          }
        } else {
          stub.expand_error = 'invalid_response';
        }
      } else {
        let errData = null;
        try { errData = parseJsonResponse(res, 'Expand document request'); } catch {}
        const code = errData?.error?.code || (res.statusCode === 404 ? 'not_found' : `HTTP_${res.statusCode}`);
        stub.expand_error = code;
      }
    } catch (e) {
      stub.expand_error = e.code || 'network_error';
    }
  }
}
