/**
 * Run: node --import tsx --test src/lib/ai-review-board/calibration-revision-consistency.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateClaimRevisionConsistency,
  runCalibrationRevisionChecks,
  summarizeConsistency,
} from './calibration-revision-consistency';
import type {
  CalibratedClaim,
  ClaimCalibration,
  RevisionAnswers,
  RevisionRecord,
} from './types';

function emptyAnswers(status: 'UNCHANGED' | 'PARTIAL' | 'FULL' = 'UNCHANGED'): RevisionAnswers {
  return {
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
    q11_chosenStatus: status,
    q12_confidenceChange: '',
  };
}

function baseClaim(p: Partial<CalibratedClaim> & Pick<CalibratedClaim, 'claimText'>): CalibratedClaim {
  return {
    claimId: p.claimId ?? 'C001',
    claimText: p.claimText,
    evidenceRefs: p.evidenceRefs ?? ['newUsersLast7d'],
    evidenceType: p.evidenceType ?? 'DIRECT_FACT',
    supportLevel: p.supportLevel ?? 'SUPPORTED',
    reason: p.reason ?? '',
    missingEvidence: p.missingEvidence ?? [],
    evidenceImpact: p.evidenceImpact ?? 'NONE',
    riskOfOverclaiming: p.riskOfOverclaiming ?? 'LOW',
  };
}

function baseRev(p: Partial<RevisionRecord> & Pick<RevisionRecord, 'revisionStatus'>): RevisionRecord {
  const revised = p.revisionStatus !== 'UNCHANGED';
  return {
    memberId: 'A',
    revisionStatus: p.revisionStatus,
    revised,
    originalOpinion: p.originalOpinion ?? 'original',
    revisionReason: p.revisionReason ?? null,
    retainReason: p.retainReason ?? null,
    changedClaims: p.changedClaims ?? [],
    newEvidenceAccepted: p.newEvidenceAccepted ?? [],
    rejectedArguments: p.rejectedArguments ?? [],
    confidenceBefore: p.confidenceBefore ?? 0.9,
    confidenceAfter: p.confidenceAfter ?? 0.9,
    confidenceChangeReason: p.confidenceChangeReason ?? 'unchanged',
    finalOpinion: p.finalOpinion ?? 'original',
    revisionAnswers: p.revisionAnswers ?? emptyAnswers(p.revisionStatus),
    calibrationImpactAssessment: p.calibrationImpactAssessment,
  };
}

describe('calibration ↔ revision consistency', () => {
  it('Test1: supported fact retained → CONSISTENT', () => {
    const claim = baseClaim({
      claimText: '최근 7일 신규 사용자 수는 0명이다.',
      evidenceType: 'DIRECT_FACT',
      supportLevel: 'SUPPORTED',
      riskOfOverclaiming: 'LOW',
    });
    const rev = baseRev({
      revisionStatus: 'UNCHANGED',
      retainReason: 'DIRECT_FACT newUsersLast7d=0 still holds',
      calibrationImpactAssessment: {
        materiallyAffected: false,
        affectedClaims: [
          {
            claimId: 'C001',
            calibrationSupportLevel: 'SUPPORTED',
            calibrationEvidenceImpact: 'NONE',
            calibrationRiskOfOverclaiming: 'LOW',
            revisionAction: 'RETAIN_WITH_JUSTIFICATION',
            actionReason: 'Supported fact',
          },
        ],
      },
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'RETAIN_WITH_JUSTIFICATION',
    });
    assert.equal(r.consistency, 'CONSISTENT');
  });

  it('Test2: partial claim correctly narrowed → CONSISTENT', () => {
    const claim = baseClaim({
      claimId: 'C003',
      claimText: '전체 사용자 참여도가 심각하게 낮다.',
      evidenceType: 'INFERENCE',
      supportLevel: 'PARTIALLY_SUPPORTED',
      evidenceImpact: 'HIGH',
      riskOfOverclaiming: 'MEDIUM',
      missingEvidence: ['activeUsersLast7d', 'viewsLast7d'],
    });
    const rev = baseRev({
      revisionStatus: 'PARTIAL',
      revisionReason: 'Narrow platform-wide engagement claim due to null active/views',
      changedClaims: ['crisis → scoped signup/comments only'],
      confidenceAfter: 0.7,
      confidenceChangeReason: 'HIGH evidence gap → lower confidence',
      finalOpinion: 'Recent signups/comments are zero; overall engagement unknown',
      calibrationImpactAssessment: {
        materiallyAffected: true,
        affectedClaims: [
          {
            claimId: 'C003',
            calibrationSupportLevel: 'PARTIALLY_SUPPORTED',
            calibrationEvidenceImpact: 'HIGH',
            calibrationRiskOfOverclaiming: 'MEDIUM',
            revisionAction: 'NARROW',
            actionReason: 'Null active/views block platform-wide claim',
          },
        ],
      },
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'NARROW',
    });
    assert.equal(r.consistency, 'CONSISTENT');
  });

  it('Test3: partial retained with valid justification → CONSISTENT', () => {
    const claim = baseClaim({
      claimId: 'C003',
      claimText: '전체 사용자 참여도가 심각하게 낮다.',
      evidenceType: 'INFERENCE',
      supportLevel: 'PARTIALLY_SUPPORTED',
      evidenceImpact: 'HIGH',
      riskOfOverclaiming: 'MEDIUM',
    });
    const rev = baseRev({
      revisionStatus: 'UNCHANGED',
      retainReason:
        'C003: evidence gap on activeUsersLast7d/viewsLast7d noted, but zero newUsers+comments still warrant strong low-activity wording for measured channels',
      confidenceChangeReason: 'Kept confidence because scoped measured metrics still support core',
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'RETAIN_WITH_JUSTIFICATION',
      actionReason: 'Measured channel activity remains zero',
    });
    assert.ok(r.consistency === 'CONSISTENT' || r.consistency === 'PARTIALLY_CONSISTENT');
  });

  it('Test4: partial retained without justification → INCONSISTENT', () => {
    const claim = baseClaim({
      claimId: 'C003',
      claimText: '전체 사용자 참여도가 심각하게 낮다.',
      evidenceType: 'INFERENCE',
      supportLevel: 'PARTIALLY_SUPPORTED',
      evidenceImpact: 'HIGH',
      riskOfOverclaiming: 'HIGH',
    });
    const rev = baseRev({
      revisionStatus: 'UNCHANGED',
      retainReason: 'No change needed',
      confidenceChangeReason: 'same',
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'NO_ACTION_NEEDED',
    });
    assert.equal(r.consistency, 'INCONSISTENT');
    assert.ok(r.flags.includes('CALIBRATION_REVISION_MISMATCH'));
  });

  it('Test5: unknown interpreted as low activity → INCONSISTENT', () => {
    const claim = baseClaim({
      claimId: 'C010',
      claimText: 'activeUsersLast7d is null',
      evidenceType: 'UNKNOWN',
      supportLevel: 'NOT_SUPPORTED',
      evidenceRefs: ['activeUsersLast7d', 'viewsLast7d'],
      evidenceImpact: 'HIGH',
    });
    const rev = baseRev({
      revisionStatus: 'UNCHANGED',
      finalOpinion: '최근 활동량이 매우 낮다 because metrics unavailable',
      retainReason: 'unchanged',
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
    });
    assert.equal(r.consistency, 'INCONSISTENT');
    assert.ok(r.flags.includes('UNKNOWN_AS_NEGATIVE_EVIDENCE'));
  });

  it('Test6: unsupported causal retained → INCONSISTENT', () => {
    const claim = baseClaim({
      claimId: 'C011',
      claimText: 'UX/UI 문제가 신규 부족의 원인이다',
      evidenceType: 'HYPOTHESIS',
      supportLevel: 'NOT_SUPPORTED',
      evidenceRefs: [],
      evidenceImpact: 'MEDIUM',
      riskOfOverclaiming: 'HIGH',
    });
    const rev = baseRev({
      revisionStatus: 'UNCHANGED',
      finalOpinion: 'UX 문제 때문에 신규 사용자가 감소했다.',
      retainReason: 'still believe UX is root cause',
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
    });
    assert.equal(r.consistency, 'INCONSISTENT');
    assert.ok(r.flags.includes('CAUSAL_CLAIM_WITHOUT_EVIDENCE'));
  });

  it('Test7: confidence unchanged but justified → not unjustified flag', () => {
    const claim = baseClaim({
      claimId: 'C003',
      claimText: 'engagement low',
      supportLevel: 'PARTIALLY_SUPPORTED',
      evidenceImpact: 'HIGH',
      riskOfOverclaiming: 'MEDIUM',
      evidenceType: 'INFERENCE',
    });
    const rev = baseRev({
      revisionStatus: 'UNCHANGED',
      retainReason:
        'C003 evidence gap on null active/views considered; confidence kept because newUsers=0 and comments=0 still strong',
      confidenceChangeReason: 'confidence maintained: measured metrics still support scoped claim despite gap',
      confidenceBefore: 0.9,
      confidenceAfter: 0.9,
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'RETAIN_WITH_JUSTIFICATION',
    });
    assert.equal(r.flags.includes('CONFIDENCE_UNJUSTIFIED'), false);
  });

  it('Test8: confidence unchanged without justification → CONFIDENCE_UNJUSTIFIED', () => {
    const claim = baseClaim({
      claimId: 'C003',
      claimText: 'engagement crisis',
      supportLevel: 'PARTIALLY_SUPPORTED',
      evidenceImpact: 'HIGH',
      riskOfOverclaiming: 'HIGH',
      evidenceType: 'INFERENCE',
    });
    const rev = baseRev({
      revisionStatus: 'UNCHANGED',
      retainReason: 'ok',
      confidenceChangeReason: '',
      confidenceBefore: 0.9,
      confidenceAfter: 0.9,
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'NO_ACTION_NEEDED',
    });
    assert.ok(r.flags.includes('CONFIDENCE_UNJUSTIFIED'));
  });

  it('Test9: majority-driven revision → MAJORITY_DRIVEN_REVISION', () => {
    const claim = baseClaim({ claimText: 'x' });
    const rev = baseRev({
      revisionStatus: 'PARTIAL',
      revisionReason: '다른 AI 4명이 같은 의견을 냈기 때문에 수정했다. The majority agrees.',
      changedClaims: ['tweaked'],
      confidenceAfter: 0.85,
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'REWORD',
    });
    assert.ok(r.flags.includes('MAJORITY_DRIVEN_REVISION'));
  });

  it('Test10: supported fact unnecessarily downgraded → warn', () => {
    const claim = baseClaim({
      claimText: 'newUsersLast7d is 0',
      evidenceType: 'DIRECT_FACT',
      supportLevel: 'SUPPORTED',
      riskOfOverclaiming: 'LOW',
      evidenceImpact: 'NONE',
    });
    const rev = baseRev({
      revisionStatus: 'PARTIAL',
      revisionReason: 'evidence 부족으로 fact를 약화',
      changedClaims: ['remove zero signup fact'],
      confidenceAfter: 0.5,
    });
    const r = evaluateClaimRevisionConsistency({
      memberId: 'A',
      claim,
      revision: rev,
      revisionAction: 'REWORD',
    });
    assert.ok(r.flags.includes('SUPPORTED_FACT_UNNECESSARILY_DOWNGRADED'));
    assert.ok(
      r.consistency === 'PARTIALLY_CONSISTENT' || r.consistency === 'INCONSISTENT',
    );
  });

  it('batch checker + summarize', () => {
    const cal: ClaimCalibration = {
      memberId: 'B',
      claims: [
        baseClaim({
          claimId: 'C001',
          claimText: 'signup 0',
          supportLevel: 'SUPPORTED',
          evidenceType: 'DIRECT_FACT',
        }),
        baseClaim({
          claimId: 'C002',
          claimText: 'platform engagement crisis',
          supportLevel: 'PARTIALLY_SUPPORTED',
          evidenceImpact: 'HIGH',
          riskOfOverclaiming: 'HIGH',
          evidenceType: 'INFERENCE',
        }),
      ],
    };
    const rev = baseRev({
      memberId: 'B',
      revisionStatus: 'UNCHANGED',
      retainReason: 'fine',
      confidenceChangeReason: 'same',
    });
    // fix memberId on rev
    rev.memberId = 'B';
    const checks = runCalibrationRevisionChecks([cal], [rev]);
    assert.equal(checks.length, 2);
    const sum = summarizeConsistency(checks);
    assert.ok(sum.inconsistent >= 1);
  });

  it('mock scenarios A–E produce expected consistency outcomes', async () => {
    const { createMockReviewBoardLlm } = await import('./mock-llm');
    const { buildStubEvidencePack } = await import('./evidence-pack');
    const evidence = buildStubEvidencePack();

    async function runScenario(sc: 'A' | 'B' | 'C' | 'D' | 'E') {
      const llm = createMockReviewBoardLlm({ consistencyScenario: sc });
      const ind = await llm.independentAnalysis('A', evidence, {
        phase: 'independent',
        evidence,
      });
      const deb = await llm.debateTurn('A', evidence, [ind], ind);
      const cal = await llm.claimCalibrate('A', evidence, ind, deb);
      const rev = await llm.revisionPass('A', evidence, ind, deb, [ind], cal);
      return runCalibrationRevisionChecks([cal], [rev]);
    }

    const a = await runScenario('A');
    assert.ok(a.some((c) => c.revisionStatus === 'PARTIAL'));
    assert.ok(a.every((c) => c.consistency === 'CONSISTENT' || c.consistency === 'PARTIALLY_CONSISTENT'));

    const b = await runScenario('B');
    assert.ok(b.some((c) => c.revisionStatus === 'UNCHANGED'));
    assert.ok(
      b
        .filter((c) => c.calibrationSupportLevel === 'PARTIALLY_SUPPORTED')
        .every((c) => c.consistency === 'CONSISTENT' || c.consistency === 'PARTIALLY_CONSISTENT'),
    );

    const c = await runScenario('C');
    assert.ok(
      c.some(
        (x) =>
          x.consistency === 'INCONSISTENT' &&
          x.flags.includes('CALIBRATION_REVISION_MISMATCH'),
      ),
    );

    const d = await runScenario('D');
    assert.ok(d.some((x) => x.flags.includes('CAUSAL_CLAIM_WITHOUT_EVIDENCE')));

    const e = await runScenario('E');
    assert.ok(e.some((x) => x.flags.includes('UNKNOWN_AS_NEGATIVE_EVIDENCE')));
  });
});
