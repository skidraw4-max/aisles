/** RM-20 phase 1 (I-024): display only. No input claim -> '주장 입력 없음', never a definite strength label. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewDisplayModel, claimInputState, NO_INPUT_CLAIM_LABEL, type ReviewDisplayInput } from './review-display-model';

function input(request: ReviewDisplayInput['request'], claimStrength = 'strong'): ReviewDisplayInput {
  return {
    result: {
      id: 'rm20-r',
      boardRunId: 'run-1',
      expectedDecision: 'ACCEPT',
      finalSurface: {
        statusSummary: 's', topProblems: [], expectedUserEffect: '', risk: '', dimensionEvidence: [],
        supportedClaims: ['a'], partiallySupportedClaims: [], hypotheses: [],
      } as never,
      evidenceStrength: 'strong',
      claimStrength,
      revisionRequired: false,
      conflictDetected: false,
      overclaimDetected: false,
    },
    request,
    evidence: undefined,
  };
}

test('FULL_REVIEW without an input claim shows 주장 입력 없음, not 강함', () => {
  for (const claim of [null, '', '   ']) {
    const model = buildReviewDisplayModel(input({ status: 'COMPLETED', resultSource: 'REAL_MODEL', reviewType: 'FULL_REVIEW', claim }));
    assert.equal(model.claimInput, 'NONE');
    assert.equal(model.strength.claim, NO_INPUT_CLAIM_LABEL);
    assert.notEqual(model.strength.claim, '강함');
  }
});

test('an entered claim keeps the stored strength label', () => {
  const full = buildReviewDisplayModel(input({ reviewType: 'FULL_REVIEW', claim: '가입자 400명 돌파' }));
  assert.equal(full.claimInput, 'ENTERED');
  assert.equal(full.strength.claim, '강함');
  const cv = buildReviewDisplayModel(input({ reviewType: 'CLAIM_VALIDATION', claim: '주장' }, 'extreme'));
  assert.equal(cv.claimInput, 'ENTERED');
  assert.equal(cv.strength.claim, '과도함');
});

test('CLAIM_VALIDATION is never treated as no-input', () => {
  assert.equal(claimInputState({ reviewType: 'CLAIM_VALIDATION', claim: '' }), 'ENTERED');
});

test('claim not loaded (legacy callers) keeps previous behaviour', () => {
  assert.equal(claimInputState(undefined), 'UNKNOWN');
  assert.equal(claimInputState({ status: 'COMPLETED' }), 'UNKNOWN');
  const model = buildReviewDisplayModel(input({ status: 'COMPLETED', resultSource: 'REAL_MODEL' }));
  assert.equal(model.claimInput, 'UNKNOWN');
  assert.equal(model.strength.claim, '강함');
});

test('display layer does not change decision, flags or evidence strength', () => {
  const before = buildReviewDisplayModel(input({ status: 'COMPLETED', resultSource: 'REAL_MODEL' }));
  const after = buildReviewDisplayModel(input({ status: 'COMPLETED', resultSource: 'REAL_MODEL', reviewType: 'FULL_REVIEW', claim: null }));
  assert.deepEqual(after.decision, before.decision);
  assert.deepEqual(after.flags, before.flags);
  assert.equal(after.strength.evidence, before.strength.evidence);
  assert.deepEqual(after.claims, before.claims);
});
