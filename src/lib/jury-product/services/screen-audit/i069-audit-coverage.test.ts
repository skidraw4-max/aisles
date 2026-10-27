import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JuryActor } from '../../access';
import { executeReadonlyObservation, type AuditTab, type ObservationDriver, type ObservedRequest, type RequestVerdict, type TabClickResult } from '../readonly-account/executor';
import type { ObservationRunStore } from '../readonly-account/observation-run';
import { sameDocumentUrl } from '../readonly-account/browser-driver';
import { READONLY_ACCOUNT_CONSENT_TEXT, READONLY_ACCOUNT_CONSENT_VERSION } from '../readonly-account/consent-text';
import { createAuditHook } from './audit-hook';
import { runScreenAudit, tabCounts, type ScreenAuditStore } from './audit-run';
import type { LayoutMetrics } from './layout-probe';
import { classifyPageType, selectAuditCandidates } from './page-sampling';
import { TAB_UNSAFE_TEXT_SOURCE } from './tab-probe';

const metrics = (w: number): LayoutMetrics => ({
  viewportWidth: w, viewportHeight: 800, docWidth: w, docHeight: 2000, overflowBoxes: [], clippedBoxes: [], interactive: [], lowContrast: [], textSamples: 10, navVisible: true, searchVisible: false, headings: 2,
});
const O = 'https://app.example.com';

test('I-069: page types and candidate selection (main 1, product ≤3, info ≤2, total ≤8, /mypage never)', () => {
  assert.equal(classifyPageType('/main'), 'MAIN');
  assert.equal(classifyPageType('/'), 'MAIN');
  assert.equal(classifyPageType('/product/123456'), 'PRODUCT');
  assert.equal(classifyPageType('/goods/view'), 'PRODUCT');
  assert.equal(classifyPageType('/cst/contactUs'), 'INFO');
  assert.equal(classifyPageType('/common/location'), 'INFO');
  assert.equal(classifyPageType('/brand/story'), 'OTHER');
  const picked = selectAuditCandidates([
    '/main', '/main', '/mypage/orderList', '/cst/contactUs', '/common/productProposal', '/common/location',
    '/product/1', '/product/2', '/product/3', '/product/4', '/brand/a', '/brand/b', '/brand/c', '/brand/d', '//evil.com/x', 'x',
  ]);
  assert.deepEqual(picked, ['/main', '/product/1', '/product/2', '/product/3', '/cst/contactUs', '/common/productProposal', '/brand/a', '/brand/b']);
});

function driverWith(opts: { tabs?: AuditTab[]; click?: (i: number) => TabClickResult; links?: Record<string, string[]>; onMeasure?: () => void } = {}) {
  let url = 'about:blank';
  let width = 1366;
  const log = { gotos: [] as string[], clicks: [] as number[], logins: 0 };
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  const driver: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(target) { log.gotos.push(new URL(target).pathname); if (guard({ method: 'GET', url: target, isFormSubmit: false, isNavigation: true }) === 'allow') url = target; },
    async fill() {},
    async click() { log.logins += 1; guard({ method: 'POST', url: `${O}/login`, isFormSubmit: true, isNavigation: true }); url = `${O}/main`; },
    async currentUrl() { return url; },
    async detectChallenge() { return 'NONE'; },
    async snapshotText() { return 'body'; },
    async collectLinks() { return (opts.links?.[new URL(url).pathname] ?? []).map((p) => ({ href: `${O}${p}`, text: p, nav: true, download: false })); },
    async setViewport(v) { width = v.width; },
    async layoutMetrics() { opts.onMeasure?.(); return metrics(width); },
    ...(opts.tabs ? {
      async listTabs(limit: number) { return opts.tabs!.slice(0, limit); },
      async clickTab(i: number) { log.clicks.push(i); return opts.click ? opts.click(i) : { clicked: true, urlChanged: false, nonGetRequests: 0, navigations: 0 }; },
    } : {}),
    async close() {},
  };
  return { driver, log };
}

test('I-069: hook samples by type — extra product pages are NOT_TESTED (SAMPLE_LIMIT), never PASS', async () => {
  const { driver } = driverWith();
  const hook = createAuditHook({ driver, tabsPerPage: 0 });
  for (const p of ['/main', '/product/1', '/product/2', '/product/3', '/product/4', '/cst/a', '/cst/b', '/cst/c']) await hook.onPage({ label: p, url: `${O}${p}` });
  const desk = hook.results.filter((r) => r.viewport === 'DESKTOP').map((r) => `${r.path}:${r.status}${r.reason ? `:${r.reason}` : ''}`);
  assert.deepEqual(desk, ['/main:PASS', '/product/1:PASS', '/product/2:PASS', '/product/3:PASS', '/product/4:NOT_TESTED:SAMPLE_LIMIT', '/cst/a:PASS', '/cst/b:PASS', '/cst/c:NOT_TESTED:SAMPLE_LIMIT']);
});

test('I-069: measuring time inside the hook does not use up the discovery budget; seeds are visited first and checked', async () => {
  let now = 0;
  const { driver, log } = driverWith({ links: { '/main': ['/cst/a', '/brand/x'] }, onMeasure: () => { now += 30_000; } });
  const hook = createAuditHook({ driver, clock: () => now, budgetMs: 10_000_000, tabsPerPage: 0 });
  const report = await executeReadonlyObservation({
    driver, credential: { username: 'u@example.com', password: 'pw-secret' },
    scope: { allowedOrigins: [O], paths: [] },
    login: { loginUrl: `${O}/login`, usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', successPathPrefix: '/main' },
    actions: [], clock: () => now,
    discover: { maxPages: 10, budgetMs: 60_000 },
    seedPaths: ['/product/1', '/product/2', 'https://evil.example/x', '//evil.example/y', '/logout', '/mypage/info'],
    onPage: hook.onPage,
  });
  assert.equal(report.ok, true);
  assert.equal(log.logins, 1);
  const visited = log.gotos.filter((p) => p !== '/login');
  assert.deepEqual(visited.slice(0, 3), ['/product/1', '/product/2', '/mypage/info']);
  assert.ok(visited.includes('/cst/a') && visited.includes('/brand/x'), 'discovery continued although measuring took 60s+');
  assert.ok(!visited.some((p) => /evil|logout/.test(p)));
  assert.equal(report.discovery?.seeded, 3);
  const mypage = hook.results.filter((r) => r.path === '/mypage/info');
  assert.ok(mypage.length > 0 && mypage.every((r) => r.status === 'BLOCKED' && r.reason === 'SENSITIVE_PATH'));
});

test('I-069: tabs — selected skipped, same-URL tabs measured as masked separate entries, cap 5', async () => {
  const tabs = [{ index: 0, name: '상세정보', selected: true }, { index: 1, name: '리뷰 12345', selected: false }, { index: 2, name: '배송안내', selected: false }];
  const { driver, log } = driverWith({ tabs });
  const hook = createAuditHook({ driver });
  await hook.onPage({ label: '상품', url: `${O}/product/1` });
  const t = hook.results.filter((r) => r.tab);
  assert.deepEqual(log.clicks, [1, 2]);
  assert.deepEqual(t.map((r) => [r.path, r.viewport, r.status, r.label]), [
    ['/product/1#tab-1', 'DESKTOP', 'PASS', '상품 · 탭: 탭 1'],
    ['/product/1#tab-2', 'DESKTOP', 'PASS', '상품 · 탭: 배송안내'],
  ]);
  assert.equal(log.gotos.at(-1), '/product/1', 'page restored after tab clicks');
  assert.deepEqual(tabCounts(hook.results), { measured: 2, blocked: 0, total: 2 });
  const many = driverWith({ tabs: Array.from({ length: 9 }, (_, i) => ({ index: i, name: `탭${i}`, selected: false })) });
  const h2 = createAuditHook({ driver: many.driver });
  await h2.onPage({ label: 'm', url: `${O}/main` });
  assert.equal(many.log.clicks.length, 5);
});

test('I-069: a tab that sends a non-GET request or changes the URL is BLOCKED and stops tab clicking', async () => {
  const tabs = [1, 2, 3].map((i) => ({ index: i, name: `탭${i}`, selected: false }));
  const a = driverWith({ tabs, click: (i) => ({ clicked: true, urlChanged: false, nonGetRequests: i === 2 ? 1 : 0, navigations: 0 }) });
  const ha = createAuditHook({ driver: a.driver });
  await ha.onPage({ label: 'p', url: `${O}/product/1` });
  assert.deepEqual(ha.results.filter((r) => r.tab).map((r) => `${r.status}:${r.reason ?? ''}`), ['PASS:', 'BLOCKED:TAB_NON_GET']);
  assert.deepEqual(a.log.clicks, [1, 2]);
  const b = driverWith({ tabs, click: () => ({ clicked: true, urlChanged: true, nonGetRequests: 0, navigations: 1 }) });
  const hb = createAuditHook({ driver: b.driver });
  await hb.onPage({ label: 'p', url: `${O}/product/1` });
  assert.deepEqual(hb.results.filter((r) => r.tab).map((r) => r.reason), ['TAB_NAVIGATED']);
  assert.equal(b.log.gotos.at(-1), '/product/1');
  assert.deepEqual(tabCounts(hb.results), { measured: 0, blocked: 1, total: 1 });
});

test('I-069: tab helpers — hash-only change is same document; unsafe tab text is excluded', () => {
  assert.equal(sameDocumentUrl(`${O}/p/1#a`, `${O}/p/1#b`), true);
  assert.equal(sameDocumentUrl(`${O}/p/1`, `${O}/p/1?tab=2`), false);
  const unsafe = new RegExp(TAB_UNSAFE_TEXT_SOURCE, 'i');
  for (const t of ['장바구니 담기', '바로구매', '결제하기', '로그아웃', '삭제', 'Add to cart']) assert.ok(unsafe.test(t), t);
  for (const t of ['상세정보', '리뷰', '배송/교환 안내']) assert.ok(!unsafe.test(t), t);
});

test('I-069: consent v5 mentions same-page tabs (max 5) and sampled pages', () => {
  assert.equal(READONLY_ACCOUNT_CONSENT_VERSION, 'readonly-account-consent-v5');
  const text = READONLY_ACCOUNT_CONSENT_TEXT.join('\n');
  assert.match(text, /탭.*최대 5개/);
  assert.match(text, /상품 상세 최대 3개/);
});

test('I-069: audit reuses recent observation paths as candidates (sensitive dropped) and reports the source', async () => {
  const summaries: unknown[] = [];
  const obs = {
    async findConnection() { return { id: 'c1', tenantId: 't1', serviceKey: 'readonly-account', accessMethod: 'READ_ONLY_ACCOUNT' }; },
    async findLatestConsent() { return null; },
    async findActiveCredential() { return null; },
    async audit() {},
    async findRecentObservationPaths(t: string, c: string) { assert.deepEqual([t, c], ['t1', 'c1']); return ['/main', '/mypage/orderList', '/product/1']; },
  } as ObservationRunStore;
  const audit: ScreenAuditStore = { async createAudit() {}, async finishAudit(a) { summaries.push(a.summary); }, async findAudit() { return null; } };
  const actor = { ok: true, tenantId: 't1', userId: 'u1', role: 'OWNER' } as unknown as JuryActor;
  await runScreenAudit({ actor, connectionId: 'c1', observationStore: obs, auditStore: audit, keys: { ok: false } as never, createDriver: () => ({ async close() {} }) as unknown as ObservationDriver });
  assert.deepEqual((summaries[0] as { candidateSource: string; seededPaths: number }).candidateSource, 'RECENT_OBSERVATION');
  assert.equal((summaries[0] as { seededPaths: number }).seededPaths, 2);
});
