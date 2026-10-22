import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { withDbRetry } from '@/lib/db-retry';

export type PopularTag = { tag: string; count: number };

async function fetchPopularTagsUncached(limit = 40): Promise<PopularTag[]> {
  const rows = await withDbRetry(() =>
    prisma.post.findMany({
      where: { tags: { isEmpty: false } },
      select: { tags: true },
      orderBy: { createdAt: 'desc' },
      take: 800,
    })
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const raw of row.tags ?? []) {
      const tag = raw.trim();
      if (!tag || tag.startsWith('ugc-weekly:')) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

const getCachedPopularTags = unstable_cache(
  () => fetchPopularTagsUncached(48),
  ['popular-tags-v1'],
  { revalidate: 300, tags: ['popular-tags'] }
);

export async function fetchPopularTags(limit = 40): Promise<PopularTag[]> {
  const all = await getCachedPopularTags();
  return all.slice(0, limit);
}
