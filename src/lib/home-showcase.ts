import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { HOME_FEED_INCLUDE, type HomeFeedPost } from '@/lib/home-feed';

export type HomeShowcaseOptions = {
  category: Category | null;
};

/**
 * 메인 70/30 쇼케이스.
 * 해당 범위에서 에디터 픽 최대 4 + 최신으로 채운 뒤, 우측에 다음 최신 4.
 */
export async function fetchHomeShowcasePosts(
  options: HomeShowcaseOptions
): Promise<{
  leftPosts: HomeFeedPost[];
  rightPosts: HomeFeedPost[];
  showcaseIds: string[];
}> {
  const { category } = options;
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
