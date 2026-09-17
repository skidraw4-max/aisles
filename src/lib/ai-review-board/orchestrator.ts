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
import type {
  ClaimCalibration,
  EvidencePack,
  ReviewBoardRun,
  RevisionRecord,
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
    revisions: [],
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

    run.status = 'revision';
    await touch();

    const revisionResults: RevisionRecord[] = [];
    for (const memberId of COMMITTEE_ANALYSTS) {
      budget = recordCall(budget);
      const own = run.independent.find((i) => i.memberId === memberId)!;
      const ownDebate = run.debate.find((d) => d.memberId === memberId)!;
      const cal = run.claimCalibrations!.find((c) => c.memberId === memberId)!;
      const rev = await options.llm.revisionPass(
        memberId,
        options.evidence,
        own,
        ownDebate,
        run.independent,
        cal,
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
        },
      });
      await touch();
    }

    run.status = 'critic';
    await touch();
    budget = recordCall(budget);
    run.critic = await options.llm.critic(
      options.evidence,
      run.independent,
      run.debate,
      run.revisions,
      run.claimCalibrations,
    );
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
    );
    run.final = enrichFinalReport(run.final, run.independent, run.critic);
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
