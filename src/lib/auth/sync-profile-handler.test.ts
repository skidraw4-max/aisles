import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSyncProfileHandler,
  isEmailUniqueConflict,
  safePrismaCode,
  type SyncProfileDeps,
} from './sync-profile-handler';

const EMAIL = 'secret.person@example.invalid';
const ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = 'SENTINEL_TOKEN_abc';
const URL_ = 'https://SENTINEL-url.example.invalid';
const SECRETS = [EMAIL, ID, TOKEN, URL_, 'SENTINEL', 'secret.person'];

class FakeKnownError extends Error {
  constructor(public code: string, public meta: unknown) { super(`Unique constraint failed ${EMAIL} ${ID}`); }
}
const adapterP2002 = (constraint: unknown) =>
  new FakeKnownError('P2002', {
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: { kind: 'UniqueConstraintViolation', constraint, originalMessage: `Key (email)=(${EMAIL}) already exists.` },
    },
  });

type Call = { op: string; args: unknown };
function harness(opts: { upsert?: () => Promise<unknown>; readback?: () => Promise<unknown>; user?: unknown; authError?: unknown; env?: SyncProfileDeps['env'] } = {}) {
  const calls: Call[] = [];
  const logs: unknown[] = [];
  const deps: SyncProfileDeps = {
    env: opts.env ?? { NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    getUser: async (_u, _a, token) => {
      calls.push({ op: 'getUser', args: token === TOKEN });
      return { data: { user: (opts.user === undefined ? { id: ID, email: EMAIL, user_metadata: {} } : opts.user) as never }, error: opts.authError ?? null };
    },
    db: {
      findUsernameOwner: async (username, excludeId) => { calls.push({ op: 'findUsernameOwner', args: { username, excludeId } }); return null; },
      upsertUser: async (args) => { calls.push({ op: 'upsert', args }); return opts.upsert ? opts.upsert() : {}; },
      findUsername: async (id) => { calls.push({ op: 'findUsername', args: id }); return opts.readback ? (opts.readback() as never) : { username: 'secretperson' }; },
    },
    log: (event, detail) => logs.push([event, detail]),
  };
  const req = (auth: string | null = `Bearer ${TOKEN}`) =>
    new Request('https://app.example.invalid/api/auth/sync-profile', { method: 'POST', headers: auth ? { authorization: auth } : {} });
  return { handler: createSyncProfileHandler(deps), calls, logs, req };
}
const noSecret = (s: string) => { for (const x of SECRETS) assert.ok(!s.includes(x), `leaked ${x}`); };

test('1. success path unchanged: upsert by id, readback, 200 {ok, username}', async () => {
  const h = harness();
  const res = await h.handler(h.req());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, username: 'secretperson' });
  const up = h.calls.find((c) => c.op === 'upsert')!.args as { where: unknown; create: { email: string; role: string; id: string }; update: Record<string, unknown> };
  assert.deepEqual(up.where, { id: ID });
  assert.equal(up.create.id, ID);
  assert.equal(up.create.email, EMAIL);
  assert.equal(up.create.role, 'USER');
  assert.deepEqual(Object.keys(up.update), ['email']);
  assert.deepEqual(h.logs, []);
});

test('2. P2002 on email (adapter fields / index / legacy target) -> 409 ACCOUNT_EMAIL_CONFLICT', async () => {
  for (const err of [
    adapterP2002({ fields: ['email'] }),
    adapterP2002({ index: 'User_email_key' }),
    new FakeKnownError('P2002', { target: ['email'] }),
    new FakeKnownError('P2002', { target: 'User_email_key' }),
  ]) {
    assert.equal(isEmailUniqueConflict(err), true);
    const h = harness({ upsert: async () => { throw err; } });
    const res = await h.handler(h.req());
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { code: 'ACCOUNT_EMAIL_CONFLICT' });
  }
});

test('3. 409 and 500 responses contain no email/id/token/url/raw message', async () => {
  for (const err of [adapterP2002({ fields: ['email'] }), new Error(`boom ${EMAIL} ${ID} ${URL_}`)]) {
    const h = harness({ upsert: async () => { throw err; } });
    const res = await h.handler(h.req());
    const text = await res.text();
    noSecret(text);
    for (const [k, v] of res.headers) noSecret(`${k}:${v}`);
  }
});

test('4. logs are fixed event + {stage, prismaCode?} only (console captured)', async () => {
  const captured: string[] = [];
  const orig = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { captured.push(JSON.stringify(a)); };
  try {
    const errs: unknown[] = [adapterP2002({ fields: ['email'] }), Object.assign(new Error(`x ${EMAIL}`), { code: `P20${EMAIL}` }), new Error(`plain ${TOKEN}`)];
    for (const err of errs) {
      const handler = createSyncProfileHandler({
        env: { NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a' },
        getUser: async () => ({ data: { user: { id: ID, email: EMAIL } }, error: null }),
        db: { findUsernameOwner: async () => null, upsertUser: async () => { throw err; }, findUsername: async () => null },
      });
      await handler(new Request('https://app.example.invalid/x', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }));
    }
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(captured, [
    JSON.stringify(['[sync-profile] SYNC_FAILED', { stage: 'upsert', prismaCode: 'P2002' }]),
    JSON.stringify(['[sync-profile] SYNC_FAILED', { stage: 'upsert' }]),
    JSON.stringify(['[sync-profile] SYNC_FAILED', { stage: 'upsert' }]),
  ]);
  captured.forEach(noSecret);
  assert.equal(safePrismaCode({ code: 'P2002' }), 'P2002');
  assert.equal(safePrismaCode({ code: 'P20021' }), undefined);
});

test('5. non-P2002 errors are not misclassified (500 generic, unchanged body)', async () => {
  for (const err of [new FakeKnownError('P2025', { target: ['email'] }), new FakeKnownError('P1001', {}), new Error('x'), 'str', null]) {
    assert.equal(isEmailUniqueConflict(err), false);
    const h = harness({ upsert: async () => { throw err; } });
    const res = await h.handler(h.req());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Profile sync failed' });
  }
  // readback-stage failure is never treated as a conflict even if it looks like one
  const h = harness({ readback: () => { throw adapterP2002({ fields: ['email'] }); } });
  const res = await h.handler(h.req());
  assert.equal(res.status, 500);
  assert.deepEqual(h.logs, [['[sync-profile] SYNC_FAILED', { stage: 'readback', prismaCode: 'P2002' }]]);
});

test('6. other / ambiguous P2002 targets are NOT email conflicts', async () => {
  const notEmail = [
    adapterP2002({ fields: ['username'] }),
    adapterP2002({ fields: ['email', 'username'] }),
    adapterP2002({ index: 'User_username_key' }),
    adapterP2002(undefined),
    adapterP2002({ foreignKey: {} }),
    new FakeKnownError('P2002', { driverAdapterError: { cause: { kind: 'Other', constraint: { fields: ['email'] } } } }),
    new FakeKnownError('P2002', { target: ['username'] }),
    new FakeKnownError('P2002', { target: 'emails' }),
    new FakeKnownError('P2002', {}),
    new FakeKnownError('P2002', undefined),
  ];
  for (const err of notEmail) {
    assert.equal(isEmailUniqueConflict(err), false, JSON.stringify((err as FakeKnownError).meta));
    const h = harness({ upsert: async () => { throw err; } });
    const res = await h.handler(h.req());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Profile sync failed' });
  }
});

test('7. conflict causes no other DB access (no merge, no id change, no email lookup)', async () => {
  const h = harness({ upsert: async () => { throw adapterP2002({ fields: ['email'] }); } });
  await h.handler(h.req());
  assert.deepEqual(h.calls.map((c) => c.op), ['getUser', 'findUsernameOwner', 'upsert']);
  const up = h.calls[2].args as { where: Record<string, unknown> };
  assert.deepEqual(Object.keys(up.where), ['id']);
});

test('8. auth/env failures unchanged and never touch the DB', async () => {
  const cases: [ReturnType<typeof harness>, string | null, number, unknown][] = [
    [harness({ env: {} }), `Bearer ${TOKEN}`, 500, { error: 'Supabase env not configured' }],
    [harness(), null, 401, { error: 'Missing token' }],
    [harness({ authError: new Error('bad') }), `Bearer ${TOKEN}`, 401, { error: 'Invalid session' }],
    [harness({ user: null }), `Bearer ${TOKEN}`, 401, { error: 'Invalid session' }],
    [harness({ user: { id: ID, email: null } }), `Bearer ${TOKEN}`, 401, { error: 'Invalid session' }],
  ];
  for (const [h, auth, status, body] of cases) {
    const res = await h.handler(h.req(auth));
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), body);
    assert.ok(!h.calls.some((c) => c.op !== 'getUser'));
  }
});

test('9. frontend contract: 409 body has no `error` field (callers fall back to their generic message)', async () => {
  const h = harness({ upsert: async () => { throw adapterP2002({ fields: ['email'] }); } });
  const res = await h.handler(h.req());
  const body = (await res.json()) as { error?: string; code?: string };
  assert.equal(body.error, undefined);
  assert.equal(body.code, 'ACCOUNT_EMAIL_CONFLICT');
  assert.equal(res.ok, false);
});
