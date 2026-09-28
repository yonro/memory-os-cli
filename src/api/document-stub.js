export const MAX_EXPAND_DOCUMENTS = 3;
export const MAX_EXPAND_CHARS = 20000;

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

export function buildNextCommand(item) {
  const id = item?.id || item?.memory_id || '';
  return `xmemo memory read ${id}`;
}

export async function processDocumentStubs(items, { expandDocuments, client, teamId } = {}) {
  if (!Array.isArray(items) || items.length === 0) return;

  for (const item of items) {
    if (isDocumentStub(item)) {
      item.document_backed = true;
      item.next_command = buildNextCommand(item);
    }
  }

  if (!expandDocuments || !client) return;

  const stubs = items.filter(isDocumentStub).slice(0, MAX_EXPAND_DOCUMENTS);
  for (const stub of stubs) {
    const id = stub.id || stub.memory_id;
    if (!id) continue;

    try {
      const response = await client.request({
        method: 'GET',
        path: `/api/v1/memories/${encodeURIComponent(id)}/explain`,
        query: teamId ? { team_id: teamId } : {},
        sideEffect: false,
        retry: 'bounded'
      });
      const data = response?.data ?? response;
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
    } catch (e) {
      stub.expand_error = e.code || e.serviceCode || (e.httpStatus ? `HTTP_${e.httpStatus}` : 'network_error');
    }
  }
}
