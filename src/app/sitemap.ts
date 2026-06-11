import type { MetadataRoute } from 'next';
import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

/** 검색엔진용 사이트맵 재검증 주기(초) */
export const revalidate = 3600;

const SEO_PRIORITY_CATEGORIES: Category[] = ['AI_FORTUNE', 'BUILD', 'LAUNCH'];
const RECENT_PER_SEO_CATEGORY = 200;

const STATIC_PATHS: MetadataRoute.Sitemap = [
  { url: '/', changeFrequency: 'daily', priority: 1 },
  { url: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/search', changeFrequency: 'weekly', priority: 0.7 },
  { url: '/support', changeFrequency: 'monthly', priority: 0.4 },
  { url: '/legal/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/legal/terms', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/legal/child-safety', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/notices', changeFrequency: 'weekly', priority: 0.5 },
];

function postEntry(
  base: string,
  p: { id: string; createdAt: Date },
  priority: number,
): MetadataRoute.Sitemap[number] {
  return {
    url: `${base}/post/${p.id}`,
    lastModified: p.createdAt,
    changeFrequency: 'weekly' as const,
    priority,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((e) => ({
    ...e,
    url: e.url === '/' ? base : `${base}${e.url}`,
  }));

  const byId = new Map<string, MetadataRoute.Sitemap[number]>();

  try {
    const now = new Date();
    const [featuredLaunch, seoRecent, allPosts, notices] = await Promise.all([
      prisma.post.findMany({
        where: {
          category: 'LAUNCH',
          featuredOnHome: true,
          OR: [{ launchBannerUntil: null }, { launchBannerUntil: { gt: now } }],
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      Promise.all(
        SEO_PRIORITY_CATEGORIES.map((category) =>
          prisma.post.findMany({
            where: { category },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: RECENT_PER_SEO_CATEGORY,
          }),
        ),
      ),
      prisma.post.findMany({
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notice.findMany({
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
    ]);

    for (const p of featuredLaunch) {
      byId.set(p.id, postEntry(base, p, 0.95));
    }
    for (const batch of seoRecent) {
      for (const p of batch) {
        if (!byId.has(p.id)) {
          byId.set(p.id, postEntry(base, p, 0.85));
        }
      }
    }
    for (const p of allPosts) {
      if (!byId.has(p.id)) {
        byId.set(p.id, postEntry(base, p, 0.8));
      }
    }

    const noticeEntries: MetadataRoute.Sitemap = notices.map((n) => ({
      url: `${base}/notices/${n.id}`,
      lastModified: n.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));

    return [...staticEntries, ...byId.values(), ...noticeEntries];
  } catch (e) {
    console.error('[sitemap] DB 조회 실패 — 정적 URL만 반환:', e);
    return staticEntries;
  }
}
