import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSubmitOutcome } from './review-submit-outcome';
import { evidenceReviewStatus } from './evidence-review-status';

const EVIDENCE = 'https://jury.example.test/jury/evidence';

test('I-030 repro: action settled, URL unchanged → "no navigation" + refresh offered', () => {
  assert.equal(reviewSubmitOutcome(EVIDENCE, EVIDENCE), 'NO_NAVIGATION');
  assert.equal(reviewSubmitOutcome(`${EVIDENCE}?page=2`, `${EVIDENCE}?page=2`), 'NO_NAVIGATION');
});

test('I-030: refusal redirect to the same route with ?result= is a notice, not "no navigation"', () => {
  assert.equal(reviewSubmitOutcome(EVIDENCE, `${EVIDENCE}?result=SCOPE_NOT_APPROVED`), 'SAME_PAGE_NOTICE');
  assert.equal(reviewSubmitOutcome(`${EVIDENCE}?result=X`, `${EVIDENCE}?result=PERSISTENCE_FAILED`), 'SAME_PAGE_NOTICE');
});

test('I-030: success redirect to the result page counts as navigated', () => {
  assert.equal(reviewSubmitOutcome(EVIDENCE, 'https://jury.example.test/jury/reviews/res-1'), 'NAVIGATED');
});

test('I-030 repro (C1/C5 pattern): completed on the server, page stayed → card still links the stored result after refresh', () => {
  // 1) browser: the action settled but the URL did not change
  assert.equal(reviewSubmitOutcome(EVIDENCE, EVIDENCE), 'NO_NAVIGATION');
  // 2) server state re-read on refresh: request COMPLETED with a result
  const view = {
    requests: [{ id: 'req-c1', evidenceId: 'ev-1', reviewType: 'CLAIM_VALIDATION', status: 'COMPLETED' }],
    results: [{ id: 'res-c1', reviewRequestId: 'req-c1', completedAt: '2026-10-23T02:25:00Z' }],
    attempts: [{ id: 'a1', reviewRequestKey: 'req-c1', evidenceId: 'ev-1', reviewType: 'CLAIM_VALIDATION', status: 'SUCCEEDED', startedAt: '2026-10-23T02:22:00Z', finishedAt: '2026-10-23T02:25:00Z', failureReason: null, lastLlmErrorCode: null }],
  } as unknown as Parameters<typeof evidenceReviewStatus>[0];
  const state = evidenceReviewStatus(view, 'ev-1', Date.parse('2026-10-23T02:26:00Z'));
  assert.deepEqual(state.latestResult, { id: 'res-c1', completedAt: '2026-10-23T02:25:00Z' });
  assert.equal(state.inFlight, false);
  assert.equal(state.open, null);
});
