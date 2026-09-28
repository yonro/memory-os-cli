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

export function buildServerPrefixVariants(inputPrefix) {
  if (typeof inputPrefix !== 'string' || !inputPrefix.trim()) return [];
  const variants = [];
  const seen = new Set();

  function add(val) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length > 0 && !seen.has(trimmed)) {
        seen.add(trimmed);
        variants.push(trimmed);
      }
    }
  }

  const startsWithRoot = /^\[root\]\s*\/?\s*/iu.test(inputPrefix.trim());

  // Cleaned: leading/trailing slashes removed, spaces around slashes collapsed, consecutive slashes collapsed
  const cleaned = inputPrefix.trim().replace(/^\/+|\/+$/gu, '').replace(/\s*\/\s*/gu, '/').replace(/\/+/gu, '/');
  const cleanedWithoutRoot = cleaned.replace(/^\[root\]\s*\/?\s*/iu, '').replace(/^\/+|\/+$/gu, '');

  if (cleanedWithoutRoot) {
    if (startsWithRoot) {
      add(`[ROOT]/${cleanedWithoutRoot}`);
      add(cleanedWithoutRoot);
    } else {
      add(cleanedWithoutRoot);
      add(`[ROOT]/${cleanedWithoutRoot}`);
    }
  }

  // Verbatim stripped (preserves spaces around slashes if any)
  const verbatimStripped = inputPrefix.trim().replace(/^\/+|\/+$/gu, '');
  const verbatimWithoutRoot = verbatimStripped.replace(/^\[root\]\s*\/?\s*/iu, '').replace(/^\/+|\/+$/gu, '');
  if (verbatimWithoutRoot) {
    if (startsWithRoot) {
      add(`[ROOT]/${verbatimWithoutRoot}`);
      add(verbatimWithoutRoot);
    } else {
      add(verbatimWithoutRoot);
      add(`[ROOT]/${verbatimWithoutRoot}`);
    }
  }

  // Verbatim as typed
  add(inputPrefix.trim());

  return variants;
}

export function unifyMemoryItem(item, { score = null } = {}) {
  if (!item || typeof item !== 'object') return item;
  const existingId = item.id;
  const existingMemoryId = item.memory_id;

  let metadataMemoryId = null;
  if (item.metadata && typeof item.metadata === 'object') {
    metadataMemoryId = item.metadata.memory_id ?? null;
  } else if (typeof item.metadata === 'string') {
    try {
      const parsed = JSON.parse(item.metadata);
      if (parsed && typeof parsed === 'object') metadataMemoryId = parsed.memory_id ?? null;
    } catch {}
  }

  // Canonical memory reference:
  // Use memory_id if explicitly provided in item or metadata.
  // For list/record items without a verified memory_id, set memory_id to null
  // so that item.id is not conflated with memory_id.
  const memoryId = existingMemoryId ?? metadataMemoryId ?? null;
  const id = existingId ?? memoryId ?? null;

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
