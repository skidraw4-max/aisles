/**
 * RM-04 (I-016, done criterion "fixture 2f6638a0형 케이스 테스트 통과"): production-shaped cases
 * (shapes only, synthetic text) run through projectReviewConsole -> screen.display, the path the UI renders.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectReviewConsole } from './review-console';
import type { JuryActor } from './access';
import type { JuryFinalSurface } from './records';

const actor: JuryActor = { ok: true, userId: 'u', tenantId: 't', role: 'OWNER', membershipId: 'm' };
const n = (k: number, p: string) => Array.from({ length: k }, (_, i) => `${p} ${i}`);
const surface = (o: Partial<JuryFinalSurface>): JuryFinalSurface => ({
  statusSummary: 's', topProblems: [], expectedUserEffect: '', risk: '', dimensionEvidence: [],
  supportedClaims: [], partiallySupportedClaims: [], hypotheses: [], ...o,
});

function screen(decision: 'ACCEPT' | 'VERIFY' | 'REWORD', s: JuryFinalSurface, facts: Record<string, unknown> = {}, evidenceStrength: 'strong' | 'moderate' | 'unknown' = 'moderate') {
  const out = projectReviewConsole({
    actor,
    result: { id: 'r', tenantId: 't', expectedDecision: decision, finalSurface: s, completedAt: '2026-10-01T00:00:00.000Z', evidenceStrength },
    status: 'COMPLETED',
    evidenceId: 'e',
    metrics: [{ id: 'm1', metric: 'x', value: 1, availability: 'AVAILABLE' }],
    displayFacts: { metricIds: ['x'], ...facts },
  });
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error('projection failed');
  assert.ok(out.screen.display);
  return out.screen.display!;
}

test('2f6638a0-shape: VERIFY + 5 problems + 0 claims -> claims NONE_RECORDED, unknown legacy source', () => {
  const d = screen('VERIFY', surface({ topProblems: n(5, 'p') }));
  assert.equal(d.problems.count, 5);
  assert.equal(d.claims.state, 'NONE_RECORDED');
  assert.equal(d.missingEvidenceCount, null);
  assert.equal(d.source.value, 'UNKNOWN_LEGACY');
  assert.equal(d.source.countsTowardAggregates, false);
});

test('6adbe715-shape: VERIFY + 0 problems + claims 15/21/10 -> mismatch flag, counts kept', () => {
  const d = screen('VERIFY', surface({ supportedClaims: n(15, 's'), partiallySupportedClaims: n(21, 'p'), hypotheses: n(10, 'h') }));
  assert.ok(d.flags.includes('DECISION_PROBLEM_MISMATCH'));
  assert.deepEqual(d.claims.counts, { supported: 15, partial: 21, unverified: 10 });
  assert.equal(d.missingEvidenceCount, 31);
});

test('10a856f7-shape: REWORD + 5 problems + 22/1/1, one metric -> consistent', () => {
  const d = screen('REWORD', surface({ topProblems: n(5, 'p'), supportedClaims: n(22, 's'), partiallySupportedClaims: ['a'], hypotheses: ['b'] }));
  assert.equal(d.flags.includes('DECISION_PROBLEM_MISMATCH'), false);
  assert.equal(d.scope.metricCount, 1);
  assert.equal(d.decision.withheld, false);
});

test('aa734100-shape (I-016): fixture REWORD, no problems/claims, unknown strength -> all contradictions flagged', () => {
  const d = screen('REWORD', surface({}), { boardRunId: 'fixture-reword-phase16' }, 'unknown');
  assert.equal(d.source.value, 'FIXTURE');
  for (const flag of ['DECISION_PROBLEM_MISMATCH', 'NO_CLAIMS', 'NON_REAL_SOURCE', 'STRENGTH_COUNT_MISMATCH'] as const) {
    assert.ok(d.flags.includes(flag), flag);
  }
  assert.equal(d.missingEvidenceCount, null);
});

test('37072025-shape: stored MOCK source -> badge, excluded from aggregates', () => {
  const d = screen('VERIFY', surface({ topProblems: ['p'], supportedClaims: ['s'] }), { resultSource: 'MOCK' });
  assert.equal(d.source.label, 'Mock 결과');
  assert.equal(d.source.countsTowardAggregates, false);
});

test('I-016 banner and count agree: unknown strength with missing evidence is not flagged', () => {
  const d = screen('VERIFY', surface({ topProblems: ['p'], supportedClaims: ['s'], hypotheses: ['h'] }), {}, 'unknown');
  assert.equal(d.strength.evidence, '판단 불가');
  assert.equal(d.missingEvidenceCount, 1);
  assert.equal(d.flags.includes('STRENGTH_COUNT_MISMATCH'), false);
});
