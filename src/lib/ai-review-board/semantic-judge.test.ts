/**
 * Run: node --import tsx --test src/lib/ai-review-board/semantic-judge.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import {
  adjudicateClaimDeterministic,
  buildSemanticJudgment,
  compareToReference,
  runJudgeRevisionConsistency,
  summarizeSemanticJudgments,
} from './semantic-judge';
import type { CalibratedClaim, RevisionRecord } from './types';

function claim(p: Partial<CalibratedClaim> & Pick<CalibratedClaim, 'claimText'>): CalibratedClaim {
  return {
    claimId: p.claimId ?? 'C001',
    claimText: p.claimText,
    evidenceRefs: p.evidenceRefs ?? [],
    evidenceType: p.evidenceType ?? 'INFERENCE',
    supportLevel: p.supportLevel ?? 'PARTIALLY_SUPPORTED',
    reason: p.reason ?? '',
    missingEvidence: p.missingEvidence ?? [],
    evidenceImpact: p.evidenceImpact ?? 'MEDIUM',
    riskOfOverclaiming: p.riskOfOverclaiming ?? 'MEDIUM',
  };
}

describe('semantic judge', () => {
  const evidence = buildStubEvidencePack({
    aggregates: {
      userCount: 14,
      usersLast7d: 0,
      newUsersLast7d: 0,
      activeUsersLast7d: null,
      postCount: 3369,
      postsLast7d: 138,
      commentsLast7d: 0,
      viewsLast7d: null,
      totalViews: 1000,
      commentCount: 0,
      postsByCategory: {},
    },
  });

  it('Test1: null metrics → measurement gap SUPPORTED', () => {
    const r = adjudicateClaimDeterministic(
      '활성 사용자 및 조회수 데이터가 측정되지 않는다.',
      evidence,
    );
    assert.equal(r.classification.supportLevel, 'SUPPORTED');
    assert.equal(r.classification.evidenceRelation, 'DIRECTLY_SUPPORTS');
    assert.equal(r.semanticLeap.type, 'NONE');
  });

  it('Test2: null → low activity UNKNOWN_AS_NEGATIVE', () => {
    const r = adjudicateClaimDeterministic('플랫폼의 활성도가 낮다.', evidence);
    assert.ok(
      r.classification.supportLevel === 'NOT_SUPPORTED' ||
        r.classification.supportLevel === 'PARTIALLY_SUPPORTED',
    );
    assert.equal(r.semanticLeap.type, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
  });

  it('Test3: newUsers=0 direct fact', () => {
    const r = adjudicateClaimDeterministic('최근 7일 신규 사용자가 0명이다.', evidence);
    assert.equal(r.classification.supportLevel, 'SUPPORTED');
    assert.equal(r.classification.evidenceRelation, 'DIRECTLY_SUPPORTS');
  });

  it('Test4: acquisition strategy failed → FACT_TO_CAUSALITY', () => {
    const r = adjudicateClaimDeterministic('사용자 획득 전략이 실패했다.', evidence);
    assert.ok(
      r.classification.supportLevel === 'NOT_SUPPORTED' ||
        r.classification.supportLevel === 'PARTIALLY_SUPPORTED',
    );
    assert.equal(r.semanticLeap.type, 'FACT_TO_CAUSALITY');
  });

  it('Test5: comments=0 direct', () => {
    const r = adjudicateClaimDeterministic('최근 7일 댓글 활동이 없다.', evidence);
    assert.equal(r.classification.supportLevel, 'SUPPORTED');
  });

  it('Test6: global community engagement → FACT_TO_GLOBAL', () => {
    const r = adjudicateClaimDeterministic(
      '전체 커뮤니티 참여도가 심각하게 낮다.',
      evidence,
    );
    assert.equal(r.semanticLeap.type, 'FACT_TO_GLOBAL_CONCLUSION');
  });

  it('Test7: posts decline trend → FACT_TO_TREND', () => {
    const r = adjudicateClaimDeterministic('최근 게시물 생산량이 감소했다.', evidence);
    assert.equal(r.classification.supportLevel, 'NOT_SUPPORTED');
    assert.equal(r.semanticLeap.type, 'FACT_TO_TREND');
  });

  it('Test8: tech stack quality leap', () => {
    const r = adjudicateClaimDeterministic(
      'Vercel + PostgreSQL로 인프라 확장성이 검증되었다.',
      evidence,
    );
    assert.equal(r.semanticLeap.type, 'TECH_STACK_TO_QUALITY');
  });

  it('Test9: dual zero claim not over-downgraded', () => {
    const r = adjudicateClaimDeterministic(
      '최근 7일 신규 사용자가 0명이고 댓글도 0개이다.',
      evidence,
    );
    assert.equal(r.classification.supportLevel, 'SUPPORTED');
    assert.equal(r.semanticLeap.type, 'NONE');
  });

  it('Test10: zero means strategy failure → causal', () => {
    const r = adjudicateClaimDeterministic(
      '최근 7일 신규 사용자 0명이라는 사실은 획득 전략 실패를 의미한다.',
      evidence,
    );
    assert.equal(r.classification.supportLevel, 'NOT_SUPPORTED');
    assert.equal(r.semanticLeap.type, 'FACT_TO_CAUSALITY');
  });

  it('null ≠ 0: measurement vs low activity differ', () => {
    const a = adjudicateClaimDeterministic(
      '활성 사용자 수를 알 수 없다.',
      evidence,
    );
    const b = adjudicateClaimDeterministic('활성 사용자 활동량이 낮다.', evidence);
    assert.equal(a.classification.supportLevel, 'SUPPORTED');
    assert.equal(b.semanticLeap.type, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
  });

  it('regression: compareToReference yields TP/TN/FP', () => {
    const det = adjudicateClaimDeterministic('플랫폼의 활성도가 낮다.', evidence);
    const tp = compareToReference(
      det.classification,
      {
        evidenceType: 'UNKNOWN',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
        semanticLeapType: 'UNKNOWN_AS_NEGATIVE_EVIDENCE',
      },
      det.semanticLeap.type,
    );
    assert.equal(tp, 'TRUE_POSITIVE');

    const ok = adjudicateClaimDeterministic('최근 7일 신규 사용자가 0명이다.', evidence);
    const tn = compareToReference(
      ok.classification,
      {
        evidenceType: 'DIRECT_FACT',
        supportLevel: 'SUPPORTED',
        evidenceRelation: 'DIRECTLY_SUPPORTS',
        overclaimRisk: 'LOW',
        semanticLeapType: 'NONE',
      },
      ok.semanticLeap.type,
    );
    assert.equal(tn, 'TRUE_NEGATIVE');
  });

  it('live mode never assigns TP/FP without reference', () => {
    const j = buildSemanticJudgment({
      memberId: 'A',
      claim: claim({
        claimText: '플랫폼의 활성도가 낮다.',
        evidenceType: 'INFERENCE',
        supportLevel: 'SUPPORTED',
      }),
      evidence,
      liveMode: true,
    });
    assert.equal(j.verdict, 'SEMANTICALLY_AMBIGUOUS');
    assert.equal(j.semanticLeap.type, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
    assert.ok(j.calibrationAgreement === 'DISAGREE' || j.calibrationAgreement === 'PARTIAL');
  });

  it('majority reasoning flagged in judge-revision consistency', () => {
    const j = buildSemanticJudgment({
      memberId: 'B',
      claim: claim({ claimText: '최근 7일 신규 사용자가 0명이다.' }),
      evidence,
      llmJudgment: {
        judgeReason: '다른 AI들이 모두 동의했기 때문에 SUPPORTED로 판정',
        judgeClassification: {
          evidenceType: 'DIRECT_FACT',
          supportLevel: 'SUPPORTED',
          evidenceRelation: 'DIRECTLY_SUPPORTS',
          overclaimRisk: 'LOW',
        },
      },
      liveMode: true,
    });
    const rev: RevisionRecord = {
      memberId: 'B',
      revisionStatus: 'UNCHANGED',
      revised: false,
      originalOpinion: 'x',
      revisionReason: null,
      retainReason: 'ok',
      changedClaims: [],
      newEvidenceAccepted: [],
      rejectedArguments: [],
      confidenceBefore: 0.9,
      confidenceAfter: 0.9,
      confidenceChangeReason: 'same',
      finalOpinion: 'x',
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
        q11_chosenStatus: 'UNCHANGED',
        q12_confidenceChange: '',
      },
    };
    const checks = runJudgeRevisionConsistency([j], [rev]);
    assert.ok(checks.some((c) => c.flags.includes('MAJORITY_DRIVEN_JUDGMENT')));
  });

  it('judgeRevisionMismatch when leap retained without reason', () => {
    const j = buildSemanticJudgment({
      memberId: 'C',
      claim: claim({
        claimText: '사용자 획득 전략이 실패했다.',
        supportLevel: 'SUPPORTED',
      }),
      evidence,
      liveMode: true,
    });
    const rev: RevisionRecord = {
      memberId: 'C',
      revisionStatus: 'UNCHANGED',
      revised: false,
      originalOpinion: 'x',
      revisionReason: null,
      retainReason: '기존 의견을 유지한다.',
      changedClaims: [],
      newEvidenceAccepted: [],
      rejectedArguments: [],
      confidenceBefore: 0.9,
      confidenceAfter: 0.9,
      confidenceChangeReason: 'same',
      finalOpinion: '획득 전략이 실패했다',
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
        q11_chosenStatus: 'UNCHANGED',
        q12_confidenceChange: '',
      },
    };
    const checks = runJudgeRevisionConsistency([j], [rev]);
    assert.ok(
      checks.some(
        (c) =>
          c.flags.includes('JUDGE_REVISION_MISMATCH') ||
          c.flags.includes('CAUSAL_LEAP_RETAINED'),
      ),
    );
  });

  it('summarize live leaves TP/FP null', () => {
    const j = buildSemanticJudgment({
      memberId: 'A',
      claim: claim({ claimText: '최근 7일 신규 사용자가 0명이다.' }),
      evidence,
      liveMode: true,
    });
    const s = summarizeSemanticJudgments([j]);
    assert.equal(s.truePositive, null);
    assert.equal(s.ambiguous, 1);
  });

  it('v1-v7 compatibility: empty judgments summarize safely', () => {
    const s = summarizeSemanticJudgments([]);
    assert.equal(s.totalClaims, 0);
    assert.equal(s.truePositive, null);
  });
});
