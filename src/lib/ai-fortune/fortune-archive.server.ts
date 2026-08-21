import { prisma } from '@/lib/prisma';
import { withDbRetry } from '@/lib/db-retry';
import { unstable_cache } from 'next/cache';

export type FortuneArchiveItem = {
  id: string;
  title: string;
  weekKey: string | null;
  createdAt: Date;
};

async function fetchFortuneArchiveUncached(take = 52): Promise<FortuneArchiveItem[]> {
  const rows = await withDbRetry(() =>
    prisma.post.findMany({
      where: { category: 'AI_FORTUNE' },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        aiFortuneWeekKey: true,
        createdAt: true,
      },
    })
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    weekKey: r.aiFortuneWeekKey,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
  }));
}

const getCachedFortuneArchive = unstable_cache(
  () => fetchFortuneArchiveUncached(52),
  ['fortune-archive-v1'],
  { revalidate: 120, tags: ['ai-fortune-latest', 'fortune-archive'] }
);

export async function fetchFortuneArchive(take = 52): Promise<FortuneArchiveItem[]> {
  const all = await getCachedFortuneArchive();
  return all.slice(0, take);
}
