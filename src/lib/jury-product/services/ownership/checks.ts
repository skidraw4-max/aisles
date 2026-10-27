/**
 * I-072: ownership checks. DNS TXT at `_jury-verify.<host>`, `<meta name="jury-site-verification">` on the
 * site root, or `https://<host>/.well-known/jury-verification.txt`. All fetches go through safeOwnershipGet.
 */
import { isForbiddenHostname, type HostLookup } from '../readonly-account/net-guard';
import { OWNERSHIP_TOKEN_PREFIX, extractTokenCandidates, tokenMatchesHash } from './token';
import { safeOwnershipGet, type PinnedGet, type SafeFetchFailure } from './safe-fetch';

export const OWNERSHIP_METHODS = ['DNS_TXT', 'META_TAG', 'WELL_KNOWN_FILE'] as const;
export type OwnershipMethod = (typeof OWNERSHIP_METHODS)[number];
export const DNS_TXT_LABEL = '_jury-verify';
export const META_TAG_NAME = 'jury-site-verification';
export const WELL_KNOWN_PATH = '/.well-known/jury-verification.txt';

export function isOwnershipMethod(v: unknown): v is OwnershipMethod {
  return typeof v === 'string' && (OWNERSHIP_METHODS as readonly string[]).includes(v);
}

/** Accepts "example.com", "https://example.com/path"; returns the lowercase public hostname or null. */
export function normalizeOwnershipHost(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 253 + 8) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isForbiddenHostname(host)) return null;
  return host;
}

export type OwnershipInstructions = { method: OwnershipMethod; where: string; value: string };

export function ownershipInstructions(method: OwnershipMethod, host: string, token: string): OwnershipInstructions {
  if (method === 'DNS_TXT') return { method, where: `${DNS_TXT_LABEL}.${host}`, value: `${OWNERSHIP_TOKEN_PREFIX}${token}` };
  if (method === 'META_TAG') return { method, where: `https://${host}/`, value: `<meta name="${META_TAG_NAME}" content="${token}">` };
  return { method, where: `https://${host}${WELL_KNOWN_PATH}`, value: `${OWNERSHIP_TOKEN_PREFIX}${token}` };
}

export type OwnershipCheckFailure = 'NOT_FOUND' | 'MISMATCH' | 'DNS_ERROR' | 'HTTP_STATUS' | SafeFetchFailure;
export type OwnershipCheckResult = { ok: true } | { ok: false; code: OwnershipCheckFailure };

export type OwnershipCheckDeps = {
  resolveTxt?: (name: string) => Promise<string[][]>;
  lookup?: HostLookup;
  get?: PinnedGet;
};

const defaultResolveTxt = async (name: string) => {
  const { resolveTxt } = await import('node:dns/promises');
  return resolveTxt(name);
};

export function metaTagContents(html: string): string[] {
  const out: string[] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    const tag = m[0];
    const name = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (name?.toLowerCase() !== META_TAG_NAME) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
    if (content) out.push(content.trim());
  }
  return out;
}

function anyMatch(candidates: string[], tokenHash: string, pepper: string): boolean {
  return candidates.some((c) => tokenMatchesHash(c, tokenHash, pepper));
}

export async function checkOwnership(
  input: { method: OwnershipMethod; host: string; tokenHash: string; pepper: string },
  deps: OwnershipCheckDeps = {},
): Promise<OwnershipCheckResult> {
  const host = normalizeOwnershipHost(input.host);
  if (!host) return { ok: false, code: 'BLOCKED_URL' };
  if (input.method === 'DNS_TXT') {
    let records: string[][];
    try {
      records = await (deps.resolveTxt ?? defaultResolveTxt)(`${DNS_TXT_LABEL}.${host}`);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      return { ok: false, code: code === 'ENOTFOUND' || code === 'ENODATA' ? 'NOT_FOUND' : 'DNS_ERROR' };
    }
    const values = records.map((chunks) => chunks.join('')).filter((v) => v.startsWith(OWNERSHIP_TOKEN_PREFIX));
    if (values.length === 0) return { ok: false, code: 'NOT_FOUND' };
    return anyMatch(values.flatMap(extractTokenCandidates), input.tokenHash, input.pepper) ? { ok: true } : { ok: false, code: 'MISMATCH' };
  }
  const url = new URL(input.method === 'META_TAG' ? `https://${host}/` : `https://${host}${WELL_KNOWN_PATH}`);
  const res = await safeOwnershipGet(url, { lookup: deps.lookup, get: deps.get });
  if (!res.ok) return { ok: false, code: res.code };
  if (res.status === 404) return { ok: false, code: 'NOT_FOUND' };
  if (res.status < 200 || res.status >= 300) return { ok: false, code: 'HTTP_STATUS' };
  const candidates = input.method === 'META_TAG' ? metaTagContents(res.body).flatMap(extractTokenCandidates) : extractTokenCandidates(res.body);
  if (candidates.length === 0) return { ok: false, code: 'NOT_FOUND' };
  return anyMatch(candidates, input.tokenHash, input.pepper) ? { ok: true } : { ok: false, code: 'MISMATCH' };
}
