import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { createTestKeyProvider, encryptAccountCredential } from './credential-crypto';
import type { ObservationDriver } from './executor';
import { resolveEnvKeyProvider, READONLY_ACCOUNT_KEK_ENV } from './key-provider';
import { attachObservationToPack, observeWithStoredCredential, summarizeObservation } from './observation-evidence';

const ctx = { tenantId: 't1', connectionId: 'c1' };

test('env key provider: NOT_CONFIGURED when missing or malformed, round-trips when set', async () => {
  assert.deepEqual(resolveEnvKeyProvider(() => undefined), { ok: false, reason: 'NOT_CONFIGURED' });
  assert.deepEqual(resolveEnvKeyProvider(() => 'c2hvcnQ='), { ok: false, reason: 'NOT_CONFIGURED' });
  const fake = Buffer.alloc(32, 7).toString('base64');
  const seen: string[] = [];
  const r = resolveEnvKeyProvider((name) => { seen.push(name); return name === READONLY_ACCOUNT_KEK_ENV ? fake : undefined; });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(!JSON.stringify(r.provider).includes(fake));
  const enc = await encryptAccountCredential({ username: 'admin@x', password: 'pw-123' }, ctx, r.provider);
  assert.ok(!JSON.stringify(enc).includes('pw-123'));
  assert.deepEqual(seen.sort(), ['JURY_ACCOUNT_CREDENTIAL_KEK', 'JURY_ACCOUNT_CREDENTIAL_KEK_ID']);
});

const report = {
  ok: true,
  loginAttempts: 1,
  snapshots: [
    { label: 'dash', url: 'https://app.example.com/dashboard?email=a@b.c', text: '홍길동 a@b.c 매출 100' },
    { label: 'empty', url: 'https://app.example.com/reports', text: '  ' },
  ],
  blockedRequests: [{ method: 'POST', url: 'https://app.example.com/api', reason: 'LOGIN_ALREADY_USED' as const }],
};

test('summary keeps counts/visibility only, no text or query strings', () => {
  const s = summarizeObservation(report);
  const json = JSON.stringify(s);
  for (const leak of ['홍길동', 'a@b.c', 'email=', '/api']) assert.ok(!json.includes(leak), leak);
  assert.equal(s.pagesObserved, 2);
  assert.deepEqual(s.pages.map((p) => p.visible), [true, false]);
  assert.equal(s.blockedByReason.LOGIN_ALREADY_USED, 1);
});

test('attachObservationToPack appends hints without touching aggregates', () => {
  const pack = { generatedAt: 'x', site: { name: 's', corridors: [], stackNotes: [] }, aggregates: { a: 1 }, metricDefinitions: {}, docsHints: ['h'], piiExcluded: true, readOnly: true } as unknown as EvidencePack;
  const out = attachObservationToPack(pack, summarizeObservation(report));
  assert.equal(out.aggregates, pack.aggregates);
  assert.equal(out.docsHints.length, 4);
  assert.ok(out.docsHints[2].includes('visible=1'));
});

function closingDriver() {
  let closed = 0;
  const d = { close: async () => { closed += 1; } } as unknown as ObservationDriver;
  return { d, closed: () => closed };
}

test('stored credential is decrypted through the provider; flag off → NOT_IMPLEMENTED summary', async () => {
  const provider = createTestKeyProvider();
  const enc = await encryptAccountCredential({ username: 'admin', password: 'pw' }, ctx, provider);
  const base = { context: ctx, provider, scope: { allowedOrigins: ['https://app.example.com'], paths: ['/'] }, login: { loginUrl: 'https://app.example.com/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', successPathPrefix: '/' }, actions: [] };
  const live = { ...enc, expiresAt: new Date(Date.now() + 60_000), destroyedAt: null };
  const a = closingDriver();
  const r = await observeWithStoredCredential({ ...base, record: live, driver: a.d });
  assert.equal(r.ok && r.summary.stop, 'NOT_IMPLEMENTED');
  const b = closingDriver();
  assert.deepEqual(await observeWithStoredCredential({ ...base, record: { ...live, expiresAt: new Date(0) }, driver: b.d }), { ok: false, reason: 'CREDENTIAL_EXPIRED' });
  assert.equal(b.closed(), 1);
  assert.deepEqual(await observeWithStoredCredential({ ...base, record: { ...live, destroyedAt: new Date() }, driver: b.d }), { ok: false, reason: 'CREDENTIAL_UNAVAILABLE' });
  assert.deepEqual(await observeWithStoredCredential({ ...base, record: live, context: { ...ctx, connectionId: 'other' }, driver: b.d }), { ok: false, reason: 'DECRYPT_FAILED' });
});
