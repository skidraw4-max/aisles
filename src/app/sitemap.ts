import type { MetadataRoute } from 'next';
import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withDbRetry } from '@/lib/db-retry';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { GAME_LIST } from '@/lib/games/catalog';
import { sitemapPriorityForPostCategory } from '@/lib/games-seo';
import { categoryToHomeQuery } from '@/lib/post-categories';

/** 검색엔진용 사이트맵 재검증 주기(초) */
export const revalidate = 3600;

const SEO_PRIORITY_CATEGORIES: Category[] = ['AI_FORTUNE', 'BUILD', 'LAUNCH'];
const RECENT_PER_SEO_CATEGORY = 200;

/**
 * allPosts 최대 수 — Vercel serverless 타임아웃 방지.
 * SEO_PRIORITY_CATEGORIES에서 이미 최신 200건씩 수집하므로
 * 나머지 카테고리의 비교적 최신 글까지 커버.
 */
const ALL_POSTS_LIMIT = 5000;

const CORRIDOR_SITEMAP: { category: Category; priority: number }[] = [
  { category: 'AI_FORTUNE', priority: 0.9 },
  { category: 'RECIPE', priority: 0.85 },
  { category: 'BUILD', priority: 0.85 },
  { category: 'LAUNCH', priority: 0.85 },
  { category: 'LOUNGE', priority: 0.8 },
  { category: 'GALLERY', priority: 0.75 },
  { category: 'GOSSIP', priority: 0.4 },
];

const STATIC_PATHS: MetadataRoute.Sitemap = [
  { url: '/', changeFrequency: 'daily', priority: 1 },
  { url: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/support', changeFrequency: 'monthly', priority: 0.4 },
  { url: '/legal/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/legal/terms', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/legal/child-safety', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/notices', changeFrequency: 'weekly', priority: 0.5 },
  { url: '/games', changeFrequency: 'weekly', priority: 0.7 },
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

  const corridorEntries: MetadataRoute.Sitemap = CORRIDOR_SITEMAP.map(({ category, priority }) => ({
    url: `${base}/?category=${categoryToHomeQuery(category)}`,
    changeFrequency: 'daily' as const,
    priority,
  }));

  const gameDetailEntries: MetadataRoute.Sitemap = GAME_LIST.map((g) => ({
    url: `${base}/games/${g.slug}`,
    changeFrequency: 'weekly' as const,
    priority: 0.65,
  }));

  const byId = new Map<string, MetadataRoute.Sitemap[number]>();

  try {
    const now = new Date();
    const [featuredLaunch, seoRecent, allPosts, notices] = await withDbRetry(() =>
      Promise.all([
        prisma.post.findMany({
          where: {
            category: 'LAUNCH',
            featuredOnHome: true,
            OR: [{ launchBannerUntil: null }, { launchBannerUntil: { gt: now } }],
          },
          select: { id: true, createdAt: true, category: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        Promise.all(
          SEO_PRIORITY_CATEGORIES.map((category) =>
            prisma.post.findMany({
              where: { category },
              select: { id: true, createdAt: true, category: true },
              orderBy: { createdAt: 'desc' },
              take: RECENT_PER_SEO_CATEGORY,
            }),
          ),
        ),
        prisma.post.findMany({
          select: { id: true, createdAt: true, category: true },
          orderBy: { createdAt: 'desc' },
          take: ALL_POSTS_LIMIT,
        }),
        prisma.notice.findMany({
          select: { id: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 500,
        }),
      ]),
    );

    for (const p of featuredLaunch) {
      byId.set(p.id, postEntry(base, p, 0.95));
    }
    for (const batch of seoRecent) {
      for (const p of batch) {
        if (!byId.has(p.id)) {
          byId.set(p.id, postEntry(base, p, sitemapPriorityForPostCategory(p.category)));
        }
      }
    }
    for (const p of allPosts) {
      if (!byId.has(p.id)) {
        byId.set(p.id, postEntry(base, p, sitemapPriorityForPostCategory(p.category)));
      }
    }

    const noticeEntries: MetadataRoute.Sitemap = notices.map((n) => ({
      url: `${base}/notices/${n.id}`,
      lastModified: n.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));

    return [
      ...staticEntries,
      ...corridorEntries,
      ...gameDetailEntries,
      ...byId.values(),
      ...noticeEntries,
    ];
  } catch (e) {
    console.error('[sitemap] DB 조회 실패 — 정적 URL만 반환:', e);
    return [...staticEntries, ...corridorEntries, ...gameDetailEntries];
  }
}
