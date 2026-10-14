/**
 * Jury host routing (pure). On jury.aisleshub.com, root paths are served from the existing
 * /jury routes via a middleware rewrite. Hub hosts are never rewritten.
 */

export const JURY_HOSTS: readonly string[] = ['jury.aisleshub.com'];

export function isJuryHost(hostname: string | null | undefined): boolean {
  return typeof hostname === 'string' && JURY_HOSTS.includes(hostname.toLowerCase());
}

const EXCLUDED_PREFIXES = ['/jury', '/api', '/_next', '/auth'] as const;
/** Next metadata routes and well-known root files (first segment). */
const METADATA_SEGMENT = /^(robots\.txt|sitemap\.xml|manifest|icon|apple-icon|opengraph-image|twitter-image)/;

/** True when a Jury-host request path should be served from /jury + path. */
export function shouldRewriteToJury(pathname: string): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return false;
  }
  if (pathname === '/reset-password' || pathname.startsWith('/reset-password/')) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (/\.[A-Za-z0-9]+$/.test(lastSegment)) return false;
  const firstSegment = pathname.slice(1).split('/')[0] ?? '';
  if (METADATA_SEGMENT.test(firstSegment)) return false;
  return true;
}

export function juryRewritePath(pathname: string): string {
  return pathname === '/' ? '/jury' : `/jury${pathname}`;
}
