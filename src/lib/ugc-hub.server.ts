import { prisma } from '@/lib/prisma';
import { HOME_FEED_INCLUDE, type HomeFeedPost } from '@/lib/home-feed';
import { MIN_POST_DESCRIPTION_LENGTH } from '@/lib/post-description-policy';
import type { LaunchBannerAdminRow } from '@/lib/ugc-hub.shared';

const MS_7_DAYS = 7 * 24 * 60 * 60 * 1000;

/** LAUNCH 메인 배너: featuredOnHome + 만료 전 */
export async function fetchLaunchBannerPosts(take = 3): Promise<HomeFeedPost[]> {
  const now = new Date();
  try {
    return await prisma.post.findMany({
      where: {
        category: 'LAUNCH',
        featuredOnHome: true,
        OR: [{ launchBannerUntil: null }, { launchBannerUntil: { gt: now } }],
      },
      orderBy: [{ launchBannerUntil: 'desc' }, { createdAt: 'desc' }],
      take,
      include: HOME_FEED_INCLUDE,
    });
  } catch (err) {
    console.error('[fetchLaunchBannerPosts]', err);
    return [];
  }
}

/** BUILD 허브: 최근 7일 좋아요 상위 */
export async function fetchBuildPopularWeekly(take = 5): Promise<HomeFeedPost[]> {
  const since = new Date(Date.now() - MS_7_DAYS);
  try {
    return await prisma.post.findMany({
      where: { category: 'BUILD', createdAt: { gte: since } },
      orderBy: [{ likeCount: 'desc' }, { createdAt: 'desc' }],
      take,
      include: HOME_FEED_INCLUDE,
    });
  } catch (err) {
    console.error('[fetchBuildPopularWeekly]', err);
    return [];
  }
}

/** BUILD/LAUNCH 주간 베스트 (복도 필터 페이지용) */
export async function fetchUgcWeeklyTop(
  category: 'BUILD' | 'LAUNCH',
  take = 5
): Promise<HomeFeedPost[]> {
  const since = new Date(Date.now() - MS_7_DAYS);
  try {
    return await prisma.post.findMany({
      where: { category, createdAt: { gte: since } },
      orderBy: [{ likeCount: 'desc' }, { createdAt: 'desc' }],
      take,
      include: HOME_FEED_INCLUDE,
    });
  } catch (err) {
    console.error('[fetchUgcWeeklyTop]', { category, err });
    return [];
  }
}

/** 관리자 검토 후보: LAUNCH + 본문 길이 + 썸네일 */
export async function fetchLaunchBannerCandidates(take = 30): Promise<HomeFeedPost[]> {
  try {
    const rows = await prisma.post.findMany({
      where: {
        category: 'LAUNCH',
        featuredOnHome: false,
        thumbnail: { not: null },
        NOT: { thumbnail: '' },
      },
      orderBy: { createdAt: 'desc' },
      take: take * 2,
      include: HOME_FEED_INCLUDE,
    });
    return rows
      .filter((p) => (p.content?.trim().length ?? 0) >= MIN_POST_DESCRIPTION_LENGTH)
      .slice(0, take);
  } catch (err) {
    console.error('[fetchLaunchBannerCandidates]', err);
    return [];
  }
}

export async function fetchLaunchPostsForAdmin(): Promise<{
  active: LaunchBannerAdminRow[];
  candidates: LaunchBannerAdminRow[];
}> {
  const [activePosts, candidatePosts] = await Promise.all([
    fetchLaunchBannerPosts(24),
    fetchLaunchBannerCandidates(30),
  ]);

  const toRow = (p: HomeFeedPost): LaunchBannerAdminRow => ({
    id: p.id,
    title: p.title,
    featuredOnHome: p.featuredOnHome,
    launchBannerUntil: p.launchBannerUntil?.toISOString() ?? null,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    views: p.views,
    likeCount: p.likeCount,
    hasThumbnail: Boolean(p.thumbnail?.trim()),
  });

  const activeIds = new Set(activePosts.map((p) => p.id));
  return {
    active: activePosts.map(toRow),
    candidates: candidatePosts.filter((p) => !activeIds.has(p.id)).map(toRow),
  };
}
