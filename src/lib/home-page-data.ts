import type { Category } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { fetchHomeLaunchBannerPosts } from '@/lib/ugc-hub.server';
import { ALL_CARD_FEED_INITIAL_COUNT } from '@/lib/home-all-card-feed';
import { fetchFeedPosts, type HomeFeedPost } from '@/lib/home-feed';
import { reviveHomePageCache, serializeHomePageCache } from '@/lib/home-page-cache';

function parseCategoryKey(categoryKey: string): Category | null {
  if (categoryKey === 'all') return null;
  return categoryKey as Category;
}

const FILTERED_FEED_INITIAL = 12;
const HOME_PAGE_REVALIDATE_SEC = 60;

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

type HomePageQueries = {
  recentAll: Awaited<ReturnType<typeof fetchRecentSidebar>>;
  firstHomeFeed: Awaited<ReturnType<typeof fetchFeedPosts>>;
  launchBannerPosts: HomeFeedPost[];
};

async function fetchRecentSidebar() {
  return prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: RECENT_SIDEBAR_SELECT,
  });
}

async function fetchHomePageQueriesUncached(categoryKey: string): Promise<HomePageQueries> {
  const filterCategory = parseCategoryKey(categoryKey);

  const [recentAll, firstHomeFeed, launchBannerPosts] = await Promise.all([
    fetchRecentSidebar(),
    fetchFeedPosts(0, initialHomeFeedTake(filterCategory), filterCategory, [], {
      excludeLoungeGossipFromAll: !filterCategory,
    }),
    filterCategory ? Promise.resolve([] as HomeFeedPost[]) : fetchHomeLaunchBannerPosts(3),
  ]);

  return { recentAll, firstHomeFeed, launchBannerPosts };
}

/**
 * 메인 페이지 DB 조회.
 * `unstable_cache` JSON 직렬화로 Date가 문자열이 되므로 ISO로 저장한 뒤 Date로 복원한다.
 */
export async function getHomePageQueries(categoryKey: string): Promise<HomePageQueries> {
  const cached = await unstable_cache(
    async () => serializeHomePageCache(await fetchHomePageQueriesUncached(categoryKey)),
    ['home-page-queries-v1', categoryKey],
    {
      revalidate: HOME_PAGE_REVALIDATE_SEC,
      tags: ['home-page', `home-page-${categoryKey}`],
    }
  )();
  return reviveHomePageCache(cached) as unknown as HomePageQueries;
}

export function categoryKeyForCache(filterCategory: Category | null): string {
  return filterCategory ?? 'all';
}
