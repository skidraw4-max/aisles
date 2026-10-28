import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ObservationDriver } from '../readonly-account/executor';
import { createAuditHook } from './audit-hook';
import { buildAuditRows, errorScreens } from './audit-run';
import { isErrorScreen, matchesErrorText } from './error-screen';
import type { LayoutMetrics } from './layout-probe';
import { errorScreenRows, formatKstTime } from './view-model';

const base = (o: Partial<LayoutMetrics> = {}): LayoutMetrics => ({
  viewportWidth: 1366, viewportHeight: 768, docWidth: 1366, docHeight: 768, overflowBoxes: [], clippedBoxes: [], interactive: [{ x: 1, y: 1, w: 100, h: 44 }], lowContrast: [], textSamples: 6, navVisible: false, searchVisible: false, headings: 1, errorText: true, bodyTextLength: 199, ...o,
});

test('I-096: error phrases match (ko/en, Next.js), normal text does not', () => {
  for (const t of ['오류가 발생했습니다', 'Application error: a client-side exception has occurred', 'Something went wrong', '문제가 발생했습니다. 다시 시도해 주세요', 'Internal Server Error']) assert.equal(matchesErrorText(t), true, t);
  for (const t of ['프로젝트 목록', '오류 신고하기', 'Error handling guide', '에러 로그 보기']) assert.equal(matchesErrorText(t), false, t);
});

test('I-096: Side-Sync global-error shape is an error screen', () => {
  assert.equal(isErrorScreen(base()), true);
});

test('I-096: no false positives on normal pages or old rows', () => {
  assert.equal(isErrorScreen(base({ errorText: false })), false);
  assert.equal(isErrorScreen(base({ errorText: undefined })), false, 'old rows lack errorText');
  assert.equal(isErrorScreen(base({ navVisible: true })), false, 'page with nav that mentions an error (toast)');
  assert.equal(isErrorScreen(base({ headings: 5 })), false);
  assert.equal(isErrorScreen(base({ docHeight: 3000 })), false, 'long page');
  assert.equal(isErrorScreen(base({ bodyTextLength: 4000 })), false, 'content page mentioning an error');
  assert.equal(isErrorScreen(base({ interactive: Array.from({ length: 8 }, () => ({ x: 0, y: 0, w: 10, h: 10 })) })), false);
  assert.equal(isErrorScreen(null), false);
});

function fakeDriver(m: () => LayoutMetrics): ObservationDriver {
  let w = 1366;
  return {
    setRequestGuard: async () => undefined, goto: async () => undefined, fill: async () => true, click: async () => undefined, currentUrl: async () => 'https://app.example.com/projects',
    snapshotText: async () => '', detectChallenge: async () => 'NONE', close: async () => undefined,
    setViewport: async (vp: { width: number }) => { w = vp.width; }, layoutMetrics: async () => ({ ...m(), viewportWidth: w, docWidth: w }),
  } as unknown as ObservationDriver;
}

test('I-096: hook marks error screens BLOCKED/ERROR_SCREEN, keeps metrics, suppresses findings', async () => {
  const hook = createAuditHook({ driver: fakeDriver(() => base()), tabsPerPage: 0 });
  await hook.onPage({ label: 'p', url: 'https://app.example.com/projects' });
  assert.ok(hook.results.length > 0);
  for (const r of hook.results) {
    assert.equal(r.status, 'BLOCKED');
    assert.equal(r.reason, 'ERROR_SCREEN');
    assert.ok(r.metrics);
  }
  const { summary, rows } = buildAuditRows(hook.results, new Date(0), (() => { let i = 0; return () => `id${i++}`; })());
  assert.equal(summary.findings.length, 0, 'no NAV_NOT_VISIBLE etc. from an error screen');
  assert.ok(summary.areas.every((a) => a.status === 'BLOCKED'));
  assert.equal((rows.pages[0].metrics as { reason?: string }).reason, 'ERROR_SCREEN');
  assert.deepEqual(errorScreens(hook.results).map((e) => e.path), hook.results.map(() => '/projects'));
});

test('I-096: normal page stays PASS', async () => {
  const hook = createAuditHook({ driver: fakeDriver(() => base({ errorText: false, navVisible: true, headings: 3, docHeight: 2000 })), tabsPerPage: 0 });
  await hook.onPage({ label: 'p', url: 'https://app.example.com/projects' });
  assert.ok(hook.results.every((r) => r.status === 'PASS'));
});

test('I-096: view model tolerates old summaries and formats KST', () => {
  assert.deepEqual(errorScreenRows({ areas: [] }), []);
  assert.deepEqual(errorScreenRows(null), []);
  assert.deepEqual(errorScreenRows({ errorScreens: [{ path: '/projects?x=1', viewport: 'MOBILE' }, { bad: 1 }] }), [{ path: '/projects', viewport: 'MOBILE', errors: [] }]);
  assert.equal(formatKstTime('2026-10-27T17:46:58.000Z'), '02:46:58 KST');
  assert.equal(formatKstTime('nope'), '-');
});
