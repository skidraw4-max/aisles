import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHALLENGE_PROBE, DISABLED_PROBE, toObservedRequest } from './browser-driver';
import { createRequestGuard, executeReadonlyObservation, type ObservationDriver, type ObservedRequest, type RequestVerdict } from './executor';
import { summarizeObservation } from './observation-evidence';
import { toLatestObservationRun } from './latest-observation';
import { readonlyAccountStopText } from './result-text';
import { blockedHostCounts, registrableSite } from './same-site';

type FakeEl = { rect: { width: number; height: number }; style?: { display?: string; visibility?: string }; parentElement?: FakeEl | null; hidden?: boolean };
function withDom<R>(dom: Record<string, FakeEl[]>, text: string, fn: () => R): R {
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { document: g.document, getComputedStyle: g.getComputedStyle };
  const wrap = (e: FakeEl): unknown => ({
    getBoundingClientRect: () => e.rect,
    getAttribute: (n: string) => (n === 'hidden' && e.hidden ? '' : null),
    get parentElement() { return e.parentElement ? wrap(e.parentElement) : null; },
    __e: e,
  });
  g.document = {
    querySelectorAll: (sel: string) => Object.entries(dom).filter(([k]) => sel.includes(k)).flatMap(([, v]) => v.map(wrap)),
    body: { innerText: text },
  };
  g.getComputedStyle = (el: { __e: FakeEl }) => el.__e.style ?? {};
  try {
    return fn();
  } finally {
    g.document = prev.document;
    g.getComputedStyle = prev.getComputedStyle;
  }
}

test('A: hidden reCAPTCHA placeholder (display:none, ATOMY) is not a challenge', () => {
  const hidden: FakeEl = { rect: { width: 0, height: 0 }, style: { display: 'none' } };
  assert.equal(withDom({ '.g-recaptcha': [hidden] }, 'login', CHALLENGE_PROBE), 'NONE');
});

test('A: hidden ancestor, visibility:hidden and zero size are ignored; a visible widget is CAPTCHA', () => {
  const parent: FakeEl = { rect: { width: 300, height: 80 }, style: { display: 'none' } };
  const inHidden: FakeEl = { rect: { width: 300, height: 80 }, parentElement: parent };
  const invisible: FakeEl = { rect: { width: 300, height: 80 }, style: { visibility: 'hidden' } };
  const zero: FakeEl = { rect: { width: 0, height: 0 } };
  const attrHidden: FakeEl = { rect: { width: 300, height: 80 }, hidden: true };
  assert.equal(withDom({ 'iframe[src*="recaptcha"]': [inHidden, invisible, zero, attrHidden] }, '', CHALLENGE_PROBE), 'NONE');
  const shown: FakeEl = { rect: { width: 304, height: 78 }, style: { display: 'block', visibility: 'visible' } };
  assert.equal(withDom({ '.g-recaptcha': [zero, shown] }, '', CHALLENGE_PROBE), 'CAPTCHA');
  assert.equal(withDom({ '.cf-turnstile': [shown] }, '', CHALLENGE_PROBE), 'CAPTCHA');
});

test('A: visible OTP input and 2FA text still stop', () => {
  const shown: FakeEl = { rect: { width: 100, height: 30 } };
  assert.equal(withDom({ 'one-time-code': [shown] }, '', CHALLENGE_PROBE), 'TWO_FACTOR');
  assert.equal(withDom({}, '인증번호를 입력하세요', CHALLENGE_PROBE), 'TWO_FACTOR');
});

test('registrable site: same eTLD+1, two-level suffixes, shared hosting not expanded', () => {
  assert.equal(registrableSite('kr.atomy.com'), 'atomy.com');
  assert.equal(registrableSite('resources.atomy.com'), 'atomy.com');
  assert.equal(registrableSite('shop.example.co.kr'), 'example.co.kr');
  assert.equal(registrableSite('co.kr'), null);
  assert.equal(registrableSite('myapp.vercel.app'), null);
  assert.equal(registrableSite('abc.supabase.co'), null);
  assert.equal(registrableSite('127.0.0.1'), null);
});

const atomyScope = { allowedOrigins: ['https://kr.atomy.com'], paths: ['/'] };
const sub = (url: string, resourceType: string, method = 'GET'): ObservedRequest => ({ method, url, isNavigation: false, isFormSubmit: false, resourceType });

test('B: same-site static GET subresources are allowed; xhr, writes, navigation and other sites stay blocked', () => {
  const p = createRequestGuard({ scope: atomyScope, loginOrigin: 'https://kr.atomy.com' });
  for (const t of ['script', 'stylesheet', 'image', 'font']) assert.equal(p.guard(sub(`https://resources.atomy.com/x/a.${t}`, t)), 'allow', t);
  assert.equal(p.guard(sub('https://api.atomy.com/data', 'xhr')), 'block');
  assert.equal(p.guard(sub('https://api.atomy.com/data', 'fetch')), 'block');
  assert.equal(p.guard(sub('https://resources.atomy.com/a.js', 'script', 'POST')), 'block');
  assert.equal(p.guard(sub('http://resources.atomy.com/a.js', 'script')), 'block');
  assert.equal(p.guard({ method: 'GET', url: 'https://www.atomy.com/', isNavigation: true, isFormSubmit: false, resourceType: 'document' }), 'block');
  assert.equal(p.guard({ method: 'GET', url: 'https://www.atomy.com/frame', isNavigation: true, isFormSubmit: false, resourceType: 'document' }), 'block');
  assert.equal(p.guard(sub('https://resources.atomy.com/a.js', '')), 'block');
  assert.equal(p.guard(sub('https://evilatomy.com/a.js', 'script')), 'block');
  assert.equal(p.guard(sub('https://atomy.com.evil.test/a.js', 'script')), 'block');
});

test('B: Google reCAPTCHA and tag hosts stay blocked', () => {
  const p = createRequestGuard({ scope: atomyScope, loginOrigin: 'https://kr.atomy.com' });
  for (const u of ['https://www.google.com/recaptcha/enterprise.js', 'https://www.gstatic.com/recaptcha/x.js', 'https://www.recaptcha.net/recaptcha/api.js']) {
    assert.equal(p.guard(sub(u, 'script')), 'block', u);
  }
  // I-097: tag hosts are never fetched; they are answered locally (stub), not allowed.
  assert.equal(p.guard(sub('https://www.googletagmanager.com/gtag/js', 'script')), 'stub');
  // even if a google origin were allowed, same-site expansion is never applied to it
  const g = createRequestGuard({ scope: { allowedOrigins: ['https://accounts.google.com'], paths: ['/'] }, loginOrigin: 'https://accounts.google.com' });
  assert.equal(g.guard(sub('https://www.google.com/recaptcha/api.js', 'script')), 'block');
});

test('B: toObservedRequest carries the resource type', () => {
  const r = toObservedRequest({ method: () => 'GET', url: () => 'https://resources.atomy.com/a.js', resourceType: () => 'script', isNavigationRequest: () => false });
  assert.equal(r.resourceType, 'script');
});

test('B: blocked hostnames are counted without paths or queries', () => {
  const hosts = blockedHostCounts([
    { url: 'https://www.google.com/recaptcha/api.js?render=KEY' },
    { url: 'https://www.google.com/x' },
    { url: 'https://www.googletagmanager.com/gtag/js?id=G-1' },
    { url: 'not a url' },
  ]);
  assert.deepEqual(hosts, { 'www.google.com': 2, invalid: 1, 'www.googletagmanager.com': 1 });
  assert.ok(!JSON.stringify(hosts).includes('recaptcha/api.js'));
  assert.ok(!JSON.stringify(hosts).includes('KEY'));
});

type DriverOpts = { disabled?: boolean; loginRequest?: ObservedRequest };
function atomyDriver(opts: DriverOpts = {}) {
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  let url = 'about:blank';
  const log = { clicks: 0, verdicts: [] as { url: string; verdict: RequestVerdict }[] };
  const send = (r: ObservedRequest) => {
    const verdict = guard(r);
    log.verdicts.push({ url: r.url, verdict });
    return verdict;
  };
  const driver: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(target) {
      if (send({ method: 'GET', url: target, isNavigation: true, isFormSubmit: false, resourceType: 'document' }) === 'block') return;
      url = target;
      send(sub('https://resources.atomy.com/js/overpass/login/login.js', 'script'));
      send(sub('https://www.google.com/recaptcha/enterprise.js', 'script'));
    },
    async fill() { return true; },
    async isDisabled() { return opts.disabled === true; },
    async click() {
      log.clicks += 1;
      // type="button" + jQuery AJAX: a same-origin XHR POST, not a form submit navigation
      const verdict = send(opts.loginRequest ?? { method: 'POST', url: 'https://kr.atomy.com/login/doLogin', isNavigation: false, isFormSubmit: false, resourceType: 'xhr' });
      if (verdict === 'allow') url = 'https://kr.atomy.com/';
    },
    async currentUrl() { return url; },
    async detectChallenge() { return 'NONE'; },
    async snapshotText() { return 'home'; },
    async close() {},
  };
  return { driver, log };
}
const atomyLogin = { loginUrl: 'https://kr.atomy.com/login', usernameSelector: '#login_id', passwordSelector: '#login_pw', submitSelector: 'button[login-role="login-button"]', successPathPrefix: '/' };
const credential = { username: 'u', password: 'p' };

test('C: type=button AJAX login (XHR POST to the login origin) uses the single login slot and is detected', async () => {
  const { driver, log } = atomyDriver();
  const r = await executeReadonlyObservation({ driver, credential, scope: atomyScope, login: atomyLogin, actions: [{ type: 'snapshot', label: 'home' }] });
  assert.equal(r.ok, true, String(r.stop));
  assert.equal(r.loginRequestUsed, true);
  assert.equal(r.loginAttempts, 1);
  assert.equal(log.verdicts.find((v) => v.url.endsWith('/login.js'))?.verdict, 'allow');
  const s = summarizeObservation(r);
  assert.deepEqual(s.blockedHosts, { 'www.google.com': 1 });
});

test('C: AJAX login POST to another subdomain of the same site is not treated as allowed', async () => {
  const { driver } = atomyDriver({ loginRequest: { method: 'POST', url: 'https://api.atomy.com/login', isNavigation: false, isFormSubmit: false, resourceType: 'xhr' } });
  const r = await executeReadonlyObservation({ driver, credential, scope: atomyScope, login: atomyLogin, actions: [] });
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'LOGIN_NOT_SUBMITTED');
});

test('B: disabled login button stops with LOGIN_BUTTON_DISABLED before any click', async () => {
  const { driver, log } = atomyDriver({ disabled: true });
  const r = await executeReadonlyObservation({ driver, credential, scope: atomyScope, login: atomyLogin, actions: [] });
  assert.equal(r.stop, 'LOGIN_BUTTON_DISABLED');
  assert.equal(r.loginAttempts, 0);
  assert.equal(log.clicks, 0);
  assert.match(readonlyAccountStopText('LOGIN_BUTTON_DISABLED'), /로그인 버튼이 비활성/);
});

test('B: DISABLED_PROBE reads disabled and aria-disabled', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = g.document;
  const els: Record<string, { disabled?: boolean; getAttribute(n: string): string | null }> = {
    '#a': { disabled: true, getAttribute: () => null },
    '#b': { disabled: false, getAttribute: (n) => (n === 'aria-disabled' ? 'true' : null) },
    '#c': { disabled: false, getAttribute: () => null },
  };
  g.document = { querySelector: (s: string) => els[s] ?? null };
  try {
    assert.equal(DISABLED_PROBE('#a'), true);
    assert.equal(DISABLED_PROBE('#b'), true);
    assert.equal(DISABLED_PROBE('#c'), false);
    assert.equal(DISABLED_PROBE('#missing'), false);
  } finally {
    g.document = prev;
  }
});

test('blocked hosts round-trip through the stored JSON column and old rows read as empty', () => {
  const base = { id: 'r', ok: false, stop: 'CHALLENGE_REQUIRED', challenge: 'CAPTCHA', loginAttempts: 0, pagesObserved: 0, pagesVisible: 0, pages: [], blockedRequestCount: 3, finalOrigin: null, finalPath: null, observedAt: new Date(0) };
  const run = toLatestObservationRun({ ...base, blockedByReason: { ORIGIN: 3, METHOD: 0, FORM_SUBMIT: 0, LOGIN_ALREADY_USED: 0, hosts: { 'www.google.com': 2, 'bad host/x': 1 } } });
  assert.deepEqual(run.blockedHosts, { 'www.google.com': 2 });
  assert.equal(run.blockedByReason.ORIGIN, 3);
  assert.deepEqual(toLatestObservationRun({ ...base, blockedByReason: { ORIGIN: 3 } }).blockedHosts, {});
});
