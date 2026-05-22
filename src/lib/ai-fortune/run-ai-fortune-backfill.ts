import {
  AI_FORTUNE_BACKFILL_END_KEY,
  AI_FORTUNE_BACKFILL_START_KEY,
  dateForAiFortuneWeekKey,
  listAiFortuneWeekKeysInRange,
} from '@/lib/ai-fortune/kst-week';
import { runAiFortuneSync, type AiFortuneSyncResult } from '@/lib/ai-fortune/run-ai-fortune-sync';
import { prisma } from '@/lib/prisma';

const BACKFILL_STAGGER_MS = 24 * 60 * 60 * 1000;
const GEMINI_GAP_MS = 4000;

export type AiFortuneBackfillWeekResult = {
  weekKey: string;
  status: 'created' | 'skipped_exists' | 'failed';
  postId?: string;
  error?: string;
};

export type AiFortuneBackfillResult = {
  ok: boolean;
  startKey: string;
  endKey: string;
  weekKeys: string[];
  results: AiFortuneBackfillWeekResult[];
};

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createdAtForBackfillIndex(index: number, total: number): Date {
  const base = new Date('2026-04-01T03:00:00.000Z');
  return new Date(base.getTime() + index * BACKFILL_STAGGER_MS);
}

export async function runAiFortuneBackfill(
  startKey: string = AI_FORTUNE_BACKFILL_START_KEY,
  endKey: string = AI_FORTUNE_BACKFILL_END_KEY,
): Promise<AiFortuneBackfillResult> {
  const weekKeys = listAiFortuneWeekKeysInRange(startKey, endKey);
  const results: AiFortuneBackfillWeekResult[] = [];

  for (let i = 0; i < weekKeys.length; i++) {
    const weekKey = weekKeys[i]!;
    if (i > 0) {
      await sleepMs(GEMINI_GAP_MS);
    }

    const existing = await prisma.post.findUnique({
      where: { aiFortuneWeekKey: weekKey },
      select: { id: true },
    });
    if (existing) {
      console.log('[ai-fortune-backfill] 이미 존재 — 스킵', { weekKey, postId: existing.id });
      results.push({ weekKey, status: 'skipped_exists', postId: existing.id });
      continue;
    }

    const referenceDate = dateForAiFortuneWeekKey(weekKey);
    if (!referenceDate) {
      results.push({
        weekKey,
        status: 'failed',
        error: 'INVALID_WEEK_KEY',
      });
      continue;
    }

    const sync: AiFortuneSyncResult = await runAiFortuneSync({
      referenceDate,
      skipScheduleWindow: true,
      createdAt: createdAtForBackfillIndex(i, weekKeys.length),
    });

    if (!sync.ok) {
      results.push({ weekKey, status: 'failed', error: sync.message });
      continue;
    }
    if (sync.status === 'skipped_exists') {
      results.push({ weekKey, status: 'skipped_exists', postId: sync.postId });
      continue;
    }
    if (sync.status === 'created') {
      results.push({ weekKey, status: 'created', postId: sync.postId });
      continue;
    }
    results.push({
      weekKey,
      status: 'failed',
      error: sync.status,
    });
  }

  const failed = results.some((r) => r.status === 'failed');
  return {
    ok: !failed,
    startKey,
    endKey,
    weekKeys,
    results,
  };
}
