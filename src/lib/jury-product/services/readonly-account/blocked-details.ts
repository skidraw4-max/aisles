/**
 * I-096: per-request detail for requests the read-only guard blocked. Stored inside the existing
 * JuryReadonlyObservationRun.blockedByReason JSON column under `details` (no schema change).
 * Only origin + path (query/fragment stripped, PII-looking path segments masked), method, reason, the page path
 * that was open, and a timestamp. Never headers, bodies, cookies or query strings. Capped at BLOCKED_DETAILS_CAP.
 */
export const BLOCKED_DETAILS_CAP = 50;
export type BlockedReason = 'ORIGIN' | 'METHOD' | 'FORM_SUBMIT' | 'LOGIN_ALREADY_USED';
export type BlockedDetail = { origin: string; path: string; method: string; reason: BlockedReason; page: string | null; at: string };

const REASONS = new Set<string>(['ORIGIN', 'METHOD', 'FORM_SUBMIT', 'LOGIN_ALREADY_USED']);

/** Masks path segments that look like emails, phone numbers or long tokens; caps length. */
export function safePath(pathname: string): string {
  const p = (pathname || '/')
    .split('/')
    .map((seg) => {
      let s = seg;
      try {
        s = decodeURIComponent(seg);
      } catch {
        /* keep raw */
      }
      if (s.includes('@') || /\d{6,}/.test(s) || /^[A-Za-z0-9_-]{32,}$/.test(s) || /^eyJ/.test(s)) return ':masked';
      return seg;
    })
    .join('/');
  return (p.startsWith('/') ? p : `/${p}`).slice(0, 200);
}

export function toBlockedDetail(b: { method: string; url: string; reason: BlockedReason; page?: string | null; at?: number }): BlockedDetail {
  let origin = 'invalid';
  let path = '';
  try {
    const u = new URL(b.url);
    origin = u.origin === 'null' ? u.protocol : u.origin;
    path = u.origin === 'null' ? '' : safePath(u.pathname);
  } catch {
    /* invalid url → no path */
  }
  return {
    origin: origin.slice(0, 200),
    path,
    method: String(b.method || '').toUpperCase().slice(0, 10),
    reason: b.reason,
    page: b.page ? safePath(b.page) : null,
    at: new Date(typeof b.at === 'number' && Number.isFinite(b.at) ? b.at : Date.now()).toISOString(),
  };
}

export function toBlockedDetails(list: readonly Parameters<typeof toBlockedDetail>[0][], cap = BLOCKED_DETAILS_CAP): BlockedDetail[] {
  return list.slice(0, cap).map(toBlockedDetail);
}

/** Reads `details` back from the JSON column; tolerant of old rows (returns []). */
export function parseBlockedDetails(raw: unknown): BlockedDetail[] {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (!Array.isArray(b.details)) return [];
  const out: BlockedDetail[] = [];
  for (const d of b.details.slice(0, BLOCKED_DETAILS_CAP)) {
    if (!d || typeof d !== 'object') continue;
    const r = d as Record<string, unknown>;
    if (typeof r.origin !== 'string' || typeof r.method !== 'string' || typeof r.reason !== 'string' || !REASONS.has(r.reason)) continue;
    if (!/^(https?:\/\/[a-z0-9.:-]{1,200}|[a-z-]{1,20}:|invalid)$/i.test(r.origin)) continue;
    const at = typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : null;
    if (!at) continue;
    out.push({
      origin: r.origin,
      path: typeof r.path === 'string' ? safePath(r.path.split(/[?#]/)[0] || '/') : '',
      method: r.method.toUpperCase().slice(0, 10),
      reason: r.reason as BlockedReason,
      page: typeof r.page === 'string' ? safePath(r.page.split(/[?#]/)[0] || '/') : null,
      at,
    });
  }
  return out;
}
