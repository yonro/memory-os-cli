export function normalizeMemoryPath(rawPath) {
  if (typeof rawPath !== 'string') return '';
  let p = rawPath.trim();
  // Strip leading [ROOT]/ or [root]/ (with optional spaces around /)
  p = p.replace(/^\[root\]\s*\/?\s*/iu, '');
  // Collapse spaces around '/'
  p = p.replace(/\s*\/\s*/gu, '/');
  // Collapse multiple consecutive slashes
  p = p.replace(/\/+/gu, '/');
  // Strip leading and trailing slashes
  p = p.replace(/^\/+|\/+$/gu, '');
  // Lowercase for comparison
  return p.toLowerCase();
}

export function matchesPathPrefix(itemPath, inputPrefix, exact = false) {
  if (typeof itemPath !== 'string') return false;
  if (!inputPrefix) return true;
  if (exact) return itemPath.startsWith(inputPrefix);
  const normItem = normalizeMemoryPath(itemPath);
  const normPrefix = normalizeMemoryPath(inputPrefix);
  return normItem.startsWith(normPrefix);
}

export function unifyMemoryItem(item, { score = null } = {}) {
  if (!item || typeof item !== 'object') return item;
  const existingId = item.id;
  const existingMemoryId = item.memory_id;

  // Stable memory reference:
  // If memory_id exists, use it. If not, fallback to existingId.
  const memoryId = existingMemoryId ?? existingId ?? null;
  // Existing id must not be overwritten with a different meaning.
  // If id is missing, set it to memoryId.
  const id = existingId ?? memoryId;

  return {
    ...item,
    id,
    memory_id: memoryId,
    path: item.path ?? item.memory_path ?? null,
    content: typeof item.content === 'string' ? item.content : '',
    created_at: item.created_at ?? item.createdAt ?? null,
    score
  };
}

export function rerankSearchResults(items, { keyword = null, exact = null } = {}) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  const exactPhrase = typeof exact === 'string' && exact.trim() ? exact.trim().toLowerCase() : null;
  const keywords = typeof keyword === 'string' && keyword.trim()
    ? keyword.toLowerCase().split(/[\s,]+/).filter(Boolean)
    : [];

  if (!exactPhrase && keywords.length === 0) return items;

  const scored = items.map((item, originalIndex) => {
    const text = `${item.content || ''} ${item.path || item.memory_path || ''}`.toLowerCase();
    const exactMatch = exactPhrase ? text.includes(exactPhrase) : false;
    let keywordCount = 0;
    if (keywords.length > 0) {
      for (const kw of keywords) {
        if (text.includes(kw)) keywordCount += 1;
      }
    }
    return { item, originalIndex, exactMatch, keywordCount };
  });

  scored.sort((a, b) => {
    // 1. Exact phrase matches first
    if (a.exactMatch !== b.exactMatch) {
      return a.exactMatch ? -1 : 1;
    }
    // 2. Keyword hits count next
    if (a.keywordCount !== b.keywordCount) {
      return b.keywordCount - a.keywordCount;
    }
    // 3. Stable original order
    return a.originalIndex - b.originalIndex;
  });

  return scored.map((s) => s.item);
}
