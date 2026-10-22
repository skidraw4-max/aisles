/**
 * The only product call site for the frozen v9.x pipeline.
 * Artifacts stay under the product root. The core implementation is not modified.
 */
import type { DebateTurn, EvidencePack, FinalReport, IndependentAnalysis } from '../ai-review-board/types';
import type { ReviewBoardLlm } from '../ai-review-board/llm';
import { containsSecret } from './agent-execution';
import {
  JURY_MEMBER_OPINION_IDS,
  JURY_PRODUCT_DATA_ROOT,
  type JuryFinalSurface,
  type JuryMemberOpinion,
  type JuryMemberOpinionId,
} from './records';
import type { FrozenCoreReading } from './review-boundary';

/** Display-only size limits for copied committee text. */
export const MEMBER_OPINION_LIMITS = {
  opinion: 600,
  basis: 300,
  item: 200,
  problems: 3,
  listItems: 5,
} as const;

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clipList(value: unknown, count: number, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, count)
    .map((item) => clip(item, max));
}

/** Accepts 0..1 or 0..100 and returns 0..1, otherwise null. */
export function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

/** Reads (never mutates) the board run and copies a short per-analyst opinion for display. */
export function memberOpinionsFromRun(run: {
  independent?: readonly IndependentAnalysis[] | null;
  debate?: readonly DebateTurn[] | null;
}): JuryMemberOpinion[] {
  const independent = Array.isArray(run.independent) ? run.independent : [];
  const debate = Array.isArray(run.debate) ? run.debate : [];
  const opinions: JuryMemberOpinion[] = [];
  for (const memberId of JURY_MEMBER_OPINION_IDS) {
    const analysis = independent.find((item) => item?.memberId === memberId);
    const turn = [...debate].reverse().find((item) => item?.memberId === memberId);
    if (!analysis && !turn) continue;
    const opinion = clip(turn?.finalOpinion || analysis?.originalOpinion, MEMBER_OPINION_LIMITS.opinion);
    opinions.push({
      memberId: memberId as JuryMemberOpinionId,
      opinion,
      basis: clip(analysis?.judgmentBasis, MEMBER_OPINION_LIMITS.basis),
      problems: clipList(analysis?.problems, MEMBER_OPINION_LIMITS.problems, MEMBER_OPINION_LIMITS.item),
      confidence: normalizeConfidence(turn?.confidence ?? analysis?.confidence),
      revised: typeof turn?.revised === 'boolean' ? turn.revised : null,
    });
  }
  return opinions;
}

export function committeeSurfaceFromRun(
  final: FinalReport | null,
  run: { independent?: readonly IndependentAnalysis[] | null; debate?: readonly DebateTurn[] | null },
): Pick<JuryFinalSurface, 'boardConfidence' | 'opinionDifferences' | 'disputedPoints' | 'memberOpinions' | 'memberOpinionsOmitted'> {
  const committee = {
    boardConfidence: normalizeConfidence(final?.confidence),
    opinionDifferences: clipList(final?.opinionDifferences, MEMBER_OPINION_LIMITS.listItems, MEMBER_OPINION_LIMITS.item),
    disputedPoints: clipList(final?.disputedPoints, MEMBER_OPINION_LIMITS.listItems, MEMBER_OPINION_LIMITS.item),
    memberOpinions: memberOpinionsFromRun(run),
  };
  if (containsSecret(committee)) {
    return {
      boardConfidence: committee.boardConfidence,
      opinionDifferences: [],
      disputedPoints: [],
      memberOpinions: [],
      memberOpinionsOmitted: 'SECRET',
    };
  }
  return { ...committee, memberOpinionsOmitted: null };
}

export function surfaceFromFinal(
  final: FinalReport | null,
  run: { independent?: readonly IndependentAnalysis[] | null; debate?: readonly DebateTurn[] | null } = {},
): JuryFinalSurface {
  return {
    statusSummary: final?.statusSummary ?? '',
    topProblems: [...(final?.topProblems ?? [])],
    expectedUserEffect: final?.expectedUserEffect ?? '',
    risk: final?.risk ?? '',
    dimensionEvidence: (final?.dimensionScores ?? []).flatMap((score) => score.evidence.map((item) => item.text)),
    supportedClaims: [...(final?.supportedClaims ?? [])],
    partiallySupportedClaims: [...(final?.partiallySupportedClaims ?? [])],
    hypotheses: [...(final?.hypotheses ?? [])],
    ...committeeSurfaceFromRun(final, run),
  };
}

export async function callFrozenReviewPipeline(input: {
  rootDir: typeof JURY_PRODUCT_DATA_ROOT;
  evidence: EvidencePack;
  claim?: string;
  llm: ReviewBoardLlm;
}): Promise<FrozenCoreReading> {
  void input.claim;
  if (input.rootDir !== JURY_PRODUCT_DATA_ROOT) {
    throw new Error('product review artifacts must stay in data/jury-product');
  }
  const { runReviewBoardPipeline } = await import('../ai-review-board/orchestrator');
  const { extractActualFromRun } = await import('../ai-review-board/final-quality-actual');
  const run = await runReviewBoardPipeline({
    rootDir: input.rootDir,
    llm: input.llm,
    evidence: input.evidence,
  });
  const actual = extractActualFromRun(run);
  if (
    actual.evidenceStrength === undefined ||
    actual.claimStrength === undefined ||
    actual.conflictDetected === undefined ||
    actual.overclaimDetected === undefined ||
    actual.revisionRequired === undefined ||
    actual.expectedDecision === undefined
  ) {
    throw new Error('CORE_READING_INCOMPLETE');
  }
  return {
    boardRunId: run.runId,
    evidenceStrength: actual.evidenceStrength,
    claimStrength: actual.claimStrength,
    conflictDetected: actual.conflictDetected,
    overclaimDetected: actual.overclaimDetected,
    revisionRequired: actual.revisionRequired,
    expectedDecision: actual.expectedDecision,
    finalSurface: surfaceFromFinal(run.final, run),
    completedAt: run.updatedAt,
  };
}
