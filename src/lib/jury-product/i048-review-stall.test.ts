import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { REVIEW_STALE_RUNNING_MS, isStaleRunningReview } from './review-stale';
import { CONNECTED_REVIEW_STALE_TEXT, buildRequestStatusRows } from './review-request-status';

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pageFiles(p);
    return /^(page|layout|route)\.tsx?$/.test(name) ? [p] : [];
  });
}

test('I-048: no route under the jury segment lowers maxDuration below the layout (300s)', () => {
  const layout = Number(readFileSync('src/app/(jury)/jury/layout.tsx', 'utf8').match(/export const maxDuration = (\d+);/)![1]);
  assert.equal(layout, 300);
  for (const file of pageFiles('src/app/(jury)/jury')) {
    const m = readFileSync(file, 'utf8').match(/export const maxDuration = (\d+);/);
    if (m) assert.ok(Number(m[1]) >= layout, `${file} maxDuration ${m[1]} < ${layout}`);
  }
  const detail = readFileSync('src/app/(jury)/jury/services/[connectionId]/page.tsx', 'utf8');
  assert.match(detail, /export const maxDuration = 300;/);
});

test('I-048: stale RUNNING detection uses a 330s threshold beyond the 300s function limit', () => {
  const now = Date.parse('2026-10-26T08:00:00.000Z');
  assert.equal(REVIEW_STALE_RUNNING_MS, 330_000);
  assert.ok(REVIEW_STALE_RUNNING_MS > 300_000);
  assert.equal(isStaleRunningReview('RUNNING', new Date(now - 331_000), now), true);
  assert.equal(isStaleRunningReview('RUNNING', new Date(now - 329_000).toISOString(), now), false);
  assert.equal(isStaleRunningReview('FAILED', new Date(now - 999_000), now), false);
  assert.equal(isStaleRunningReview('COMPLETED', new Date(now - 999_000), now), false);
  assert.equal(isStaleRunningReview('RUNNING', null, now), false);
  assert.equal(isStaleRunningReview('RUNNING', 'not-a-date', now), false);
});

test('I-048: claim reclaims FAILED or stale RUNNING with a status+updatedAt guard; attempts are recorded', () => {
  const src = readFileSync('src/lib/jury-product/connected-service-review.ts', 'utf8');
  assert.match(src, /existing\.status === 'FAILED' \|\| stale/);
  assert.match(src, /status: existing\.status, updatedAt: existing\.updatedAt/);
  assert.match(src, /startReviewAttempt\(prisma/);
  assert.match(src, /finishReviewAttempt\(prisma, attemptId/);
  assert.match(src, /evidence: projection\.pack,\s*trace,/);
  assert.match(src, /data: \{ status: 'FAILED', \.\.\.\(audit \? \{ failureReason: audit\.failureReason \} : \{\}\) \}/);
  assert.doesNotMatch(src, /markReviewFailed\(requestId[^\n]*\n\s*return \{ ok: false, reason: '(REVIEW_NOT_EXECUTED|PERSISTENCE_FAILED)'/);
});

const base = { tenantId: 't', connectionId: 'c', evidenceId: 'e', coreRootDir: 'data/jury-product' as never, reviewType: 'FULL_REVIEW' as const };

test('I-048: orphaned AISLE_SELF RUNNING row (no attempt) shows as stale with the retry message', () => {
  const now = Date.parse('2026-10-26T08:00:00.000Z');
  const rows = buildRequestStatusRows(
    {
      requests: [
        { ...base, id: 'old', mode: 'AISLE_SELF', status: 'RUNNING', updatedAt: new Date(now - 400_000).toISOString() },
        { ...base, id: 'fresh', mode: 'AISLE_SELF', status: 'RUNNING', updatedAt: new Date(now - 10_000).toISOString() },
        { ...base, id: 'ext', mode: 'EXTERNAL_SERVICE', status: 'RUNNING', updatedAt: new Date(now - 400_000).toISOString() },
      ],
      results: [],
      attempts: [],
    },
    now,
  );
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.old!.state, 'STALE');
  assert.equal(by.old!.reason, CONNECTED_REVIEW_STALE_TEXT);
  assert.equal(CONNECTED_REVIEW_STALE_TEXT, '시간 안에 끝나지 않아 중단됐어요. 다시 실행할 수 있어요');
  assert.equal(by.fresh!.state, 'RUNNING');
  assert.equal(by.ext!.state, 'RUNNING');
});

test('I-048: AISLE_SELF attempt RUNNING past 330s is stale; tenant review keeps the 15 min threshold', () => {
  const now = Date.parse('2026-10-26T08:00:00.000Z');
  const startedAt = new Date(now - 400_000).toISOString();
  const attempt = (key: string) => ({ id: `a-${key}`, reviewRequestKey: key, evidenceId: 'e', reviewType: 'FULL_REVIEW', status: 'RUNNING', startedAt, finishedAt: null, failureReason: null, lastLlmErrorCode: null });
  const rows = buildRequestStatusRows(
    {
      requests: [
        { ...base, id: 's', mode: 'AISLE_SELF', status: 'RUNNING' },
        { ...base, id: 'x', mode: 'EXTERNAL_SERVICE', status: 'RUNNING' },
      ],
      results: [],
      attempts: [attempt('s'), attempt('x')] as never,
    },
    now,
  );
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.s!.state, 'STALE');
  assert.equal(by.s!.reason, CONNECTED_REVIEW_STALE_TEXT);
  assert.equal(by.x!.state, 'RUNNING');
});
