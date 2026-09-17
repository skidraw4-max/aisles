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
  RevisionRecord,
  RevisionStatus,
} from './types';
import { assertIndependentContext } from './independence';
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

/**
 * 테스트·오프라인용 LLM.
 * v4: debate = rebuttal only; revisionPass = UNCHANGED|PARTIAL|FULL.
 */
export function createMockReviewBoardLlm(options?: {
  reviseOnDebate?: boolean;
  revisionStatus?: RevisionStatus;
}): ReviewBoardLlm {
  const forcedStatus: RevisionStatus =
    options?.revisionStatus ??
    (options?.reviseOnDebate === false ? 'UNCHANGED' : 'PARTIAL');

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

    async revisionPass(memberId, evidence, own, ownDebate, _peers) {
      const gaps = [
        evidence.aggregates.activeUsersLast7d == null ? 'activeUsersLast7d=null' : null,
        evidence.aggregates.viewsLast7d == null ? 'viewsLast7d=null' : null,
      ].filter(Boolean);

      if (forcedStatus === 'UNCHANGED') {
        return normalizeRevisionRecord({
          memberId,
          originalOpinion: own.originalOpinion,
          confidenceBefore: own.confidence,
          revisionStatus: 'UNCHANGED',
          retainReason: `Strongest rebuttal in debate was weak/inference (${ownDebate.disagreement[0] ?? 'none'}). Scoped claims still supported by EvidencePack metrics; gaps (${gaps.join(',') || 'none'}) do not overturn the core scoped claim.`,
          confidenceAfter: own.confidence,
          confidenceChangeReason: 'Evidence still supports scoped claim; no majority-based boost',
          finalOpinion: own.originalOpinion,
          rejectedArguments: ownDebate.disagreement.slice(0, 1).map((argument) => ({
            argument,
            reason: 'Inference without direct metric; does not overturn core claim',
          })),
          revisionAnswers: {
            q1_coreClaim: own.originalOpinion.slice(0, 80),
            q2_strongestRebuttal: ownDebate.disagreement[0] ?? 'none',
            q3_rebuttalEvidenceKind: 'inference',
            q4_evidenceGapsFound: gaps.join(', ') || 'none noted',
            q5_gapAffectsCoreClaim: 'limited — core claim scoped to available metrics',
            q6_directlySupportedScope: 'aggregates present in EvidencePack',
            q7_overclaimCheck: 'kept within metric scope',
            q8_whyRetainIfUnchanged: 'Rebuttal weak; metrics still support scoped claim',
            q9_claimsToChangeIfPartial: '',
            q10_groundsForFullRevision: 'none',
            q11_chosenStatus: 'UNCHANGED',
            q12_confidenceChange: 'unchanged',
          },
        });
      }

      if (forcedStatus === 'FULL') {
        return normalizeRevisionRecord({
          memberId,
          originalOpinion: own.originalOpinion,
          confidenceBefore: own.confidence,
          revisionStatus: 'FULL',
          revisionReason: 'Direct metrics contradict prior core claim',
          changedClaims: [`${own.originalOpinion} → revised core after conflicting metrics`],
          confidenceAfter: Math.min(0.85, own.confidence + 0.05),
          confidenceChangeReason: 'Direct metric conflict resolved by replacing core claim',
          finalOpinion: `${own.originalOpinion} (FULL revise)`,
          newEvidenceAccepted: ownDebate.weakEvidence.slice(0, 1),
          revisionAnswers: {
            q1_coreClaim: own.originalOpinion.slice(0, 80),
            q2_strongestRebuttal: ownDebate.disagreement[0] ?? 'metric conflict',
            q3_rebuttalEvidenceKind: 'direct_evidence',
            q4_evidenceGapsFound: gaps.join(', '),
            q5_gapAffectsCoreClaim: 'yes — overturns prior claim',
            q6_directlySupportedScope: 'conflicting metric subset',
            q7_overclaimCheck: 'prior claim overreached',
            q8_whyRetainIfUnchanged: '',
            q9_claimsToChangeIfPartial: '',
            q10_groundsForFullRevision: 'direct metric conflict',
            q11_chosenStatus: 'FULL',
            q12_confidenceChange: 're-evaluated after core flip',
          },
        });
      }

      // PARTIAL default — evidence gap softens claim strength
      const after = Math.max(0.4, own.confidence - 0.2);
      return normalizeRevisionRecord({
        memberId,
        originalOpinion: own.originalOpinion,
        confidenceBefore: own.confidence,
        revisionStatus: 'PARTIAL',
        revisionReason:
          'Evidence gaps (activeUsersLast7d/viewsLast7d null) require softening over-strong engagement language while keeping zero-signup/comment facts',
        changedClaims: [
          'Soften any platform-wide engagement crisis wording to: last-7d new users/comments low; overall engagement unknown',
        ],
        confidenceAfter: after,
        confidenceChangeReason: 'Evidence gap affects core claim strength',
        finalOpinion: `${own.originalOpinion} (PARTIAL: scoped to measured metrics; gaps acknowledged)`,
        newEvidenceAccepted: ownDebate.needsVerification.slice(0, 1),
        rejectedArguments: [],
        revisionAnswers: {
          q1_coreClaim: own.originalOpinion.slice(0, 80),
          q2_strongestRebuttal: 'Cannot prove platform-wide crisis while active/views null',
          q3_rebuttalEvidenceKind: 'direct_evidence (null metrics)',
          q4_evidenceGapsFound: gaps.join(', ') || 'activeUsers/views',
          q5_gapAffectsCoreClaim: 'yes — strength/scope of engagement claims',
          q6_directlySupportedScope: 'newUsersLast7d / commentsLast7d when present',
          q7_overclaimCheck: 'crisis language may overclaim',
          q8_whyRetainIfUnchanged: '',
          q9_claimsToChangeIfPartial: 'crisis → scoped low signup/comments + unknown overall',
          q10_groundsForFullRevision: 'none — direction of concern remains',
          q11_chosenStatus: 'PARTIAL',
          q12_confidenceChange: `${own.confidence}→${after}`,
        },
      });
    },

    async critic(_evidence, independent, debate, revisions): Promise<CriticReport> {
      const revs = revisions ?? [];
      const integrityFlags = revs.flatMap((r) =>
        listRevisionIntegrityIssues(r).map((i) => `${r.memberId}:${i}`),
      );
      const herdingFlags = revs
        .filter((r) =>
          listRevisionIntegrityIssues(r).some(
            (i) => i === 'majority_as_retain_ground' || i === 'majority_as_revision_ground',
          ),
        )
        .map((r) => `${r.memberId}:majority_ground`);
      const statusFlags = revs
        .filter((r) => listRevisionIntegrityIssues(r).includes('status_revised_mismatch'))
        .map((r) => `${r.memberId}:status_mismatch`);

      return {
        factVsSpeculationOk: true,
        evidenceSufficient: independent.every((i) => i.scores.some((s) => s.evidence.length > 0)),
        scoresWithoutEvidence: [],
        herdingDetected: herdingFlags.length > 0,
        dominantMemberInfluence: null,
        trendEvidenceOk: true,
        userBenefitLikely: true,
        existingFeatureRisk: false,
        overEngineering: false,
        notes: ['Mock critic pass', `debateTurns=${debate.length}`, `revisions=${revs.length}`],
        confidence: 0.7,
        revisionIntegrity: { ok: integrityFlags.length === 0, flags: integrityFlags },
        evidenceGrounding: { ok: true, flags: [] },
        overclaiming: { ok: true, flags: [] },
        herding: { ok: herdingFlags.length === 0, flags: herdingFlags },
        confidenceIntegrity: { ok: true, flags: [] },
        fabrication: { ok: true, flags: [] },
        statusConsistency: { ok: statusFlags.length === 0, flags: statusFlags },
      };
    },

    async chairman(evidence, independent, debate, critic, revisions): Promise<FinalReport> {
      const revs = revisions ?? [];
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
        confirmedFacts: ['EvidencePack aggregates as provided'],
        unknownMissingData: ['activeUsersLast7d', 'viewsLast7d'].filter(Boolean),
        hypotheses: [],
        disputedPoints: debate.flatMap((d) => d.disagreement).slice(0, 5),
        validatedImprovements: improvements.map((i) => i.title),
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
          herdingRisks: critic.herding?.flags ?? [],
        },
      };
    },
  };
}
