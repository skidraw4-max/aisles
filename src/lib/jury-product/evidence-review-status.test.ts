import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceReviewStatus } from './evidence-review-status';

type View = Parameters<typeof evidenceReviewStatus>[0];
const NOW = Date.parse('2026-10-23T03:00:00Z');

function view(partial: Partial<View>): View {
  return { requests: [], results: [], attempts: [], ...partial } as View;
}
const req = (id: string, evidenceId: string, status = 'COMPLETED') =>
  ({ id, evidenceId, reviewType: 'FULL_REVIEW', status }) as unknown as View['requests'][number];
const res = (id: string, reviewRequestId: string, completedAt: string) =>
  ({ id, reviewRequestId, completedAt }) as unknown as View['results'][number];
const att = (key: string, evidenceId: string, status: string, startedAt: string, finishedAt: string | null = null) =>
  ({ id: `a-${key}`, reviewRequestKey: key, evidenceId, reviewType: 'CLAIM_VALIDATION', status, startedAt, finishedAt, failureReason: status === 'FAILED' ? 'REVIEW_NOT_EXECUTED' : null, lastLlmErrorCode: null }) as unknown as NonNullable<View['attempts']>[number];

test('I-030: completed result links from the card even when the page did not navigate', () => {
  const s = evidenceReviewStatus(view({ requests: [req('r1', 'e1')], results: [res('x1', 'r1', '2026-10-23T02:30:00Z')] }), 'e1', NOW);
  assert.deepEqual(s.latestResult, { id: 'x1', completedAt: '2026-10-23T02:30:00Z' });
  assert.equal(s.open, null);
  assert.equal(s.inFlight, false);
});

test('I-030: running attempt marks the card in flight (submit disabled); other evidence unaffected', () => {
  const v = view({ requests: [req('r2', 'e1', 'RUNNING')], attempts: [att('r2', 'e1', 'RUNNING', '2026-10-23T02:58:00Z')] });
  const s = evidenceReviewStatus(v, 'e1', NOW);
  assert.equal(s.open?.state, 'RUNNING');
  assert.equal(s.inFlight, true);
  assert.equal(evidenceReviewStatus(v, 'e2', NOW).inFlight, false);
});

test('I-030: failed and timed-out (stale) are told apart from completed', () => {
  const failed = evidenceReviewStatus(view({ requests: [req('r3', 'e1', 'FAILED')], attempts: [att('r3', 'e1', 'FAILED', '2026-10-23T02:50:00Z', '2026-10-23T02:51:00Z')] }), 'e1', NOW);
  assert.equal(failed.open?.state, 'FAILED');
  assert.equal(failed.inFlight, false);
  const stale = evidenceReviewStatus(view({ requests: [req('r4', 'e1', 'RUNNING')], attempts: [att('r4', 'e1', 'RUNNING', '2026-10-23T02:00:00Z')] }), 'e1', NOW);
  assert.equal(stale.open?.state, 'STALE');
  assert.equal(stale.inFlight, false);
});

test('I-030: an older failure does not hide a newer completed result', () => {
  const s = evidenceReviewStatus(view({
    requests: [req('r5', 'e1', 'FAILED'), req('r6', 'e1')],
    results: [res('x6', 'r6', '2026-10-23T02:40:00Z')],
    attempts: [att('r5', 'e1', 'FAILED', '2026-10-23T02:10:00Z', '2026-10-23T02:11:00Z')],
  }), 'e1', NOW);
  assert.equal(s.latestResult?.id, 'x6');
  assert.equal(s.open, null);
});

test('I-030: attempts not loaded is reported as unknown, not as "no request"', () => {
  const s = evidenceReviewStatus({ requests: [], results: [] } as unknown as View, 'e1', NOW);
  assert.equal(s.attemptsLoaded, false);
});
