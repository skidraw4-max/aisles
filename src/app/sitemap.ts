import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

/** 검색엔진용 사이트맵 재검증 주기(초) */
export const revalidate = 3600;

const STATIC_PATHS: MetadataRoute.Sitemap = [
  { url: '/', changeFrequency: 'daily', priority: 1 },
  { url: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/search', changeFrequency: 'weekly', priority: 0.7 },
  { url: '/login', changeFrequency: 'monthly', priority: 0.3 },
  { url: '/upload', changeFrequency: 'monthly', priority: 0.5 },
  { url: '/profile', changeFrequency: 'monthly', priority: 0.3 },
  { url: '/my-aisles', changeFrequency: 'monthly', priority: 0.4 },
  { url: '/support', changeFrequency: 'monthly', priority: 0.4 },
  { url: '/legal/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/legal/terms', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/notices', changeFrequency: 'weekly', priority: 0.5 },
  { url: '/write', changeFrequency: 'monthly', priority: 0.4 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((e) => ({
    ...e,
    url: e.url === '/' ? base : `${base}${e.url}`,
  }));

  let postEntries: MetadataRoute.Sitemap = [];
  let noticeEntries: MetadataRoute.Sitemap = [];

  try {
    const posts = await prisma.post.findMany({
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    postEntries = posts.map((p) => ({
      url: `${base}/post/${p.id}`,
      lastModified: p.createdAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    const notices = await prisma.notice.findMany({
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    noticeEntries = notices.map((n) => ({
      url: `${base}/notices/${n.id}`,
      lastModified: n.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));
  } catch (e) {
    console.error('[sitemap] DB 조회 실패 — 정적 URL만 반환:', e);
  }

  return [...staticEntries, ...postEntries, ...noticeEntries];
}
