import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCKED_DETAILS_CAP, parseBlockedDetails, safePath, toBlockedDetail, toBlockedDetails } from './blocked-details';
import { createRequestGuard } from './executor';
import { toLatestObservationRun } from './latest-observation';
import { summarizeObservation } from './observation-evidence';

const O = 'https://app.example.com';

test('I-096: detail strips query/fragment and masks PII-like segments', () => {
  const d = toBlockedDetail({ method: 'post', url: `${O}/api/users/a@b.com/x?token=abc#f`, reason: 'METHOD', page: '/projects', at: Date.UTC(2026, 9, 27, 17, 46, 58) });
  assert.deepEqual(d, { origin: O, path: '/api/users/:masked/x', method: 'POST', reason: 'METHOD', page: '/projects', at: '2026-10-27T17:46:58.000Z' });
  assert.ok(!JSON.stringify(d).includes('token') && !JSON.stringify(d).includes('abc'));
  assert.equal(safePath('/orders/12345678'), '/orders/:masked');
  assert.equal(toBlockedDetail({ method: 'GET', url: 'not a url', reason: 'ORIGIN' }).origin, 'invalid');
});

test('I-096: capped at 50', () => {
  const list = Array.from({ length: 80 }, (_, i) => ({ method: 'GET', url: `${O}/p${i}`, reason: 'ORIGIN' as const }));
  assert.equal(toBlockedDetails(list).length, BLOCKED_DETAILS_CAP);
});

test('I-096: guard records page path and time with each block', () => {
  let t = 1000;
  const g = createRequestGuard({ scope: { allowedOrigins: [O], paths: ['/'], authOrigins: [] }, loginOrigin: O, clock: () => t });
  g.setPage(`${O}/projects?q=1`);
  t = 2000;
  assert.equal(g.guard({ method: 'POST', url: `${O}/projects?x=1`, resourceType: 'fetch', isNavigation: false, isFormSubmit: false } as never), 'block');
  assert.equal(g.blocked[0].page, '/projects');
  assert.equal(g.blocked[0].at, 2000);
});

test('I-096: summary carries details; old rows without details still load', () => {
  const s = summarizeObservation({ ok: true, loginAttempts: 1, snapshots: [], blockedRequests: [{ method: 'POST', url: `${O}/projects?secret=1`, reason: 'METHOD', page: '/projects', at: 0 }] });
  assert.equal(s.blockedDetails?.[0].path, '/projects');
  const row = { id: 'r', ok: true, stop: null, challenge: null, loginAttempts: 1, pagesObserved: 0, pagesVisible: 0, pages: [], blockedRequestCount: 2, finalOrigin: null, finalPath: null, observedAt: new Date(0) };
  const old = toLatestObservationRun({ ...row, blockedByReason: { ORIGIN: 1, METHOD: 1, hosts: { 'a.com': 2 } } });
  assert.deepEqual(old.blockedDetails, []);
  assert.equal(old.blockedByReason.METHOD, 1);
  const neu = toLatestObservationRun({ ...row, blockedByReason: { METHOD: 1, details: [{ origin: O, path: '/x?y=1', method: 'POST', reason: 'METHOD', page: '/projects', at: '2026-10-27T17:46:58.000Z' }, { origin: 'javascript:alert(1)//', method: 'GET', reason: 'ORIGIN', at: 'x' }] } });
  assert.equal(neu.blockedDetails?.length, 1);
  assert.equal(neu.blockedDetails?.[0].path, '/x');
  assert.deepEqual(parseBlockedDetails(null), []);
});
