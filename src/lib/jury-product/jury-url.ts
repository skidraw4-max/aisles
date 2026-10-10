/**
 * Jury URL boundary.
 *
 * Mounted app routes stay under `/jury` until a canonical origin is configured.
 * `NEXT_PUBLIC_JURY_APP_URL` (for example https://jury.aisleshub.com) switches
 * generated links to that origin and drops the legacy prefix. Unset, invalid,
 * or hostile values keep the relative `/jury` routes.
 */

const STATIC_ROUTES = new Set([
  '/',
  '/login',
  '/dashboard',
  '/services',
  '/services/new',
  '/services/github',
  '/services/github/callback',
  '/evidence',
  '/reviews',
  '/improvements',
  '/audit',
  '/settings',
  '/agents',
  '/automation',
  '/discovery',
  '/signup',
  '/organization/create',
  '/organization/invitations',
  '/organization/members',
  '/organization/services',
  '/organization/security',
]);

const DYNAMIC_PREFIXES = ['/services/', '/reviews/', '/improvements/', '/invitation/'] as const;

export function juryAppOrigin(raw = process.env.NEXT_PUBLIC_JURY_APP_URL): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Internal Jury route, or null when the input is not one of those routes. */
export function normalizeJuryRoute(input: string): string | null {
  if (typeof input !== 'string') return null;
  const route = input.trim();
  if (!route.startsWith('/') || route.startsWith('//')) return null;
  if (route.includes('://') || route.includes('\\') || route.includes('?') || route.includes('#') || route.includes('%') || route.includes('..')) {
    return null;
  }
  const path = route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
  if (STATIC_ROUTES.has(path)) return path;
  for (const prefix of DYNAMIC_PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const id = path.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    return path;
  }
  return null;
}

function legacyPath(internal: string): string {
  if (internal === '/' || internal === '/dashboard') return '/jury';
  return `/jury${internal}`;
}

function withQuery(path: string, query?: Record<string, string | undefined>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(key) || !/^[A-Za-z0-9_-]+$/.test(value)) continue;
    params.set(key, value);
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

/** Relative `/jury` path, or an absolute canonical URL when the origin is configured. */
export function juryHref(
  route: string,
  query?: Record<string, string | undefined>,
  configuredOrigin: string | null | undefined = process.env.NEXT_PUBLIC_JURY_APP_URL,
): string {
  const internal = normalizeJuryRoute(route);
  if (!internal) return '/jury';
  const origin = configuredOrigin === undefined ? juryAppOrigin() : juryAppOrigin(configuredOrigin ?? '');
  if (!origin) return withQuery(legacyPath(internal), query);
  const url = new URL(internal === '/' ? '/' : internal, `${origin}/`);
  if (!query) return url.href;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(key) || !/^[A-Za-z0-9_-]+$/.test(value)) continue;
    url.searchParams.set(key, value);
  }
  return url.href;
}

/** Jury signup route. Unset origin keeps `/jury/signup`. */
export function jurySignupHref(
  configuredOrigin: string | null | undefined = process.env.NEXT_PUBLIC_JURY_APP_URL,
): string {
  return juryHref('/signup', undefined, configuredOrigin);
}

/**
 * Caller-supplied return path. Only a Jury route survives.
 * Anything else, including external and protocol-relative URLs, becomes Jury root.
 */
export function safeJuryNext(
  raw: string | null | undefined,
  configuredOrigin: string | null | undefined = process.env.NEXT_PUBLIC_JURY_APP_URL,
): string {
  if (typeof raw !== 'string') return juryHref('/', undefined, configuredOrigin);
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return juryHref('/', undefined, configuredOrigin);
  if (value.includes('://') || value.includes('\\') || value.includes('%') || value.includes('..') || value.includes('?') || value.includes('#')) {
    return juryHref('/', undefined, configuredOrigin);
  }
  const internal = value === '/jury' || value === '/jury/'
    ? '/'
    : value.startsWith('/jury/')
      ? value.slice('/jury'.length)
      : value;
  if (!normalizeJuryRoute(internal)) return juryHref('/', undefined, configuredOrigin);
  return juryHref(internal, undefined, configuredOrigin);
}

function hubUrl(siteOrigin: string, pathname: string): string | null {
  try {
    const url = new URL(siteOrigin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return new URL(pathname, `${url.origin}/`).href;
  } catch {
    return null;
  }
}

/** Hub OAuth callback. `next` stays the relative `/jury` path the existing callback allows. */
export function juryOAuthRedirect(
  siteOrigin: string,
  next?: string | null,
): { redirectTo: string; next: string } | null {
  const redirectTo = hubUrl(siteOrigin, '/auth/callback');
  if (!redirectTo) return null;
  const url = new URL(redirectTo);
  const callbackNext = juryCallbackNext(next);
  url.searchParams.set('next', callbackNext);
  return { redirectTo: url.href, next: callbackNext };
}

export function juryPasswordResetDestination(siteOrigin: string): string | null {
  return hubUrl(siteOrigin, '/auth/reset-callback');
}

/** Relative callback path. Only Jury root or one invitation token survives. */
export function juryCallbackNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '/jury';
  const value = raw.trim();
  const internal = value.startsWith('/jury/invitation/')
    ? value.slice('/jury'.length)
    : value.startsWith('/invitation/')
      ? value
      : null;
  if (!internal || !/^\/invitation\/[A-Za-z0-9_-]{43}$/.test(internal)) return '/jury';
  if (!normalizeJuryRoute(internal)) return '/jury';
  return `/jury${internal}`;
}

/** Relative return path for login, signup, and the auth callback. Unsafe values are dropped. */
export function juryReturnQuery(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://') || value.includes('\\') || value.includes('%') || value.includes('..') || value.includes('?') || value.includes('#')) {
    return null;
  }
  const internal = value === '/jury' || value === '/jury/'
    ? '/'
    : value.startsWith('/jury/')
      ? value.slice('/jury'.length)
      : value;
  if (!normalizeJuryRoute(internal) || internal === '/') return null;
  return `/jury${internal}`;
}

function withReturn(base: string, returnPath: string | null | undefined): string {
  const next = juryReturnQuery(returnPath);
  if (!next) return base;
  return `${base}?next=${encodeURIComponent(next)}`;
}

export function juryLoginHref(
  returnPath?: string | null,
  configuredOrigin: string | null | undefined = process.env.NEXT_PUBLIC_JURY_APP_URL,
): string {
  return withReturn(juryHref('/login', undefined, configuredOrigin), returnPath);
}

export function jurySignupLink(
  returnPath?: string | null,
  configuredOrigin: string | null | undefined = process.env.NEXT_PUBLIC_JURY_APP_URL,
): string {
  return withReturn(juryHref('/signup', undefined, configuredOrigin), returnPath);
}

export function juryInvitationHref(
  token: string,
  configuredOrigin: string | null | undefined = process.env.NEXT_PUBLIC_JURY_APP_URL,
): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return juryHref('/', undefined, configuredOrigin);
  return juryHref(`/invitation/${token}`, undefined, configuredOrigin);
}

/** Existing hub callback. `next` stays a relative Jury path the callback already allows. */
export function juryEmailVerificationDestination(siteOrigin: string, next?: string | null): string | null {
  const redirectTo = hubUrl(siteOrigin, '/auth/callback');
  if (!redirectTo) return null;
  const url = new URL(redirectTo);
  url.searchParams.set('next', juryCallbackNext(next));
  return url.href;
}

export function isJuryRequestPath(pathname: string, host?: string | null): boolean {
  if (pathname === '/jury' || pathname.startsWith('/jury/')) return true;
  const origin = juryAppOrigin();
  if (!origin || !host) return false;
  return new URL(origin).host === host;
}
