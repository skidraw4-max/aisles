import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGuard, type ObservationDriver, type ObservedRequest } from '../readonly-account/executor';
import { createBrowserObservationDriver, type PwContext, type PwPage, type PwRoute } from '../readonly-account/browser-driver';
import { createAuditHook, mobileOriginsNotAllowed } from './audit-hook';
import { analyzePage, summarizeAudit } from './rules';
import { buildAuditRows } from './audit-run';
import { guidanceText } from './view-model';
import { MOBILE_DEVICE } from './viewports';
import type { LayoutMetrics } from './layout-probe';

const APP = 'https://app.example.com';
const req = (url: string, resourceType: string, method = 'GET', isNavigation = false): ObservedRequest =>
  ({ url, method, resourceType, isNavigation, isFormSubmit: false }) as ObservedRequest;

const metrics = (o: Partial<LayoutMetrics> = {}): LayoutMetrics => ({
  viewportWidth: 390, viewportHeight: 844, docWidth: 390, docHeight: 1000, overflowBoxes: [], clippedBoxes: [], interactive: [], lowContrast: [],
  textSamples: 10, navVisible: true, searchVisible: true, headings: 2, ...o,
});

test('font hosts: only GET stylesheet/font on fonts.googleapis.com / fonts.gstatic.com; reCAPTCHA stays blocked', () => {
  const { guard } = createRequestGuard({ scope: { allowedOrigins: [APP], paths: ['/'] }, loginOrigin: APP });
  assert.equal(guard(req('https://fonts.googleapis.com/css2?family=Noto+Sans+KR', 'stylesheet')), 'allow');
  assert.equal(guard(req('https://fonts.gstatic.com/s/notosanskr/v1/a.woff2', 'font')), 'allow');
  assert.equal(guard(req('https://fonts.gstatic.com/s/a.js', 'script')), 'block');
  assert.equal(guard(req('https://fonts.googleapis.com/css2', 'stylesheet', 'POST')), 'block');
  assert.equal(guard(req('https://fonts.googleapis.com/', 'document', 'GET', true)), 'block');
  assert.equal(guard(req('https://www.gstatic.com/recaptcha/releases/x/recaptcha__ko.js', 'script')), 'block');
  assert.equal(guard(req('https://www.google.com/recaptcha/api.js', 'script')), 'block');
  assert.equal(guard(req('https://www.gstatic.com/fonts/a.woff2', 'font')), 'block');
});

function fakeDriver(opts: { mobileFinal?: string; blockedNav?: string | null; docWidth?: number; fontsBlocked?: number; noMobile?: boolean }) {
  const log: string[] = [];
  let mobile = false;
  const d: ObservationDriver = {
    async setViewport(vp) { log.push(`vp:${vp.name}`); },
    async layoutMetrics() { return mobile ? metrics() : metrics({ viewportWidth: 1366, docWidth: opts.docWidth ?? 1366 }); },
    async resourceStats() { return { blocked: { stylesheet: 0, font: mobile ? 0 : opts.fontsBlocked ?? 0, script: 0, xhr: 0, other: 0 }, fontsReady: true }; },
    ...(opts.noMobile ? {} : {
      async openMobile(url: string) { mobile = true; log.push('openMobile'); return { finalUrl: opts.mobileFinal ?? url, blockedNavigationOrigin: opts.blockedNav ?? null }; },
      async closeMobile() { mobile = false; log.push('closeMobile'); },
    }),
  } as ObservationDriver;
  return { d, log };
}

test('mobile emulation: redirect to a non-consented mobile host → NOT_TESTED with guidance, never auto-added', async () => {
  let t = 1000;
  const { d, log } = fakeDriver({ mobileFinal: 'about:blank', blockedNav: 'https://m.example.com' });
  const hook = createAuditHook({ driver: d, clock: () => (t += 5) });
  await hook.onPage({ label: '홈', url: `${APP}/main` });
  const mob = hook.results.find((r) => r.viewport === 'MOBILE')!;
  assert.deepEqual([mob.status, mob.reason, mob.mobileOrigin], ['NOT_TESTED', 'MOBILE_HOST_NOT_ALLOWED', 'https://m.example.com']);
  assert.ok(log.includes('openMobile') && log.includes('closeMobile'));
  assert.deepEqual(mobileOriginsNotAllowed(hook.results), ['https://m.example.com']);
  const g = guidanceText({ mobileOriginsNotAllowed: ['https://m.example.com'] });
  assert.match(g[0], /허용 출처/);
  assert.match(g[0], /m\.example\.com/);
  const desk = hook.results.find((r) => r.viewport === 'DESKTOP')!;
  assert.equal(desk.status, 'PASS');
  assert.ok(desk.capturedAt && desk.capturedAt !== mob.capturedAt, 'per-page capture time');
});

test('mobile emulation to an allowed mobile host is measured and records the final origin', async () => {
  const { d } = fakeDriver({ mobileFinal: 'https://m.example.com/main' });
  const hook = createAuditHook({ driver: d });
  await hook.onPage({ label: '홈', url: `${APP}/main` });
  const mob = hook.results.find((r) => r.viewport === 'MOBILE')!;
  assert.equal(mob.status, 'PASS');
  assert.equal(mob.env?.emulated, true);
  assert.equal(mob.env?.finalOrigin, 'https://m.example.com');
});

test('resize-only fallback on a fixed-min-width PC layout is NOT_TESTED, not a mobile failure', async () => {
  const d: ObservationDriver = { async setViewport() {}, async layoutMetrics() { return metrics({ docWidth: 1280 }); } } as ObservationDriver;
  const hook = createAuditHook({ driver: d });
  await hook.onPage({ label: '홈', url: `${APP}/main` });
  const mob = hook.results.find((r) => r.viewport === 'MOBILE')!;
  assert.deepEqual([mob.status, mob.reason], ['NOT_TESTED', 'DESKTOP_ONLY_LAYOUT']);
  assert.equal(summarizeAudit(hook.results).findings.filter((f) => f.viewport === 'MOBILE').length, 0);
});

test('environment-limited pages: severity one step lower, FAIL → WARN, flagged and stored', async () => {
  const m = metrics({ viewportWidth: 1366, docWidth: 1600, lowContrast: Array.from({ length: 6 }, () => ({ ratio: 2, large: false, box: { x: 0, y: 0, w: 1, h: 1 } })) });
  const env = { emulated: false, blocked: { stylesheet: 0, font: 3, script: 0, xhr: 0, other: 0 }, fontsReady: false };
  const plain = analyzePage('/a', 'DESKTOP', m);
  const lim = analyzePage('/a', 'DESKTOP', m, env);
  const c0 = plain.find((f) => f.rule === 'CONTRAST_LOW')!;
  const c1 = lim.find((f) => f.rule === 'CONTRAST_LOW')!;
  assert.deepEqual([c0.severity, c0.status], ['MEDIUM', 'FAIL']);
  assert.deepEqual([c1.severity, c1.status, c1.envLimited], ['LOW', 'WARN', true]);
  assert.match(c1.message, /환경 제약: 글꼴 3개 차단, 글꼴 로딩 미완료/);
  const { rows, summary } = buildAuditRows([{ path: '/a', label: 'A', viewport: 'DESKTOP', status: 'PASS', metrics: m, env, capturedAt: Date.UTC(2026, 9, 26) }], new Date());
  assert.ok(summary.findings.every((f) => f.envLimited));
  assert.equal(rows.pages[0].capturedAt?.toISOString(), '2026-10-26T00:00:00.000Z');
  assert.deepEqual((rows.pages[0].metrics as { env: unknown }).env, env);
  assert.ok(rows.findings.every((f) => f.envLimited));
});

test('browser driver: openMobile forks an emulated context, blocks the off-scope redirect and switches the audit page', async () => {
  const devices: unknown[] = [];
  const evals: string[] = [];
  const page = (name: string, routes: ((r: PwRoute) => Promise<void> | void)[]): PwPage => {
    let url = 'about:blank';
    return {
      async goto(u: string) {
        if (name === 'mobile') {
          let aborted = false;
          const mk = (target: string, type: string, nav: boolean) => ({ request: () => ({ method: () => 'GET', url: () => target, resourceType: () => type, isNavigationRequest: () => nav }), abort: async () => { aborted = true; }, continue: async () => {} }) as PwRoute;
          for (const h of routes) await h(mk(u, 'document', true));
          for (const h of routes) await h(mk('https://m.example.com/main', 'document', true));
          void aborted;
          url = u;
        } else url = u;
      },
      async fill() {}, async click() {}, async inputValue() { return ''; }, async waitForSelector() {}, async waitForTimeout() {}, async waitForURL() {},
      async waitForLoadState() {}, url: () => url, async setViewportSize() {},
      async evaluate(fn: unknown) { evals.push(name); return typeof fn === 'function' && String(fn).includes('fonts') ? true : ({ viewportWidth: name === 'mobile' ? 390 : 1366 } as never); },
    } as unknown as PwPage;
  };
  const mk = (name: string): PwContext => {
    const routes: ((r: PwRoute) => Promise<void> | void)[] = [];
    return {
      async route(_u: string, h: (r: PwRoute) => Promise<void> | void) { routes.push(h); },
      async addInitScript() {}, async newPage() { return page(name, routes); }, async close() {},
      async forkMobile(dev: unknown) { devices.push(dev); return mk('mobile'); },
    };
  };
  const driver = createBrowserObservationDriver(async () => mk('desktop'));
  await driver.setRequestGuard?.(createRequestGuard({ scope: { allowedOrigins: [APP], paths: ['/'] }, loginOrigin: APP }).guard);
  const nav = await driver.openMobile!(`${APP}/main`);
  assert.deepEqual(devices, [MOBILE_DEVICE]);
  assert.equal(nav.blockedNavigationOrigin, 'https://m.example.com');
  const lm = await driver.layoutMetrics!();
  assert.equal(lm.viewportWidth, 390);
  await driver.closeMobile!();
  assert.equal((await driver.layoutMetrics!()).viewportWidth, 1366);
});
