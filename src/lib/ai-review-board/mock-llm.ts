import { SCORE_DIMENSIONS } from './score-dimensions';
import { normalizeDimensionScores } from './scoring';
import type { ReviewBoardLlm } from './llm';
import type {
  CommitteeAnalystId,
  CriticReport,
  DebateTurn,
  DimensionScore,
  EvidencePack,
  FinalReport,
  IndependentAnalysis,
  LlmContext,
} from './types';
import { assertIndependentContext } from './independence';

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

/**
 * 테스트·오프라인용 LLM. 독립 단계에서 peer를 받으면 independence assert로 실패.
 */
export function createMockReviewBoardLlm(options?: {
  reviseOnDebate?: boolean;
  /** v3 experiment: force a specific revisionStatus in mock debate */
  revisionStatus?: 'UNCHANGED' | 'PARTIAL' | 'FULL';
}): ReviewBoardLlm {
  const reviseOnDebate = options?.reviseOnDebate ?? true;
  const forcedStatus = options?.revisionStatus;

  return {
    async independentAnalysis(memberId, evidence, ctx: LlmContext) {
      assertIndependentContext(ctx);
      return stubIndependent(memberId, evidence);
    },

    async debateTurn(memberId, _evidence, peers, own) {
      const others = peers.filter((p) => p.memberId !== memberId);
      const revisionStatus =
        forcedStatus ?? (reviseOnDebate ? 'PARTIAL' : 'UNCHANGED');
      const revised = revisionStatus === 'PARTIAL' || revisionStatus === 'FULL';
      const turn: DebateTurn = {
        memberId,
        agreement: others.slice(0, 1).map((o) => `Agree partially with ${o.memberId} on strengths`),
        disagreement: others.slice(0, 1).map((o) => `Disagree with ${o.memberId} priority framing`),
        weakEvidence: ['Some trend claims lack metric evidence'],
        missed: ['Mobile performance field metrics'],
        needsVerification: ['Retention cohort definition'],
        revisionStatus,
        revised,
        revisionReason: revised
          ? `Adjusted after reviewing ${others.map((o) => o.memberId).join(',')}`
          : 'Independent analysis still holds after peer review',
        previousOpinion: own.originalOpinion,
        revisedOpinion: revised
          ? revisionStatus === 'FULL'
            ? `${own.originalOpinion} (FULL revise)`
            : `${own.originalOpinion} (PARTIAL revise)`
          : null,
        finalOpinion: revised
          ? revisionStatus === 'FULL'
            ? `${own.originalOpinion} (FULL revise)`
            : `${own.originalOpinion} (PARTIAL revise)`
          : own.originalOpinion,
        confidence: Math.max(0.4, own.confidence - 0.05),
      };
      return turn;
    },

    async critic(_evidence, independent, debate): Promise<CriticReport> {
      const revisedCount = debate.filter((d) => d.revised).length;
      return {
        factVsSpeculationOk: true,
        evidenceSufficient: independent.every((i) => i.scores.some((s) => s.evidence.length > 0)),
        scoresWithoutEvidence: [],
        herdingDetected: revisedCount === debate.length && debate.length > 3,
        dominantMemberInfluence: null,
        trendEvidenceOk: true,
        userBenefitLikely: true,
        existingFeatureRisk: false,
        overEngineering: false,
        notes: ['Mock critic pass'],
        confidence: 0.7,
      };
    },

    async chairman(evidence, independent, debate, critic): Promise<FinalReport> {
      const improvements = independent.flatMap((i) => i.improvements).slice(0, 5);
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
        confidence: Math.min(
          0.85,
          (independent.reduce((a, i) => a + i.confidence, 0) / independent.length) *
            (critic.herdingDetected ? 0.85 : 1),
        ),
        needsFurtherVerification: debate.flatMap((d) => d.needsVerification).slice(0, 5),
      };
    },
  };
}
