import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeObservationScope, observationScopeHash } from './consent';
import { createRequestGuard, type ObservedRequest } from './executor';
import { waitAfterLoginClick, type PwPage } from './browser-driver';
import { describeBlockedRequests, logBlockedRequests } from './observation-evidence';

const APP = 'https://app.example.com';
const AUTH = 'https://proj.supabase.co';
const scope = { allowedOrigins: [APP], authOrigins: [AUTH], paths: ['/projects'] };
const r = (method: string, url: string, extra: Partial<ObservedRequest> = {}): ObservedRequest => ({ method, url, isFormSubmit: false, isNavigation: false, ...extra });

test('I-045 scope: authOrigins normalized, deduped against allowedOrigins, omitted from hash when empty', () => {
  const n = normalizeObservationScope({ allowedOrigins: [APP], authOrigins: [`${AUTH}/auth/v1`, APP], paths: ['/projects'] });
  assert.deepEqual(n, { ok: true, scope: { allowedOrigins: [APP], authOrigins: [AUTH], paths: ['/projects'] } });
  assert.equal(normalizeObservationScope({ allowedOrigins: [APP], authOrigins: ['http://x.com'], paths: ['/'] }).ok, false);
  const legacy = normalizeObservationScope({ allowedOrigins: [APP], paths: ['/projects'] });
  const empty = normalizeObservationScope({ allowedOrigins: [APP], authOrigins: [], paths: ['/projects'] });
  assert.ok(legacy.ok && empty.ok);
  assert.equal(observationScopeHash(legacy.scope), observationScopeHash(empty.scope));
  assert.ok(n.ok && observationScopeHash(n.scope) !== observationScopeHash(legacy.scope));
});

test('I-045 guard: auth origin allows reads always and exactly one password-login POST during login', () => {
  const p = createRequestGuard({ scope, loginOrigin: APP });
  assert.equal(p.guard(r('GET', `${AUTH}/auth/v1/user`)), 'allow');
  assert.equal(p.guard(r('OPTIONS', `${AUTH}/auth/v1/token?grant_type=password`)), 'allow');
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/token?grant_type=password`)), 'block', 'not before login phase');
  p.beginLoginSubmit();
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/signup`)), 'block');
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/token?grant_type=password&x=1`)), 'block');
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/token?grant_type=password`)), 'allow');
  assert.equal(p.loginRequestUsed, true);
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/token?grant_type=password`)), 'block');
  assert.equal(p.guard(r('POST', `${APP}/login`)), 'block', 'login slot shared with app origin');
  p.endLogin();
  assert.equal(p.guard(r('GET', `${AUTH}/rest/v1/projects?select=*`)), 'allow');
  assert.equal(p.guard(r('HEAD', `${AUTH}/rest/v1/projects`)), 'allow');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(p.guard(r(m, `${AUTH}/rest/v1/projects`)), 'block', m);
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/token?grant_type=refresh_token`)), 'block', 'refresh not allowed');
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/logout`)), 'block');
  assert.equal(p.guard(r('GET', `${AUTH}/x`, { isNavigation: true })), 'block', 'auth origin is not navigable');
  assert.equal(p.guard(r('POST', `${AUTH}/x`, { isFormSubmit: true, isNavigation: true })), 'block');
  assert.equal(p.guard(r('GET', 'https://ads.example.net/a.js')), 'block');
});

test('I-045 guard: without authOrigins a cross-origin login POST stays blocked (previous behavior)', () => {
  const p = createRequestGuard({ scope: { allowedOrigins: [APP], paths: ['/'] }, loginOrigin: APP });
  p.beginLoginSubmit();
  assert.equal(p.guard(r('POST', `${AUTH}/auth/v1/token?grant_type=password`)), 'block');
  assert.equal(p.loginRequestUsed, false);
});

function fakePage(opts: { urlMatches: boolean }) {
  const calls: string[] = [];
  const page = {
    async waitForURL(pred: (u: URL) => boolean, o?: { timeout?: number }) {
      calls.push(`url:${(o?.timeout ?? 0) > 0}`);
      assert.equal(pred(new URL(`${APP}/login`)), false);
      assert.equal(pred(new URL(`${APP}/projects`)), true);
      if (!opts.urlMatches) throw new Error('timeout');
    },
    async waitForLoadState(state?: string) {
      calls.push(`load:${state}`);
    },
  } as unknown as PwPage;
  return { page, calls };
}

test('I-045 driver: waits for success URL, falls back to networkidle', async () => {
  const a = fakePage({ urlMatches: true });
  await waitAfterLoginClick(a.page, { successPathPrefix: '/projects', loginPath: '/login' });
  assert.deepEqual(a.calls.map((c) => c.split(':')[0] + ':' + c.split(':')[1]), ['url:true', 'load:domcontentloaded']);
  const b = fakePage({ urlMatches: false });
  await waitAfterLoginClick(b.page, { successPathPrefix: '/projects', loginPath: '/login' });
  assert.deepEqual(b.calls.slice(1), ['load:networkidle']);
});

test('I-045 log: blocked requests logged as method + origin + path only', () => {
  const report = {
    ok: false,
    stop: 'LOGIN_FAILED' as const,
    loginAttempts: 1,
    snapshots: [],
    blockedRequests: [{ method: 'POST', url: `${AUTH}/auth/v1/token?grant_type=password&email=a%40b.com`, reason: 'ORIGIN' as const }],
  };
  assert.deepEqual(describeBlockedRequests(report), [{ method: 'POST', origin: AUTH, path: '/auth/v1/token', reason: 'ORIGIN' }]);
  const lines: string[] = [];
  logBlockedRequests(report, 'c1', (l) => lines.push(l));
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('?') && !lines[0].includes('grant_type') && !lines[0].includes('%40'));
});
