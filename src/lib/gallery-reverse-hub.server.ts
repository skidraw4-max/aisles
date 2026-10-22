import { prisma } from '@/lib/prisma';
import { withDbRetry } from '@/lib/db-retry';
import { HOME_FEED_SELECT, type HomeFeedPost } from '@/lib/home-feed';

/** LOUNGE 브릿지용 — 역분석이 캐시된 최근 GALLERY 글 */
export async function fetchGalleryPostsWithCachedAnalysis(take = 4): Promise<HomeFeedPost[]> {
  try {
    const rows = await withDbRetry(() =>
      prisma.post.findMany({
        where: {
          category: 'GALLERY',
          aiReversePrompt: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(take * 4, 12),
        select: { ...HOME_FEED_SELECT, aiReversePrompt: true },
      })
    );
    return rows
      .filter((p) => Boolean(p.aiReversePrompt?.trim()))
      .slice(0, take)
      .map(({ aiReversePrompt: _drop, ...rest }) => rest);
  } catch (err) {
    console.error('[fetchGalleryPostsWithCachedAnalysis]', err);
    return [];
  }
}
