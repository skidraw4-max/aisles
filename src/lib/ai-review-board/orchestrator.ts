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
import type { EvidencePack, ReviewBoardRun } from './types';

export type OrchestratorOptions = {
  rootDir: string;
  llm: ReviewBoardLlm;
  evidence: EvidencePack;
  maxCalls?: number;
  runId?: string;
  /** independent 호출을 순차로 (기본 true — 예산·관찰 용이) */
  sequentialIndependent?: boolean;
};

export async function runReviewBoardPipeline(
  options: OrchestratorOptions,
): Promise<ReviewBoardRun> {
  const runId = options.runId ?? createRunId();
  const maxCalls = options.maxCalls ?? defaultMaxCallsFromEnv();
  let budget = createBudget(maxCalls);
  const now = () => new Date().toISOString();

  const run: ReviewBoardRun = {
    runId,
    status: 'collecting_evidence',
    createdAt: now(),
    updatedAt: now(),
    evidence: options.evidence,
    independent: [],
    debate: [],
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
      payload: { generatedAt: options.evidence.generatedAt },
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
        peerAnalyses: run.independent, // stripPeers removes these
      });
      const analysis = await options.llm.independentAnalysis(
        memberId,
        options.evidence,
        ctx,
      );
      // Preserve originalOpinion immutably in stored snapshot
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
        type: turn.revised ? 'opinion_revised' : 'debate_turn',
        actor: memberId,
        payload: {
          agreement: turn.agreement,
          disagreement: turn.disagreement,
          revised: turn.revised,
          revisionStatus: turn.revisionStatus,
          previousOpinion: turn.previousOpinion,
          revisedOpinion: turn.revisedOpinion,
          revisionReason: turn.revisionReason,
          finalOpinion: turn.finalOpinion,
        },
      });
      await touch();
    }

    run.status = 'critic';
    await touch();
    budget = recordCall(budget);
    run.critic = await options.llm.critic(options.evidence, run.independent, run.debate);
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
