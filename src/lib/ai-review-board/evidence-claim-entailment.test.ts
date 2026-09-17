/**
 * Run: node --import tsx --test src/lib/ai-review-board/evidence-claim-entailment.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import {
  evaluateEvidenceClaimEntailment,
  runEvidenceSemanticsChecks,
  normalizeEvidenceSemanticsMember,
  rowFromHeuristic,
} from './evidence-claim-entailment';
import type { ClaimCalibration } from './types';

describe('evidence claim entailment', () => {
  const evidence = buildStubEvidencePack({
    aggregates: {
      userCount: 14,
      usersLast7d: 0,
      newUsersLast7d: 0,
      activeUsersLast7d: null,
      postCount: 200,
      postsLast7d: 139,
      commentsLast7d: 0,
      viewsLast7d: null,
      totalViews: 1000,
      commentCount: 0,
      postsByCategory: {},
    },
  });

  it('Test1: newUsers=0 → DIRECTLY_SUPPORTS signup claim', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '최근 7일 신규 가입자는 0명이다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'DIRECTLY_SUPPORTS');
  });

  it('Test2: activeUsers null → DIRECTLY_SUPPORTS cannot-measure claim', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '최근 7일 활성 사용자 수를 알 수 없다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'DIRECTLY_SUPPORTS');
  });

  it('Test3: activeUsers null → low activity DOES_NOT_SUPPORT or UNKNOWN', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '최근 사용자 활동이 매우 낮다.',
      evidence,
    });
    assert.ok(
      r.evidenceRelation === 'DOES_NOT_SUPPORT' || r.evidenceRelation === 'UNKNOWN',
    );
    assert.ok(r.flags.includes('UNKNOWN_AS_NEGATIVE_EVIDENCE'));
  });

  it('Test4: comments=0 → UX problem DOES_NOT_SUPPORT', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '댓글 UX가 문제다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'DOES_NOT_SUPPORT');
  });

  it('Test5: newUsers=0 → acquisition decreased → UNKNOWN', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '신규 유입이 감소했다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'UNKNOWN');
    assert.ok(r.flags.includes('UNSUPPORTED_TIME_TREND'));
  });

  it('Test6: newUsers=0 → SEO failed DOES_NOT_SUPPORT', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: 'SEO가 실패했다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'DOES_NOT_SUPPORT');
  });

  it('Test7: Gemini → engagement increase DOES_NOT_SUPPORT or UNKNOWN', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: 'Gemini가 참여도를 증가시켰다.',
      evidence,
    });
    assert.ok(
      r.evidenceRelation === 'DOES_NOT_SUPPORT' || r.evidenceRelation === 'UNKNOWN',
    );
  });

  it('Test8: posts+comments → creation with no comments DIRECTLY_SUPPORTS', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '게시글 생성은 있었지만 댓글 작성은 없었다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'DIRECTLY_SUPPORTS');
  });

  it('Test9: content fails to induce engagement → PARTIALLY_SUPPORTS', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '콘텐츠가 사용자 참여를 유도하지 못했다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'PARTIALLY_SUPPORTS');
  });

  it('Test10: userCount=14 → DIRECTLY_SUPPORTS', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '전체 사용자 수는 14명이다.',
      evidence,
    });
    assert.equal(r.evidenceRelation, 'DIRECTLY_SUPPORTS');
  });

  it('Test11: user base very small → PARTIALLY_SUPPORTS or UNKNOWN', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '사용자 기반이 매우 작다.',
      evidence,
    });
    assert.ok(
      r.evidenceRelation === 'PARTIALLY_SUPPORTS' || r.evidenceRelation === 'UNKNOWN',
    );
  });

  it('Test12: prior comparison decrease → DIRECTLY_SUPPORTS or STRONG_INFERENCE', () => {
    const r = evaluateEvidenceClaimEntailment({
      claimText: '사용자가 감소했다.',
      evidence,
      priorUserCount: 20,
    });
    assert.ok(
      r.evidenceRelation === 'DIRECTLY_SUPPORTS' ||
        r.entailmentLevel === 'STRONG_INFERENCE',
    );
  });

  it('mock scenarios A–G via heuristics + checker', () => {
    const cal: ClaimCalibration = {
      memberId: 'A',
      claims: [
        {
          claimId: 'C001',
          claimText: '최근 7일 신규 가입자는 0명이다.',
          evidenceRefs: ['newUsersLast7d'],
          evidenceType: 'DIRECT_FACT',
          supportLevel: 'SUPPORTED',
          reason: 'newUsersLast7d=0',
          missingEvidence: [],
          evidenceImpact: 'NONE',
          riskOfOverclaiming: 'LOW',
        },
        {
          claimId: 'C002',
          claimText: '최근 사용자 활동이 매우 낮다.',
          evidenceRefs: ['activeUsersLast7d'],
          evidenceType: 'UNKNOWN',
          supportLevel: 'NOT_SUPPORTED',
          reason: 'null',
          missingEvidence: ['activeUsersLast7d'],
          evidenceImpact: 'HIGH',
          riskOfOverclaiming: 'HIGH',
        },
        {
          claimId: 'C003',
          claimText: '최근 7일 댓글 작성은 0건이다.',
          evidenceRefs: ['commentsLast7d'],
          evidenceType: 'DIRECT_FACT',
          supportLevel: 'SUPPORTED',
          reason: '0',
          missingEvidence: [],
          evidenceImpact: 'NONE',
          riskOfOverclaiming: 'LOW',
        },
        {
          claimId: 'C004',
          claimText: 'UX 문제 때문에 댓글이 없다.',
          evidenceRefs: ['commentsLast7d'],
          evidenceType: 'HYPOTHESIS',
          supportLevel: 'NOT_SUPPORTED',
          reason: 'causal',
          missingEvidence: ['ux_events'],
          evidenceImpact: 'HIGH',
          riskOfOverclaiming: 'HIGH',
        },
        {
          claimId: 'C005',
          claimText: 'Gemini가 참여도를 증가시켰다.',
          evidenceRefs: [],
          evidenceType: 'HYPOTHESIS',
          supportLevel: 'NOT_SUPPORTED',
          reason: 'no usage',
          missingEvidence: ['ai_usage'],
          evidenceImpact: 'HIGH',
          riskOfOverclaiming: 'HIGH',
        },
        {
          claimId: 'C006',
          claimText: '게시글 생성은 있었지만 댓글 작성은 없었다.',
          evidenceRefs: ['postsLast7d', 'commentsLast7d'],
          evidenceType: 'DIRECT_FACT',
          supportLevel: 'SUPPORTED',
          reason: '139/0',
          missingEvidence: [],
          evidenceImpact: 'LOW',
          riskOfOverclaiming: 'LOW',
        },
        {
          claimId: 'C007',
          claimText: '신규 유입이 감소했다.',
          evidenceRefs: ['newUsersLast7d'],
          evidenceType: 'INFERENCE',
          supportLevel: 'NOT_SUPPORTED',
          reason: 'no prior',
          missingEvidence: ['prior'],
          evidenceImpact: 'HIGH',
          riskOfOverclaiming: 'MEDIUM',
        },
      ],
    };

    const sem = normalizeEvidenceSemanticsMember(
      'A',
      {
        claims: cal.claims.map((c) => rowFromHeuristic(c, evidence)),
      },
      cal,
    );

    assert.equal(
      sem.claims.find((c) => c.claimId === 'C001')?.evidenceRelation,
      'DIRECTLY_SUPPORTS',
    );
    assert.equal(
      sem.claims.find((c) => c.claimId === 'C002')?.evidenceRelation,
      'DOES_NOT_SUPPORT',
    );
    assert.equal(
      sem.claims.find((c) => c.claimId === 'C003')?.evidenceRelation,
      'DIRECTLY_SUPPORTS',
    );
    assert.equal(
      sem.claims.find((c) => c.claimId === 'C004')?.evidenceRelation,
      'DOES_NOT_SUPPORT',
    );
    assert.ok(
      ['DOES_NOT_SUPPORT', 'UNKNOWN'].includes(
        sem.claims.find((c) => c.claimId === 'C005')!.evidenceRelation,
      ),
    );
    assert.equal(
      sem.claims.find((c) => c.claimId === 'C006')?.evidenceRelation,
      'DIRECTLY_SUPPORTS',
    );
    assert.equal(
      sem.claims.find((c) => c.claimId === 'C007')?.evidenceRelation,
      'UNKNOWN',
    );

    const checks = runEvidenceSemanticsChecks(evidence, [cal], [sem]);
    assert.ok(
      checks.some(
        (c) =>
          c.claimId === 'C002' && c.flags.includes('UNKNOWN_AS_NEGATIVE_EVIDENCE'),
      ),
    );
    assert.ok(
      checks.some(
        (c) => c.claimId === 'C004' && c.flags.includes('UNSUPPORTED_CAUSAL_CLAIM'),
      ),
    );
  });
});
