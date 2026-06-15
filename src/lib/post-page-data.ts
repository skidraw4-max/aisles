import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import type { Category, Prisma } from '@prisma/client';
import { fetchLatestAiFortunePost } from '@/lib/ai-fortune/latest-fortune.server';
import { prisma } from '@/lib/prisma';
import { withDbRetry } from '@/lib/db-retry';

const POST_SIDEBAR_REVALIDATE_SEC = 60;

const postInclude = {
  author: true,
  metadata: true,
  launchInfo: true,
} satisfies Prisma.PostInclude;

export type PostDetail = Prisma.PostGetPayload<{ include: typeof postInclude }>;

const relatedSelect = {
  id: true,
  title: true,
  thumbnail: true,
  likeCount: true,
  category: true,
  author: { select: { username: true } },
  metadata: { select: { params: true } },
} satisfies Prisma.PostSelect;

const popularSelect = {
  id: true,
  title: true,
  thumbnail: true,
  likeCount: true,
  content: true,
  category: true,
  metadata: { select: { params: true } },
} satisfies Prisma.PostSelect;

const categoryBoardSelect = {
  id: true,
  title: true,
  views: true,
  author: { select: { username: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.PostSelect;

export type PostRelatedRow = Prisma.PostGetPayload<{ select: typeof relatedSelect }>;
export type PostPopularRow = Prisma.PostGetPayload<{ select: typeof popularSelect }>;
export type PostCategoryBoardRow = Prisma.PostGetPayload<{ select: typeof categoryBoardSelect }>;

export type PostSidebarData = {
  relatedPosts: PostRelatedRow[];
  popularPosts: PostPopularRow[];
  prevPost: { id: string; title: string } | null;
  nextPost: { id: string; title: string } | null;
  categoryBoardPosts: PostCategoryBoardRow[];
  latestAiFortuneId: string | null;
};

export const EMPTY_POST_SIDEBAR: PostSidebarData = {
  relatedPosts: [],
  popularPosts: [],
  prevPost: null,
  nextPost: null,
  categoryBoardPosts: [],
  latestAiFortuneId: null,
};

/** 동일 요청에서 metadata·page가 중복 조회하지 않도록 dedupe */
export const getPostDetail = cache(async (id: string): Promise<PostDetail | null> => {
  return withDbRetry(() =>
    prisma.post.findUnique({
      where: { id },
      include: postInclude,
    })
  );
});

/** metadata는 getPostDetail과 React cache로 dedupe — 동일 요청에서 이중 조회 방지 */
export const getPostMetadataFields = cache(
  async (
    id: string
  ): Promise<{
    title: string;
    content: string | null;
    thumbnail: string | null;
    createdAt: Date;
    category: Category;
  } | null> => {
    const post = await getPostDetail(id);
    if (!post) return null;
    return {
      title: post.title,
      content: post.content,
      thumbnail: post.thumbnail,
      createdAt: post.createdAt,
      category: post.category,
    };
  }
);

async function fetchPostSidebarUncached(
  postId: string,
  category: Category,
  createdAtIso: string
): Promise<PostSidebarData> {
  const createdAt = new Date(createdAtIso);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    [relatedPosts, weekPopular, prevPost, nextPost, categoryBoardPosts],
    latestFortune,
  ] = await Promise.all([
    withDbRetry(() =>
      Promise.all([
        prisma.post.findMany({
          where: { category, id: { not: postId } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: relatedSelect,
        }),
        prisma.post.findMany({
          where: { id: { not: postId }, createdAt: { gte: weekAgo } },
          orderBy: { likeCount: 'desc' },
          take: 3,
          select: popularSelect,
        }),
        prisma.post.findFirst({
          where: {
            category,
            id: { not: postId },
            OR: [
              { createdAt: { lt: createdAt } },
              { AND: [{ createdAt }, { id: { lt: postId } }] },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, title: true },
        }),
        prisma.post.findFirst({
          where: {
            category,
            id: { not: postId },
            OR: [
              { createdAt: { gt: createdAt } },
              { AND: [{ createdAt }, { id: { gt: postId } }] },
            ],
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, title: true },
        }),
        prisma.post.findMany({
          where: { category },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: categoryBoardSelect,
        }),
      ])
    ),
    fetchLatestAiFortunePost(),
  ]);

  let popularPosts = weekPopular;
  if (popularPosts.length < 3) {
    const exclude = new Set<string>([postId, ...popularPosts.map((p) => p.id)]);
    const more = await withDbRetry(() =>
      prisma.post.findMany({
        where: { id: { notIn: [...exclude] } },
        orderBy: { likeCount: 'desc' },
        take: 3 - popularPosts.length,
        select: popularSelect,
      })
    );
    popularPosts = [...popularPosts, ...more];
  }

  return {
    relatedPosts,
    popularPosts,
    prevPost,
    nextPost,
    categoryBoardPosts,
    latestAiFortuneId: latestFortune?.id ?? null,
  };
}

/** 공개 사이드바·보드 데이터 — 스파이크 시 DB 부하 완화 (짧은 TTL) */
export function getPostSidebarData(
  postId: string,
  category: Category,
  createdAt: Date
): Promise<PostSidebarData> {
  const createdAtIso = createdAt.toISOString();
  return unstable_cache(
    () => fetchPostSidebarUncached(postId, category, createdAtIso),
    ['post-sidebar-v1', postId, category, createdAtIso],
    {
      revalidate: POST_SIDEBAR_REVALIDATE_SEC,
      tags: [`post-${postId}`, 'post-sidebar'],
    }
  )();
}

export async function getPostComments(postId: string) {
  return withDbRetry(() =>
    prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, username: true, avatarUrl: true } } },
    })
  );
}
