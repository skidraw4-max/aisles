/**
 * Run: node --import tsx --test src/lib/ai-review-board/run-observation.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRunObservationMetrics } from './run-observation';
import type { ReviewBoardRun } from './types';

function baseRun(over: Partial<ReviewBoardRun>): ReviewBoardRun {
  return {
    runId: 'run-test',
    status: 'completed',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    evidence: null,
    independent: [],
    debate: [],
    critic: null,
    final: null,
    budget: { maxCalls: 40, usedCalls: 0, estimatedCostUsd: 0, warnings: [] },
    ...over,
  };
}

describe('computeRunObservationMetrics', () => {
  it('returns null debate counts when debate is empty (no invented zeros)', () => {
    const m = computeRunObservationMetrics(baseRun({}));
    assert.equal(m.agreementCount, null);
    assert.equal(m.disagreementCount, null);
    assert.equal(m.weakEvidenceCount, null);
    assert.equal(m.revisionCount, null);
  });

  it('counts agreement/disagreement/weakEvidence/revisions from debate arrays (v3)', () => {
    const m = computeRunObservationMetrics(
      baseRun({
        debate: [
          {
            memberId: 'A',
            agreement: ['a1', 'a2'],
            disagreement: ['d1'],
            weakEvidence: ['w1', 'w2', 'w3'],
            missed: [],
            needsVerification: [],
            revisionStatus: 'UNCHANGED',
            revised: false,
            revisionReason: 'kept',
            previousOpinion: 'p0',
            revisedOpinion: null,
            finalOpinion: 'f',
            confidence: 0.9,
          },
          {
            memberId: 'B',
            agreement: ['b1'],
            disagreement: [],
            weakEvidence: [],
            missed: [],
            needsVerification: [],
            revisionStatus: 'PARTIAL',
            revised: true,
            revisionReason: 'r',
            previousOpinion: 'p',
            revisedOpinion: 'n',
            finalOpinion: 'f2',
            confidence: 0.7,
          },
        ],
      }),
    );
    assert.equal(m.agreementCount, 3);
    assert.equal(m.disagreementCount, 1);
    assert.equal(m.weakEvidenceCount, 3);
    assert.equal(m.revisionCount, 1);
    assert.equal(m.partialRevisionCount, 1);
    assert.equal(m.fullRevisionCount, 0);
    assert.equal(m.unchangedCount, 1);
    assert.equal(m.averageConfidence, 0.8);
    assert.equal(m.confidenceSource, 'debate');
  });

  it('prefers revisions array for v4 confidence and status counts', () => {
    const m = computeRunObservationMetrics(
      baseRun({
        debate: [
          {
            memberId: 'A',
            agreement: ['x'],
            disagreement: [],
            weakEvidence: [],
            missed: [],
            needsVerification: [],
          },
        ],
        revisions: [
          {
            memberId: 'A',
            revisionStatus: 'PARTIAL',
            revised: true,
            originalOpinion: 'o',
            revisionReason: 'soften',
            retainReason: null,
            changedClaims: ['c1'],
            newEvidenceAccepted: [],
            rejectedArguments: [],
            confidenceBefore: 0.9,
            confidenceAfter: 0.6,
            confidenceChangeReason: 'gap',
            finalOpinion: 'f',
            revisionAnswers: {
              q1_coreClaim: '',
              q2_strongestRebuttal: '',
              q3_rebuttalEvidenceKind: '',
              q4_evidenceGapsFound: '',
              q5_gapAffectsCoreClaim: '',
              q6_directlySupportedScope: '',
              q7_overclaimCheck: '',
              q8_whyRetainIfUnchanged: '',
              q9_claimsToChangeIfPartial: '',
              q10_groundsForFullRevision: '',
              q11_chosenStatus: 'PARTIAL',
              q12_confidenceChange: '',
            },
          },
        ],
      }),
    );
    assert.equal(m.revisionCount, 1);
    assert.equal(m.partialRevisionCount, 1);
    assert.equal(m.confidenceSource, 'revision');
    assert.equal(m.avgConfidenceBefore, 0.9);
    assert.equal(m.avgConfidenceAfter, 0.6);
  });
});
