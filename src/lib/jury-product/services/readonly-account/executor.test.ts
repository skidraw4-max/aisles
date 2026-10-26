import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequestGuard, executeReadonlyObservation, runReadonlyObservation, type ObservationDriver, type ObservedRequest, type RequestVerdict } from './executor';

const scope = { allowedOrigins: ['https://app.example.com'], paths: ['/admin', '/dashboard'] };
const login = { loginUrl: 'https://app.example.com/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', successPathPrefix: '/dashboard' };
const credential = { username: 'admin@example.com', password: 'pw-secret' };

type Page = { text: string; challenge?: 'TWO_FACTOR' | 'CAPTCHA'; subrequests?: ObservedRequest[]; onClick?: Record<string, ObservedRequest> };

function fakeDriver(pages: Record<string, Page>, opts: { loginOk?: boolean; challengeAfterLogin?: 'TWO_FACTOR' | 'CAPTCHA'; redirect?: Record<string, string> } = {}) {
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  let url = 'about:blank';
  let afterLogin = false;
  const log = { requests: [] as (ObservedRequest & { verdict: RequestVerdict })[], fills: [] as string[], clicks: 0, closed: false };
  const send = (r: ObservedRequest) => {
    const verdict = guard(r);
    log.requests.push({ ...r, verdict });
    return verdict;
  };
  const driver: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(target) {
      if (send({ method: 'GET', url: target, isFormSubmit: false, isNavigation: true }) === 'block') return;
      url = opts.redirect?.[target] ?? target;
      for (const sub of pages[new URL(url).pathname]?.subrequests ?? []) send(sub);
    },
    async fill(selector) { log.fills.push(selector); },
    async click() {
      log.clicks += 1;
      const verdict = send({ method: 'POST', url: 'https://app.example.com/login', isFormSubmit: true, isNavigation: true });
      afterLogin = true;
      if (verdict === 'allow' && opts.loginOk !== false) {
        url = 'https://app.example.com/dashboard';
        for (const sub of pages['/dashboard']?.subrequests ?? []) send(sub);
      }
      // a hostile page tries a second POST right after login
      send({ method: 'POST', url: 'https://app.example.com/api/delete', isFormSubmit: false, isNavigation: false });
    },
    async currentUrl() { return url; },
    async detectChallenge() {
      if (afterLogin && opts.challengeAfterLogin) return opts.challengeAfterLogin;
      return pages[new URL(url).pathname]?.challenge ?? 'NONE';
    },
    async snapshotText() { return pages[new URL(url).pathname]?.text ?? ''; },
    async close() { log.closed = true; },
  };
  return { driver, log };
}

const pages: Record<string, Page> = {
  '/login': { text: 'login' },
  '/dashboard': {
    text: 'dash',
    subrequests: [
      { method: 'GET', url: 'https://app.example.com/api/stats', isFormSubmit: false, isNavigation: false },
      { method: 'GET', url: 'https://tracker.evil.test/p', isFormSubmit: false, isNavigation: false },
      { method: 'DELETE', url: 'https://app.example.com/api/users/1', isFormSubmit: false, isNavigation: false },
      { method: 'GET', url: 'https://app.example.com/search?q=1', isFormSubmit: true, isNavigation: true },
    ],
  },
  '/admin/users': { text: 'users list' },
};

test('admin account logs in once and observes read-only', async () => {
  const { driver, log } = fakeDriver(pages);
  const report = await executeReadonlyObservation({ driver, credential, scope, login, actions: [
    { type: 'snapshot', label: 'home' }, { type: 'goto', path: '/admin/users' }, { type: 'snapshot', label: 'users' },
  ] });
  assert.equal(report.ok, true);
  assert.equal(report.loginAttempts, 1);
  assert.equal(log.clicks, 1);
  assert.deepEqual(report.snapshots.map((s) => s.text), ['dash', 'users list']);
  const nonRead = log.requests.filter((r) => r.verdict === 'allow' && !['GET', 'HEAD'].includes(r.method));
  assert.equal(nonRead.length, 1);
  assert.equal(nonRead[0].url, 'https://app.example.com/login');
  assert.deepEqual(report.blockedRequests.map((b) => b.reason).sort(), ['FORM_SUBMIT', 'LOGIN_ALREADY_USED', 'METHOD', 'ORIGIN']);
  assert.equal(log.closed, true);
  assert.doesNotMatch(JSON.stringify(report), /pw-secret/);
});

test('2FA or captcha stops and reports without retry', async () => {
  for (const kind of ['TWO_FACTOR', 'CAPTCHA'] as const) {
    const after = fakeDriver(pages, { challengeAfterLogin: kind });
    const r1 = await executeReadonlyObservation({ driver: after.driver, credential, scope, login, actions: [{ type: 'snapshot', label: 'x' }] });
    assert.deepEqual([r1.ok, r1.stop, r1.challenge, r1.loginAttempts, r1.snapshots.length], [false, 'CHALLENGE_REQUIRED', kind, 1, 0]);
    const before = fakeDriver({ ...pages, '/login': { text: 'login', challenge: kind } });
    const r2 = await executeReadonlyObservation({ driver: before.driver, credential, scope, login, actions: [] });
    assert.deepEqual([r2.stop, r2.loginAttempts, before.log.fills.length], ['CHALLENGE_REQUIRED', 0, 0]);
  }
});

test('failed login is a single attempt and stops', async () => {
  const { driver, log } = fakeDriver(pages, { loginOk: false });
  const r = await executeReadonlyObservation({ driver, credential, scope, login, actions: [] });
  assert.deepEqual([r.stop, r.loginAttempts, log.clicks], ['LOGIN_FAILED', 1, 1]);
});

test('non-allowlisted actions and out-of-scope paths are rejected before any request', async () => {
  for (const actions of [[{ type: 'click', selector: '#delete' }], [{ type: 'goto', path: '/settings' }], [{ type: 'goto', path: '//evil.test/x' }]]) {
    const { driver, log } = fakeDriver(pages);
    const r = await executeReadonlyObservation({ driver, credential, scope, login, actions: actions as never });
    assert.equal(r.stop, 'ACTION_NOT_ALLOWED');
    assert.equal(log.requests.length, 0);
  }
  const { driver } = fakeDriver(pages);
  const r = await executeReadonlyObservation({ driver, credential, scope, login: { ...login, loginUrl: 'https://other.example.com/login' }, actions: [] });
  assert.equal(r.stop, 'SCOPE_INVALID');
});

test('redirect outside scope stops navigation', async () => {
  const { driver } = fakeDriver(pages, { redirect: { 'https://app.example.com/admin/users': 'https://app.example.com/settings/delete' } });
  const r = await executeReadonlyObservation({ driver, credential, scope, login, actions: [{ type: 'goto', path: '/admin/users' }] });
  assert.equal(r.stop, 'NAVIGATION_BLOCKED');
});

test('request guard: only GET/HEAD after login, single login POST, http and foreign origins blocked', () => {
  const p = createRequestGuard({ scope, loginOrigin: 'https://app.example.com' });
  const req = (method: string, url: string, isFormSubmit = false) => p.guard({ method, url, isFormSubmit, isNavigation: false });
  assert.equal(req('POST', 'https://app.example.com/login', true), 'block');
  p.beginLoginSubmit();
  assert.equal(req('POST', 'https://app.example.com/login', true), 'allow');
  assert.equal(req('POST', 'https://app.example.com/login', true), 'block');
  p.endLogin();
  assert.equal(req('HEAD', 'https://app.example.com/x'), 'allow');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(req(m, 'https://app.example.com/x'), 'block');
  assert.equal(req('GET', 'http://app.example.com/x'), 'block');
  assert.equal(req('GET', 'https://app.example.com/x', true), 'block');
});

test('gated entry point blocks everything when disabled', async () => {
  const { driver, log } = fakeDriver(pages);
  const r = await runReadonlyObservation({ driver, credential, scope, login, actions: [] }, false);
  assert.equal(r.stop, 'NOT_IMPLEMENTED');
  assert.equal(log.requests.length, 0);
});
