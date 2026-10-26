import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillVerified, type PwPage } from './browser-driver';
import { executeReadonlyObservation, originPath, type ObservationDriver, type ObservedRequest, type RequestVerdict } from './executor';
import { logBlockedRequests } from './observation-evidence';
import { readonlyAccountStopText } from './result-text';

const APP = 'https://app.example.com';
const scope = { allowedOrigins: [APP], paths: ['/projects'] };
const login = { loginUrl: `${APP}/login`, usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', successPathPrefix: '/projects' };
const credential = { username: 'user@example.com', password: 'pw-secret' };

function inputPage(resetsFirst: number) {
  const values = new Map<string, string>();
  const calls: string[] = [];
  let fills = 0;
  const page = {
    async waitForSelector(sel: string, o: { state?: string }) { calls.push(`wait:${sel}:${o.state}`); return null; },
    async fill(sel: string, v: string) { fills += 1; calls.push(`fill:${sel}`); values.set(sel, fills <= resetsFirst ? '' : v); },
    async inputValue(sel: string) { return values.get(sel) ?? ''; },
    async waitForTimeout() { calls.push('delay'); },
  } as unknown as PwPage;
  return { page, calls };
}

test('I-046 fill: waits for visible field, verifies value, re-fills once', async () => {
  const ok = inputPage(0);
  assert.equal(await fillVerified(ok.page, '#u', 'x'), true);
  assert.deepEqual(ok.calls, ['wait:#u:visible', 'fill:#u']);
  const once = inputPage(1);
  assert.equal(await fillVerified(once.page, '#u', 'x'), true);
  assert.deepEqual(once.calls, ['wait:#u:visible', 'fill:#u', 'delay', 'fill:#u']);
  const never = inputPage(5);
  assert.equal(await fillVerified(never.page, '#u', 'x'), false);
  assert.equal(never.calls.filter((c) => c.startsWith('fill')).length, 2);
});

function driver(opts: { fillOk?: boolean; sendLogin?: boolean; landTo?: string }) {
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  let url = 'about:blank';
  const log = { gotoOpts: [] as unknown[], clicks: 0 };
  const d: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(t, o) { log.gotoOpts.push(o); guard({ method: 'GET', url: t, isFormSubmit: false, isNavigation: true }); url = t; },
    async fill() { return opts.fillOk !== false; },
    async click() {
      log.clicks += 1;
      if (opts.sendLogin !== false) guard({ method: 'POST', url: `${APP}/login`, isFormSubmit: true, isNavigation: true });
      if (opts.landTo) url = opts.landTo;
    },
    async currentUrl() { return url; },
    async detectChallenge() { return 'NONE'; },
    async snapshotText() { return 'ok'; },
    async close() {},
  };
  return { d, log };
}

test('I-046 executor: login page goto is marked, fill failure stops before click', async () => {
  const { d, log } = driver({ fillOk: false });
  const r = await executeReadonlyObservation({ driver: d, credential, scope, login, actions: [] });
  assert.deepEqual([r.stop, r.loginAttempts, log.clicks, log.gotoOpts[0]], ['LOGIN_NOT_SUBMITTED', 0, 0, { login: true }]);
});

test('I-046 executor: no login request => LOGIN_NOT_SUBMITTED; no redirect => LOGIN_NO_REDIRECT; final URL has no query', async () => {
  const a = await executeReadonlyObservation({ driver: driver({ sendLogin: false }).d, credential, scope, login, actions: [] });
  assert.deepEqual([a.stop, a.loginRequestUsed, a.finalUrl], ['LOGIN_NOT_SUBMITTED', false, `${APP}/login`]);
  const b = await executeReadonlyObservation({ driver: driver({ landTo: `${APP}/login?error=bad&email=a%40b.com#x` }).d, credential, scope, login, actions: [] });
  assert.deepEqual([b.stop, b.loginRequestUsed, b.finalUrl], ['LOGIN_NO_REDIRECT', true, `${APP}/login`]);
  const c = await executeReadonlyObservation({ driver: driver({ landTo: `${APP}/projects?t=1` }).d, credential, scope, login, actions: [] });
  assert.deepEqual([c.ok, c.finalUrl], [true, `${APP}/projects`]);
  assert.equal(originPath('about:blank'), 'about:');
  assert.equal(originPath('not a url'), 'invalid');
});

test('I-046 log + messages: loginRequestUsed and finalUrl logged; split stops have their own text', () => {
  const lines: string[] = [];
  logBlockedRequests({ ok: false, stop: 'LOGIN_NO_REDIRECT', loginAttempts: 1, loginRequestUsed: true, finalUrl: `${APP}/login`, snapshots: [], blockedRequests: [] }, 'c1', (l) => lines.push(l));
  const j = JSON.parse(lines[0]);
  assert.deepEqual([j.loginRequestUsed, j.finalUrl, j.stop], [true, `${APP}/login`, 'LOGIN_NO_REDIRECT']);
  for (const s of ['LOGIN_NOT_SUBMITTED', 'LOGIN_NO_REDIRECT']) assert.notEqual(readonlyAccountStopText(s), '관찰을 중단했습니다.');
});
