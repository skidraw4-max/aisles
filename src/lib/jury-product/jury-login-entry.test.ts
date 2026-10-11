import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { juryLoginOutcome } from './jury-login-entry';
import { juryReturnQuery } from './jury-url';
import { JURY_LOGIN_STORE_UNAVAILABLE_NOTICE } from '../auth/account-email-conflict';

const ORIGIN_UNSET = null;
const CANON = 'https://jury.aisleshub.com';
const INVITE = `/jury/invitation/${'a'.repeat(43)}`;
const signedIn = { ok: true as const, userId: 'u1', tenantId: 't1', role: 'OWNER' as const, membershipId: 'm1' };
const out = (entry: Parameters<typeof juryLoginOutcome>[0], next: string | null, origin: string | null = ORIGIN_UNSET) =>
  juryLoginOutcome(entry, juryReturnQuery(next), origin);

test('1. Jury login states', () => {
  assert.deepEqual(out({ ok: false, reason: 'UNAUTHENTICATED' }, '/jury/reviews'), { kind: 'form' });
  assert.deepEqual(out({ ok: false, reason: 'EMAIL_UNVERIFIED' }, null), { kind: 'form', notice: 'EMAIL_UNVERIFIED' });
  assert.deepEqual(out({ ok: false, reason: 'STORE_UNAVAILABLE' }, '/jury/reviews'), { kind: 'form', notice: 'STORE_UNAVAILABLE' });
  assert.deepEqual(out({ ok: false, reason: 'NO_MEMBERSHIP' }, null), { kind: 'redirect', href: '/jury/organization/create' });
  assert.deepEqual(out({ ok: false, reason: 'NO_MEMBERSHIP' }, null, CANON), { kind: 'redirect', href: `${CANON}/organization/create` });
  assert.deepEqual(out(signedIn, null), { kind: 'redirect', href: '/jury' });
  assert.deepEqual(out(signedIn, '/jury/reviews'), { kind: 'redirect', href: '/jury/reviews' });
  // Multiple organizations resolve to ok:true (oldest or cookie-selected), so they follow entry.ok.
  // AMBIGUOUS_MEMBERSHIP is unreachable from getJuryEntry today and keeps the form unchanged.
  assert.deepEqual(out({ ok: false, reason: 'AMBIGUOUS_MEMBERSHIP' }, '/jury/reviews'), { kind: 'form' });
});

test('2. NO_MEMBERSHIP: only a well-formed invitation path wins over organization creation', () => {
  assert.deepEqual(out({ ok: false, reason: 'NO_MEMBERSHIP' }, INVITE), { kind: 'redirect', href: INVITE });
  assert.deepEqual(out({ ok: false, reason: 'NO_MEMBERSHIP' }, INVITE, CANON), { kind: 'redirect', href: `${CANON}/invitation/${'a'.repeat(43)}` });
  for (const n of ['/jury/reviews', '/jury/invitation/short', '/jury/invitation/' + 'a'.repeat(44)]) {
    assert.deepEqual(out({ ok: false, reason: 'NO_MEMBERSHIP' }, n), { kind: 'redirect', href: '/jury/organization/create' }, n);
  }
});

test('3. path safety: hostile next never leaves the Jury routes', () => {
  const bad = ['//evil.example', 'https://evil.example', '/%2F%2Fevil.example', '%2F%2Fevil.example', '/jury/%2e%2e/admin',
    '/jury/../admin', '/jury/invitation/../../evil', '/\\evil.example', '/jury/reviews?x=https://evil.example', 'javascript:alert(1)'];
  for (const n of bad) {
    for (const entry of [signedIn, { ok: false as const, reason: 'NO_MEMBERSHIP' as const }]) {
      const r = out(entry, n);
      assert.equal(r.kind, 'redirect', n);
      if (r.kind !== 'redirect') continue;
      assert.ok(r.href === '/jury' || r.href === '/jury/organization/create', `${n} -> ${r.href}`);
      const c = out(entry, n, CANON);
      if (c.kind === 'redirect') assert.equal(new URL(c.href).origin, CANON, n);
    }
  }
  assert.deepEqual(out(signedIn, '/jury/services/new'), { kind: 'redirect', href: '/jury/services/new' });
  assert.deepEqual(out(signedIn, INVITE), { kind: 'redirect', href: INVITE });
});

test('4. login page wiring: decision helper, store notice, single notice', () => {
  const page = readFileSync(new URL('../../app/(root)/jury/login/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /const outcome = juryLoginOutcome\(entry, returnQuery\);/);
  assert.match(page, /if \(outcome\.kind === 'redirect'\) redirect\(outcome\.href\);/);
  assert.match(page, /JURY_LOGIN_STORE_UNAVAILABLE_NOTICE/);
  assert.equal((page.match(/redirect\(/g) ?? []).length, 1);
  assert.ok(/[\uac00-\ud7a3]/.test(JURY_LOGIN_STORE_UNAVAILABLE_NOTICE));
  assert.ok(!/@|tenant|token/i.test(JURY_LOGIN_STORE_UNAVAILABLE_NOTICE));
});
