/** RM-16 (M-013): VERIFIED_REAL only, ≥3 points, categorical. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewDisplayModel } from './review-display-model';
import type { ComparisonSide } from './review-comparison';
import { buildQualityTrend } from './quality-trend';

const side = (id: string, day: number, source: string, decision = 'VERIFY', problems: string[] = ['p']): ComparisonSide => ({
  display: buildReviewDisplayModel({
    result: { id, boardRunId: 'run', evidenceStrength: 'moderate', expectedDecision: decision, finalSurface: { statusSummary: 's', topProblems: problems, expectedUserEffect: '', risk: '', dimensionEvidence: [], supportedClaims: ['c'], partiallySupportedClaims: [], hypotheses: [] } },
    request: { status: 'COMPLETED', resultSource: source },
    evidence: { id: 'e', metricIds: ['m'], metrics: [{ metric: 'm', availability: 'AVAILABLE' }] },
  }),
  connectionId: 'c', metricIds: [], completedAt: `2026-10-${10 + day}T00:00:00.000Z`,
});

test('hidden below 3 VERIFIED_REAL points; REAL_MODEL/MOCK/LEGACY never count', () => {
  const t = buildQualityTrend([side('a', 1, 'VERIFIED_REAL'), side('b', 2, 'VERIFIED_REAL'), side('c', 3, 'REAL_MODEL'), side('d', 4, 'MOCK'), side('e', 5, 'UNKNOWN_LEGACY')]);
  assert.equal(t.visible, false);
  assert.equal(t.excluded, 3);
});

test('≥3 points: chronological, categorical, integer counts', () => {
  const t = buildQualityTrend([side('c', 3, 'VERIFIED_REAL', 'ACCEPT', []), side('a', 1, 'VERIFIED_REAL', 'REWORD', ['x', 'y']), side('b', 2, 'VERIFIED_REAL'), side('m', 4, 'MOCK')]);
  assert.equal(t.visible, true);
  if (!t.visible) return;
  assert.deepEqual(t.points.map((p) => p.resultId), ['a', 'b', 'c']);
  assert.deepEqual(t.points.map((p) => p.problems), [2, 1, 0]);
  assert.equal(t.excluded, 1);
  assert.equal(JSON.stringify(t).includes('score'), false);
});
