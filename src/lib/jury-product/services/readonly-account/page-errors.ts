/**
 * I-098: sanitized client error messages (pageerror / console.error) for error-screen diagnosis.
 * At most PAGE_ERROR_LIMIT per page, each ≤ PAGE_ERROR_MAX_CHARS. URL queries/fragments, emails, digit runs and
 * token-like strings are masked; never stores page text, request bodies or headers.
 */
export const PAGE_ERROR_LIMIT = 3;
export const PAGE_ERROR_MAX_CHARS = 160;

export function sanitizeErrorMessage(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  s = s.split(/\r?\n/)[0] ?? '';
  s = s
    // URL query string / fragment
    .replace(/(https?:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, '$1?…')
    // emails
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    // JWT-like / long token-like strings (letters+digits mixed, ≥ 20 chars)
    .replace(/\beyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '[token]')
    .replace(/\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b/g, '[token]')
    // digit runs (ids, phone numbers, line numbers)
    .replace(/\d{4,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > PAGE_ERROR_MAX_CHARS ? `${s.slice(0, PAGE_ERROR_MAX_CHARS - 1)}…` : s;
}

/** Adds a sanitized message unless empty, duplicate or over the limit. Mutates and returns `list`. */
export function pushPageError(list: string[], raw: unknown): string[] {
  if (list.length >= PAGE_ERROR_LIMIT) return list;
  const m = sanitizeErrorMessage(raw);
  if (m && !list.includes(m)) list.push(m);
  return list;
}

/** Read-side guard for stored JSON (old rows have no errors). */
export function parsePageErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) if (typeof r === 'string') pushPageError(out, r);
  return out;
}
