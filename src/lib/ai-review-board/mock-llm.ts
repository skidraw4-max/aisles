import { SCORE_DIMENSIONS } from './score-dimensions';
import { normalizeDimensionScores } from './scoring';
import type { ReviewBoardLlm } from './llm';
import type {
  ClaimCalibration,
  CommitteeAnalystId,
  CriticReport,
  DebateTurn,
  DimensionScore,
  EvidencePack,
  FinalReport,
  IndependentAnalysis,
  LlmContext,
  RevisionRecord,
  RevisionStatus,
} from './types';
import { assertIndependentContext } from './independence';
import {
  calibrationSuggestsSoftening,
  listClaimFlags,
  normalizeClaimCalibration,
} from './claim-calibration';
import { listRevisionIntegrityIssues, normalizeRevisionRecord } from './revision-quality';

function baseScores(seed: number): DimensionScore[] {
  return SCORE_DIMENSIONS.map((dimension, i) => ({
    dimension,
    score: 40 + ((seed + i * 3) % 40),
    evidence: [
      {
        kind: 'observation' as const,
        text: `Stub observation for ${dimension}`,
        source: 'evidence-pack',
      },
    ],
  }));
}

function stubIndependent(memberId: CommitteeAnalystId, evidence: EvidencePack): IndependentAnalysis {
  const seed = memberId.charCodeAt(0);
  const originalOpinion = `${memberId} independent view on ${evidence.site.name}`;
  return {
    memberId,
    currentState: `AIsle operates corridors: ${evidence.site.corridors.join(', ')}`,
    strengths: [`Strength noted by ${memberId}`],
    problems: [`Problem noted by ${memberId}`],
    trendGap: `Trend gap from ${memberId}`,
    improvementNeed: 'medium',
    improvements: [
      {
        id: `${memberId}-1`,
        title: `Improvement from ${memberId}`,
        priority: 1,
        expectedEffect: 'better UX',
        difficulty: 'medium',
        risk: 'low',
        rationale: 'based on evidence pack aggregates',
      },
    ],
    scores: normalizeDimensionScores(baseScores(seed)),
    judgmentBasis: 'stub llm using evidence aggregates only',
    confidence: 0.6 + (seed % 3) * 0.1,
    originalOpinion,
  };
}

export type MockClaimCalibrationProfile =
  | 'mixed-gaps'
  | 'all-supported'
  | 'not-supported-core';

/**
 * 테스트·오프라인용 LLM.
 * v5: claimCalibrate → revisionPass(calibration)
 */
export function createMockReviewBoardLlm(options?: {
  reviseOnDebate?: boolean;
  revisionStatus?: RevisionStatus;
  claimCalibrationProfile?: MockClaimCalibrationProfile;
}): ReviewBoardLlm {
  const forcedStatus: RevisionStatus =
    options?.revisionStatus ??
    (options?.reviseOnDebate === false ? 'UNCHANGED' : 'PARTIAL');
  const profile: MockClaimCalibrationProfile =
    options?.claimCalibrationProfile ??
    (forcedStatus === 'UNCHANGED'
      ? 'all-supported'
      : forcedStatus === 'FULL'
        ? 'not-supported-core'
        : 'mixed-gaps');

  return {
    async independentAnalysis(memberId, evidence, ctx: LlmContext) {
      assertIndependentContext(ctx);
      return stubIndependent(memberId, evidence);
    },

    async debateTurn(memberId, _evidence, peers, _own) {
      const others = peers.filter((p) => p.memberId !== memberId);
      const turn: DebateTurn = {
        memberId,
        agreement: others.slice(0, 1).map((o) => `Agree partially with ${o.memberId} on strengths`),
        disagreement: others
          .slice(0, 1)
          .map((o) => `Disagree with ${o.memberId} priority framing`),
        weakEvidence: ['Some trend claims lack metric evidence'],
        missed: ['Mobile performance field metrics'],
        needsVerification: ['Retention cohort definition', 'activeUsersLast7d still null'],
      };
      return turn;
    },

    async claimCalibrate(memberId, evidence, own, _ownDebate) {
      if (profile === 'all-supported') {
        return normalizeClaimCalibration(memberId, {
          claims: [
            {
              claimId: 'C001',
              claimText: '최근 7일 신규 가입이 없다',
              evidenceRefs: ['newUsersLast7d'],
              evidenceType: 'DIRECT_FACT',
              supportLevel: 'SUPPORTED',
              reason: `newUsersLast7d=${evidence.aggregates.newUsersLast7d}`,
              missingEvidence: [],
              evidenceImpact: 'NONE',
              riskOfOverclaiming: 'LOW',
            },
            {
              claimId: 'C002',
              claimText: '최근 7일 댓글이 없다',
              evidenceRefs: ['commentsLast7d'],
              evidenceType: 'DIRECT_FACT',
              supportLevel: 'SUPPORTED',
              reason: `commentsLast7d=${evidence.aggregates.commentsLast7d}`,
              missingEvidence: [],
              evidenceImpact: 'NONE',
              riskOfOverclaiming: 'LOW',
            },
            {
              claimId: 'C003',
              claimText: own.originalOpinion.slice(0, 60),
              evidenceRefs: ['postsLast7d'],
              evidenceType: 'DIRECT_FACT',
              supportLevel: 'SUPPORTED',
              reason: 'scoped to measured metrics',
              missingEvidence: [],
              evidenceImpact: 'LOW',
              riskOfOverclaiming: 'LOW',
            },
          ],
        });
      }

      if (profile === 'not-supported-core') {
        return normalizeClaimCalibration(memberId, {
          claims: [
            {
              claimId: 'C001',
              claimText: 'Growth is healthy across the platform',
              evidenceRefs: ['newUsersLast7d'],
              evidenceType: 'INFERENCE',
              supportLevel: 'NOT_SUPPORTED',
              reason: 'newUsersLast7d=0 contradicts healthy growth',
              missingEvidence: [],
              evidenceImpact: 'CRITICAL',
              riskOfOverclaiming: 'HIGH',
            },
            {
              claimId: 'C002',
              claimText: 'Gemini AI 기능이 사용자 참여를 증가시키고 있다',
              evidenceRefs: [],
              evidenceType: 'HYPOTHESIS',
              supportLevel: 'NOT_SUPPORTED',
              reason: 'no engagement lift metric',
              missingEvidence: ['activeUsersLast7d', 'viewsLast7d'],
              evidenceImpact: 'HIGH',
              riskOfOverclaiming: 'HIGH',
            },
          ],
        });
      }

      // mixed-gaps — typical AIsle case
      return normalizeClaimCalibration(memberId, {
        claims: [
          {
            claimId: 'C001',
            claimText: '최근 7일 신규 사용자 유입이 없다',
            evidenceRefs: ['newUsersLast7d'],
            evidenceType: 'DIRECT_FACT',
            supportLevel: 'SUPPORTED',
            reason: 'newUsersLast7d is 0',
            missingEvidence: [],
            evidenceImpact: 'NONE',
            riskOfOverclaiming: 'LOW',
          },
          {
            claimId: 'C002',
            claimText: '최근 7일 댓글 활동이 없다',
            evidenceRefs: ['commentsLast7d'],
            evidenceType: 'DIRECT_FACT',
            supportLevel: 'SUPPORTED',
            reason: 'commentsLast7d is 0',
            missingEvidence: [],
            evidenceImpact: 'NONE',
            riskOfOverclaiming: 'LOW',
          },
          {
            claimId: 'C003',
            claimText: 'AIsle의 전체 사용자 참여도가 심각하게 낮다',
            evidenceRefs: [
              'newUsersLast7d',
              'commentsLast7d',
              'activeUsersLast7d',
              'viewsLast7d',
            ],
            evidenceType: 'INFERENCE',
            supportLevel: 'PARTIALLY_SUPPORTED',
            reason: 'signup/comments zero but active/views null — cannot prove platform-wide',
            missingEvidence: ['activeUsersLast7d', 'viewsLast7d'],
            evidenceImpact: 'HIGH',
            riskOfOverclaiming: 'HIGH',
          },
          {
            claimId: 'C004',
            claimText: 'UX/UI 문제가 신규 사용자 및 참여 부족의 원인이다',
            evidenceRefs: [],
            evidenceType: 'HYPOTHESIS',
            supportLevel: 'NOT_SUPPORTED',
            reason: 'no UX behavior metrics in EvidencePack',
            missingEvidence: ['ux_events'],
            evidenceImpact: 'MEDIUM',
            riskOfOverclaiming: 'HIGH',
          },
          {
            claimId: 'C005',
            claimText: '플랫폼이 stagnant 상태다',
            evidenceRefs: ['newUsersLast7d', 'commentsLast7d'],
            evidenceType: 'INFERENCE',
            supportLevel: 'PARTIALLY_SUPPORTED',
            reason: 'partial signals only',
            missingEvidence: ['activeUsersLast7d', 'viewsLast7d'],
            evidenceImpact: 'HIGH',
            riskOfOverclaiming: 'MEDIUM',
          },
        ],
      });
    },

    async revisionPass(memberId, evidence, own, ownDebate, _peers, calibration) {
      const cal =
        calibration ??
        (await (async () => {
          const empty: ClaimCalibration = { memberId, claims: [] };
          return empty;
        })());

      const soften =
        forcedStatus === 'PARTIAL' ||
        (forcedStatus !== 'UNCHANGED' &&
          forcedStatus !== 'FULL' &&
          calibrationSuggestsSoftening(cal));

      if (forcedStatus === 'UNCHANGED' || (!soften && forcedStatus !== 'FULL' && forcedStatus !== 'PARTIAL')) {
        if (forcedStatus === 'UNCHANGED' || profile === 'all-supported') {
          return normalizeRevisionRecord({
            memberId,
            originalOpinion: own.originalOpinion,
            confidenceBefore: own.confidence,
            revisionStatus: 'UNCHANGED',
            retainReason: `Calibration shows core DIRECT_FACT claims SUPPORTED (newUsers/comments). Strongest debate rebuttal was weak. Gaps (${cal.claims
              .flatMap((c) => c.missingEvidence)
              .join(',') || 'none'}) do not overturn scoped facts.`,
            confidenceAfter: own.confidence,
            confidenceChangeReason: 'Supported claims remain; no majority-based boost',
            finalOpinion: own.originalOpinion,
            revisionAnswers: {
              q1_coreClaim: own.originalOpinion.slice(0, 80),
              q2_strongestRebuttal: ownDebate.disagreement[0] ?? 'none',
              q3_rebuttalEvidenceKind: 'inference',
              q4_evidenceGapsFound: cal.claims.flatMap((c) => c.missingEvidence).join(', '),
              q5_gapAffectsCoreClaim: 'low for scoped facts',
              q6_directlySupportedScope: 'newUsersLast7d / commentsLast7d',
              q7_overclaimCheck: 'kept scoped',
              q8_whyRetainIfUnchanged: 'SUPPORTED claims hold',
              q9_claimsToChangeIfPartial: '',
              q10_groundsForFullRevision: 'none',
              q11_chosenStatus: 'UNCHANGED',
              q12_confidenceChange: 'unchanged',
            },
          });
        }
      }

      if (forcedStatus === 'FULL' || profile === 'not-supported-core') {
        return normalizeRevisionRecord({
          memberId,
          originalOpinion: own.originalOpinion,
          confidenceBefore: own.confidence,
          revisionStatus: 'FULL',
          revisionReason: 'Core claim NOT_SUPPORTED by EvidencePack metrics',
          changedClaims: cal.claims
            .filter((c) => c.supportLevel === 'NOT_SUPPORTED')
            .map((c) => c.claimText),
          confidenceAfter: Math.min(0.85, own.confidence + 0.05),
          confidenceChangeReason: 'Replaced NOT_SUPPORTED core claim using direct metrics',
          finalOpinion: `${own.originalOpinion} (FULL revise after calibration)`,
          revisionAnswers: {
            q1_coreClaim: own.originalOpinion.slice(0, 80),
            q2_strongestRebuttal: 'metrics contradict prior core',
            q3_rebuttalEvidenceKind: 'direct_evidence',
            q4_evidenceGapsFound: '',
            q5_gapAffectsCoreClaim: 'yes',
            q6_directlySupportedScope: 'newUsersLast7d=0',
            q7_overclaimCheck: 'prior overreached',
            q8_whyRetainIfUnchanged: '',
            q9_claimsToChangeIfPartial: '',
            q10_groundsForFullRevision: 'NOT_SUPPORTED core',
            q11_chosenStatus: 'FULL',
            q12_confidenceChange: 're-scored',
          },
        });
      }

      // PARTIAL — soften overclaims from calibration
      const after = Math.max(0.4, own.confidence - 0.2);
      return normalizeRevisionRecord({
        memberId,
        originalOpinion: own.originalOpinion,
        confidenceBefore: own.confidence,
        revisionStatus: 'PARTIAL',
        revisionReason:
          'Claim calibration: PARTIALLY_SUPPORTED platform-wide engagement with HIGH evidenceImpact — soften crisis language',
        changedClaims: [
          'Replace platform-wide engagement crisis with: last-7d new users/comments are zero; overall engagement unknown due to null activeUsers/views',
        ],
        confidenceAfter: after,
        confidenceChangeReason:
          'HIGH evidenceImpact on PARTIALLY_SUPPORTED core engagement claim → lower confidence',
        finalOpinion: `${own.originalOpinion} (PARTIAL: scoped to measured metrics; gaps acknowledged via calibration)`,
        newEvidenceAccepted: ['claim calibration PARTIALLY_SUPPORTED C003'],
        revisionAnswers: {
          q1_coreClaim: own.originalOpinion.slice(0, 80),
          q2_strongestRebuttal: 'cannot prove platform-wide while active/views null',
          q3_rebuttalEvidenceKind: 'direct_evidence (null metrics)',
          q4_evidenceGapsFound: 'activeUsersLast7d, viewsLast7d',
          q5_gapAffectsCoreClaim: 'yes — HIGH',
          q6_directlySupportedScope: 'newUsersLast7d / commentsLast7d',
          q7_overclaimCheck: 'crisis language overclaims',
          q8_whyRetainIfUnchanged: '',
          q9_claimsToChangeIfPartial: 'crisis → scoped low signup/comments',
          q10_groundsForFullRevision: 'none',
          q11_chosenStatus: 'PARTIAL',
          q12_confidenceChange: `${own.confidence}→${after}`,
        },
      });
    },

    async critic(_evidence, independent, debate, revisions, claimCalibrations): Promise<CriticReport> {
      const revs = revisions ?? [];
      const cals = claimCalibrations ?? [];
      const integrityFlags = revs.flatMap((r) =>
        listRevisionIntegrityIssues(r).map((i) => `${r.memberId}:${i}`),
      );
      const unknownFlags: string[] = [];
      const causalFlags: string[] = [];
      const overclaimFlags: string[] = [];
      for (const cal of cals) {
        for (const c of cal.claims) {
          for (const f of listClaimFlags(c, _evidence)) {
            const tag = `${cal.memberId}:${c.claimId}:${f}`;
            if (f === 'unknown_as_evidence') unknownFlags.push(tag);
            else if (f === 'causal_without_evidence') causalFlags.push(tag);
            else if (f === 'overclaim_risk') overclaimFlags.push(tag);
          }
        }
      }

      return {
        factVsSpeculationOk: true,
        evidenceSufficient: independent.every((i) => i.scores.some((s) => s.evidence.length > 0)),
        scoresWithoutEvidence: [],
        herdingDetected: false,
        dominantMemberInfluence: null,
        trendEvidenceOk: true,
        userBenefitLikely: true,
        existingFeatureRisk: false,
        overEngineering: false,
        notes: [
          'Mock critic pass',
          `debate=${debate.length}`,
          `revisions=${revs.length}`,
          `calibrations=${cals.length}`,
        ],
        confidence: 0.7,
        revisionIntegrity: { ok: integrityFlags.length === 0, flags: integrityFlags },
        evidenceGrounding: { ok: true, flags: [] },
        overclaiming: { ok: overclaimFlags.length === 0, flags: overclaimFlags },
        herding: { ok: true, flags: [] },
        confidenceIntegrity: { ok: true, flags: [] },
        fabrication: { ok: true, flags: [] },
        statusConsistency: { ok: true, flags: [] },
        claimCalibrationIntegrity: { ok: cals.length === independent.length, flags: [] },
        evidenceMappingIntegrity: { ok: true, flags: [] },
        unsupportedClaimFlags: {
          ok: true,
          flags: cals.flatMap((cal) =>
            cal.claims
              .filter((c) => c.supportLevel === 'NOT_SUPPORTED')
              .map((c) => `${cal.memberId}:${c.claimId}`),
          ),
        },
        overclaimingFlags: { ok: overclaimFlags.length === 0, flags: overclaimFlags },
        unknownAsEvidenceFlags: { ok: unknownFlags.length === 0, flags: unknownFlags },
        causalClaimWithoutEvidenceFlags: {
          ok: causalFlags.length === 0,
          flags: causalFlags,
        },
        confidenceCalibrationFlags: { ok: true, flags: [] },
        herdingFlags: { ok: true, flags: [] },
      };
    },

    async chairman(evidence, independent, debate, critic, revisions, claimCalibrations): Promise<FinalReport> {
      const revs = revisions ?? [];
      const cals = claimCalibrations ?? [];
      const improvements = independent.flatMap((i) => i.improvements).slice(0, 5);
      const allClaims = cals.flatMap((c) => c.claims);
      return {
        statusSummary: `${evidence.site.name} review completed with ${independent.length} analysts`,
        overallTrendScore: 62,
        dimensionScores: normalizeDimensionScores(baseScores(10)),
        topProblems: independent.flatMap((i) => i.problems).slice(0, 5),
        improvements,
        expectedUserEffect: 'Clearer corridors and retention loops',
        expectedDifficulty: 'medium',
        risk: 'low-medium',
        improvementEvidence: independent.map((i) => i.judgmentBasis),
        opinionDifferences: debate
          .filter((d) => d.disagreement.length > 0)
          .map((d) => `${d.memberId}: ${d.disagreement.join('; ')}`),
        confidence: Math.min(0.85, avg(independent.map((i) => i.confidence))),
        needsFurtherVerification: debate.flatMap((d) => d.needsVerification).slice(0, 5),
        confirmedFacts: allClaims
          .filter((c) => c.supportLevel === 'SUPPORTED' && c.evidenceType === 'DIRECT_FACT')
          .map((c) => c.claimText)
          .slice(0, 8),
        unknownMissingData: ['activeUsersLast7d', 'viewsLast7d'],
        hypotheses: allClaims
          .filter((c) => c.evidenceType === 'HYPOTHESIS')
          .map((c) => c.claimText)
          .slice(0, 5),
        disputedPoints: debate.flatMap((d) => d.disagreement).slice(0, 5),
        validatedImprovements: improvements.map((i) => i.title),
        supportedClaims: allClaims
          .filter((c) => c.supportLevel === 'SUPPORTED')
          .map((c) => c.claimText)
          .slice(0, 8),
        partiallySupportedClaims: allClaims
          .filter((c) => c.supportLevel === 'PARTIALLY_SUPPORTED')
          .map((c) => c.claimText)
          .slice(0, 8),
        unsupportedHypothesisClaims: allClaims
          .filter((c) => c.supportLevel === 'NOT_SUPPORTED')
          .map((c) => c.claimText)
          .slice(0, 8),
        revisionSummary: {
          unchanged: revs.filter((r) => r.revisionStatus === 'UNCHANGED').map((r) => r.memberId),
          partial: revs.filter((r) => r.revisionStatus === 'PARTIAL').map((r) => r.memberId),
          full: revs.filter((r) => r.revisionStatus === 'FULL').map((r) => r.memberId),
          confidenceShifts: revs
            .filter((r) => r.confidenceAfter !== r.confidenceBefore)
            .map((r) => `${r.memberId}: ${r.confidenceBefore}→${r.confidenceAfter}`),
          claimSofteningFromEvidenceGap: revs
            .filter((r) => r.revisionStatus === 'PARTIAL')
            .map((r) => `${r.memberId}: ${r.changedClaims[0] ?? ''}`),
          herdingRisks: critic.herdingFlags?.flags ?? critic.herding?.flags ?? [],
        },
      };
    },
  };
}

function avg(nums: number[]): number {
  if (!nums.length) return 0.5;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
