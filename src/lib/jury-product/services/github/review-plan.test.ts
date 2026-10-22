import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planGithubReviewStart } from './review-plan';

test('a valid evidence row with no review can start', () => {
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: null }), { ok: true });
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'PARTIAL', reviewStatus: null }), { ok: true });
});

test('review start keeps the existing status results', () => {
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: null, reviewStatus: null }), { ok: false, flow: 'evidence-failed' });
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'FAILED', reviewStatus: null }), { ok: false, flow: 'evidence-failed' });
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'FAILED', reviewStatus: 'COMPLETED' }), { ok: false, flow: 'evidence-failed' });
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: 'QUEUED' }), { ok: false, flow: 'in-progress' });
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: 'RUNNING' }), { ok: false, flow: 'in-progress' });
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'PARTIAL', reviewStatus: 'FAILED' }), { ok: false, flow: 'review-failed' });
  assert.deepEqual(planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: 'COMPLETED' }), { ok: false, flow: 'review-exists' });
});

test('review planning source does not import service permissions', () => {
  const plan = readFileSync(new URL('./review-plan.ts', import.meta.url), 'utf8');
  const refresh = readFileSync(new URL('./refresh.ts', import.meta.url), 'utf8');
  for (const token of ['servicePermissionSatisfies', 'service-member-management', 'service-permission', 'service-feature-guard', 'JuryServiceMember']) {
    assert.equal(plan.includes(token), false);
  }
  assert.equal(refresh.includes("from './review-plan'"), true);
  assert.equal(refresh.includes("from './product-flow'"), false);
  assert.equal(refresh.includes('product.ts'), false);
});
