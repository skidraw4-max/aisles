import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** 피드·쇼케이스에 필요한 Post 스칼라만 조회 (aiFortunePayload·원문 URL 등 대용량 컬럼 제외) */
export const HOME_FEED_SELECT = {
  id: true,
  category: true,
  title: true,
  content: true,
  thumbnail: true,
  attachmentUrls: true,
  views: true,
  likeCount: true,
  isFeatured: true,
  featuredOnHome: true,
  launchBannerUntil: true,
  aiFortuneWeekKey: true,
  tags: true,
  createdAt: true,
  author: { select: { username: true } },
  launchInfo: { select: { serviceUrl: true, status: true } },
  _count: { select: { comments: true } },
  metadata: { select: { params: true } },
} as const satisfies Prisma.PostSelect;

/** @deprecated `select: HOME_FEED_SELECT` 사용 */
export const HOME_FEED_INCLUDE = HOME_FEED_SELECT;

export type HomeFeedPost = Prisma.PostGetPayload<{ select: typeof HOME_FEED_SELECT }>;

/** 클라이언트·JSON으로 넘길 때 `_count` 등이 누락되지 않도록 댓글 수를 평문 필드로 둡니다. */
export type FeedPostJson = Omit<HomeFeedPost, 'createdAt' | '_count'> & {
  createdAt: string;
  commentCount: number;
};

const FEED_CONTENT_SNIPPET_MAX = 200;

/** Prisma `Date` 또는 JSON/캐시에서 복원된 ISO 문자열 모두 처리 */
export function homeFeedCreatedAtToIso(createdAt: Date | string): string {
  if (createdAt instanceof Date) return createdAt.toISOString();
  if (typeof createdAt === 'string') return createdAt;
  return new Date(createdAt as unknown as string).toISOString();
}

function feedContentForClient(content: string | null | undefined): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.length <= FEED_CONTENT_SNIPPET_MAX) return trimmed;
  return `${trimmed.slice(0, FEED_CONTENT_SNIPPET_MAX)}…`;
}

export function serializeFeedPost(post: HomeFeedPost): FeedPostJson {
  const { createdAt, _count, content, ...rest } = post;
  return {
    ...rest,
    content: feedContentForClient(content),
    createdAt: homeFeedCreatedAtToIso(createdAt as Date | string),
    commentCount: _count.comments,
  };
}

/** 에디터 픽 — 현재 필터(전체 또는 복도)에 맞는 featured 글 */
export async function fetchFeaturedForHome(category: Category | null): Promise<HomeFeedPost[]> {
  try {
    return await prisma.post.findMany({
      where: { isFeatured: true, ...(category ? { category } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: HOME_FEED_SELECT,
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
          ? { category: { notIn: ['LOUNGE', 'GOSSIP', 'AI_FORTUNE'] satisfies Category[] } }
          : {}),
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    };

    const orderBy: Prisma.PostOrderByWithRelationInput | Prisma.PostOrderByWithRelationInput[] =
      category === 'AI_FORTUNE'
        ? [{ aiFortuneWeekKey: 'desc' }, { createdAt: 'desc' }]
        : { createdAt: 'desc' };

    const posts = await prisma.post.findMany({
      where,
      orderBy,
      skip,
      take: take + 1,
      select: HOME_FEED_SELECT,
    });
    const hasMore = posts.length > take;
    return { posts: hasMore ? posts.slice(0, take) : posts, hasMore };
  } catch (err) {
    console.error('[fetchFeedPosts]', { category, skip, take, err });
    return { posts: [], hasMore: false };
  }
}
