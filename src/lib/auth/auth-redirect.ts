/**
 * Auth redirect helpers (pure, client/server-safe).
 */

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Same-origin relative path: one leading '/', no '//' or backslash, no control chars. */
export function isSafeRelativePath(raw: string | null | undefined): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  if (raw.includes('\\') || CONTROL.test(raw)) return false;
  return true;
}

export function safeRelativePath(raw: string | null | undefined, fallback = '/'): string {
  return isSafeRelativePath(raw) ? raw : fallback;
}

/** Production hosts that may receive auth callbacks / email links (hub + Jury). */
const PRODUCTION_AUTH_HOSTS: ReadonlySet<string> = new Set(['www.aisleshub.com', 'jury.aisleshub.com']);
/** This team's Vercel deployment hosts (single DNS label). */
const TEAM_PREVIEW_HOST = /^[a-z0-9-]+-skidraw4-maxs-projects\.vercel\.app$/;
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/**
 * Exact origin allowlist for auth redirects: https on www/jury.aisleshub.com or this team's
 * *.vercel.app deployments (no port, no credentials), or http://localhost|127.0.0.1 (dev).
 */
export function isAllowedAuthOrigin(origin: string | null | undefined): origin is string {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin !== origin || u.username || u.password) return false;
  if (u.protocol === 'http:') return LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== 'https:' || u.port) return false;
  return PRODUCTION_AUTH_HOSTS.has(u.hostname) || TEAM_PREVIEW_HOST.test(u.hostname);
}

function isLocalOrigin(origin: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** OAuth callback base: the current page origin when allowlisted, otherwise publicSiteUrl unchanged. */
export function resolveAuthCallbackBase(input: {
  publicSiteUrl: string;
  currentOrigin: string | null | undefined;
}): string {
  return isAllowedAuthOrigin(input.currentOrigin) ? input.currentOrigin : input.publicSiteUrl;
}

/**
 * Email-link base (password reset): the request origin when allowlisted and not local
 * (email links never point at localhost, as before), otherwise the canonical fallback.
 */
export function resolveEmailLinkBase(requestOrigin: string | null | undefined, canonical: string): string {
  return isAllowedAuthOrigin(requestOrigin) && !isLocalOrigin(requestOrigin) ? requestOrigin : canonical;
}

/** Origin of a request URL, or null when unparsable. */
export function requestUrlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
