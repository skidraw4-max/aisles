import type { EvalCaseExpected, EvalCaseResult } from './types';
import type { CriticReport, RevisionRecord } from '../../../../src/lib/ai-review-board/types';

export { extractActualFromRun } from '../../../../src/lib/ai-review-board/final-quality-actual';

function boolEq(a: boolean, b: boolean): boolean {
  return a === b;
}

export function compareExpected(
  expected: EvalCaseExpected,
  actual: NonNullable<EvalCaseResult['actual']>,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (actual.evidenceStrength !== expected.evidenceStrength) {
    reasons.push(
      `evidenceStrength: actual=${actual.evidenceStrength} expected=${expected.evidenceStrength}`,
    );
  }
  if (actual.claimStrength !== expected.claimStrength) {
    reasons.push(`claimStrength: actual=${actual.claimStrength} expected=${expected.claimStrength}`);
  }
  if (!boolEq(actual.conflictDetected!, expected.conflictDetected)) {
    reasons.push(
      `conflictDetected: actual=${actual.conflictDetected} expected=${expected.conflictDetected}`,
    );
  }
  if (!boolEq(actual.overclaimDetected!, expected.overclaimDetected)) {
    reasons.push(
      `overclaimDetected: actual=${actual.overclaimDetected} expected=${expected.overclaimDetected}`,
    );
  }
  if (!boolEq(actual.revisionRequired!, expected.revisionRequired)) {
    reasons.push(
      `revisionRequired: actual=${actual.revisionRequired} expected=${expected.revisionRequired}`,
    );
  }
  if (actual.expectedDecision !== expected.expectedDecision) {
    reasons.push(
      `expectedDecision: actual=${actual.expectedDecision} expected=${expected.expectedDecision}`,
    );
  }
  return { pass: reasons.length === 0, reasons };
}

export function scoreMetrics(
  cases: Array<{ expected: EvalCaseExpected; result: EvalCaseResult }>,
): Record<string, number | null> {
  const buckets: Record<string, { hit: number; total: number }> = {
    evidenceAssessment: { hit: 0, total: 0 },
    conflictDetection: { hit: 0, total: 0 },
    overclaimDetection: { hit: 0, total: 0 },
    revisionQuality: { hit: 0, total: 0 },
    chairmanSynthesis: { hit: 0, total: 0 },
  };

  for (const { expected, result } of cases) {
    if (result.status === 'SKIPPED' || result.status === 'ERROR') continue;
    const tags =
      expected.metricTags ??
      ([
        'evidenceAssessment',
        expected.conflictDetected ? 'conflictDetection' : null,
        expected.overclaimDetected ? 'overclaimDetection' : null,
        expected.revisionRequired ? 'revisionQuality' : null,
        'chairmanSynthesis',
      ].filter(Boolean) as string[]);
    const pass = result.status === 'PASS';
    for (const tag of tags) {
      const b = buckets[tag];
      if (!b) continue;
      b.total += 1;
      if (pass) b.hit += 1;
    }
  }

  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(buckets)) {
    out[k] = v.total === 0 ? null : Number((v.hit / v.total).toFixed(3));
  }
  return out;
}

// silence unused import lint in some tooling
export type _Critic = CriticReport;
export type _Rev = RevisionRecord;
