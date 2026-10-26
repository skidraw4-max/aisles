import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { logBlockedRequests, summarizeObservation } from './observation-evidence';
import { loadLatestObservationRun, toLatestObservationRun } from './latest-observation';
import { LatestObservationResult } from '../../../../app/(jury)/jury/ReadOnlyAccountCredentialForm';

const report = {
  ok: true,
  loginAttempts: 1,
  loginRequestUsed: true,
  finalUrl: 'https://app.example.com/onboarding?token=secret',
  snapshots: [
    { label: 'Dashboard', url: 'https://app.example.com/dashboard?x=1', text: 'private body text' },
    { label: 'Empty', url: 'https://app.example.com/empty', text: '   ' },
  ],
  blockedRequests: [{ reason: 'ORIGIN' as const, method: 'GET', url: 'https://ads.example.net/x' }],
} as never;

test('summary carries final origin and path without the query string', () => {
  const s = summarizeObservation(report);
  assert.equal(s.finalOrigin, 'https://app.example.com');
  assert.equal(s.finalPath, '/onboarding');
  assert.doesNotMatch(JSON.stringify(s), /secret|private body/);
});

test('log line includes pagesObserved and per-page counts, never page text', () => {
  const lines: string[] = [];
  logBlockedRequests(report, 'c1', (l) => lines.push(l));
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.pagesObserved, 2);
  assert.deepEqual(parsed.pages, [
    { label: 'Dashboard', visible: true, textLength: 17 },
    { label: 'Empty', visible: false, textLength: 3 },
  ]);
  assert.doesNotMatch(lines[0]!, /private body/);
});

const row = {
  id: 'r1', ok: true, stop: null, challenge: null, loginAttempts: 1, pagesObserved: 2, pagesVisible: 1,
  pages: [{ label: 'Dashboard', path: '/dashboard', visible: true, textLength: 17 }],
  blockedRequestCount: 1, blockedByReason: { ORIGIN: 1 }, finalOrigin: 'https://app.example.com', finalPath: '/onboarding',
  observedAt: new Date('2026-10-26T06:35:40Z'),
};

test('latest run loader filters by tenant/connection and ok', async () => {
  let where: Record<string, unknown> = {};
  const db = { juryReadonlyObservationRun: { async findFirst(a: { where: Record<string, unknown> }) { where = a.where; return row; } } };
  const r = await loadLatestObservationRun(db as never, 't1', 'c1', { okOnly: true });
  assert.deepEqual(where, { tenantId: 't1', connectionId: 'c1', ok: true });
  assert.equal(r?.blockedByReason.METHOD, 0);
});

test('renders 최근 관찰 결과 with counts and final path', () => {
  const html = renderToStaticMarkup(createElement(LatestObservationResult, { run: toLatestObservationRun(row) }));
  assert.match(html, /최근 관찰 결과/);
  assert.match(html, /관찰 페이지 2개/);
  assert.match(html, /https:\/\/app.example.com\/onboarding/);
  const empty = renderToStaticMarkup(createElement(LatestObservationResult, { run: null }));
  assert.match(empty, /아직 저장된 관찰 결과가 없습니다/);
});

import { readonlyAccountReasonText, withClientDeadline } from './result-text';

test('client deadline resolves CLIENT_TIMEOUT when the action hangs', async () => {
  let fire: () => void = () => {};
  const wrapped = withClientDeadline(() => new Promise(() => {}), 70_000, (fn) => { fire = fn; return 1; }, () => {});
  const p = wrapped(null, new FormData());
  fire();
  assert.deepEqual(await p, { ok: false, reason: 'CLIENT_TIMEOUT' });
  assert.match(readonlyAccountReasonText('CLIENT_TIMEOUT'), /새로고침/);
});

test('client deadline maps thrown errors to CLIENT_ERROR and passes results through', async () => {
  const thrower = withClientDeadline(async () => { throw new Error('network'); }, 70_000, () => 1, () => {});
  assert.deepEqual(await thrower(null, new FormData()), { ok: false, reason: 'CLIENT_ERROR' });
  const fine = withClientDeadline(async () => ({ ok: true }), 70_000, () => 1, () => {});
  assert.deepEqual(await fine(null, new FormData()), { ok: true });
});
