import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
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

export type FetchFeedPostsOptions = {
  /** 전체(ALL) 카드 피드에서 라운지·가십 글 제외 */
  excludeLoungeGossipFromAll?: boolean;
};

/**
 * 메인 피드(비-featured만). 등록일 최신순.
 * `excludeIds`: 상단 쇼케이스에 이미 노출된 글 제외(중복 방지).
 */
export async function fetchFeedPosts(
  skip: number,
  take: number,
  category: Category | null,
  excludeIds: string[] = [],
  options: FetchFeedPostsOptions = {}
): Promise<{ posts: HomeFeedPost[]; hasMore: boolean }> {
  try {
    const excludeLoungeGossip = Boolean(
      !category && options.excludeLoungeGossipFromAll
    );
    const where = {
      isFeatured: false,
      ...(category
        ? { category }
        : excludeLoungeGossip
          ? { category: { notIn: ['LOUNGE', 'GOSSIP'] satisfies Category[] } }
          : {}),
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    };

    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: take + 1,
      include: HOME_FEED_INCLUDE,
    });
    const hasMore = posts.length > take;
    return { posts: hasMore ? posts.slice(0, take) : posts, hasMore };
  } catch (err) {
    console.error('[fetchFeedPosts]', { category, skip, take, err });
    return { posts: [], hasMore: false };
  }
}
