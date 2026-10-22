import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PinnedCaError } from './db-ca';
import { createPreviewDiagHandler, serializeDiagBody, type DiagChecks, type PreviewDiagDeps } from './preview-diagnostics';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Sentinels: none of these may ever appear in a response body or captured log output.
const S_URL = 'https://sentinelrefabcdxyz.supabase.co';
const S_KEY = 'eyJsentinelKEY.payloadSENTINEL.sigSENTINEL';
const S_REF = 'sentinelrefabcdxyz';
const S_DB = 'postgresql://postgres.sentinelrefabcdxyz:Pw_SENTINEL@db.sentinel.example:5432/postgres';
const S_MSG = 'EXC_MESSAGE_SENTINEL /secret/path/ca.crt';
const SENTINELS = [S_URL, S_KEY, S_REF, S_DB, S_MSG, 'SENTINEL', 'sentinel', 'eyJ', '/secret/path'];

const previewEnv = () => ({
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: S_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: S_KEY,
  SUPABASE_SERVICE_ROLE_KEY: S_KEY,
  DATABASE_URL: S_DB,
  JURY_PREVIEW_DB_PROJECT_REF: S_REF,
});

const okChecks = (): DiagChecks => ({
  supabaseTarget: () => ({ ok: true, code: 'SUPABASE_TARGET_OK', keyRef: 'verified' }),
  dbTarget: () => ({ ok: true }),
  caPath: () => '/secret/path/ca.crt',
  caPin: () => '-----BEGIN CERTIFICATE-----SENTINEL',
  tlsConfig: () => ({ ok: true, connectionString: S_DB, ssl: { ca: 'SENTINEL' } }) as unknown as { ok: boolean },
});

type Calls = { auth: number; load: number; rate: number };
function deps(over: Partial<PreviewDiagDeps> = {}, calls: Calls = { auth: 0, load: 0, rate: 0 }): PreviewDiagDeps {
  return {
    env: previewEnv(),
    loadAuth: async () => {
      calls.load += 1;
      return { classifyAdminAuth: async () => { calls.auth += 1; return { ok: true }; } };
    },
    rateLimit: () => { calls.rate += 1; return false; },
    checks: okChecks(),
    ...over,
  };
}
const req = (method = 'GET') => new Request('https://example.test/api/admin/preview-diagnostics', { method });

// Network/console traps for the whole file.
let netCalls = 0;
let logs: string[] = [];
const origFetch = globalThis.fetch;
const origConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
test.beforeEach(() => {
  netCalls = 0;
  logs = [];
  globalThis.fetch = (async () => { netCalls += 1; throw new Error('network forbidden'); }) as typeof fetch;
  for (const k of ['log', 'error', 'warn', 'info'] as const) {
    console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  }
});
test.afterEach(() => {
  globalThis.fetch = origFetch;
  Object.assign(console, origConsole);
  assert.equal(netCalls, 0, 'fetch must never be called');
});
const t1 = test.mock.method(net, 'connect', () => { netCalls += 1; throw new Error('net forbidden'); });
const t2 = test.mock.method(net, 'createConnection', () => { netCalls += 1; throw new Error('net forbidden'); });
const t3 = test.mock.method(tls, 'connect', () => { netCalls += 1; throw new Error('tls forbidden'); });
void t1; void t2; void t3;

function assertClean(text: string) {
  for (const s of SENTINELS) assert.ok(!text.includes(s), 'sentinel leaked');
  for (const l of logs) for (const s of SENTINELS) assert.ok(!l.includes(s), 'sentinel leaked to log');
}
function assertHeaders(res: Response) {
  assert.equal(res.headers.get('cache-control'), 'no-store, private, max-age=0');
  assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
}

test('non-preview environments: empty 404, no auth/rate/check calls', async () => {
  const envs: Record<string, string | undefined>[] = [
    {}, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }, { JURY_PREVIEW_DB: '1' },
    { VERCEL_ENV: 'Preview' }, { VERCEL_ENV: ' preview' },
  ];
  for (const env of envs) {
    const calls = { auth: 0, load: 0, rate: 0 };
    let checked = 0;
    const throwing = new Proxy({}, { get: () => () => { checked += 1; throw new Error(S_MSG); } }) as DiagChecks;
    const res = await createPreviewDiagHandler(deps({ env: { ...previewEnv(), ...env, VERCEL_ENV: env.VERCEL_ENV }, checks: throwing }, calls))(req());
    assert.equal(res.status, 404);
    assert.equal(await res.text(), '');
    assertHeaders(res);
    assert.deepEqual(calls, { auth: 0, load: 0, rate: 0 });
    assert.equal(checked, 0);
  }
});

test('auth failures: 401/403 with fixed code only, no checks run', async () => {
  for (const [code, status] of [['UNAUTHORIZED', 401], ['FORBIDDEN', 403]] as const) {
    let checked = 0;
    const checks = new Proxy({}, { get: () => () => { checked += 1; return { ok: true }; } }) as DiagChecks;
    const res = await createPreviewDiagHandler(deps({
      checks,
      loadAuth: async () => ({ classifyAdminAuth: async () => ({ ok: false, code, error: S_MSG }) }),
    }))(req());
    assert.equal(res.status, status);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { code });
    assertClean(text);
    assertHeaders(res);
    assert.equal(checked, 0);
  }
});

test('auth module import failure / throw / odd result -> 503 ADMIN_AUTH_UNAVAILABLE only', async () => {
  const variants: PreviewDiagDeps['loadAuth'][] = [
    async () => { throw new Error(`BLOCKED_PRODUCTION_DB ${S_MSG} ${S_DB}`); },
    async () => { throw new PinnedCaError('CA_PIN_FINGERPRINT'); },
    async () => ({ classifyAdminAuth: async () => { throw new Error(S_MSG); } }),
    async () => ({ classifyAdminAuth: async () => ({ ok: false, code: 'WEIRD' }) }),
    async () => ({ classifyAdminAuth: async () => undefined as unknown as { ok: boolean } }),
  ];
  for (const loadAuth of variants) {
    const res = await createPreviewDiagHandler(deps({ loadAuth }))(req());
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { code: 'ADMIN_AUTH_UNAVAILABLE' });
    assertClean(text);
    assertHeaders(res);
  }
});

test('rate limited -> 429 before auth import; rate limiter throwing fails closed', async () => {
  const calls = { auth: 0, load: 0, rate: 0 };
  let res = await createPreviewDiagHandler(deps({ rateLimit: () => true }, calls))(req());
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { code: 'RATE_LIMITED' });
  assert.equal(calls.load, 0);
  res = await createPreviewDiagHandler(deps({ rateLimit: () => { throw new Error(S_MSG); } }, calls))(req());
  assert.equal(res.status, 429);
  assertClean(await res.text());
  assert.equal(calls.load, 0);
});

const EXPECTED_KEYS = (body: Record<string, unknown>) => {
  assert.deepEqual(Object.keys(body).sort(), ['checks', 'ok', 'previewRuntime', 'schema']);
  const c = body.checks as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(c).sort(), ['caPin', 'dbTarget', 'supabaseTarget', 'tlsConfig']);
  assert.deepEqual(Object.keys(c.supabaseTarget).sort(), ['code', 'keyRefVerified', 'ok']);
  for (const k of ['dbTarget', 'caPin', 'tlsConfig']) assert.deepEqual(Object.keys(c[k]).sort(), ['code', 'ok']);
  for (const v of Object.values(c)) {
    assert.equal(typeof v.ok, 'boolean');
    assert.match(String(v.code), /^[A-Z_]+$/);
  }
};

test('admin OK, all checks pass: exact allowlist schema, no secrets', async () => {
  const res = await createPreviewDiagHandler(deps())(req());
  assert.equal(res.status, 200);
  assertHeaders(res);
  const text = await res.text();
  const body = JSON.parse(text);
  EXPECTED_KEYS(body);
  assert.deepEqual(body, {
    schema: 'preview-diag/v1', ok: true, previewRuntime: true,
    checks: {
      supabaseTarget: { ok: true, code: 'SUPABASE_TARGET_OK', keyRefVerified: true },
      dbTarget: { ok: true, code: 'DB_TARGET_OK' },
      caPin: { ok: true, code: 'CA_PIN_OK' },
      tlsConfig: { ok: true, code: 'TLS_CONFIG_OK' },
    },
  });
  assertClean(text);
});

test('each check fails independently; others still reported; exceptions not leaked', async () => {
  const names = ['supabaseTarget', 'dbTarget', 'caPin', 'tlsConfig'] as const;
  for (const name of names) {
    const checks = okChecks();
    const key = name === 'caPin' ? 'caPin' : name;
    (checks as Record<string, unknown>)[key] = () => { throw new Error(S_MSG); };
    const res = await createPreviewDiagHandler(deps({ checks }))(req());
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    EXPECTED_KEYS(body);
    assert.equal(body.ok, false);
    assert.deepEqual(body.checks[name], name === 'supabaseTarget'
      ? { ok: false, code: 'UNKNOWN', keyRefVerified: false } : { ok: false, code: 'UNKNOWN' });
    for (const other of names.filter((n) => n !== name)) assert.equal(body.checks[other].ok, true, other);
    assertClean(text);
  }
});

test('fixed failure codes are mapped; unknown codes normalized to UNKNOWN', async () => {
  const checks: DiagChecks = {
    supabaseTarget: () => ({ ok: false, code: 'BLOCKED_SUPABASE_PRODUCTION' }),
    dbTarget: () => ({ ok: false, status: 'BLOCKED_PRODUCTION_DB' }),
    caPath: () => '/x',
    caPin: () => { throw new PinnedCaError('CA_PIN_EXPIRED'); },
    tlsConfig: () => ({ ok: false }),
  };
  let body = await (await createPreviewDiagHandler(deps({ checks }))(req())).json();
  assert.deepEqual(body.checks, {
    supabaseTarget: { ok: false, code: 'BLOCKED_SUPABASE_PRODUCTION', keyRefVerified: false },
    dbTarget: { ok: false, code: 'BLOCKED_PRODUCTION_DB' },
    caPin: { ok: false, code: 'CA_PIN_EXPIRED' },
    tlsConfig: { ok: false, code: 'BLOCKED_PREVIEW_TLS' },
  });
  assert.equal(body.ok, false);

  const weird: DiagChecks = {
    supabaseTarget: () => ({ ok: true, code: S_URL, keyRef: 'verified' }),
    dbTarget: () => ({ ok: false, status: S_DB }),
    caPath: () => null,
    caPin: () => '',
    tlsConfig: () => ({ ok: 'yes' as unknown as boolean }),
  };
  const res = await createPreviewDiagHandler(deps({ checks: weird }))(req());
  const text = await res.text();
  body = JSON.parse(text);
  assert.deepEqual(body.checks, {
    supabaseTarget: { ok: false, code: 'UNKNOWN', keyRefVerified: false },
    dbTarget: { ok: false, code: 'UNKNOWN' },
    caPin: { ok: false, code: 'CA_PATH_INVALID' },
    tlsConfig: { ok: false, code: 'BLOCKED_PREVIEW_TLS' },
  });
  assertClean(text);

  // CA error with a non-allowlisted code + message
  const caOdd = okChecks();
  caOdd.caPin = () => { throw Object.assign(new Error(S_MSG), { code: 'ENOENT_SENTINEL' }); };
  const b2 = await (await createPreviewDiagHandler(deps({ checks: caOdd }))(req())).text();
  assert.deepEqual(JSON.parse(b2).checks.caPin, { ok: false, code: 'UNKNOWN' });
  assertClean(b2);

  // SKIPPED is never reported as ok in a Preview runtime; unverifiable key ref is surfaced
  const skip = okChecks();
  skip.supabaseTarget = () => ({ ok: true, code: 'SUPABASE_TARGET_SKIPPED' });
  assert.deepEqual((await (await createPreviewDiagHandler(deps({ checks: skip }))(req())).json()).checks.supabaseTarget,
    { ok: false, code: 'SUPABASE_TARGET_SKIPPED', keyRefVerified: false });
  const unv = okChecks();
  unv.supabaseTarget = () => ({ ok: true, code: 'SUPABASE_TARGET_OK_KEY_REF_UNVERIFIABLE', keyRef: 'unverifiable' });
  assert.deepEqual((await (await createPreviewDiagHandler(deps({ checks: unv }))(req())).json()).checks.supabaseTarget,
    { ok: true, code: 'SUPABASE_TARGET_OK_KEY_REF_UNVERIFIABLE', keyRefVerified: false });
});

test('serializer drops extra fields', () => {
  const body = serializeDiagBody(true, {
    supabaseTarget: { ok: true, code: 'SUPABASE_TARGET_OK', keyRefVerified: true, url: S_URL } as never,
    dbTarget: { ok: true, code: 'DB_TARGET_OK', ref: S_REF } as never,
    caPin: { ok: true, code: 'CA_PIN_OK', path: '/secret/path' } as never,
    tlsConfig: { ok: true, code: 'TLS_CONFIG_OK', connectionString: S_DB } as never,
  });
  EXPECTED_KEYS(body as unknown as Record<string, unknown>);
  assertClean(JSON.stringify(body));
});

test('real static checks with fake preview env: no network, no leaks, guard codes only', async () => {
  const { checkSupabaseTarget } = require('./supabase-target-guard.cjs');
  const { planRuntimeDbTarget } = await import('./preview-db-guard');
  const { buildPreviewPgConfig, defaultPreviewCaPath } = await import('./preview-db-tls');
  const { readPinnedCaPem } = await import('./db-ca');
  const checks: DiagChecks = {
    supabaseTarget: (env) => checkSupabaseTarget(env, { requireServiceKey: true }),
    dbTarget: (env) => planRuntimeDbTarget(env),
    caPath: (env) => defaultPreviewCaPath(env),
    caPin: (p) => readPinnedCaPem(p),
    tlsConfig: (url, env) => buildPreviewPgConfig(url, env),
  };
  const res = await createPreviewDiagHandler(deps({ checks }))(req());
  assert.equal(res.status, 200);
  const text = await res.text();
  EXPECTED_KEYS(JSON.parse(text));
  assertClean(text);
});

test('route module: GET only, dynamic/no-cache config, lazy admin import, no static prisma', () => {
  const routeFile = path.join(here, '../../app/api/admin/preview-diagnostics/route.ts');
  const src = readFileSync(routeFile, 'utf8');
  const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ['GET', 'dynamic', 'revalidate', 'runtime']);
  assert.match(src, /export const dynamic = 'force-dynamic'/);
  assert.match(src, /export const runtime = 'nodejs'/);
  assert.match(src, /export const revalidate = 0/);
  assert.ok(!/^import .*(require-admin|classify-admin-auth|@\/lib\/prisma)/m.test(src), 'auth/prisma must not be statically imported');
  assert.match(src, /import\('@\/lib\/auth\/classify-admin-auth'\)/);
  // Static-check modules and rate limiter must not import Prisma (transitively within jury-product).
  for (const f of ['preview-diagnostics.ts', 'preview-db-guard.ts', 'preview-db-tls.ts', 'db-ca.ts', 'supabase-ca-pin.ts',
    'supabase-target-guard.cjs', 'db-target-classifier.cjs', '../cron-rate-limit.ts']) {
    const s = readFileSync(path.join(here, f), 'utf8');
    assert.ok(!/prisma['"]|@prisma\/client|require-admin/.test(s.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), f);
  }
});

test('non-GET methods are refused even if invoked', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const calls = { auth: 0, load: 0, rate: 0 };
    const res = await createPreviewDiagHandler(deps({}, calls))(req(m));
    assert.equal(res.status, 405);
    assert.equal(await res.text(), '');
    assert.equal(calls.load, 0);
  }
});
