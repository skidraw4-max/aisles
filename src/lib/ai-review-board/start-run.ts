import type { ReviewBoardPhase, ReviewBoardRun } from './types';
import { isInProgressReviewBoardPhase, isTerminalReviewBoardPhase } from './phase-label';
import { createBudget, defaultMaxCallsFromEnv } from './call-budget';
import {
  createRunId,
  listRuns,
  loadRun,
  saveRunSnapshot,
} from './store';

export type AdminRunEnv = {
  VERCEL?: string;
  NODE_ENV?: string;
  AI_REVIEW_BOARD_ALLOW_ADMIN_RUN?: string;
};

/** Vercel/prod에서는 Admin 실행 금지. 로컬 next dev는 기본 허용. */
export function isAdminReviewBoardRunAllowed(env: AdminRunEnv = process.env): boolean {
  if (env.VERCEL === '1') return false;
  if (env.AI_REVIEW_BOARD_ALLOW_ADMIN_RUN === '0') return false;
  if (env.AI_REVIEW_BOARD_ALLOW_ADMIN_RUN === '1') return true;
  return env.NODE_ENV !== 'production';
}

export function canStartReviewBoardRun(statuses: ReviewBoardPhase[]): boolean {
  return !statuses.some(isInProgressReviewBoardPhase);
}

export async function findInProgressRunId(rootDir: string): Promise<string | null> {
  const ids = await listRuns(rootDir);
  for (const id of ids) {
    const run = await loadRun(rootDir, id);
    if (run && isInProgressReviewBoardPhase(run.status)) {
      return id;
    }
  }
  return null;
}

export type PrepareQueuedRunInput = {
  rootDir: string;
  evidence: ReviewBoardRun['evidence'];
  maxCalls?: number;
  now?: Date;
};

/** 파이프라인 kickoff 전 초기 스냅샷 (폴링용). */
export async function prepareQueuedReviewBoardRun(
  input: PrepareQueuedRunInput,
): Promise<ReviewBoardRun> {
  const runId = createRunId(input.now);
  const maxCalls = input.maxCalls ?? defaultMaxCallsFromEnv();
  const nowIso = (input.now ?? new Date()).toISOString();
  const run: ReviewBoardRun = {
    runId,
    status: 'collecting_evidence',
    createdAt: nowIso,
    updatedAt: nowIso,
    evidence: input.evidence,
    independent: [],
    debate: [],
    claimCalibrations: [],
    evidenceSemantics: [],
    semanticJudgments: [],
    revisions: [],
    calibrationRevisionChecks: [],
    critic: null,
    final: null,
    budget: createBudget(maxCalls),
  };
  await saveRunSnapshot(input.rootDir, run);
  return run;
}

export { isTerminalReviewBoardPhase, isInProgressReviewBoardPhase };
