import { prisma } from '@/lib/prisma';

/** GeekNews·HN·Verge·AI Breakfast 등 자동 수집 원문 URL 전부 (중복 방지) */
export async function loadBlockedSyndicationUrls(): Promise<Set<string>> {
  const rows = await prisma.post.findMany({
    where: {
      OR: [
        { geeknewsOriginalUrl: { not: null } },
        { hackerNewsOriginalUrl: { not: null } },
        { vergeOriginalUrl: { not: null } },
        { aiBreakfastOriginalUrl: { not: null } },
      ],
    },
    select: {
      geeknewsOriginalUrl: true,
      hackerNewsOriginalUrl: true,
      vergeOriginalUrl: true,
      aiBreakfastOriginalUrl: true,
    },
  });
  const set = new Set<string>();
  for (const r of rows) {
    if (r.geeknewsOriginalUrl) set.add(r.geeknewsOriginalUrl);
    if (r.hackerNewsOriginalUrl) set.add(r.hackerNewsOriginalUrl);
    if (r.vergeOriginalUrl) set.add(r.vergeOriginalUrl);
    if (r.aiBreakfastOriginalUrl) set.add(r.aiBreakfastOriginalUrl);
  }
  return set;
}
