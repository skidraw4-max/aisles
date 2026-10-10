import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  juryAppOrigin,
  juryEmailVerificationDestination,
  juryHref,
  juryOAuthRedirect,
  juryPasswordResetDestination,
  jurySignupHref,
  normalizeJuryRoute,
  safeJuryNext,
} from './jury-url';

const ORIGIN = 'https://jury.aisleshub.com';

test('without a Jury origin, links stay on the legacy /jury routes', () => {
  assert.equal(juryAppOrigin(''), null);
  assert.equal(juryAppOrigin(undefined), null);
  assert.equal(juryHref('/', undefined, null), '/jury');
  assert.equal(juryHref('/login', undefined, null), '/jury/login');
  assert.equal(juryHref('/dashboard', undefined, null), '/jury');
  assert.equal(juryHref('/reviews', undefined, null), '/jury/reviews');
  assert.equal(juryHref('/services/new', undefined, null), '/jury/services/new');
  assert.equal(juryHref('/reviews/abc123', undefined, null), '/jury/reviews/abc123');
  assert.equal(juryHref('/signup', undefined, null), '/jury/signup');
  assert.equal(juryHref('/organization/create', undefined, null), '/jury/organization/create');
  assert.equal(jurySignupHref(null), '/jury/signup');
  assert.equal(safeJuryNext('/jury/reviews', null), '/jury/reviews');
});

test('a canonical Jury origin drops the legacy prefix', () => {
  assert.equal(juryHref('/', undefined, ORIGIN), 'https://jury.aisleshub.com/');
  assert.equal(juryHref('/login', undefined, ORIGIN), 'https://jury.aisleshub.com/login');
  assert.equal(juryHref('/dashboard', undefined, ORIGIN), 'https://jury.aisleshub.com/dashboard');
  assert.equal(juryHref('/services', undefined, ORIGIN), 'https://jury.aisleshub.com/services');
  assert.equal(juryHref('/reviews', undefined, ORIGIN), 'https://jury.aisleshub.com/reviews');
  assert.equal(juryHref('/improvements', undefined, ORIGIN), 'https://jury.aisleshub.com/improvements');
  assert.equal(juryHref('/settings', undefined, ORIGIN), 'https://jury.aisleshub.com/settings');
  assert.equal(juryHref('/signup', undefined, ORIGIN), 'https://jury.aisleshub.com/signup');
  assert.equal(juryHref('/organization/create', undefined, ORIGIN), 'https://jury.aisleshub.com/organization/create');
  assert.equal(jurySignupHref(ORIGIN), 'https://jury.aisleshub.com/signup');
  assert.equal(safeJuryNext('/jury', ORIGIN), 'https://jury.aisleshub.com/');
  assert.equal(safeJuryNext('https://evil.example.com', ORIGIN), 'https://jury.aisleshub.com/');
});

test('external and malformed redirect targets stay on /jury', () => {
  for (const input of [
    'https://evil.example/phish',
    '//evil.example',
    '/\\evil.example',
    '/reviews/../../etc/passwd',
    '/reviews/%2e%2e',
    'javascript:alert(1)',
    '/not-a-jury-page',
    '/reviews/id?next=https://evil.example',
  ]) {
    assert.equal(normalizeJuryRoute(input), null, input);
    assert.equal(juryHref(input), '/jury', input);
  }
  assert.equal(juryOAuthRedirect('javascript:alert(1)'), null);
  assert.equal(juryOAuthRedirect('https://user:pass@evil.example'), null);
  const oauth = juryOAuthRedirect('https://www.aisleshub.com/ignored');
  assert.equal(oauth?.next, '/jury');
  assert.equal(oauth?.redirectTo, 'https://www.aisleshub.com/auth/callback?next=%2Fjury');
  assert.equal(juryPasswordResetDestination('https://www.aisleshub.com'), 'https://www.aisleshub.com/auth/reset-callback');
  assert.equal(juryEmailVerificationDestination('https://www.aisleshub.com'), 'https://www.aisleshub.com/auth/callback?next=%2Fjury');
  assert.equal(safeJuryNext('//evil.example.com'), '/jury');
  assert.equal(safeJuryNext('javascript:alert(1)'), '/jury');
  assert.equal(safeJuryNext('%2F%2Fevil.example.com'), '/jury');
  assert.equal(juryAppOrigin('https://jury.aisleshub.com/extra'), null);
  assert.equal(juryAppOrigin('https://user:secret@jury.aisleshub.com'), null);
});

test('legacy Jury pages remain mounted', () => {
  for (const file of [
    'src/app/(root)/jury/page.tsx',
    'src/app/(root)/jury/login/page.tsx',
    'src/app/(root)/jury/signup/page.tsx',
    'src/app/(root)/jury/organization/create/page.tsx',
    'src/app/(root)/jury/reviews/page.tsx',
    'src/app/(root)/jury/services/page.tsx',
    'src/app/(root)/jury/evidence/page.tsx',
    'src/app/(root)/jury/improvements/page.tsx',
    'src/app/(root)/jury/audit/page.tsx',
    'src/app/(root)/jury/settings/page.tsx',
  ]) {
    assert.equal(existsSync(path.resolve(process.cwd(), file)), true, file);
  }
});
