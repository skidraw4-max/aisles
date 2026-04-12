import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import {
  HOT_POPULARITY_LIKE_WEIGHT,
  HOT_POPULARITY_VIEW_WEIGHT,
  hotPopularityCutoffDate,
} from '@/lib/hot-popularity';
import { prisma } from '@/lib/prisma';

export const HOME_FEED_INCLUDE = {
  author: { select: { username: true } },
  launchInfo: { select: { serviceUrl: true, status: true } },
  _count: { select: { comments: true } },
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
  try {
    return await prisma.post.findMany({
      where: { isFeatured: true, ...(category ? { category } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 24,
      include: HOME_FEED_INCLUDE,
    });
  } catch (err) {
    console.error('[fetchFeaturedForHome]', { category, err });
    return [];
  }
}

/**
 * 메인 피드(비-featured만). Hot: (좋아요×10)+조회 내림차순, 선택적 최근 N일만.
 * `excludeIds`: 상단 쇼케이스에 이미 노출된 글 제외(중복 방지).
 */
export async function fetchFeedPosts(
  sort: 'new' | 'hot',
  skip: number,
  take: number,
  category: Category | null,
  excludeIds: string[] = []
): Promise<{ posts: HomeFeedPost[]; hasMore: boolean }> {
  try {
    /** 인기 점수 정렬은 상단「인기」탭(전체·복도 필터 없음)일 때만. 복도 탭은 항상 등록일순. */
    const effectiveSort: 'new' | 'hot' = sort === 'hot' && category === null ? 'hot' : 'new';

    const where = {
      isFeatured: false,
      ...(category ? { category } : {}),
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    };

    if (effectiveSort === 'new') {
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
    if (excludeIds.length > 0) {
      const idParams = excludeIds.map((id) => Prisma.sql`${id}`);
      conditions.push(Prisma.sql`p.id NOT IN (${Prisma.join(idParams, ', ')})`);
    }
    const hotSince = hotPopularityCutoffDate();
    if (hotSince) {
      conditions.push(Prisma.sql`p."createdAt" >= ${hotSince}`);
    }

    const idRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "Post" p
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY (p."likeCount" * ${HOT_POPULARITY_LIKE_WEIGHT} + p."views" * ${HOT_POPULARITY_VIEW_WEIGHT}) DESC, p."createdAt" DESC
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
  } catch (err) {
    console.error('[fetchFeedPosts]', { sort, category, skip, take, err });
    return { posts: [], hasMore: false };
  }
}
