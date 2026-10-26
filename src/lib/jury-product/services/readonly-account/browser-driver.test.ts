import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserObservationDriver, INIT_SCRIPT, toObservedRequest, type PwContext, type PwPage, type PwRequest, type PwRoute } from './browser-driver';
import { createRequestGuard, executeReadonlyObservation } from './executor';

function req(method: string, url: string, resourceType = 'xhr', nav = false): PwRequest {
  return { method: () => method, url: () => url, resourceType: () => resourceType, isNavigationRequest: () => nav };
}

function fakeContext(script: { onGoto?: (url: string, fire: (r: PwRequest) => Promise<string>) => Promise<string | void>; onClick?: (fire: (r: PwRequest) => Promise<string>) => Promise<string | void>; probe?: string; text?: string }) {
  let handler: ((route: PwRoute) => Promise<void> | void) | null = null;
  const log = { init: [] as string[], outcomes: [] as { url: string; method: string; type: string; result: string }[], closed: false, evaluates: 0 };
  let current = 'about:blank';
  const values = new Map<string, string>();
  const fire = async (r: PwRequest) => {
    let result = 'pending';
    await handler!({ request: () => r, abort: async () => { result = 'abort'; }, continue: async () => { result = 'continue'; } });
    log.outcomes.push({ url: r.url(), method: r.method(), type: r.resourceType(), result });
    return result;
  };
  const page: PwPage = {
    async goto(url) {
      if ((await fire(req('GET', url, 'document', true))) !== 'continue') return null;
      current = (await script.onGoto?.(url, fire)) || url;
      return null;
    },
    async fill(sel: string, v: string) { values.set(sel, v); },
    async inputValue(sel: string) { return values.get(sel) ?? ''; },
    async waitForSelector() { return null; },
    async waitForTimeout() {},
    async click() {
      const to = await script.onClick?.(fire);
      if (to) current = to;
    },
    async waitForLoadState() {},
    async waitForURL() {},
    url: () => current,
    evaluate: (async () => {
      log.evaluates += 1;
      return log.evaluates === 0 ? undefined : (script.probe ?? script.text ?? 'NONE');
    }) as PwPage['evaluate'],
  };
  const context: PwContext = {
    async route(_p, h) { handler = h; },
    async addInitScript(s) { log.init.push(s.content); },
    async newPage() { return page; },
    async close() { log.closed = true; },
  };
  return { context, log };
}

const scope = { allowedOrigins: ['https://app.example.com'], paths: ['/dashboard'] };

test('maps playwright requests; POST document navigation counts as form submit', () => {
  assert.deepEqual(toObservedRequest(req('post', 'https://a/x', 'document', true)), { method: 'POST', url: 'https://a/x', isNavigation: true, isFormSubmit: true });
  assert.equal(toObservedRequest(req('POST', 'https://a/x', 'fetch')).isFormSubmit, false);
});

test('init script disables websocket, eventsource, beacon, service worker and post-login submit', () => {
  for (const token of ['WebSocket', 'EventSource', 'sendBeacon', 'serviceWorker', 'RTCPeerConnection', "addEventListener('submit'"]) assert.ok(INIT_SCRIPT.includes(token), token);
});

test('route handler applies the policy to subresources and blocks websocket/beacon resource types', async () => {
  const { context, log } = fakeContext({
    onGoto: async (_u, fire) => {
      await fire(req('GET', 'https://app.example.com/app.js', 'script'));
      await fire(req('GET', 'https://cdn.evil.test/x.js', 'script'));
      await fire(req('GET', 'wss://app.example.com/socket', 'websocket'));
      await fire(req('POST', 'https://app.example.com/collect', 'ping'));
      await fire(req('DELETE', 'https://app.example.com/api/1', 'fetch'));
    },
  });
  const driver = createBrowserObservationDriver(async () => context);
  const policy = createRequestGuard({ scope, loginOrigin: 'https://app.example.com' });
  await driver.setRequestGuard(policy.guard);
  await driver.goto('https://app.example.com/dashboard');
  assert.deepEqual(log.outcomes.map((o) => o.result), ['continue', 'continue', 'abort', 'abort', 'abort', 'abort']);
  assert.equal(log.init.length, 1);
  await driver.close();
  assert.equal(log.closed, true);
});

test('only one click is allowed and the executor runs end-to-end on the fake browser', async () => {
  const { context, log } = fakeContext({
    onClick: async (fire) => ((await fire(req('POST', 'https://app.example.com/login', 'document', true))) === 'continue' ? 'https://app.example.com/dashboard' : undefined),
    text: 'NONE',
  });
  const driver = createBrowserObservationDriver(async () => context);
  const report = await executeReadonlyObservation({
    driver,
    credential: { username: 'admin', password: 'pw-x' },
    scope,
    login: { loginUrl: 'https://app.example.com/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', successPathPrefix: '/dashboard' },
    actions: [],
  });
  assert.equal(report.ok, true);
  assert.equal(log.outcomes.filter((o) => o.method === 'POST' && o.result === 'continue').length, 1);
  await assert.rejects(() => driver.click('#again'));
});

test('I-050 waitForSettle polls until the text length is stable, and never exceeds its cap', async () => {
  const { waitForSettle } = await import('./browser-driver');
  let t = 0;
  const lengths = [7, 7, 120, 199, 199, 199];
  let i = 0;
  const idle: number[] = [];
  const page = {
    async waitForLoadState(_s: string, o?: { timeout?: number }) { idle.push(o?.timeout ?? -1); },
    async waitForTimeout(ms: number) { t += ms; },
    evaluate: async () => lengths[Math.min(i++, lengths.length - 1)],
  } as unknown as PwPage;
  const polls = await waitForSettle(page, { now: () => t, maxMs: 5_000, pollMs: 400, stableChecks: 2 });
  assert.equal(polls, 6); // 7,7 (one stable) → 120 reset → 199,199,199 (two stable)
  assert.ok(idle[0] > 0 && idle[0] <= 5_000);
  let t2 = 0;
  let n = 0;
  const growing = {
    async waitForLoadState() {},
    async waitForTimeout(ms: number) { t2 += ms; },
    evaluate: async () => ++n * 10,
  } as unknown as PwPage;
  await waitForSettle(growing, { now: () => t2, maxMs: 2_000, pollMs: 400 });
  assert.ok(t2 <= 2_000, `capped at ${t2}`);
  const unmeasurable = { async waitForLoadState() {}, async waitForTimeout() { throw new Error('no wait'); }, evaluate: async () => 'NONE' } as unknown as PwPage;
  assert.equal(await waitForSettle(unmeasurable, { maxMs: 1_000 }), 1);
});
