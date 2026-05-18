import { prisma } from '@/lib/prisma';

export type AiFortuneAggregateContext = {
  mbtiCounts: { type: string; count: number }[];
  mbtiUserTotal: number;
  recentBookmarkCategories: { category: string; count: number }[];
  recentBookmarkTotal: number;
};

/** 주간 공개 글용 — 커뮤니티 집계(개인 식별 없음) */
export async function loadAiFortuneAggregateContext(): Promise<AiFortuneAggregateContext> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [mbtiGroups, bookmarkGroups] = await Promise.all([
    prisma.user.groupBy({
      by: ['mbti'],
      where: { mbti: { not: null } },
      _count: { mbti: true },
    }),
    prisma.bookmark.groupBy({
      by: ['postId'],
      where: { createdAt: { gte: since } },
      _count: { postId: true },
    }),
  ]);

  const mbtiCounts = mbtiGroups
    .filter((g) => g.mbti)
    .map((g) => ({ type: g.mbti!, count: g._count.mbti }))
    .sort((a, b) => b.count - a.count);

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
    mbtiCounts,
    mbtiUserTotal: mbtiCounts.reduce((s, x) => s + x.count, 0),
    recentBookmarkCategories,
    recentBookmarkTotal,
  };
}

export function formatAggregateForPrompt(ctx: AiFortuneAggregateContext): string {
  const mbtiLine =
    ctx.mbtiUserTotal > 0
      ? `등록된 MBTI 유저 ${ctx.mbtiUserTotal}명 — 상위: ${ctx.mbtiCounts
          .slice(0, 5)
          .map((x) => `${x.type}(${x.count})`)
          .join(', ')}`
      : '아직 My Aisle에 MBTI를 등록한 유저가 거의 없음';

  const bookmarkLine =
    ctx.recentBookmarkTotal > 0
      ? `최근 7일 북마크 ${ctx.recentBookmarkTotal}건 — 복도별: ${ctx.recentBookmarkCategories
          .slice(0, 5)
          .map((x) => `${x.category}(${x.count})`)
          .join(', ')}`
      : '최근 7일 북마크 활동이 적음';

  return `${mbtiLine}\n${bookmarkLine}`;
}
