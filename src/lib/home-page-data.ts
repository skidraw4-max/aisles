import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchHomeLaunchBannerPosts } from '@/lib/ugc-hub.server';
import { ALL_CARD_FEED_INITIAL_COUNT } from '@/lib/home-all-card-feed';
import { fetchFeedPosts, type HomeFeedPost } from '@/lib/home-feed';

function parseCategoryKey(categoryKey: string): Category | null {
  if (categoryKey === 'all') return null;
  return categoryKey as Category;
}

const FILTERED_FEED_INITIAL = 12;

function initialHomeFeedTake(filterCategory: Category | null): number {
  if (!filterCategory) return ALL_CARD_FEED_INITIAL_COUNT;
  if (filterCategory === 'LOUNGE' || filterCategory === 'AI_FORTUNE') return FILTERED_FEED_INITIAL * 2;
  return FILTERED_FEED_INITIAL;
}

const RECENT_SIDEBAR_SELECT = {
  id: true,
  title: true,
  thumbnail: true,
  category: true,
  createdAt: true,
  author: { select: { username: true } },
  metadata: { select: { params: true } },
} as const;

/**
 * 메인 페이지 DB 조회.
 * (과거 `unstable_cache`는 JSON 직렬화로 `Date`가 문자열이 되어 `serializeFeedPost` 등에서
 * `toISOString` 런타임 오류가 났습니다. 라우트 `revalidate`로 페이지 단 캐시를 사용합니다.)
 */
export async function getHomePageQueries(categoryKey: string) {
  const filterCategory = parseCategoryKey(categoryKey);

  const [recentAll, firstHomeFeed, launchBannerPosts] = await Promise.all([
    prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: RECENT_SIDEBAR_SELECT,
    }),
    fetchFeedPosts(0, initialHomeFeedTake(filterCategory), filterCategory, [], {
      excludeLoungeGossipFromAll: !filterCategory,
    }),
    filterCategory ? Promise.resolve([] as HomeFeedPost[]) : fetchHomeLaunchBannerPosts(3),
  ]);

  return { recentAll, firstHomeFeed, launchBannerPosts };
}

export function categoryKeyForCache(filterCategory: Category | null): string {
  return filterCategory ?? 'all';
}
