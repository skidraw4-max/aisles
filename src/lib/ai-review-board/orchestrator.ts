import { COMMITTEE_ANALYSTS } from './types';
import type { ReviewBoardLlm } from './llm';
import {
  appendHistory,
  createRunId,
  saveRunSnapshot,
} from './store';
import { createBudget, defaultMaxCallsFromEnv, recordCall } from './call-budget';
import { assertDebateReady, stripPeersForIndependent } from './independence';
import { enrichFinalReport } from './finalize-report';
import { EXPECTED_PIPELINE_LLM_CALLS } from './claim-calibration';
import {
  buildCriticConsistencyOverlay,
  formatCalibrationRevisionFindings,
  runCalibrationRevisionChecks,
  toCalibrationRevisionChecks,
} from './calibration-revision-consistency';
import {
  buildCriticSemanticsOverlay,
  enrichSemanticsWithHeuristics,
  formatEvidenceSemanticsFindings,
  runEvidenceSemanticsChecks,
} from './evidence-claim-entailment';
import {
  buildCriticJudgeOverlay,
  formatSemanticJudgeFindings,
  runJudgeRevisionConsistency,
  summarizeSemanticJudgments,
} from './semantic-judge';
import {
  measureRevisionInfluence,
  scanChairmanReliability,
} from './semantic-reference-eval';
import type {
  ClaimCalibration,
  EvidencePack,
  EvidenceSemanticsMember,
  ReviewBoardRun,
  RevisionRecord,
  SemanticJudgment,
} from './types';

export type OrchestratorOptions = {
  rootDir: string;
  llm: ReviewBoardLlm;
  evidence: EvidencePack;
  maxCalls?: number;
  runId?: string;
  sequentialIndependent?: boolean;
};

export async function runReviewBoardPipeline(
  options: OrchestratorOptions,
): Promise<ReviewBoardRun> {
  const runId = options.runId ?? createRunId();
  const maxCalls = options.maxCalls ?? defaultMaxCallsFromEnv();
  let budget = createBudget(maxCalls);
  const now = () => new Date().toISOString();

  if (maxCalls < EXPECTED_PIPELINE_LLM_CALLS) {
    throw new Error(
      `AI_REVIEW_BOARD maxCalls=${maxCalls} < expected pipeline calls ${EXPECTED_PIPELINE_LLM_CALLS}`,
    );
  }

  const run: ReviewBoardRun = {
    runId,
    status: 'collecting_evidence',
    createdAt: now(),
    updatedAt: now(),
    evidence: options.evidence,
    independent: [],
    debate: [],
    claimCalibrations: [],
    evidenceSemantics: [],
    semanticJudgments: [],
    revisions: [],
    calibrationRevisionChecks: [],
    critic: null,
    final: null,
    budget,
  };

  const touch = async () => {
    run.updatedAt = now();
    run.budget = budget;
    await saveRunSnapshot(options.rootDir, run);
  };

  try {
    await appendHistory(options.rootDir, runId, {
      at: now(),
      type: 'evidence_ready',
      actor: 'system',
      payload: {
        generatedAt: options.evidence.generatedAt,
        expectedLlmCalls: EXPECTED_PIPELINE_LLM_CALLS,
        maxCalls,
      },
    });
    await touch();

    run.status = 'independent';
    await touch();

    const independentResults = [];
    for (const memberId of COMMITTEE_ANALYSTS) {
      budget = recordCall(budget);
      const ctx = stripPeersForIndependent({
        phase: 'independent',
        memberId,
        evidence: options.evidence,
        peerAnalyses: run.independent,
      });
      const analysis = await options.llm.independentAnalysis(
        memberId,
        options.evidence,
        ctx,
      );
      independentResults.push({
        ...analysis,
        originalOpinion: analysis.originalOpinion,
      });
      run.independent = [...independentResults];
      await appendHistory(options.rootDir, runId, {
        at: now(),
        type: 'independent_analysis',
        actor: memberId,
        payload: { memberId, originalOpinion: analysis.originalOpinion },
      });
      await touch();
    }

    assertDebateReady(run.independent, COMMITTEE_ANALYSTS);

    run.status = 'debate';
    await touch();

    const debateResults = [];
    for (const memberId of COMMITTEE_ANALYSTS) {
      budget = recordCall(budget);
      const own = run.independent.find((i) => i.memberId === memberId)!;
      const turn = await options.llm.debateTurn(
        memberId,
        options.evidence,
        run.independent,
        own,
      );
      debateResults.push(turn);
      run.debate = [...debateResults];
      await appendHistory(options.rootDir, runId, {
        at: now(),
        type: 'debate_turn',
        actor: memberId,
        payload: {
          agreement: turn.agreement,
          disagreement: turn.disagreement,
          weakEvidence: turn.weakEvidence,
        },
      });
      await touch();
    }

    run.status = 'claim_calibration';
    await touch();

    const calibrationResults: ClaimCalibration[] = [];
    for (const memberId of COMMITTEE_ANALYSTS) {
      budget = recordCall(budget);
      const own = run.independent.find((i) => i.memberId === memberId)!;
      const ownDebate = run.debate.find((d) => d.memberId === memberId)!;
      const cal = await options.llm.claimCalibrate(
        memberId,
        options.evidence,
        own,
        ownDebate,
      );
      calibrationResults.push(cal);
      run.claimCalibrations = [...calibrationResults];
      await appendHistory(options.rootDir, runId, {
        at: now(),
        type: 'claim_calibration',
        actor: memberId,
        payload: {
          claimCount: cal.claims.length,
          supportLevels: cal.claims.map((c) => c.supportLevel),
        },
      });
      await touch();
    }

    // v7: Evidence Semantics / Claim Entailment (LLM ×5)
    run.status = 'evidence_semantics';
    await touch();
    const semanticsResults: EvidenceSemanticsMember[] = [];
    for (const memberId of COMMITTEE_ANALYSTS) {
      budget = recordCall(budget);
      const cal = run.claimCalibrations!.find((c) => c.memberId === memberId)!;
      let sem = await options.llm.evidenceSemanticsPass(
        memberId,
        options.evidence,
        cal,
      );
      sem = enrichSemanticsWithHeuristics(options.evidence, cal, sem);
      semanticsResults.push(sem);
      run.evidenceSemantics = [...semanticsResults];
      await appendHistory(options.rootDir, runId, {
        at: now(),
        type: 'evidence_semantics',
        actor: memberId,
        payload: {
          claimCount: sem.claims.length,
          relations: sem.claims.map((c) => c.evidenceRelation),
        },
      });
      await touch();
    }

    // v8: Semantic Judge (LLM ×5) before Revision
    run.status = 'semantic_judge';
    await touch();
    const judgmentResults: SemanticJudgment[] = [];
    for (const memberId of COMMITTEE_ANALYSTS) {
      budget = recordCall(budget);
      const own = run.independent.find((i) => i.memberId === memberId)!;
      const ownDebate = run.debate.find((d) => d.memberId === memberId)!;
      const cal = run.claimCalibrations!.find((c) => c.memberId === memberId)!;
      const sem = run.evidenceSemantics!.find((s) => s.memberId === memberId)!;
      const judgments = await options.llm.semanticJudgePass(
        memberId,
        options.evidence,
        own,
        ownDebate,
        cal,
        sem,
      );
      judgmentResults.push(...judgments);
      run.semanticJudgments = [...judgmentResults];
      await appendHistory(options.rootDir, runId, {
        at: now(),
        type: 'semantic_judge',
        actor: memberId,
        payload: {
          claimCount: judgments.length,
          leaps: judgments.filter((j) => j.semanticLeap.detected).length,
          disagree: judgments.filter((j) => j.calibrationAgreement === 'DISAGREE').length,
        },
      });
      await touch();
    }

    run.status = 'revision';
    await touch();

    const revisionResults: RevisionRecord[] = [];
    for (const memberId of COMMITTEE_ANALYSTS) {
      budget = recordCall(budget);
      const own = run.independent.find((i) => i.memberId === memberId)!;
      const ownDebate = run.debate.find((d) => d.memberId === memberId)!;
      const cal = run.claimCalibrations!.find((c) => c.memberId === memberId)!;
      const sem = run.evidenceSemantics!.find((s) => s.memberId === memberId)!;
      const memberJudgments = (run.semanticJudgments ?? []).filter(
        (j) => j.memberId === memberId,
      );
      const rev = await options.llm.revisionPass(
        memberId,
        options.evidence,
        own,
        ownDebate,
        run.independent,
        cal,
        sem,
        memberJudgments,
      );
      revisionResults.push(rev);
      run.revisions = [...revisionResults];
      await appendHistory(options.rootDir, runId, {
        at: now(),
        type: rev.revised ? 'opinion_revised' : 'revision_unchanged',
        actor: memberId,
        payload: {
          revisionStatus: rev.revisionStatus,
          revised: rev.revised,
          confidenceBefore: rev.confidenceBefore,
          confidenceAfter: rev.confidenceAfter,
          calibrationClaimCount: cal.claims.length,
          semanticsClaimCount: sem.claims.length,
          judgeClaimCount: memberJudgments.length,
        },
      });
      await touch();
    }

    // v6: deterministic Calibration ↔ Revision consistency (no LLM call)
    run.status = 'consistency_check';
    await touch();
    const consistencyResults = runCalibrationRevisionChecks(
      run.claimCalibrations ?? [],
      run.revisions ?? [],
    );
    run.calibrationRevisionChecks = toCalibrationRevisionChecks(consistencyResults);
    await appendHistory(options.rootDir, runId, {
      at: now(),
      type: 'consistency_check',
      actor: 'system',
      payload: {
        checkCount: consistencyResults.length,
        summary: formatCalibrationRevisionFindings(consistencyResults).slice(0, 3),
      },
    });
    await touch();

    run.status = 'critic';
    await touch();
    budget = recordCall(budget);
    run.critic = await options.llm.critic(
      options.evidence,
      run.independent,
      run.debate,
      run.revisions,
      run.claimCalibrations,
      run.evidenceSemantics,
      run.semanticJudgments,
    );
    const overlay = buildCriticConsistencyOverlay(consistencyResults);
    const semanticsChecks = runEvidenceSemanticsChecks(
      options.evidence,
      run.claimCalibrations ?? [],
      run.evidenceSemantics ?? [],
      run.revisions ?? [],
    );
    const semOverlay = buildCriticSemanticsOverlay(semanticsChecks);
    const judgeChecks = runJudgeRevisionConsistency(
      run.semanticJudgments ?? [],
      run.revisions ?? [],
    );
    const judgeOverlay = buildCriticJudgeOverlay(run.semanticJudgments ?? [], judgeChecks);
    run.critic = {
      ...run.critic,
      calibrationRevisionIntegrity: overlay.calibrationRevisionIntegrity,
      calibrationRevisionMismatchFlags: overlay.calibrationRevisionMismatchFlags,
      overclaimRetainedFlags: overlay.overclaimRetainedFlags,
      unjustifiedConfidenceFlags: overlay.unjustifiedConfidenceFlags,
      majorityDrivenRevisionFlags: overlay.majorityDrivenRevisionFlags,
      evidenceSemanticsIntegrity: semOverlay.evidenceSemanticsIntegrity,
      evidenceClaimSemanticMismatchFlags: semOverlay.evidenceClaimSemanticMismatchFlags,
      absenceOfEvidenceAsAbsenceFlags: semOverlay.absenceOfEvidenceAsAbsenceFlags,
      unsupportedCausalClaimFlags: semOverlay.unsupportedCausalClaimFlags,
      unsupportedRelativeClaimFlags: semOverlay.unsupportedRelativeClaimFlags,
      unsupportedTimeTrendFlags: semOverlay.unsupportedTimeTrendFlags,
      unsupportedLeapFlags: semOverlay.unsupportedLeapFlags,
      contextMistakenAsEvidenceFlags: semOverlay.contextMistakenAsEvidenceFlags,
      peerOpinionAsEvidenceFlags: semOverlay.peerOpinionAsEvidenceFlags,
      semanticJudgeIntegrity: judgeOverlay.semanticJudgeIntegrity,
      falsePositiveFlags: judgeOverlay.falsePositiveFlags,
      falseNegativeFlags: judgeOverlay.falseNegativeFlags,
      semanticLeapFlags: judgeOverlay.semanticLeapFlags,
      causalClaimFlags: judgeOverlay.causalClaimFlags,
      trendClaimFlags: judgeOverlay.trendClaimFlags,
      techQualityLeapFlags: judgeOverlay.techQualityLeapFlags,
      majorityDrivenJudgeFlags: judgeOverlay.majorityDrivenJudgeFlags,
      judgeRevisionMismatchFlags: judgeOverlay.judgeRevisionMismatchFlags,
      causalClaimWithoutEvidenceFlags: {
        ok:
          (run.critic.causalClaimWithoutEvidenceFlags?.ok ?? true) &&
          overlay.causalClaimWithoutEvidenceFlags.ok &&
          semOverlay.unsupportedCausalClaimFlags.ok &&
          judgeOverlay.causalClaimFlags.ok,
        flags: [
          ...new Set([
            ...(run.critic.causalClaimWithoutEvidenceFlags?.flags ?? []),
            ...overlay.causalClaimWithoutEvidenceFlags.flags,
            ...semOverlay.unsupportedCausalClaimFlags.flags,
            ...judgeOverlay.causalClaimFlags.flags,
          ]),
        ],
      },
      unknownAsEvidenceFlags: {
        ok:
          (run.critic.unknownAsEvidenceFlags?.ok ?? true) &&
          overlay.unknownAsNegativeEvidenceFlags.ok &&
          semOverlay.unknownAsNegativeEvidenceFlags.ok &&
          judgeOverlay.unknownAsNegativeEvidenceFlags.ok,
        flags: [
          ...new Set([
            ...(run.critic.unknownAsEvidenceFlags?.flags ?? []),
            ...overlay.unknownAsNegativeEvidenceFlags.flags,
            ...semOverlay.unknownAsNegativeEvidenceFlags.flags,
            ...judgeOverlay.unknownAsNegativeEvidenceFlags.flags,
          ]),
        ],
      },
      unknownAsNegativeEvidenceFlags: {
        ok:
          overlay.unknownAsNegativeEvidenceFlags.ok &&
          semOverlay.unknownAsNegativeEvidenceFlags.ok &&
          judgeOverlay.unknownAsNegativeEvidenceFlags.ok,
        flags: [
          ...new Set([
            ...overlay.unknownAsNegativeEvidenceFlags.flags,
            ...semOverlay.unknownAsNegativeEvidenceFlags.flags,
            ...judgeOverlay.unknownAsNegativeEvidenceFlags.flags,
          ]),
        ],
      },
      notes: [
        ...(run.critic.notes ?? []),
        `v6 consistency: ${overlay.calibrationRevisionIntegrity.summary}`,
        `v7 semantics: ${semOverlay.evidenceSemanticsIntegrity.summary}`,
        `v8 judge: ${judgeOverlay.semanticJudgeIntegrity.summary}`,
      ],
    };
    await appendHistory(options.rootDir, runId, {
      at: now(),
      type: 'critic_report',
      actor: 'F',
      payload: run.critic,
    });
    await touch();

    run.status = 'chairman';
    await touch();
    budget = recordCall(budget);
    run.final = await options.llm.chairman(
      options.evidence,
      run.independent,
      run.debate,
      run.critic,
      run.revisions,
      run.claimCalibrations,
      run.evidenceSemantics,
      run.semanticJudgments,
    );
    run.final = enrichFinalReport(run.final, run.independent, run.critic);
    const findings = formatCalibrationRevisionFindings(consistencyResults);
    const semFindings = formatEvidenceSemanticsFindings(semanticsChecks);
    const judgeSummary = summarizeSemanticJudgments(run.semanticJudgments ?? []);
    const mismatchKeys = judgeChecks
      .filter((c) => c.flags.includes('JUDGE_REVISION_MISMATCH'))
      .map((c) => `${c.memberId}/${c.claimId}`);
    const influence = measureRevisionInfluence({
      judgments: run.semanticJudgments ?? [],
      revisions: run.revisions ?? [],
      mismatchClaimKeys: mismatchKeys,
    });
    const judgeFindings = formatSemanticJudgeFindings(
      run.semanticJudgments ?? [],
      mismatchKeys.length,
    );
    const allSemRows = (run.evidenceSemantics ?? []).flatMap((s) => s.claims);
    const leaps = (run.semanticJudgments ?? []).filter((j) => j.semanticLeap.detected);
    run.final = {
      ...run.final,
      calibrationRevisionFindings: [
        ...(run.final.calibrationRevisionFindings ?? []),
        ...findings,
      ],
      evidenceSemanticsFindings: [
        ...(run.final.evidenceSemanticsFindings ?? []),
        ...semFindings,
      ],
      semanticJudgeFindings: [
        ...(run.final.semanticJudgeFindings ?? []),
        ...judgeFindings,
        `revisionInfluence: triggered=${influence.judgeTriggeredRevision} reword=${influence.judgeTriggeredReword} narrow=${influence.judgeTriggeredNarrow} confDown=${influence.judgeTriggeredConfidenceChange} ignoredRisk=${influence.judgeIgnoredRisk} mismatch=${influence.judgeRevisionMismatch}`,
      ],
      semanticRisks: leaps.map(
        (j) => `${j.memberId}/${j.claimId}: ${j.semanticLeap.type} — ${j.claimText.slice(0, 80)}`,
      ),
      semanticJudgeSummary: {
        ...judgeSummary,
        judgeRevisionMismatchCount: mismatchKeys.length,
        judgeTriggeredRevision: influence.judgeTriggeredRevision,
        judgeTriggeredReword: influence.judgeTriggeredReword,
        judgeTriggeredNarrow: influence.judgeTriggeredNarrow,
        judgeTriggeredConfidenceChange: influence.judgeTriggeredConfidenceChange,
        judgeIgnoredRisk: influence.judgeIgnoredRisk,
      },
      chairmanReliabilityFlags: scanChairmanReliability({
        confirmedFacts: run.final.confirmedFacts,
        hypotheses: run.final.hypotheses,
        statusSummary: run.final.statusSummary,
        supportedClaims: run.final.supportedClaims,
        unsupportedHypothesisClaims: run.final.unsupportedHypothesisClaims,
      }),
      directlySupportedClaims: [
        ...(run.final.directlySupportedClaims ?? []),
        ...allSemRows
          .filter((c) => c.evidenceRelation === 'DIRECTLY_SUPPORTS')
          .map((c) => `${c.claimId}: ${c.claimText}`),
      ],
      supportedInferences: [
        ...(run.final.supportedInferences ?? []),
        ...allSemRows
          .filter(
            (c) =>
              c.entailmentLevel === 'STRONG_INFERENCE' ||
              c.evidenceRelation === 'PARTIALLY_SUPPORTS',
          )
          .map((c) => `${c.claimId}: ${c.claimText}`),
      ],
      weakLimitedInferences: [
        ...(run.final.weakLimitedInferences ?? []),
        ...allSemRows
          .filter((c) => c.entailmentLevel === 'WEAK_INFERENCE' || c.unsupportedLeap)
          .map((c) => `${c.claimId}: ${c.claimText}`),
      ],
    };
    await appendHistory(options.rootDir, runId, {
      at: now(),
      type: 'final_report',
      actor: 'Chairman',
      payload: { confidence: run.final.confidence },
    });

    run.status = 'completed';
    run.budget = budget;
    await touch();
    return run;
  } catch (e) {
    run.status = 'failed';
    run.error = e instanceof Error ? e.message : String(e);
    run.budget = budget;
    await touch();
    await appendHistory(options.rootDir, runId, {
      at: now(),
      type: 'failed',
      actor: 'system',
      payload: { error: run.error },
    });
    throw e;
  }
}
