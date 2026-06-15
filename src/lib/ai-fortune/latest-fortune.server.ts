import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { withDbRetry } from '@/lib/db-retry';
import {
  fortuneSubtitleFromPost,
  type LatestAiFortuneSummary,
} from '@/lib/ai-fortune/latest-fortune.shared';

const LATEST_FORTUNE_REVALIDATE_SEC = 60;

async function fetchLatestAiFortunePostUncached(): Promise<LatestAiFortuneSummary | null> {
  const post = await withDbRetry(() =>
    prisma.post.findFirst({
      where: { category: 'AI_FORTUNE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        aiFortuneWeekKey: true,
        aiFortunePayload: true,
      },
    })
  );
  if (!post) return null;
  return {
    id: post.id,
    title: post.title,
    subtitle: fortuneSubtitleFromPost(post),
    weekKey: post.aiFortuneWeekKey,
  };
}

const getCachedLatestAiFortunePost = unstable_cache(
  fetchLatestAiFortunePostUncached,
  ['latest-ai-fortune-post-v1'],
  {
    revalidate: LATEST_FORTUNE_REVALIDATE_SEC,
    tags: ['ai-fortune-latest'],
  }
);

/** Latest weekly AI FORTUNE post (by publish time). 60s edge cache. */
export async function fetchLatestAiFortunePost(): Promise<LatestAiFortuneSummary | null> {
  return getCachedLatestAiFortunePost();
}
