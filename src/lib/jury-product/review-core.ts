/**
 * The only product call site for the frozen v9.x pipeline.
 * Artifacts stay under the product root. The core implementation is not modified.
 */
import type { EvidencePack, FinalReport } from '../ai-review-board/types';
import type { ReviewBoardLlm } from '../ai-review-board/llm';
import { JURY_PRODUCT_DATA_ROOT, type JuryFinalSurface } from './records';
import type { FrozenCoreReading } from './review-boundary';

function surfaceFromFinal(final: FinalReport | null): JuryFinalSurface {
  return {
    statusSummary: final?.statusSummary ?? '',
    topProblems: [...(final?.topProblems ?? [])],
    expectedUserEffect: final?.expectedUserEffect ?? '',
    risk: final?.risk ?? '',
    dimensionEvidence: (final?.dimensionScores ?? []).flatMap((score) => score.evidence.map((item) => item.text)),
    supportedClaims: [...(final?.supportedClaims ?? [])],
    partiallySupportedClaims: [...(final?.partiallySupportedClaims ?? [])],
    hypotheses: [...(final?.hypotheses ?? [])],
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
  const { extractActualFromRun } = await import('../../../tests/ai-review-board/evaluation/runner/compare');
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
    finalSurface: surfaceFromFinal(run.final),
    completedAt: run.updatedAt,
  };
}
