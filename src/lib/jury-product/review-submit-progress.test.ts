import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDLE_PROGRESS,
  NO_NAVIGATION_GRACE_MS,
  TIMEOUT_MARGIN_MS,
  canSubmit,
  elapsedSeconds,
  nextReviewSubmitProgress as next,
} from './review-submit-progress';

const HREF = 'https://app.test/jury/evidence';
const LIMIT = 300;
const submitted = () => next(IDLE_PROGRESS, { type: 'SUBMIT', now: 1_000, href: HREF });

test('I-034: elapsed ticks keep the submitting state until something settles it', () => {
  let p = submitted();
  for (let t = 1_250; t <= 200_000; t += 250) p = next(p, { type: 'TICK', now: t, href: HREF, limitSeconds: LIMIT });
  assert.equal(p.phase, 'SUBMITTING');
  assert.equal(elapsedSeconds(p, 200_000), 199);
});

test('I-034: a second submit is refused while submitting, timed out or showing the no-navigation hint', () => {
  const p = submitted();
  assert.equal(canSubmit(p), false);
  assert.equal(next(p, { type: 'SUBMIT', now: 2_000, href: HREF }), p);
  assert.equal(canSubmit({ ...p, phase: 'TIMED_OUT' }), false);
  assert.equal(canSubmit({ ...p, phase: 'NO_NAVIGATION' }), false);
  assert.equal(canSubmit(IDLE_PROGRESS), true);
});

test('I-034: success navigation and same-route ?result= refusal both clear the state without a hint', () => {
  const p = submitted();
  assert.equal(next(p, { type: 'TICK', now: 5_000, href: 'https://app.test/jury/reviews/abc', limitSeconds: LIMIT }).phase, 'IDLE');
  const refused = next(next(p, { type: 'RESOLVED', now: 4_000 }), { type: 'TICK', now: 60_000, href: `${HREF}?result=SCOPE_NOT_APPROVED`, limitSeconds: LIMIT });
  assert.equal(refused.phase, 'IDLE');
});

test('I-034: resolved without navigation shows the hint only after the grace period', () => {
  const p = next(submitted(), { type: 'RESOLVED', now: 4_000 });
  assert.equal(next(p, { type: 'TICK', now: 4_000 + NO_NAVIGATION_GRACE_MS - 1, href: HREF, limitSeconds: LIMIT }).phase, 'SUBMITTING');
  assert.equal(next(p, { type: 'TICK', now: 4_000 + NO_NAVIGATION_GRACE_MS, href: HREF, limitSeconds: LIMIT }).phase, 'NO_NAVIGATION');
});

test('I-034: past the function limit plus margin the browser stops waiting; refresh resets', () => {
  const p = submitted();
  const at = 1_000 + LIMIT * 1000 + TIMEOUT_MARGIN_MS;
  assert.equal(next(p, { type: 'TICK', now: at, href: HREF, limitSeconds: LIMIT }).phase, 'SUBMITTING');
  const timedOut = next(p, { type: 'TICK', now: at + 1, href: HREF, limitSeconds: LIMIT });
  assert.equal(timedOut.phase, 'TIMED_OUT');
  assert.equal(next(timedOut, { type: 'TICK', now: at + 5_000, href: HREF, limitSeconds: LIMIT }), timedOut);
  assert.deepEqual(next(timedOut, { type: 'RESET' }), IDLE_PROGRESS);
});

test('I-034: events outside SUBMITTING do not change the state', () => {
  assert.equal(next(IDLE_PROGRESS, { type: 'RESOLVED', now: 1 }), IDLE_PROGRESS);
  assert.equal(next(IDLE_PROGRESS, { type: 'TICK', now: 1, href: HREF, limitSeconds: LIMIT }), IDLE_PROGRESS);
});
