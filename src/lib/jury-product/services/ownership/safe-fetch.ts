/**
 * I-072: SSRF-safe GET for ownership checks.
 * https only, port 443, public hostnames only (net-guard), every resolved address must be public and the
 * socket is pinned to the checked address (no DNS-rebinding window). Manual redirects (max 3, https, same host
 * or its www./apex sibling), 5s timeout, 256KB cap. No cookies, no auth headers.
 */
import { isForbiddenHostname, isNonPublicAddress, type HostLookup } from '../readonly-account/net-guard';

export const OWNERSHIP_FETCH_TIMEOUT_MS = 5000;
export const OWNERSHIP_FETCH_MAX_BYTES = 256 * 1024;
export const OWNERSHIP_FETCH_MAX_REDIRECTS = 3;

export type SafeFetchResult = { ok: true; status: number; body: string } | { ok: false; code: SafeFetchFailure };
export type SafeFetchFailure = 'BLOCKED_URL' | 'BLOCKED_ADDRESS' | 'TOO_MANY_REDIRECTS' | 'BAD_REDIRECT' | 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK';

/** One request against a pinned address. Injected in tests. */
export type PinnedGet = (input: { url: URL; address: string; family: number }) => Promise<
  { status: number; location: string | null; body: string } | { error: 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK' }
>;

const defaultLookup: HostLookup = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  return lookup(hostname, { all: true, verbatim: true });
};

type LookupCallback = (err: Error | null, addr: string | { address: string; family: number }[], fam?: number) => void;

/**
 * I-095: socket lookup pinned to the already-checked address. Node 20+ calls lookup with `{ all: true }`
 * (autoSelectFamily) and expects an array; answering with a bare string fails with ERR_INVALID_IP_ADDRESS.
 * Either shape still only ever yields the pinned address.
 */
export function pinnedLookup(address: string, family: number) {
  return (_hostname: string, options: unknown, cb?: LookupCallback): void => {
    const callback = (typeof options === 'function' ? options : cb) as LookupCallback;
    const all = typeof options === 'object' && options !== null && (options as { all?: unknown }).all === true;
    if (all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

const defaultPinnedGet: PinnedGet = async ({ url, address, family }) => {
  const https = await import('node:https');
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: Awaited<ReturnType<PinnedGet>>) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const req = https.request(
      {
        method: 'GET',
        host: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        headers: { 'user-agent': 'JuryOwnershipCheck/1.0', accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
        lookup: pinnedLookup(address, family),
        timeout: OWNERSHIP_FETCH_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        if (status >= 300 && status < 400) {
          res.destroy();
          done({ status, location, body: '' });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > OWNERSHIP_FETCH_MAX_BYTES) {
            res.destroy();
            done({ error: 'TOO_LARGE' });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => done({ status, location: null, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', () => done({ error: 'NETWORK' }));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ error: 'TIMEOUT' });
    }, OWNERSHIP_FETCH_TIMEOUT_MS);
    req.on('timeout', () => {
      req.destroy();
      done({ error: 'TIMEOUT' });
    });
    req.on('error', () => done({ error: 'NETWORK' }));
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
};

function stripWww(h: string): string {
  return h.startsWith('www.') ? h.slice(4) : h;
}

export function isAllowedOwnershipUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  if (url.port && url.port !== '443') return false;
  if (url.username || url.password) return false;
  return !isForbiddenHostname(url.hostname);
}

export async function safeOwnershipGet(
  start: URL,
  deps: { lookup?: HostLookup; get?: PinnedGet } = {},
): Promise<SafeFetchResult> {
  const lookup = deps.lookup ?? defaultLookup;
  const get = deps.get ?? defaultPinnedGet;
  const baseHost = stripWww(start.hostname.toLowerCase());
  let url = start;
  for (let hop = 0; hop <= OWNERSHIP_FETCH_MAX_REDIRECTS; hop += 1) {
    if (!isAllowedOwnershipUrl(url)) return { ok: false, code: hop === 0 ? 'BLOCKED_URL' : 'BAD_REDIRECT' };
    if (stripWww(url.hostname.toLowerCase()) !== baseHost) return { ok: false, code: 'BAD_REDIRECT' };
    let answers: { address: string; family?: number }[];
    try {
      answers = await lookup(url.hostname);
    } catch {
      return { ok: false, code: 'NETWORK' };
    }
    if (answers.length === 0 || answers.some((a) => isNonPublicAddress(a.address))) return { ok: false, code: 'BLOCKED_ADDRESS' };
    const pick = answers[0];
    const res = await get({ url, address: pick.address, family: pick.family ?? (pick.address.includes(':') ? 6 : 4) });
    if ('error' in res) return { ok: false, code: res.error };
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return { ok: false, code: 'BAD_REDIRECT' };
      try {
        url = new URL(res.location, url);
      } catch {
        return { ok: false, code: 'BAD_REDIRECT' };
      }
      continue;
    }
    return { ok: true, status: res.status, body: res.body };
  }
  return { ok: false, code: 'TOO_MANY_REDIRECTS' };
}
