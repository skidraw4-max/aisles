/**
 * Resume chairman-only for a failed run that already completed through critic.
 * Usage: npx tsx scripts/resume-ai-review-board-chairman.ts [runId]
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  const runId = process.argv[2] || 'run-2026-09-17T12-25-17-531Z';
  const {
    DEFAULT_REVIEW_BOARD_ROOT,
    createGeminiReviewBoardLlm,
    loadRun,
    saveRunSnapshot,
    enrichFinalReport,
    summarizeSemanticJudgments,
    formatSemanticJudgeFindings,
    formatEvidenceSemanticsFindings,
    runJudgeRevisionConsistency,
    runEvidenceSemanticsChecks,
    runCalibrationRevisionChecks,
    formatCalibrationRevisionFindings,
  } = await import('../src/lib/ai-review-board');

  const rootDir = path.resolve(DEFAULT_REVIEW_BOARD_ROOT);
  const run = await loadRun(rootDir, runId);
  if (!run?.evidence || !run.critic) {
    throw new Error(`missing run data for ${runId}`);
  }

  const llm = createGeminiReviewBoardLlm();
  console.log('[resume] chairman start', { runId, usedCalls: run.budget.usedCalls });

  run.status = 'chairman';
  delete run.error;

  let final = await llm.chairman(
    run.evidence,
    run.independent,
    run.debate,
    run.critic,
    run.revisions,
    run.claimCalibrations,
    run.evidenceSemantics,
    run.semanticJudgments,
  );
  final = enrichFinalReport(final, run.independent, run.critic);

  const consistencyResults = runCalibrationRevisionChecks(
    run.claimCalibrations ?? [],
    run.revisions ?? [],
  );
  const semanticsChecks = runEvidenceSemanticsChecks(
    run.evidence,
    run.claimCalibrations ?? [],
    run.evidenceSemantics ?? [],
    run.revisions ?? [],
  );
  const judgeChecks = runJudgeRevisionConsistency(
    run.semanticJudgments ?? [],
    run.revisions ?? [],
  );
  const judgeSummary = summarizeSemanticJudgments(run.semanticJudgments ?? []);
  const allSemRows = (run.evidenceSemantics ?? []).flatMap((s) => s.claims);
  const leaps = (run.semanticJudgments ?? []).filter((j) => j.semanticLeap.detected);
  const mismatchCount = judgeChecks.filter((c) =>
    c.flags.includes('JUDGE_REVISION_MISMATCH'),
  ).length;

  run.final = {
    ...final,
    calibrationRevisionFindings: [
      ...(final.calibrationRevisionFindings ?? []),
      ...formatCalibrationRevisionFindings(consistencyResults),
    ],
    evidenceSemanticsFindings: [
      ...(final.evidenceSemanticsFindings ?? []),
      ...formatEvidenceSemanticsFindings(semanticsChecks),
    ],
    semanticJudgeFindings: [
      ...(final.semanticJudgeFindings ?? []),
      ...formatSemanticJudgeFindings(run.semanticJudgments ?? [], mismatchCount),
    ],
    semanticRisks: leaps.map(
      (j) =>
        `${j.memberId}/${j.claimId}: ${j.semanticLeap.type} — ${j.claimText.slice(0, 80)}`,
    ),
    semanticJudgeSummary: {
      ...judgeSummary,
      judgeRevisionMismatchCount: mismatchCount,
    },
    directlySupportedClaims: [
      ...(final.directlySupportedClaims ?? []),
      ...allSemRows
        .filter((c) => c.evidenceRelation === 'DIRECTLY_SUPPORTS')
        .map((c) => `${c.claimId}: ${c.claimText}`),
    ],
    supportedInferences: [
      ...(final.supportedInferences ?? []),
      ...allSemRows
        .filter(
          (c) =>
            c.entailmentLevel === 'STRONG_INFERENCE' ||
            c.evidenceRelation === 'PARTIALLY_SUPPORTS',
        )
        .map((c) => `${c.claimId}: ${c.claimText}`),
    ],
    weakLimitedInferences: [
      ...(final.weakLimitedInferences ?? []),
      ...allSemRows
        .filter((c) => c.entailmentLevel === 'WEAK_INFERENCE' || c.unsupportedLeap)
        .map((c) => `${c.claimId}: ${c.claimText}`),
    ],
  };

  const used = run.budget.usedCalls + 1;
  run.budget = {
    ...run.budget,
    usedCalls: used,
    estimatedCostUsd: Number((used * 0.015).toFixed(4)),
  };
  run.status = 'completed';
  run.updatedAt = new Date().toISOString();
  await saveRunSnapshot(rootDir, run);

  console.log('[resume] completed', {
    runId: run.runId,
    status: run.status,
    budget: run.budget,
    confidence: run.final.confidence,
    overallTrendScore: run.final.overallTrendScore,
    judgeSummary: run.final.semanticJudgeSummary,
  });
}

main().catch((e) => {
  console.error('[resume] failed', e);
  process.exit(1);
});
