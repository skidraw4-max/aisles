/**
 * Run: node --import tsx --test src/lib/ai-review-board/revision-status.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isRevisionStatus,
  revisionStatusImpliesChange,
} from './types';
import { createMockReviewBoardLlm } from './mock-llm';
import { buildStubEvidencePack } from './evidence-pack';

describe('revisionStatus helpers', () => {
  it('accepts only UNCHANGED | PARTIAL | FULL', () => {
    assert.equal(isRevisionStatus('UNCHANGED'), true);
    assert.equal(isRevisionStatus('PARTIAL'), true);
    assert.equal(isRevisionStatus('FULL'), true);
    assert.equal(isRevisionStatus('YES'), false);
  });

  it('does not treat UNCHANGED as a change', () => {
    assert.equal(revisionStatusImpliesChange('UNCHANGED'), false);
    assert.equal(revisionStatusImpliesChange('PARTIAL'), true);
    assert.equal(revisionStatusImpliesChange('FULL'), true);
  });
});

describe('mock revisionPass revisionStatus', () => {
  it('can stay UNCHANGED without forcing revision', async () => {
    const llm = createMockReviewBoardLlm({ reviseOnDebate: false, revisionStatus: 'UNCHANGED' });
    const evidence = buildStubEvidencePack();
    const own = await llm.independentAnalysis('A', evidence, {
      phase: 'independent',
      memberId: 'A',
      evidence,
    });
    const debate = await llm.debateTurn('A', evidence, [own], own);
    const cal = await llm.claimCalibrate('A', evidence, own, debate);
    const rev = await llm.revisionPass('A', evidence, own, debate, [own], cal);
    assert.equal(rev.revisionStatus, 'UNCHANGED');
    assert.equal(rev.revised, false);
    assert.ok(rev.retainReason);
  });

  it('supports PARTIAL without claiming FULL', async () => {
    const llm = createMockReviewBoardLlm({ revisionStatus: 'PARTIAL' });
    const evidence = buildStubEvidencePack();
    const own = await llm.independentAnalysis('B', evidence, {
      phase: 'independent',
      memberId: 'B',
      evidence,
    });
    const debate = await llm.debateTurn('B', evidence, [own], own);
    const cal = await llm.claimCalibrate('B', evidence, own, debate);
    const rev = await llm.revisionPass('B', evidence, own, debate, [own], cal);
    assert.equal(rev.revisionStatus, 'PARTIAL');
    assert.equal(rev.revised, true);
    assert.ok(rev.changedClaims.length >= 1);
    assert.ok(rev.finalOpinion.includes('PARTIAL'));
  });
});
