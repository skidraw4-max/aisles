import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { executeReadonlyObservation, type ObservationDriver, type ObservedRequest, type RequestVerdict } from './executor';
import { classifyLink, pickLinks, sanitizeLabel, type DiscoveredLink } from './discovery';
import { normalizeObservationScope } from './consent';
import { READONLY_ACCOUNT_CONSENT_TEXT, READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';
import { summarizeObservation } from './observation-evidence';
import { toLatestObservationRun } from './latest-observation';
import { OBSERVATION_CLIENT_TIMEOUT_MS } from './result-text';

const O = 'https://app.example.com';
const scope = { allowedOrigins: [O], paths: [] as string[] };
const login = { loginUrl: `${O}/login`, usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', successPathPrefix: '/' };
const credential = { username: 'u@example.com', password: 'pw' };

type Site = Record<string, { links?: DiscoveredLink[]; text?: string }>;
function driverFor(site: Site, opts: { clock?: { t: number; step: number }; logoutAt?: string } = {}) {
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  let url = 'about:blank';
  const log = { gotos: [] as string[], clicks: 0, methods: [] as string[] };
  const driver: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(target) {
      log.gotos.push(target);
      log.methods.push('GET');
      if (opts.clock) opts.clock.t += opts.clock.step;
      if (guard({ method: 'GET', url: target, isFormSubmit: false, isNavigation: true }) === 'block') return;
      url = opts.logoutAt && target.endsWith(opts.logoutAt) ? `${O}/login` : target;
    },
    async fill() {},
    async click() {
      log.clicks += 1;
      guard({ method: 'POST', url: `${O}/login`, isFormSubmit: true, isNavigation: true });
      url = `${O}/home`;
    },
    async currentUrl() { return url; },
    async detectChallenge() { return 'NONE'; },
    async snapshotText() { return site[new URL(url).pathname]?.text ?? 'x'; },
    async collectLinks() { return site[new URL(url).pathname]?.links ?? []; },
    async pageStats() { return { listItems: 3, cards: 1, tableRows: 2, headings: 1 }; },
    async close() {},
  };
  return { driver, log };
}

const nav = (href: string, text = 'm'): DiscoveredLink => ({ href, text, nav: true });

test('I-049 classifyLink skips destructive, session-ending, foreign, file and scheme links', () => {
  const base = `${O}/home`;
  const bad = [
    nav('/logout'), nav('/auth/sign-out'), nav('/users/1/delete'), nav('/account/withdraw'), nav('/x', '로그아웃'), nav('/y', '회원 탈퇴'),
    nav('/z', '삭제'), nav('/pay'), nav('/billing/checkout'), nav('/w', '결제하기'), nav('mailto:a@b.c'), nav('tel:010'), nav('javascript:void(0)'),
    nav('/report.pdf'), { href: '/export', text: 'e', download: true }, nav('https://evil.test/a'), nav('http://app.example.com/a'), nav('/login'),
  ];
  for (const l of bad) assert.equal(classifyLink(l, base, [O], '/login').ok, false, l.href + l.text);
  const ok = classifyLink(nav('/orders?page=2#top'), base, [O], '/login');
  assert.deepEqual(ok, { ok: true, key: `${O}/orders`, path: '/orders' });
  assert.equal(classifyLink(nav('/payroll'), base, [O]).ok, true);
});

test('I-049 pickLinks: nav first, dedupe after normalizing query/hash/trailing slash, PII-looking labels fall back to path', () => {
  const picked = pickLinks(
    [{ href: '/a', text: 'plain' }, nav('/b/', '메뉴 B'), nav('/b?x=1'), nav('/me', 'kim@example.com'), nav('/p', '홍길동님')],
    `${O}/`, [O], { limit: 10 },
  );
  assert.deepEqual(picked.map((p) => p.path), ['/b', '/me', '/p', '/a']);
  assert.deepEqual(picked.map((p) => p.label), ['메뉴 B', '/me', '/p', 'plain']);
  assert.equal(sanitizeLabel('주문 12345', '/o'), '/o');
});

test('I-049 executor BFS visits menus (depth ≤ 2), GET only, never clicks beyond the single login', async () => {
  const site: Site = {
    '/home': { links: [nav('/orders', '주문'), nav('/settings', '설정'), nav('/logout', '로그아웃')] },
    '/orders': { links: [{ href: '/orders/archive', text: '보관' }] },
    '/orders/archive': { links: [{ href: '/deep', text: 'deep' }] },
    '/settings': {},
  };
  const { driver, log } = driverFor(site);
  const r = await executeReadonlyObservation({ driver, credential, scope, login, actions: [], discover: {} });
  assert.equal(r.ok, true);
  assert.equal(log.clicks, 1);
  assert.ok(log.methods.every((m) => m === 'GET'));
  assert.deepEqual(r.snapshots.map((s) => new URL(s.url).pathname), ['/home', '/orders', '/settings', '/orders/archive']);
  assert.ok(!log.gotos.some((g) => g.includes('logout') || g.endsWith('/deep')));
  assert.equal(r.discovery?.stoppedBy, 'DONE');
  const s = summarizeObservation(r);
  assert.equal(s.pages[1]!.discovered, true);
  assert.deepEqual(s.pages[1]!.stats, { listItems: 3, cards: 1, tableRows: 2, headings: 1 });
  assert.ok(!JSON.stringify(s).includes('"text"'));
});

test('I-049 limits: max pages and time budget stop gracefully with partial results', async () => {
  const many: Site = { '/home': { links: Array.from({ length: 40 }, (_, i) => nav(`/m${i}`)) } };
  const a = await executeReadonlyObservation({ driver: driverFor(many).driver, credential, scope, login, actions: [], discover: { maxPages: 5 } });
  assert.equal(a.ok, true);
  assert.equal(a.snapshots.length, 5);
  assert.equal(a.discovery?.stoppedBy, 'MAX_PAGES');
  const clock = { t: 0, step: 50_000 };
  const b = await executeReadonlyObservation({ driver: driverFor(many, { clock }).driver, credential, scope, login, actions: [], discover: { budgetMs: 200_000 }, clock: () => clock.t });
  assert.equal(b.ok, true);
  assert.equal(b.discovery?.stoppedBy, 'BUDGET');
  assert.ok(b.snapshots.length < 6);
});

test('I-049 session loss (redirect to login) stops discovery but keeps earlier pages', async () => {
  const site: Site = { '/home': { links: [nav('/a'), nav('/b')] } };
  const r = await executeReadonlyObservation({ driver: driverFor(site, { logoutAt: '/a' }).driver, credential, scope, login, actions: [], discover: {} });
  assert.equal(r.ok, true);
  assert.equal(r.discovery?.stoppedBy, 'SESSION_LOST');
  assert.equal(r.snapshots.length, 1);
});

test('I-049 explicit paths still visited; discovery off keeps pre-I-049 behavior', async () => {
  const site: Site = { '/home': { links: [nav('/x')] }, '/admin': {} };
  const on = await executeReadonlyObservation({ driver: driverFor(site).driver, credential, scope: { allowedOrigins: [O], paths: ['/admin'] }, login, actions: [{ type: 'goto', path: '/admin' }, { type: 'snapshot', label: '/admin' }], discover: {} });
  assert.deepEqual(on.snapshots.map((s) => new URL(s.url).pathname), ['/home', '/admin', '/x']);
  const off = await executeReadonlyObservation({ driver: driverFor(site).driver, credential, scope: { allowedOrigins: [O], paths: ['/admin'] }, login, actions: [{ type: 'goto', path: '/admin' }, { type: 'snapshot', label: '/admin' }] });
  assert.deepEqual(off.snapshots.map((s) => new URL(s.url).pathname), ['/admin']);
  assert.equal(off.discovery, undefined);
});

test('I-049 consent v3: paths optional, text covers all menus under the allowed domain, re-consent required', () => {
  assert.match(READONLY_ACCOUNT_CONSENT_VERSION, /^readonly-account-consent-v[3-9]$/); // I-065 bumped to v4
  assert.ok(READONLY_ACCOUNT_CONSENT_TEXT.some((l) => l.includes('허용 도메인 안에서 접근 가능한 모든 메뉴')));
  const n = normalizeObservationScope({ allowedOrigins: [O], paths: [] });
  assert.equal(n.ok, true);
  assert.equal(normalizeObservationScope({ allowedOrigins: [], paths: [] }).ok, false);
});

test('I-049 persisted pages keep discovered flag and stats; client wait covers the budget', () => {
  const run = toLatestObservationRun({
    id: 'r', ok: true, stop: null, challenge: null, loginAttempts: 1, pagesObserved: 1, pagesVisible: 1,
    pages: [{ label: '주문', path: '/orders', visible: true, textLength: 9, discovered: true, stats: { listItems: 2, cards: 0, tableRows: 1, headings: 1, text: 'no' } }],
    blockedRequestCount: 0, blockedByReason: {}, finalOrigin: null, finalPath: null, observedAt: new Date(0),
  });
  assert.deepEqual(run.pages[0], { label: '주문', path: '/orders', visible: true, textLength: 9, discovered: true, stats: { listItems: 2, cards: 0, tableRows: 1, headings: 1 } });
  assert.ok(OBSERVATION_CLIENT_TIMEOUT_MS >= 230_000 && OBSERVATION_CLIENT_TIMEOUT_MS < 300_000);
});

test('I-049 UI: optional paths help, MockDiscoveryAdapter hidden for READ_ONLY_ACCOUNT, stale text hidden while submitting', () => {
  const root = new URL('../../../../app/(jury)/jury/', import.meta.url);
  const form = readFileSync(new URL('ReadOnlyAccountCredentialForm.tsx', root), 'utf8');
  assert.ok(form.includes('OBSERVATION_PATHS_HELP') && form.includes('label="관찰 경로" required={false}'));
  const copy = readFileSync(new URL('../../../lib/jury-product/connected-service-copy.ts', root), 'utf8');
  assert.ok(copy.includes('비워두면 로그인 후 접근 가능한 메뉴를 자동으로 찾아 관찰해요'));
  const onboarding = readFileSync(new URL('service-onboarding-ui.tsx', root), 'utf8');
  assert.match(onboarding, /accessMethod === 'READ_ONLY_ACCOUNT' \? null : <p>어댑터/);
  const status = readFileSync(new URL('connected-review-status.tsx', root), 'utf8');
  assert.ok(status.includes('props.staleText && !submitting'));
  const button = readFileSync(new URL('review-submit-button.tsx', root), 'utf8');
  assert.ok(button.includes('REVIEW_SUBMITTING_EVENT'));
});

test('I-050 a link that redirects to an already-observed page is recorded as a redirect, not a new page', async () => {
  const site: Site = {
    '/home': { links: [nav('/explore', 'EXPLORE'), nav('/projects', '프로젝트')], text: 'home page' },
    '/projects': { text: 'projects page' },
  };
  const { driver } = driverFor(site);
  const goto = driver.goto.bind(driver);
  let current = '';
  driver.goto = async (target) => {
    await goto(target);
    current = target === login.loginUrl ? '' : target.endsWith('/explore') ? `${O}/home` : target;
  };
  driver.currentUrl = async () => current || `${O}/home`;
  const r = await executeReadonlyObservation({ driver, credential, scope, login, actions: [], discover: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.snapshots.map((s) => new URL(s.url).pathname), ['/home', '/projects']);
  assert.deepEqual(r.discovery?.redirects, [{ from: '/explore', to: '/home' }]);
  assert.equal(r.discovery?.visited, 1);
});

test('I-050 a redirect to a new page keeps the final URL and the requested URL', async () => {
  const site: Site = { '/home': { links: [nav('/go', 'GO')] }, '/landing': { text: 'landing' } };
  const { driver } = driverFor(site);
  const goto = driver.goto.bind(driver);
  let current = '';
  driver.goto = async (target) => {
    await goto(target);
    current = target === login.loginUrl ? '' : target.endsWith('/go') ? `${O}/landing` : target;
  };
  driver.currentUrl = async () => current || `${O}/home`;
  const r = await executeReadonlyObservation({ driver, credential, scope, login, actions: [], discover: {} });
  const page = r.snapshots.find((s) => s.url === `${O}/landing`);
  assert.ok(page);
  assert.equal(page?.requestedUrl, `${O}/go`);
  assert.deepEqual(r.discovery?.redirects, []);
});
