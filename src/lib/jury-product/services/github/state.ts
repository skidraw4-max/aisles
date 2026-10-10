/**
 * Signed connection state. The payload identifies the Jury actor and expires.
 * It does not carry a GitHub credential.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { providerError, type ProviderError } from '../provider-types';

const STATE_VERSION = 1;
export const GITHUB_STATE_TTL_SECONDS = 600;

export type GithubStateClaims = {
  tenantId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
};

const IDENTIFIER = /^[A-Za-z0-9_-]{1,80}$/;

export function hashGithubNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export function signGithubState(input: {
  tenantId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
  secret: string;
}): string | null {
  if (input.secret.length < 16) return null;
  if (!IDENTIFIER.test(input.tenantId) || !IDENTIFIER.test(input.userId) || !IDENTIFIER.test(input.nonce)) return null;
  if (!Number.isFinite(input.expiresAt)) return null;
  const payload = Buffer.from(JSON.stringify({
    v: STATE_VERSION,
    t: input.tenantId,
    u: input.userId,
    n: input.nonce,
    e: input.expiresAt,
  }), 'utf8').toString('base64url');
  const mac = createHmac('sha256', input.secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyGithubState(input: {
  state: string;
  secret: string;
  now: number;
}): { ok: true; claims: GithubStateClaims } | ProviderError {
  if (input.secret.length < 16) return providerError('GITHUB_NOT_CONFIGURED');
  const dot = input.state.lastIndexOf('.');
  if (dot <= 0) return providerError('GITHUB_STATE_INVALID');
  const payload = input.state.slice(0, dot);
  const mac = input.state.slice(dot + 1);
  const expected = createHmac('sha256', input.secret).update(payload).digest('base64url');
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return providerError('GITHUB_STATE_INVALID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return providerError('GITHUB_STATE_INVALID');
  }
  if (!parsed || typeof parsed !== 'object') return providerError('GITHUB_STATE_INVALID');
  const row = parsed as { v?: unknown; t?: unknown; u?: unknown; n?: unknown; e?: unknown };
  if (row.v !== STATE_VERSION) return providerError('GITHUB_STATE_INVALID');
  if (typeof row.t !== 'string' || typeof row.u !== 'string' || typeof row.n !== 'string' || typeof row.e !== 'number') {
    return providerError('GITHUB_STATE_INVALID');
  }
  if (!IDENTIFIER.test(row.t) || !IDENTIFIER.test(row.u) || !IDENTIFIER.test(row.n)) return providerError('GITHUB_STATE_INVALID');
  if (row.e <= input.now) return providerError('GITHUB_STATE_INVALID');
  return { ok: true, claims: { tenantId: row.t, userId: row.u, nonce: row.n, expiresAt: row.e } };
}

export function acceptGithubStateUse(input: { consumed: boolean; expiresAt: number; now: number }): ProviderError | { ok: true } {
  if (input.consumed || input.expiresAt <= input.now) return providerError('GITHUB_STATE_INVALID');
  return { ok: true };
}
