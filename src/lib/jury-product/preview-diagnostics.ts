import 'server-only';

/**
 * Preview-only, admin-only, network-free runtime diagnostics.
 *
 * Responses only ever contain fixed booleans and allowlisted enum codes. URLs, hosts,
 * project refs (or parts), keys, JWT claims, paths, exception messages and counts are
 * never returned or logged. No probe / network code lives here by design.
 */

export const DIAG_SCHEMA = 'preview-diag/v1' as const;

export const DIAG_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
});

const SUPABASE_CODES = [
  'SUPABASE_TARGET_SKIPPED',
  'SUPABASE_TARGET_OK',
  'SUPABASE_TARGET_OK_KEY_REF_UNVERIFIABLE',
  'SUPABASE_TARGET_CONFIG',
  'BLOCKED_SUPABASE_PRODUCTION',
  'BLOCKED_SUPABASE_URL_MISSING',
  'BLOCKED_SUPABASE_UNVERIFIED',
  'BLOCKED_SUPABASE_KEY_MISSING',
  'BLOCKED_SUPABASE_KEY_MISMATCH',
  'BLOCKED_SUPABASE_KEY_UNDECODABLE',
] as const;
const DB_CODES = ['DB_TARGET_OK', 'BLOCKED_PRODUCTION_DB', 'BLOCKED_PREVIEW_DB'] as const;
const CA_CODES = [
  'CA_PIN_OK',
  'CA_PATH_INVALID',
  'CA_PIN_MISSING',
  'CA_PIN_FILE_HASH',
  'CA_PIN_PARSE',
  'CA_PIN_FINGERPRINT',
  'CA_PIN_SUBJECT',
  'CA_PIN_ISSUER',
  'CA_PIN_NOT_CA',
  'CA_PIN_VALIDITY_MISMATCH',
  'CA_PIN_NOT_YET_VALID',
  'CA_PIN_EXPIRED',
] as const;
const TLS_CODES = ['TLS_CONFIG_OK', 'BLOCKED_PREVIEW_TLS'] as const;

export type DiagCheck = { ok: boolean; code: string };
export type SupabaseDiagCheck = DiagCheck & { keyRefVerified: boolean };
export type DiagBody = {
  schema: typeof DIAG_SCHEMA;
  ok: boolean;
  previewRuntime: boolean;
  checks: { supabaseTarget: SupabaseDiagCheck; dbTarget: DiagCheck; caPin: DiagCheck; tlsConfig: DiagCheck };
};

type Env = { readonly [key: string]: string | undefined };
type AuthResult = { ok: true } | { ok: false; code: 'UNAUTHORIZED' | 'FORBIDDEN' };

/** Raw check outputs; each may throw. Only fixed fields are read from them. */
export type DiagChecks = {
  supabaseTarget: (env: Env) => { ok: boolean; code: string; keyRef?: string };
  dbTarget: (env: Env) => { ok: true } | { ok: false; status: string };
  /** Returns a path or null; resolving the CA path itself is part of the CA check. */
  caPath: (env: Env) => string | null;
  caPin: (caPath: string) => unknown;
  tlsConfig: (connectionString: string, env: Env) => { ok: boolean };
};

export type PreviewDiagDeps = {
  env: Env;
  /** Lazy import of the admin auth module (pulls Prisma). Must not be called outside Preview. */
  loadAuth: () => Promise<{ requireAdminAction: () => Promise<{ ok: boolean; code?: string }> }>;
  checks: DiagChecks;
  /** true => limited. Must not import Prisma. */
  rateLimit: (req: Request) => boolean;
};

function pick(code: unknown, allowed: readonly string[]): string {
  return typeof code === 'string' && allowed.includes(code) ? code : 'UNKNOWN';
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...DIAG_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...DIAG_HEADERS, ...extra } });
}

const FAIL: DiagCheck = Object.freeze({ ok: false, code: 'UNKNOWN' }) as DiagCheck;

export function runStaticChecks(env: Env, checks: DiagChecks): DiagBody['checks'] {
  let supabaseTarget: SupabaseDiagCheck = { ...FAIL, keyRefVerified: false };
  try {
    const r = checks.supabaseTarget(env);
    const code = pick(r?.code, SUPABASE_CODES);
    supabaseTarget = {
      ok: r?.ok === true && code !== 'UNKNOWN' && code !== 'SUPABASE_TARGET_SKIPPED',
      code,
      keyRefVerified: r?.ok === true && r?.keyRef === 'verified',
    };
  } catch {
    /* fixed UNKNOWN */
  }

  let dbTarget: DiagCheck = { ...FAIL };
  try {
    const r = checks.dbTarget(env);
    dbTarget = r?.ok === true ? { ok: true, code: 'DB_TARGET_OK' } : { ok: false, code: pick((r as { status?: unknown })?.status, DB_CODES) };
  } catch {
    /* fixed UNKNOWN */
  }

  let caPin: DiagCheck = { ...FAIL };
  try {
    const p = checks.caPath(env);
    if (!p) {
      caPin = { ok: false, code: 'CA_PATH_INVALID' };
    } else {
      checks.caPin(p);
      caPin = { ok: true, code: 'CA_PIN_OK' };
    }
  } catch (err) {
    caPin = { ok: false, code: pick((err as { code?: unknown } | null)?.code, CA_CODES) };
    if (caPin.code === 'CA_PIN_OK') caPin = { ok: false, code: 'UNKNOWN' };
  }

  let tlsConfig: DiagCheck = { ...FAIL };
  try {
    const r = checks.tlsConfig(env.DATABASE_URL ?? '', env);
    tlsConfig = r?.ok === true ? { ok: true, code: 'TLS_CONFIG_OK' } : { ok: false, code: 'BLOCKED_PREVIEW_TLS' };
  } catch {
    /* fixed UNKNOWN */
  }

  return { supabaseTarget, dbTarget, caPin, tlsConfig };
}

/** Rebuilds the body from allowlisted fields only (defense in depth). */
export function serializeDiagBody(previewRuntime: boolean, c: DiagBody['checks']): DiagBody {
  const s = (x: DiagCheck, allowed: readonly string[]): DiagCheck => {
    const code = pick(x.code, allowed);
    return { ok: x.ok === true && code !== 'UNKNOWN', code };
  };
  const sb = s(c.supabaseTarget, SUPABASE_CODES);
  const checks = {
    supabaseTarget: { ok: sb.ok, code: sb.code, keyRefVerified: sb.ok && c.supabaseTarget.keyRefVerified === true },
    dbTarget: s(c.dbTarget, DB_CODES),
    caPin: s(c.caPin, CA_CODES),
    tlsConfig: s(c.tlsConfig, TLS_CODES),
  };
  const ok = previewRuntime && checks.supabaseTarget.ok && checks.dbTarget.ok && checks.caPin.ok && checks.tlsConfig.ok;
  return { schema: DIAG_SCHEMA, ok, previewRuntime: previewRuntime === true, checks };
}

export function createPreviewDiagHandler(deps: PreviewDiagDeps): (req: Request) => Promise<Response> {
  return async function GET(req: Request): Promise<Response> {
    // 1. Environment gate first: nothing else (auth, Prisma, rate limit) runs outside Preview.
    if (deps.env.VERCEL_ENV !== 'preview') return empty(404);
    if (req.method !== 'GET') return empty(405, { Allow: 'GET' });

    // 2. Rate limit (in-memory, no Prisma).
    let limited = true;
    try {
      limited = deps.rateLimit(req);
    } catch {
      limited = true;
    }
    if (limited) return json(429, { code: 'RATE_LIMITED' });

    // 3. Admin auth, lazily imported (pulls Prisma + DB/TLS guards at import time).
    let auth: AuthResult;
    try {
      const mod = await deps.loadAuth();
      const r = await mod.requireAdminAction();
      if (r?.ok === true) auth = { ok: true };
      else if (r?.code === 'UNAUTHORIZED') auth = { ok: false, code: 'UNAUTHORIZED' };
      else if (r?.code === 'FORBIDDEN') auth = { ok: false, code: 'FORBIDDEN' };
      else return json(503, { code: 'ADMIN_AUTH_UNAVAILABLE' });
    } catch {
      return json(503, { code: 'ADMIN_AUTH_UNAVAILABLE' });
    }
    if (!auth.ok) return json(auth.code === 'UNAUTHORIZED' ? 401 : 403, { code: auth.code });

    // 4. Network-free checks, each isolated.
    const body = serializeDiagBody(true, runStaticChecks(deps.env, deps.checks));
    return json(200, body);
  };
}
