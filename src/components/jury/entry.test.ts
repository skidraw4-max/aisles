import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { juryEntrySurface } from './entry';

test('unauthenticated jury entry is the landing and every other actor stays on the console', () => {
  assert.equal(juryEntrySurface({ ok: false, reason: 'UNAUTHENTICATED' }), 'landing');
  assert.equal(juryEntrySurface({ ok: true }), 'console');
  assert.equal(juryEntrySurface({ ok: false, reason: 'NO_MEMBERSHIP' }), 'console');
  assert.equal(juryEntrySurface({ ok: false, reason: 'STORE_UNAVAILABLE' }), 'console');
  assert.equal(juryEntrySurface({ ok: false, reason: 'EMAIL_UNVERIFIED' }), 'console');
});

test('jury landing and login stay on the jury auth entry and the existing signup link', () => {
  const landing = readFileSync(new URL('./JuryLanding.tsx', import.meta.url), 'utf8');
  const login = readFileSync(new URL('./JuryLoginForm.tsx', import.meta.url), 'utf8');
  const loginPage = readFileSync(new URL('../../app/(root)/jury/login/page.tsx', import.meta.url), 'utf8');
  assert.match(landing, /AIsles Jury/);
  assert.match(landing, /by AIsles Studio/);
  assert.match(landing, /AI Services Under Review/);
  assert.match(landing, /Verify\. Improve\. Review Again\./);
  assert.match(landing, /Evidence/);
  assert.match(landing, /Re-review/);
  assert.match(landing, /juryHref\('\/login'\)/);
  assert.match(landing, /jurySignupHref\(\)/);
  assert.match(login, /signInWithPassword/);
  assert.match(login, /signInWithOAuth/);
  assert.match(login, /jurySignupHref\(\)/);
  assert.match(login, /juryHref\('\/'\)/);
  assert.match(login, /juryOAuthRedirect/);
  assert.equal(login.includes('tenantId'), false);
  assert.match(loginPage, /getJuryEntry/);
  assert.equal(loginPage.includes('signInWithPassword'), false);
});
