import path from 'node:path';
import {
  loadRun,
  saveRunSnapshot,
  measureRevisionInfluence,
  runJudgeRevisionConsistency,
  summarizeSemanticJudgments,
  runSemanticReferenceEvaluation,
} from '../src/lib/ai-review-board';
import { DEFAULT_REVIEW_BOARD_ROOT } from '../src/lib/ai-review-board/store';

async function main() {
  const runId = process.argv[2] || 'run-2026-09-17T12-25-17-531Z';
  const root = path.resolve(DEFAULT_REVIEW_BOARD_ROOT);
  const run = await loadRun(root, runId);
  if (!run?.final) throw new Error('missing final');

  const checks = runJudgeRevisionConsistency(
    run.semanticJudgments ?? [],
    run.revisions ?? [],
  );
  const mismatchKeys = checks
    .filter((c) => c.flags.includes('JUDGE_REVISION_MISMATCH'))
    .map((c) => `${c.memberId}/${c.claimId}`);
  const influence = measureRevisionInfluence({
    judgments: run.semanticJudgments ?? [],
    revisions: run.revisions ?? [],
    mismatchClaimKeys: mismatchKeys,
  });
  const judgeSummary = {
    ...summarizeSemanticJudgments(run.semanticJudgments ?? []),
    judgeRevisionMismatchCount: mismatchKeys.length,
    judgeTriggeredRevision: influence.judgeTriggeredRevision,
    judgeTriggeredReword: influence.judgeTriggeredReword,
    judgeTriggeredNarrow: influence.judgeTriggeredNarrow,
    judgeTriggeredConfidenceChange: influence.judgeTriggeredConfidenceChange,
    judgeIgnoredRisk: influence.judgeIgnoredRisk,
  };
  run.final = { ...run.final, semanticJudgeSummary: judgeSummary };
  await saveRunSnapshot(root, run);

  const j = run.semanticJudgments ?? [];
  const leaps = j.filter((x) => x.semanticLeap.detected);
  const ref = runSemanticReferenceEvaluation();

  console.log(
    JSON.stringify(
      {
        runId: run.runId,
        status: run.status,
        budget: run.budget,
        referenceMetrics: ref.metrics,
        judgeSummary,
        agreement: {
          agree: j.filter((x) => x.calibrationAgreement === 'AGREE').length,
          partial: j.filter((x) => x.calibrationAgreement === 'PARTIAL').length,
          disagree: j.filter((x) => x.calibrationAgreement === 'DISAGREE').length,
        },
        leapSamples: leaps.map((x) => ({
          m: x.memberId,
          id: x.claimId,
          leap: x.semanticLeap.type,
          text: x.claimText.slice(0, 100),
          action: x.recommendedAction,
          overlay: x.overlayFlags ?? [],
        })),
        revisions: (run.revisions ?? []).map((r) => ({
          m: r.memberId,
          status: r.revisionStatus,
          conf: [r.confidenceBefore, r.confidenceAfter],
        })),
        chairman: {
          conf: run.final.confidence,
          trend: run.final.overallTrendScore,
          summary: (run.final.statusSummary || '').slice(0, 320),
          facts: (run.final.confirmedFacts || []).slice(0, 6),
          inferences: (run.final.supportedInferences || []).slice(0, 6),
          hypo: (run.final.hypotheses || []).slice(0, 6),
          unknown: (run.final.unknownMissingData || []).slice(0, 6),
          risks: (run.final.semanticRisks || []).slice(0, 6),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
