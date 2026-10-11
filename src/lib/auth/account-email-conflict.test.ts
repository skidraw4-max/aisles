import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT_EMAIL_CONFLICT_MESSAGE,
  AccountEmailConflictError,
  accountEmailConflictNotice,
  isAccountEmailConflictPayload,
  isAccountEmailConflictResponse,
  runProfileSync,
} from './account-email-conflict';
import { syncPrismaUserWithAuth } from '../sync-prisma-user';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const SECRET = 'SENTINEL_server_text secret.person@example.invalid 1111-2222';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

test('1. conflict only for status 409 AND code ACCOUNT_EMAIL_CONFLICT', async () => {
  assert.equal(isAccountEmailConflictPayload(409, { code: 'ACCOUNT_EMAIL_CONFLICT' }), true);
  for (const [s, b] of [[409, {}], [409, { code: 'OTHER' }], [409, null], [409, 'ACCOUNT_EMAIL_CONFLICT'], [500, { code: 'ACCOUNT_EMAIL_CONFLICT' }], [400, { code: 'ACCOUNT_EMAIL_CONFLICT' }]] as const) {
    assert.equal(isAccountEmailConflictPayload(s, b), false, `${s} ${JSON.stringify(b)}`);
  }
  assert.equal(await isAccountEmailConflictResponse(json(409, { code: 'ACCOUNT_EMAIL_CONFLICT' })), true);
  assert.equal(await isAccountEmailConflictResponse(new Response('not json', { status: 409 })), false);
  assert.equal(await isAccountEmailConflictResponse(json(500, { code: 'ACCOUNT_EMAIL_CONFLICT' })), false);
  assert.equal(await isAccountEmailConflictResponse(null), false);
});

test('2. syncPrismaUserWithAuth throws AccountEmailConflictError (fixed message) on conflict', async () => {
  await withFetch(async () => json(409, { code: 'ACCOUNT_EMAIL_CONFLICT', error: SECRET }), async () => {
    await assert.rejects(syncPrismaUserWithAuth('tok'), (e: unknown) => {
      assert.ok(e instanceof AccountEmailConflictError);
      assert.equal((e as Error).message, ACCOUNT_EMAIL_CONFLICT_MESSAGE);
      assert.ok(!(e as Error).message.includes('SENTINEL'));
      return true;
    });
  });
});

test('3. other errors keep existing behavior (500 / 409-other / non-json / network)', async () => {
  await withFetch(async () => json(500, { error: 'Profile sync failed' }), async () => {
    await assert.rejects(syncPrismaUserWithAuth('t'), (e: unknown) => !(e instanceof AccountEmailConflictError) && (e as Error).message === 'Profile sync failed');
  });
  await withFetch(async () => json(409, { code: 'SOMETHING_ELSE' }), async () => {
    await assert.rejects(syncPrismaUserWithAuth('t'), (e: unknown) => !(e instanceof AccountEmailConflictError));
  });
  await withFetch(async () => { throw new TypeError('network'); }, async () => {
    await assert.rejects(syncPrismaUserWithAuth('t'), (e: unknown) => e instanceof TypeError);
  });
});

test('4. success unchanged: returns the json body', async () => {
  await withFetch(async (_u, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer tok');
    return json(200, { ok: true, username: 'u' });
  }, async () => {
    assert.deepEqual(await syncPrismaUserWithAuth('tok'), { ok: true, username: 'u' });
  });
});

test('5. runProfileSync: conflict => "conflict" with no warn; other errors => warn + "proceed"', async () => {
  const warns: string[][] = [];
  const w = (t: string, d: string) => warns.push([t, d]);
  assert.equal(await runProfileSync(async () => { throw new AccountEmailConflictError(); }, 't', w), 'conflict');
  assert.equal(warns.length, 0);
  assert.equal(await runProfileSync(async () => { throw new Error('x'); }, 't', w, '[jury-auth] tag'), 'proceed');
  assert.deepEqual(warns, [['[jury-auth] tag', 'x']]);
  assert.equal(await runProfileSync(async () => ({ ok: true }), 't', w), 'proceed');
});

test('6. user-visible text is only the fixed Korean message (no server text/email/id/token)', () => {
  const n = accountEmailConflictNotice('account_email_conflict');
  assert.deepEqual(n, { type: 'err', text: ACCOUNT_EMAIL_CONFLICT_MESSAGE });
  assert.equal(accountEmailConflictNotice('auth_callback'), null);
  assert.equal(accountEmailConflictNotice(null), null);
  assert.ok(/[가-힣]/.test(ACCOUNT_EMAIL_CONFLICT_MESSAGE));
  assert.ok(!/@|Bearer|SENTINEL/.test(ACCOUNT_EMAIL_CONFLICT_MESSAGE));
});

const src = (rel: string) => readFileSync(path.join(repo, rel), 'utf8').replace(/\r\n/g, '\n');

test('7. UI callers stop on conflict and do not navigate/close (static wiring check)', () => {
  const am = src('src/components/AuthModal.tsx');
  assert.equal((am.match(/if \(!\(await syncProfileOrReportConflict\(data\.session\.access_token\)\)\) return;\n\s+onAuthed\(\);\n\s+onClose\(\);/g) ?? []).length, 3);
  assert.ok(!am.includes('syncProfileInBackground'));
  for (const f of ['src/components/jury/JuryLoginForm.tsx', 'src/components/jury/JurySignupForm.tsx']) {
    const s = src(f);
    assert.match(s, /if \(syncOutcome === 'conflict'\) \{\n\s+setMessage\(ACCOUNT_EMAIL_CONFLICT_MESSAGE\);\n\s+return;\n\s+\}\n\s+router\.push/);
    assert.ok(!s.includes('void syncPrismaUserWithAuth'));
  }
  const sp = src('src/components/SessionProvider.tsx');
  assert.ok(!sp.includes('ACCOUNT_EMAIL_CONFLICT'), 'SessionProvider intentionally shows nothing (no duplicate message)');
});

test('8. auth callback: conflict redirects to /login?error=account_email_conflict (non-fixed flows only)', () => {
  const cb = src('src/lib/supabase-auth-callback.ts');
  assert.equal((cb.match(/if \(await syncConflict\(syncRes\)\) return conflict\(\);/g) ?? []).length, 3);
  assert.ok(!cb.includes('}).catch(() => {});'));
  assert.match(cb, /options\.afterSuccess === 'fixed' \? Promise\.resolve\(false\)/);
  assert.match(cb, /\/login\?error=\$\{ACCOUNT_EMAIL_CONFLICT_QUERY\}/);
  const lc = src('src/app/(root)/login/LoginClient.tsx');
  assert.match(lc, /return accountEmailConflictNotice\(error\);/);
});
