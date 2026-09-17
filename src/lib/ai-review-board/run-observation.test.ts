/**
 * Run: node --import tsx --test src/lib/ai-review-board/run-observation.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRunObservationMetrics } from './run-observation';
import type { ReviewBoardRun } from './types';

function baseRun(partial: Partial<ReviewBoardRun>): ReviewBoardRun {
  return {
    runId: 'run-test',
    status: 'completed',
    createdAt: '2026-09-17T07:53:24.323Z',
    updatedAt: '2026-09-17T07:54:00.000Z',
    evidence: null,
    independent: [],
    debate: [],
    critic: null,
    final: null,
    budget: { maxCalls: 40, usedCalls: 12, estimatedCostUsd: 0.18, warnings: [] },
    ...partial,
  };
}

describe('computeRunObservationMetrics', () => {
  it('returns null debate counts when debate is empty (no invented zeros)', () => {
    const m = computeRunObservationMetrics(
      baseRun({
        independent: [
          {
            memberId: 'A',
            currentState: '',
            strengths: [],
            problems: [],
            trendGap: '',
            improvementNeed: '',
            improvements: [],
            scores: [],
            judgmentBasis: '',
            confidence: 0.8,
            originalOpinion: 'x',
          },
        ],
      }),
    );
    assert.equal(m.agreementCount, null);
    assert.equal(m.disagreementCount, null);
    assert.equal(m.weakEvidenceCount, null);
    assert.equal(m.revisionCount, null);
    assert.equal(m.averageConfidence, 0.8);
    assert.equal(m.confidenceSource, 'independent');
  });

  it('counts agreement/disagreement/weakEvidence/revisions from debate arrays', () => {
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
});
