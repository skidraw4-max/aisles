import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isInProgressReviewBoardPhase,
  isTerminalReviewBoardPhase,
  reviewBoardPhaseLabelKo,
} from './phase-label';
import type { ReviewBoardPhase } from './types';

describe('reviewBoardPhaseLabelKo', () => {
  it('maps debate to 위원회 토론 중', () => {
    assert.equal(reviewBoardPhaseLabelKo('debate'), '위원회 토론 중');
  });

  it('uses distinct labels per in-progress phase', () => {
    const phases: ReviewBoardPhase[] = [
      'queued',
      'collecting_evidence',
      'independent',
      'debate',
      'claim_calibration',
      'evidence_semantics',
      'semantic_judge',
      'revision',
      'consistency_check',
      'critic',
      'chairman',
    ];
    const labels = phases.map(reviewBoardPhaseLabelKo);
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(labels.every((l) => l.includes('중')));
  });

  it('labels terminal phases distinctly', () => {
    assert.equal(reviewBoardPhaseLabelKo('completed'), '완료');
    assert.equal(reviewBoardPhaseLabelKo('failed'), '실패');
  });
});

describe('terminal / in-progress phase helpers', () => {
  it('completed and failed are terminal', () => {
    assert.equal(isTerminalReviewBoardPhase('completed'), true);
    assert.equal(isTerminalReviewBoardPhase('failed'), true);
    assert.equal(isInProgressReviewBoardPhase('completed'), false);
  });

  it('debate and independent are in progress', () => {
    assert.equal(isInProgressReviewBoardPhase('debate'), true);
    assert.equal(isInProgressReviewBoardPhase('independent'), true);
    assert.equal(isTerminalReviewBoardPhase('debate'), false);
  });
});
