import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeReadonlyObservation, type ObservationDriver, type RequestVerdict, type ObservedRequest } from '../readonly-account/executor';
import { createAuditHook } from './audit-hook';
import type { LayoutMetrics } from './layout-probe';

const metrics = (w: number): LayoutMetrics => ({
  viewportWidth: w, viewportHeight: 800, docWidth: w, docHeight: 2000, overflowBoxes: [], clippedBoxes: [], interactive: [], lowContrast: [], textSamples: 10, navVisible: true, searchVisible: false, headings: 2,
});

function auditDriver(opts: { failMeasure?: boolean; noViewport?: boolean } = {}) {
  let url = 'about:blank';
  let width = 1366;
  const log = { viewports: [] as number[], posts: 0 };
  let guard: (r: ObservedRequest) => RequestVerdict = () => 'block';
  const driver: ObservationDriver = {
    async setRequestGuard(g) { guard = g; },
    async goto(target) { if (guard({ method: 'GET', url: target, isFormSubmit: false, isNavigation: true }) === 'allow') url = target; },
    async fill() {},
    async click() { log.posts += 1; guard({ method: 'POST', url: 'https://app.example.com/login', isFormSubmit: true, isNavigation: true }); url = 'https://app.example.com/dashboard'; },
    async currentUrl() { return url; },
    async detectChallenge() { return 'NONE'; },
    async snapshotText() { return 'PAGE-BODY-SECRET'; },
    async close() {},
    ...(opts.noViewport ? {} : {
      async setViewport(v: { width: number }) { width = v.width; log.viewports.push(v.width); },
      async layoutMetrics() { if (opts.failMeasure) throw new Error('x'); return metrics(width); },
    }),
  };
  return { driver, log };
}

const scope = { allowedOrigins: ['https://app.example.com'], paths: ['/dashboard', '/orders', '/mypage/profile'] };
const login = { loginUrl: 'https://app.example.com/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', successPathPrefix: '/dashboard' };
const credential = { username: 'a@example.com', password: 'pw-secret' };

test('executor calls the audit hook per page; desktop and mobile measured, /mypage blocked, ends on desktop', async () => {
  const { driver, log } = auditDriver();
  const hook = createAuditHook({ driver });
  const report = await executeReadonlyObservation({
    driver, credential, scope, login, discover: false, onPage: hook.onPage,
    actions: [{ type: 'goto', path: '/orders' }, { type: 'snapshot', label: '주문' }, { type: 'goto', path: '/mypage/profile' }, { type: 'snapshot', label: '내정보' }],
  });
  assert.equal(report.ok, true);
  assert.equal(log.posts, 1);
  const byKey = Object.fromEntries(hook.results.map((r) => [`${r.path}|${r.viewport}`, r]));
  assert.equal(byKey['/orders|DESKTOP'].status, 'PASS');
  assert.equal(byKey['/orders|MOBILE'].metrics?.viewportWidth, 390);
  assert.equal(byKey['/mypage/profile|MOBILE'].status, 'BLOCKED');
  assert.equal(byKey['/mypage/profile|DESKTOP'].metrics, undefined);
  assert.equal(log.viewports.at(-1), 1366);
  assert.doesNotMatch(JSON.stringify(hook.results), /pw-secret|PAGE-BODY-SECRET/);
});

test('page limit and time budget mark the rest NOT_TESTED, never PASS', async () => {
  const { driver } = auditDriver();
  let now = 0;
  const hook = createAuditHook({ driver, maxPages: 1, budgetMs: 100, clock: () => now });
  await hook.onPage({ label: 'a', url: 'https://app.example.com/a' });
  await hook.onPage({ label: 'b', url: 'https://app.example.com/b' });
  const h2 = createAuditHook({ driver, budgetMs: 100, clock: () => now });
  now = 500;
  await h2.onPage({ label: 'c', url: 'https://app.example.com/c' });
  assert.deepEqual(hook.results.map((r) => [r.path, r.status, r.reason ?? '']), [['/a', 'PASS', ''], ['/a', 'PASS', ''], ['/b', 'NOT_TESTED', 'MAX_PAGES'], ['/b', 'NOT_TESTED', 'MAX_PAGES']]);
  assert.deepEqual(h2.results.map((r) => r.reason), ['BUDGET', 'BUDGET']);
});

test('unsupported driver and measurement errors are reported, not hidden', async () => {
  const a = createAuditHook({ driver: auditDriver({ noViewport: true }).driver });
  await a.onPage({ label: 'x', url: 'https://app.example.com/x' });
  assert.deepEqual(a.results.map((r) => r.reason), ['UNSUPPORTED', 'UNSUPPORTED']);
  const b = createAuditHook({ driver: auditDriver({ failMeasure: true }).driver });
  await b.onPage({ label: 'x', url: 'https://app.example.com/x' });
  await b.onPage({ label: 'x', url: 'https://app.example.com/x' });
  assert.deepEqual(b.results.map((r) => r.status), ['ERROR', 'ERROR']);
});
