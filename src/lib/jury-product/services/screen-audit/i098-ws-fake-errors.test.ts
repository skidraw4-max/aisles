import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import type { ObservationDriver } from '../readonly-account/executor';
import { BLOCKED_RESOURCE_TYPES, INIT_SCRIPT } from '../readonly-account/browser-driver';
import { PAGE_ERROR_LIMIT, PAGE_ERROR_MAX_CHARS, parsePageErrors, pushPageError, sanitizeErrorMessage } from '../readonly-account/page-errors';
import { createAuditHook } from './audit-hook';
import { buildAuditRows, errorScreens } from './audit-run';
import type { LayoutMetrics } from './layout-probe';
import { ERROR_SCREEN_LABEL, errorScreenRows, STATUS_LABEL } from './view-model';
import { isStaleBuild } from '../../build-version';

function runInit() {
  const win: Record<string, unknown> = { addEventListener: () => undefined };
  const listeners: string[] = [];
  const ctx = vm.createContext({
    window: win, EventTarget, Event, setTimeout, Promise, Object, String, Error,
    CloseEvent: class extends Event { code: number; wasClean: boolean; constructor(t: string, o: { code: number; wasClean: boolean }) { super(t); this.code = o.code; this.wasClean = o.wasClean; } },
    navigator: { sendBeacon: () => true, serviceWorker: { register: () => Promise.resolve() } },
    document: { addEventListener: (t: string) => listeners.push(t) },
    sessionStorage: { getItem: () => null, setItem: () => undefined },
  });
  (win as { sessionStorage?: unknown }).sessionStorage = (ctx as { sessionStorage: unknown }).sessionStorage;
  vm.runInContext(INIT_SCRIPT, ctx);
  return { win, ctx };
}

test('I-098: fake WebSocket does not throw and reports error then close asynchronously', async () => {
  const { win } = runInit();
  const WS = win.WebSocket as new (u: string) => EventTarget & { readyState: number; onerror: unknown; onclose: unknown; send(d: string): void; close(): void };
  assert.equal(typeof WS, 'function');
  const events: string[] = [];
  const ws = new WS('wss://realtime.example.com/socket?apikey=x');
  ws.onerror = () => events.push('onerror');
  ws.addEventListener('close', (e) => events.push(`close:${(e as unknown as { code: number }).code}`));
  assert.equal(ws.readyState, 0);
  ws.send('x');
  assert.deepEqual(events, [], 'nothing synchronous');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(events, ['onerror', 'close:1006']);
  assert.equal(ws.readyState, 3);
  assert.equal((WS as unknown as { CLOSED: number }).CLOSED, 3);
  const ES = win.EventSource as new (u: string) => { readyState: number };
  const es = new ES('/stream');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(es.readyState, 2);
  const RTC = win.RTCPeerConnection as new () => { close(): void };
  assert.doesNotThrow(() => new RTC().close());
  assert.ok(!/throw new Error\('blocked by Jury/.test(INIT_SCRIPT), 'no throwing constructor');
  for (const t of ['websocket', 'eventsource']) assert.ok(BLOCKED_RESOURCE_TYPES.has(t), 'network still blocked');
});

test('I-098: sanitizer masks queries, emails, digits and tokens; limits count and length', () => {
  const m = sanitizeErrorMessage('TypeError: fetch https://api.example.com/v1/users?id=1&token=abc failed for kim@example.com 0101234567 key=sk_live_abcdefghij1234567890\n  at foo');
  assert.ok(!m.includes('id=1') && !m.includes('kim@') && !m.includes('0101234567') && !m.includes('sk_live_abcdefghij1234567890') && !m.includes('at foo'), m);
  assert.ok(m.includes('https://api.example.com/v1/users?…') && m.includes('[email]') && m.includes('[token]'), m);
  assert.ok(sanitizeErrorMessage('x'.repeat(500)).length <= PAGE_ERROR_MAX_CHARS);
  const list: string[] = [];
  for (let i = 0; i < 6; i++) pushPageError(list, `Error ${'abcdefg'[i]}`);
  pushPageError(list, 'Error a');
  assert.equal(list.length, PAGE_ERROR_LIMIT);
  assert.deepEqual(parsePageErrors([1, null, 'ok', 'ok']), ['ok']);
  assert.deepEqual(parsePageErrors(undefined), []);
});

const errMetrics = (): LayoutMetrics => ({
  viewportWidth: 1366, viewportHeight: 768, docWidth: 1366, docHeight: 768, overflowBoxes: [], clippedBoxes: [], interactive: [{ x: 1, y: 1, w: 100, h: 44 }], lowContrast: [], textSamples: 6, navVisible: false, searchVisible: false, headings: 1, errorText: true, bodyTextLength: 199,
});

test('I-098: error-screen pages store sanitized page errors in metrics and summary', async () => {
  let w = 1366;
  const driver = {
    setRequestGuard: async () => undefined, goto: async () => undefined, fill: async () => true, click: async () => undefined, currentUrl: async () => 'https://app.example.com/projects',
    snapshotText: async () => '', detectChallenge: async () => 'NONE', close: async () => undefined,
    setViewport: async (vp: { width: number }) => { w = vp.width; }, layoutMetrics: async () => ({ ...errMetrics(), viewportWidth: w, docWidth: w }),
    pageErrors: async () => ['Error: boom user 123456', 'b', 'c', 'd'],
  } as unknown as ObservationDriver;
  const hook = createAuditHook({ driver, tabsPerPage: 0 });
  await hook.onPage({ label: 'p', url: 'https://app.example.com/projects' });
  const r = hook.results.find((x) => x.reason === 'ERROR_SCREEN');
  assert.ok(r);
  assert.deepEqual(r.errors, ['Error: boom user #', 'b', 'c']);
  const { rows } = buildAuditRows(hook.results, new Date(0), (() => { let i = 0; return () => `id${i++}`; })());
  assert.deepEqual((rows.pages[0].metrics as { errors?: string[] }).errors, ['Error: boom user #', 'b', 'c']);
  const rowsView = errorScreenRows({ errorScreens: errorScreens(hook.results) });
  assert.deepEqual(rowsView[0].errors, ['Error: boom user #', 'b', 'c']);
});

test('I-098: old summaries render without errors; labels', () => {
  assert.deepEqual(errorScreenRows({ errorScreens: [{ path: '/a', viewport: 'DESKTOP' }] }), [{ path: '/a', viewport: 'DESKTOP', errors: [] }]);
  assert.equal(STATUS_LABEL.BLOCKED, '차단됨');
  assert.equal(ERROR_SCREEN_LABEL, '오류 화면');
});

test('I-098: stale build detection', () => {
  assert.equal(isStaleBuild('abc1234', 'def5678'), true);
  assert.equal(isStaleBuild('abc1234', 'abc1234'), false);
  assert.equal(isStaleBuild('local', 'abc1234'), false);
  assert.equal(isStaleBuild('abc1234', null), false);
});
