/** I-072: ownership token. Plaintext is shown once to the user; only an HMAC (peppered) hash is stored. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const OWNERSHIP_TOKEN_PREFIX = 'jury-verify=';

export function generateOwnershipToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOwnershipToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export function tokenHint(token: string): string {
  return token.slice(-4);
}

export function tokenMatchesHash(candidate: string, expectedHash: string, pepper: string): boolean {
  const a = Buffer.from(hashOwnershipToken(candidate.trim(), pepper), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** DNS TXT / file values carry a prefix; meta content is the bare token. */
export function extractTokenCandidates(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s"']+/)) {
    const v = raw.trim();
    if (!v) continue;
    out.push(v.startsWith(OWNERSHIP_TOKEN_PREFIX) ? v.slice(OWNERSHIP_TOKEN_PREFIX.length) : v);
    if (out.length >= 50) break;
  }
  return out;
}
