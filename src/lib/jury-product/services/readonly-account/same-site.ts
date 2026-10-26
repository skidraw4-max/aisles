/**
 * I-055: same-registrable-site check for static subresources (e.g. kr.atomy.com page loading resources.atomy.com JS).
 * No public-suffix dependency: a small list of common two-level suffixes, and shared hosting suffixes where
 * subdomains belong to different owners are never expanded (exact origin only).
 */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr', 'pe.kr', 'ms.kr', 'hs.kr', 'es.kr', 'sc.kr', 'kg.kr',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'com.cn', 'net.cn', 'org.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my', 'co.id', 'co.th',
  'com.br', 'com.mx', 'co.nz', 'co.in', 'com.tr', 'com.vn', 'com.ph',
]);
/** Shared hosting / platform suffixes: each subdomain is a different tenant, so no same-site expansion. */
const SHARED_HOST_SUFFIXES = [
  'vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com',
  'supabase.co', 'supabase.in', 'onrender.com', 'fly.dev', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
  'appspot.com', 'blogspot.com', 'wixsite.com', 'myshopify.com', 'ngrok.io', 'ngrok-free.app',
];
/** I-055: Google reCAPTCHA / challenge hosts always stay blocked (never solved or loaded). */
const ALWAYS_BLOCKED_SITES = new Set(['google.com', 'gstatic.com', 'recaptcha.net', 'hcaptcha.com', 'cloudflare.com']);

export const SAME_SITE_SUBRESOURCE_TYPES = new Set(['script', 'stylesheet', 'image', 'font']);

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** eTLD+1 approximation; null = do not expand (IP, localhost, shared hosting, single label). */
export function registrableSite(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isIp(host) || !host.includes('.')) return null;
  if (SHARED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  const parts = host.split('.');
  const lastTwo = parts.slice(-2).join('.');
  const n = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (parts.length < n) return null;
  return parts.slice(-n).join('.');
}

export function allowedSitesOf(origins: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const o of origins) {
    try {
      const u = new URL(o);
      if (u.protocol !== 'https:') continue;
      const site = registrableSite(u.hostname);
      if (site && !ALWAYS_BLOCKED_SITES.has(site)) out.add(site);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** https GET static subresource whose host shares a registrable site with an allowed origin. */
export function isSameSiteSubresource(req: { method: string; url: string; isNavigation: boolean; isFormSubmit: boolean; resourceType?: string }, sites: ReadonlySet<string>): boolean {
  if (req.isNavigation || req.isFormSubmit || req.method.toUpperCase() !== 'GET') return false;
  if (!req.resourceType || !SAME_SITE_SUBRESOURCE_TYPES.has(req.resourceType)) return false;
  try {
    const u = new URL(req.url);
    if (u.protocol !== 'https:') return false;
    const site = registrableSite(u.hostname);
    return Boolean(site && !ALWAYS_BLOCKED_SITES.has(site) && sites.has(site));
  } catch {
    return false;
  }
}

/** I-055: blocked request hostnames with counts (no paths/queries), most frequent first, max `limit`. */
export function blockedHostCounts(blocked: readonly { url: string }[], limit = 20): Record<string, number> {
  const counts = new Map<string, number>();
  for (const b of blocked) {
    let host = 'invalid';
    try {
      const u = new URL(b.url);
      host = u.hostname || u.protocol.replace(/:$/, '');
    } catch {
      /* keep invalid */
    }
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit));
}
