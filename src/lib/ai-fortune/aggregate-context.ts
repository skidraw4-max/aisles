import { prisma } from '@/lib/prisma';

export type AiFortuneAggregateContext = {
  recentBookmarkCategories: { category: string; count: number }[];
  recentBookmarkTotal: number;
};

/** 주간 공개 글용 — 커뮤니티 집계(개인 식별 없음) */
export async function loadAiFortuneAggregateContext(): Promise<AiFortuneAggregateContext> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const bookmarkGroups = await prisma.bookmark.groupBy({
    by: ['postId'],
    where: { createdAt: { gte: since } },
    _count: { postId: true },
  });

  const postIds = bookmarkGroups.map((b) => b.postId);
  let recentBookmarkCategories: { category: string; count: number }[] = [];
  let recentBookmarkTotal = 0;

  if (postIds.length > 0) {
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds } },
      select: { id: true, category: true },
    });
    const countByPost = new Map(bookmarkGroups.map((b) => [b.postId, b._count.postId]));
    const byCategory = new Map<string, number>();
    for (const p of posts) {
      const n = countByPost.get(p.id) ?? 0;
      recentBookmarkTotal += n;
      byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + n);
    }
    recentBookmarkCategories = [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  return {
    recentBookmarkCategories,
    recentBookmarkTotal,
  };
}

export function formatAggregateForPrompt(ctx: AiFortuneAggregateContext): string {
  if (ctx.recentBookmarkTotal > 0) {
    return `최근 7일 북마크 ${ctx.recentBookmarkTotal}건 — 복도별: ${ctx.recentBookmarkCategories
      .slice(0, 6)
      .map((x) => `${x.category}(${x.count})`)
      .join(', ')}`;
  }
  return '최근 7일 북마크 활동이 적음 — 트렌드는 RSS·헤드라인 위주로 분석';
}
