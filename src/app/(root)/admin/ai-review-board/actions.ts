'use server';

import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminAction } from '@/lib/auth/require-admin';
import {
  attachGa4Evidence,
  buildEvidencePackFromDb,
  createGeminiReviewBoardLlm,
  DEFAULT_REVIEW_BOARD_ROOT,
  runReviewBoardPipeline,
} from '@/lib/ai-review-board';
import {
  findInProgressRunId,
  isAdminReviewBoardRunAllowed,
  prepareQueuedReviewBoardRun,
} from '@/lib/ai-review-board/start-run';
import { loadRun, saveRunSnapshot } from '@/lib/ai-review-board/store';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';

export type StartAiReviewBoardRunResult =
  | { ok: true; runId: string }
  | {
      ok: false;
      error: string;
      code:
        | 'UNAUTHORIZED'
        | 'FORBIDDEN'
        | 'NOT_LOCAL'
        | 'IN_PROGRESS'
        | 'MISSING_GEMINI_KEY'
        | 'START_FAILED';
      inProgressRunId?: string;
    };

async function markRunFailed(rootDir: string, runId: string, message: string): Promise<void> {
  const run = await loadRun(rootDir, runId);
  if (!run || run.status === 'completed' || run.status === 'failed') return;
  run.status = 'failed';
  run.updatedAt = new Date().toISOString();
  run.budget = {
    ...run.budget,
    warnings: [...(run.budget.warnings ?? []), `admin_start_failed:${message}`],
  };
  await saveRunSnapshot(rootDir, run);
}

/**
 * 로컬 Admin 전용: Evidence(DB)+GA4(fail-open) 후 파이프라인을 after()로 기동.
 * Action은 runId만 즉시 반환한다.
 */
export async function startAiReviewBoardRun(): Promise<StartAiReviewBoardRunResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) {
    return { ok: false, error: auth.error, code: auth.code };
  }

  if (!isAdminReviewBoardRunAllowed()) {
    return {
      ok: false,
      error: '운영위원회 실행은 로컬 next dev에서만 가능합니다.',
      code: 'NOT_LOCAL',
    };
  }

  const rootDir = DEFAULT_REVIEW_BOARD_ROOT;
  const inProgress = await findInProgressRunId(rootDir);
  if (inProgress) {
    return {
      ok: false,
      error: '이미 진행 중인 위원회 런이 있습니다.',
      code: 'IN_PROGRESS',
      inProgressRunId: inProgress,
    };
  }

  const keyRes = readGeminiApiKeyFromEnv();
  if (!keyRes.ok) {
    return {
      ok: false,
      error: 'Gemini API 키가 없습니다. GOOGLE_GENERATIVE_AI_API_KEY 또는 GEMINI_API_KEY를 설정하세요.',
      code: 'MISSING_GEMINI_KEY',
    };
  }

  try {
    let evidence = await buildEvidencePackFromDb(prisma);
    evidence = await attachGa4Evidence(evidence);

    const queued = await prepareQueuedReviewBoardRun({ rootDir, evidence });
    const runId = queued.runId;
    const llm = createGeminiReviewBoardLlm(keyRes.key);

    after(async () => {
      try {
        await runReviewBoardPipeline({
          rootDir,
          llm,
          evidence,
          runId,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[ai-review-board] admin pipeline failed', e);
        await markRunFailed(rootDir, runId, msg);
      }
    });

    return { ok: true, runId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ai-review-board] admin start failed', e);
    return { ok: false, error: msg, code: 'START_FAILED' };
  }
}
