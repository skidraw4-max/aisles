import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ANALYTICS_STUB_SCRIPT, analyticsStubResponse, isAnalyticsStubHost, isAnalyticsStubRequest } from './analytics-stub';
import { createRequestGuard } from './executor';
import { summarizeObservation } from './observation-evidence';
import { parseBlockedDetails } from './blocked-details';
import { createBrowserObservationDriver, type PwContext, type PwRoute } from './browser-driver';

const req = (url: string, over: Partial<{ method: string; isNavigation: boolean; isFormSubmit: boolean; resourceType: string }> = {}) => ({
  method: 'GET', url, isNavigation: false, isFormSubmit: false, resourceType: 'script', ...over,
});

test('I-097: host list is explicit (exact or subdomain only)', () => {
  assert.ok(isAnalyticsStubHost('www.googletagmanager.com'));
  assert.ok(isAnalyticsStubHost('pagead2.googlesyndication.com'));
  assert.ok(isAnalyticsStubHost('stats.g.doubleclick.net'));
  assert.ok(!isAnalyticsStubHost('evilgoogletagmanager.com'));
  assert.ok(!isAnalyticsStubHost('googletagmanager.com.evil.io'));
  assert.ok(!isAnalyticsStubHost('sidesync.io'));
});

test('I-097: only GET/HEAD subresources are stubbed; POST, navigation, form submit are not', () => {
  assert.ok(isAnalyticsStubRequest(req('https://www.googletagmanager.com/gtag/js?id=X')));
  assert.ok(isAnalyticsStubRequest(req('https://www.google-analytics.com/g/collect', { resourceType: 'ping', method: 'HEAD' })));
  assert.ok(!isAnalyticsStubRequest(req('https://www.google-analytics.com/g/collect', { method: 'POST' })));
  assert.ok(!isAnalyticsStubRequest(req('https://www.googletagmanager.com/', { isNavigation: true })));
  assert.ok(!isAnalyticsStubRequest(req('https://www.googletagmanager.com/', { isFormSubmit: true })));
  assert.ok(!isAnalyticsStubRequest(req('http://www.googletagmanager.com/gtag/js')));
});

test('I-097: script → 200 JS shim, other → 204 empty', () => {
  const s = analyticsStubResponse('script');
  assert.equal(s.status, 200);
  assert.match(s.contentType ?? '', /application\/javascript/);
  assert.equal(analyticsStubResponse('xhr').status, 204);
  assert.equal(analyticsStubResponse('image').body, '');
});

test('I-097: shim makes gtag/dataLayer/adsbygoogle calls safe, keeps existing gtag', () => {
  const w: Record<string, unknown> = {};
  vm.runInNewContext(ANALYTICS_STUB_SCRIPT, { window: w });
  assert.doesNotThrow(() => (w.gtag as (...a: unknown[]) => void)('config', 'X'));
  assert.equal((w.dataLayer as unknown[]).length, 1);
  assert.doesNotThrow(() => (w.adsbygoogle as unknown[]).push({}));
  assert.ok(!/fetch|XMLHttpRequest|sendBeacon|createElement/.test(ANALYTICS_STUB_SCRIPT));
  const own = () => 'mine';
  const w2: Record<string, unknown> = { gtag: own };
  vm.runInNewContext(ANALYTICS_STUB_SCRIPT, { window: w2 });
  assert.equal(w2.gtag, own);
});

test('I-097: guard returns stub + STUBBED, other policies unchanged', () => {
  const g = createRequestGuard({ scope: { allowedOrigins: ['https://app.example.com'], paths: [] }, loginOrigin: 'https://app.example.com' } as never);
  assert.equal(g.guard(req('https://www.googletagmanager.com/gtag/js?id=X')), 'stub');
  assert.equal(g.guard(req('https://www.google-analytics.com/g/collect', { method: 'POST', resourceType: 'fetch' })), 'block');
  assert.equal(g.guard(req('https://cdn.other.com/x.js')), 'block');
  assert.equal(g.guard(req('https://app.example.com/api/x', { method: 'POST', resourceType: 'fetch' })), 'block');
  assert.deepEqual(g.blocked.map((b) => b.reason), ['STUBBED', 'ORIGIN', 'ORIGIN', 'METHOD']);
});

test('I-097: summary keeps STUBBED apart from blocked counts; details round-trip; old rows ok', () => {
  const s = summarizeObservation({
    ok: true, loginAttempts: 1, snapshots: [],
    blockedRequests: [
      { method: 'GET', url: 'https://www.googletagmanager.com/gtag/js?id=X', reason: 'STUBBED', at: 0 },
      { method: 'POST', url: 'https://app.example.com/api', reason: 'METHOD', at: 0 },
    ],
  });
  assert.equal(s.blockedRequestCount, 1);
  assert.equal(s.blockedByReason.STUBBED, 1);
  assert.equal(s.blockedByReason.METHOD, 1);
  assert.deepEqual(s.blockedHosts, { 'app.example.com': 1 });
  const back = parseBlockedDetails({ details: s.blockedDetails });
  assert.deepEqual(back.map((d) => [d.reason, d.path]), [['STUBBED', '/gtag/js'], ['METHOD', '/api']]);
  assert.deepEqual(parseBlockedDetails({ ORIGIN: 1, METHOD: 0 }), []);
});

test('I-097: browser driver fulfills stub locally (no continue), still aborts blocks', async () => {
  let handler: ((r: PwRoute) => Promise<void> | void) | null = null;
  const ctx = {
    route: async (_u: string, h: (r: PwRoute) => Promise<void> | void) => { handler = h; },
    addInitScript: async () => undefined,
    newPage: async () => ({}) as never,
    close: async () => undefined,
  } as unknown as PwContext;
  const driver = createBrowserObservationDriver(async () => ctx);
  await driver.setRequestGuard((r) => (r.url.includes('gtag') ? 'stub' : 'block'));
  const calls: string[] = [];
  const route = (url: string, type: string): PwRoute => ({
    request: () => ({ method: () => 'GET', url: () => url, resourceType: () => type, isNavigationRequest: () => false }),
    abort: async () => { calls.push('abort'); },
    continue: async () => { calls.push('continue'); },
    fulfill: async (r) => { calls.push(`fulfill:${r.status}`); },
  });
  await handler!(route('https://www.googletagmanager.com/gtag/js', 'script'));
  await handler!(route('https://www.googletagmanager.com/gtag/x', 'xhr'));
  await handler!(route('https://cdn.other.com/a.js', 'script'));
  assert.deepEqual(calls, ['fulfill:200', 'fulfill:204', 'abort']);
});
