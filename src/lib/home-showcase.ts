import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchFeedPosts, HOME_FEED_INCLUDE, type HomeFeedPost } from '@/lib/home-feed';

export type HomeShowcaseOptions = {
  category: Category | null;
  /** 전체 기준: 최신(에디터픽+채움) vs 인기(Hot 8칸 분할) */
  sort: 'new' | 'hot';
};

/**
 * 메인 70/30 쇼케이스.
 * - 전체+인기: Hot 순위 상위 8개를 좌4·우4.
 * - 그 외: 해당 범위에서 에디터 픽 최대 4 + 최신으로 채운 뒤, 우측에 다음 최신 4.
 */
export async function fetchHomeShowcasePosts(
  options: HomeShowcaseOptions
): Promise<{
  leftPosts: HomeFeedPost[];
  rightPosts: HomeFeedPost[];
  showcaseIds: string[];
}> {
  const { category, sort } = options;

  if (!category && sort === 'hot') {
    const batch = await fetchFeedPosts('hot', 0, 8, null, []);
    const posts = batch.posts;
    return {
      leftPosts: posts.slice(0, 4),
      rightPosts: posts.slice(4, 8),
      showcaseIds: posts.map((p) => p.id),
    };
  }

  const catWhere = category ? { category } : {};

  const featured = await prisma.post.findMany({
    where: { isFeatured: true, ...catWhere },
    orderBy: { createdAt: 'desc' },
    take: 4,
    include: HOME_FEED_INCLUDE,
  });

  const used = new Set(featured.map((p) => p.id));
  const need = 4 - featured.length;

  let leftPosts = [...featured];
  if (need > 0) {
    const fill = await prisma.post.findMany({
      where: { id: { notIn: [...used] }, ...catWhere },
      orderBy: { createdAt: 'desc' },
      take: need,
      include: HOME_FEED_INCLUDE,
    });
    leftPosts = [...leftPosts, ...fill];
    fill.forEach((p) => used.add(p.id));
  }

  const rightPosts = await prisma.post.findMany({
    where: { id: { notIn: [...used] }, ...catWhere },
    orderBy: { createdAt: 'desc' },
    take: 4,
    include: HOME_FEED_INCLUDE,
  });

  const showcaseIds = [...leftPosts.map((p) => p.id), ...rightPosts.map((p) => p.id)];
  return { leftPosts, rightPosts, showcaseIds };
}
