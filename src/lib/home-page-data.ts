import { unstable_cache } from 'next/cache';
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
 * 메인 페이지 DB 조회 — 60초 ISR 캐시(복도 필터별 키).
 * `searchParams` 때문에 라우트가 동적이어도 동일 키는 DB를 재조회하지 않습니다.
 */
async function loadHomePageQueries(categoryKey: string) {
  const filterCategory = parseCategoryKey(categoryKey);

  const recentAll = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { author: { select: { username: true } } },
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

export const getCachedHomePageQueries = unstable_cache(loadHomePageQueries, ['home-page-queries'], {
  revalidate: 60,
  tags: ['home'],
});
