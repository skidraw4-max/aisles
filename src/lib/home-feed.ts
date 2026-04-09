import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const HOME_FEED_INCLUDE = {
  author: { select: { username: true } },
  launchInfo: { select: { serviceUrl: true, status: true } },
} as const;

export type HomeFeedPost = Prisma.PostGetPayload<{ include: typeof HOME_FEED_INCLUDE }>;

export type FeedPostJson = Omit<HomeFeedPost, 'createdAt'> & { createdAt: string };

export function serializeFeedPost(post: HomeFeedPost): FeedPostJson {
  return {
    ...post,
    createdAt: post.createdAt.toISOString(),
  };
}

/** 에디터 픽 — 현재 필터(전체 또는 복도)에 맞는 featured 글 */
export async function fetchFeaturedForHome(category: Category | null): Promise<HomeFeedPost[]> {
  return prisma.post.findMany({
    where: { isFeatured: true, ...(category ? { category } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 24,
    include: HOME_FEED_INCLUDE,
  });
}

/**
 * 메인 피드(비-featured만). Hot: 조회수+좋아요 합 내림차순.
 */
export async function fetchFeedPosts(
  sort: 'new' | 'hot',
  skip: number,
  take: number,
  category: Category | null
): Promise<{ posts: HomeFeedPost[]; hasMore: boolean }> {
  const where = {
    isFeatured: false,
    ...(category ? { category } : {}),
  };

  if (sort === 'new') {
    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: take + 1,
      include: HOME_FEED_INCLUDE,
    });
    const hasMore = posts.length > take;
    return { posts: hasMore ? posts.slice(0, take) : posts, hasMore };
  }

  const conditions = [Prisma.sql`p."isFeatured" = false`];
  if (category) {
    conditions.push(Prisma.sql`p.category = ${category}::"Category"`);
  }

  const idRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Post" p
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY (p."viewCount" + p."likeCount") DESC, p."createdAt" DESC
    LIMIT ${take + 1} OFFSET ${skip}
  `;

  const hasMore = idRows.length > take;
  const ids = idRows.slice(0, take).map((r) => r.id);
  if (ids.length === 0) {
    return { posts: [], hasMore };
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: ids } },
    include: HOME_FEED_INCLUDE,
  });
  const rank = new Map(ids.map((id, i) => [id, i]));
  posts.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  return { posts, hasMore };
}
