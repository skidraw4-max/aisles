import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** Hot 피드와 동일한 가중치 */
const HOT_VIEW_WEIGHT = 1;
const HOT_LIKE_WEIGHT = 5;

export type HeroBannerPost = {
  id: string;
  title: string;
  thumbnail: string;
  category: Category;
};

/**
 * 썸네일이 있는 글 중 조회·좋아요 가중 점수가 가장 높은 1건 (메인 히어로 배너용).
 */
export async function fetchHeroBannerPost(): Promise<HeroBannerPost | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Post" p
    WHERE p.thumbnail IS NOT NULL
      AND TRIM(p.thumbnail) != ''
    ORDER BY (p."viewCount" * ${HOT_VIEW_WEIGHT} + p."likeCount" * ${HOT_LIKE_WEIGHT}) DESC, p."createdAt" DESC
    LIMIT 1
  `;
  const id = rows[0]?.id;
  if (!id) return null;

  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, title: true, thumbnail: true, category: true },
  });
  const thumb = post?.thumbnail?.trim();
  if (!post || !thumb) return null;

  return {
    id: post.id,
    title: post.title,
    thumbnail: thumb,
    category: post.category,
  };
}
