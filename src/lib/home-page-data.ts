import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchLatestForCategory } from '@/lib/home-composite';
import { ALL_CARD_FEED_INITIAL_COUNT } from '@/lib/home-all-card-feed';
import { fetchFeedPosts, type HomeFeedPost } from '@/lib/home-feed';

function parseCategoryKey(categoryKey: string): Category | null {
  if (categoryKey === 'all') return null;
  return categoryKey as Category;
}

/**
 * 메인 페이지 DB 조회.
 * (과거 `unstable_cache`는 JSON 직렬화로 `Date`가 문자열이 되어 `serializeFeedPost` 등에서
 * `toISOString` 런타임 오류가 났습니다. 라우트 `revalidate`로 페이지 단 캐시를 사용합니다.)
 */
export async function getHomePageQueries(categoryKey: string) {
  const filterCategory = parseCategoryKey(categoryKey);

  const recentAll = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: {
      author: { select: { username: true } },
      metadata: { select: { params: true } },
    },
  });

  const [firstHomeFeed, launchBannerPosts] = await Promise.all([
    fetchFeedPosts(0, filterCategory ? 12 : ALL_CARD_FEED_INITIAL_COUNT, filterCategory, [], {
      excludeLoungeGossipFromAll: !filterCategory,
    }),
    filterCategory ? Promise.resolve([] as HomeFeedPost[]) : fetchLatestForCategory('LAUNCH', 3),
  ]);

  return { recentAll, firstHomeFeed, launchBannerPosts };
}

export function categoryKeyForCache(filterCategory: Category | null): string {
  return filterCategory ?? 'all';
}
