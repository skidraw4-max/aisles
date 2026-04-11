import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

/** 사이트맵 주기 갱신(초). 새 글 반영 지연을 줄이려면 값을 낮출 수 있음. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getCanonicalSiteUrl();
  const now = new Date();

  const staticPaths: { path: string; changeFrequency: MetadataRoute.Sitemap[0]['changeFrequency']; priority: number }[] =
    [
      { path: '', changeFrequency: 'daily', priority: 1 },
      { path: '/search', changeFrequency: 'daily', priority: 0.9 },
      { path: '/support', changeFrequency: 'monthly', priority: 0.5 },
      { path: '/legal/privacy', changeFrequency: 'yearly', priority: 0.3 },
      { path: '/legal/terms', changeFrequency: 'yearly', priority: 0.3 },
    ];

  const entries: MetadataRoute.Sitemap = staticPaths.map(({ path, changeFrequency, priority }) => ({
    url: path === '' ? `${base}/` : `${base}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));

  try {
    const posts = await prisma.post.findMany({
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50_000,
    });
    for (const p of posts) {
      entries.push({
        url: `${base}/post/${p.id}`,
        lastModified: p.createdAt,
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
  } catch (e) {
    console.error('[sitemap] posts 조회 실패, 정적 URL만 반환:', e);
  }

  return entries;
}
