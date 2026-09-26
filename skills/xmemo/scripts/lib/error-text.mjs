import { sanitizeSensitiveValue } from './openclaw-egress.mjs';

/**
 * Strips ANSI escape sequences and control characters from terminal text.
 *
 * @param {any} value
 * @returns {string}
 */
export function sanitizeTerminalText(value) {
  return String(value ?? '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

export function formatMemoryContent(content, compact) {
  const value = sanitizeTerminalText(content);
  const rendered = compact ? value.replace(/\s+/g, ' ').trim() : value;
  const limit = compact ? 280 : 2_000;
  return rendered.length > limit ? `${rendered.slice(0, limit)}… (truncated)` : rendered;
}

export function formatDuration(seconds) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  return `${seconds} seconds`;
}

export function extractRecord(data) {
  if (data && typeof data === 'object') {
    if (data.result && typeof data.result === 'object') return data.result;
    if (data.memory && typeof data.memory === 'object') return data.memory;
  }
  return data;
}

/**
 * Formats and sanitizes an error into descriptive, actionable text.
 * Prevents empty error output from AggregateError or network failures.
 *
 * @param {any} err
 * @returns {string}
 */
export function describeError(err) {
  if (err === null || err === undefined) {
    return 'Unknown error';
  }
  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (!trimmed) return 'Unknown error';
    return sanitizeTerminalText(sanitizeSensitiveValue(trimmed));
  }

  let code = '';
  if (typeof err.code === 'string' && err.code.trim()) {
    code = err.code.trim();
  }

  let baseText = '';
  const msg = typeof err.message === 'string' ? err.message.trim() : '';

  if (msg) {
    baseText = msg;
  } else if (Array.isArray(err.errors) && err.errors.length > 0) {
    const parts = err.errors.map((inner) => {
      if (!inner) return '';
      if (typeof inner === 'string') return inner.trim();
      const innerMsg = typeof inner.message === 'string' ? inner.message.trim() : '';
      const innerCode = typeof inner.code === 'string' ? inner.code.trim() : '';
      if (!code && innerCode) code = innerCode;
      if (innerMsg) {
        if (innerCode && !innerMsg.toLowerCase().includes(innerCode.toLowerCase())) {
          return `${innerMsg} (${innerCode})`;
        }
        return innerMsg;
      }
      if (innerCode) return innerCode;
      if (typeof inner.name === 'string' && inner.name.trim() && inner.name !== 'Error') {
        return inner.name.trim();
      }
      return '';
    }).filter(Boolean);

    const uniqueParts = [...new Set(parts)];
    if (uniqueParts.length > 0) {
      baseText = uniqueParts.join(', ');
    }
  }

  if (!baseText && code) {
    baseText = code;
  }
  if (!baseText && typeof err.name === 'string' && err.name.trim() && err.name !== 'Error') {
    baseText = err.name.trim();
  }
  if (!baseText) {
    baseText = 'Unknown error';
  }

  if (code && !baseText.toLowerCase().includes(code.toLowerCase())) {
    baseText = `${baseText} (${code})`;
  }

  return sanitizeTerminalText(sanitizeSensitiveValue(baseText));
}
