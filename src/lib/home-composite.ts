import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { HOME_FEED_INCLUDE, type HomeFeedPost } from '@/lib/home-feed';

const HOT_VIEW_WEIGHT = 1;
const HOT_LIKE_WEIGHT = 5;

/** 복도별 인기 상위 N (쇼케이스용·메인「인기」탭 피드와 별도) */
export async function fetchHotTopForCategory(
  category: Category,
  take: number
): Promise<HomeFeedPost[]> {
  if (take <= 0) return [];

  try {
    const idRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "Post" p
      WHERE p.category = ${category}::"Category"
      ORDER BY (p."views" * ${HOT_VIEW_WEIGHT} + p."likeCount" * ${HOT_LIKE_WEIGHT}) DESC, p."createdAt" DESC
      LIMIT ${take}
    `;

    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) return [];

    const posts = await prisma.post.findMany({
      where: { id: { in: ids } },
      include: HOME_FEED_INCLUDE,
    });
    const rank = new Map(ids.map((id, i) => [id, i]));
    posts.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return posts;
  } catch (err) {
    console.error('[fetchHotTopForCategory]', { category, err });
    return [];
  }
}

export async function fetchLatestForCategory(
  category: Category,
  take: number
): Promise<HomeFeedPost[]> {
  if (take <= 0) return [];
  try {
    return await prisma.post.findMany({
      where: { category },
      orderBy: { createdAt: 'desc' },
      take,
      include: HOME_FEED_INCLUDE,
    });
  } catch (err) {
    console.error('[fetchLatestForCategory]', { category, err });
    return [];
  }
}

/** LAB·GALLERY 최신 각 4개 → 한 줄 4칸×2줄 그리드용 (교차: lab0, gal0, …) */
export async function fetchLatestLabGalleryEight(): Promise<HomeFeedPost[]> {
  const [lab, gallery] = await Promise.all([
    fetchLatestForCategory('RECIPE', 4),
    fetchLatestForCategory('GALLERY', 4),
  ]);
  const out: HomeFeedPost[] = [];
  const maxPairs = Math.max(lab.length, gallery.length);
  for (let i = 0; i < maxPairs; i++) {
    if (lab[i]) out.push(lab[i]);
    if (gallery[i]) out.push(gallery[i]);
  }
  return out;
}

/** LAB·GALLERY 인기 각 4개 → 메인 AI Work 그리드와 동일 4×2 패턴 */
export async function fetchAiWorkShowcasePosts(): Promise<HomeFeedPost[]> {
  const [lab, gallery] = await Promise.all([
    fetchHotTopForCategory('RECIPE', 4),
    fetchHotTopForCategory('GALLERY', 4),
  ]);
  const out: HomeFeedPost[] = [];
  const maxPairs = Math.max(lab.length, gallery.length);
  for (let i = 0; i < maxPairs; i++) {
    if (lab[i]) out.push(lab[i]);
    if (gallery[i]) out.push(gallery[i]);
  }
  return out;
}

export async function fetchCommunityPreviewPosts(): Promise<{
  lounge: HomeFeedPost[];
  gossip: HomeFeedPost[];
}> {
  const [lounge, gossip] = await Promise.all([
    fetchLatestForCategory('LOUNGE', 5),
    fetchLatestForCategory('GOSSIP', 5),
  ]);
  return { lounge, gossip };
}
