/**
 * I-075: Jury GA4 service-account access token. Two modes, picked by which env vars exist (see phase1-flags):
 *  - WIF: Vercel OIDC token -> Google STS token exchange -> service account impersonation (no stored key).
 *  - JSON_KEY: base64 service-account JSON -> signed JWT -> OAuth token.
 * Kept separate from the AIsles GA4 env (GA4_*). Token values are never logged or returned to the UI.
 * Scope: analytics.readonly only.
 */
import { createSign } from 'node:crypto';
import { ga4CredentialMode, type EnvLike } from '../phase1-flags';

export const GA4_READONLY_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type Ga4TokenFailure = 'NOT_CONFIGURED' | 'OIDC_TOKEN_MISSING' | 'INVALID_KEY' | 'TOKEN_EXCHANGE_FAILED' | 'IMPERSONATION_FAILED';
export type Ga4TokenResult = { ok: true; accessToken: string } | { ok: false; code: Ga4TokenFailure };

export function wifAudience(env: EnvLike): string {
  return `//iam.googleapis.com/projects/${env.JURY_GA4_WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${env.JURY_GA4_WIF_POOL_ID}/providers/${env.JURY_GA4_WIF_PROVIDER_ID}`;
}

/** Vercel exposes the OIDC token as the `x-vercel-oidc-token` request header (functions) or VERCEL_OIDC_TOKEN (builds/dev). */
export async function readVercelOidcToken(env: EnvLike = process.env): Promise<string | null> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const v = h.get('x-vercel-oidc-token');
    if (v) return v;
  } catch {
    // outside a request scope (cron/tests)
  }
  const fromEnv = env.VERCEL_OIDC_TOKEN?.trim();
  return fromEnv ? fromEnv : null;
}

type ServiceAccountKey = { client_email: string; private_key: string; token_uri?: string };

export function parseServiceAccountKeyBase64(value: string | undefined): ServiceAccountKey | null {
  if (!value) return null;
  try {
    const raw = value.trim().startsWith('{') ? value.trim() : Buffer.from(value.trim(), 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<ServiceAccountKey> & { type?: string };
    if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n'), token_uri: parsed.token_uri };
  } catch {
    return null;
  }
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function signServiceAccountJwt(key: ServiceAccountKey, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: key.client_email, scope: GA4_READONLY_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(key.private_key).toString('base64url')}`;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

export async function getGa4AccessToken(deps: { env?: EnvLike; fetch?: FetchLike; oidcToken?: () => Promise<string | null>; now?: Date } = {}): Promise<Ga4TokenResult> {
  const env = deps.env ?? process.env;
  const f = deps.fetch ?? defaultFetch;
  const mode = ga4CredentialMode(env);
  if (mode === 'NONE') return { ok: false, code: 'NOT_CONFIGURED' };

  if (mode === 'JSON_KEY') {
    const key = parseServiceAccountKeyBase64(env.JURY_GA4_SA_KEY_JSON_BASE64);
    if (!key) return { ok: false, code: 'INVALID_KEY' };
    let assertion: string;
    try {
      assertion = signServiceAccountJwt(key, Math.floor((deps.now ?? new Date()).getTime() / 1000));
    } catch {
      return { ok: false, code: 'INVALID_KEY' };
    }
    const res = await f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string };
    return res.ok && body.access_token ? { ok: true, accessToken: body.access_token } : { ok: false, code: 'TOKEN_EXCHANGE_FAILED' };
  }

  const subject = await (deps.oidcToken ?? (() => readVercelOidcToken(env)))();
  if (!subject) return { ok: false, code: 'OIDC_TOKEN_MISSING' };
  const sts = await f('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: wifAudience(env),
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectToken: subject,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
    }),
  });
  const stsBody = (await sts.json().catch(() => ({}))) as { access_token?: string };
  if (!sts.ok || !stsBody.access_token) return { ok: false, code: 'TOKEN_EXCHANGE_FAILED' };
  const email = String(env.JURY_GA4_SA_EMAIL).trim();
  const imp = await f(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:generateAccessToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${stsBody.access_token}` },
    body: JSON.stringify({ scope: [GA4_READONLY_SCOPE], lifetime: '3600s' }),
  });
  const impBody = (await imp.json().catch(() => ({}))) as { accessToken?: string };
  return imp.ok && impBody.accessToken ? { ok: true, accessToken: impBody.accessToken } : { ok: false, code: 'IMPERSONATION_FAILED' };
}
