import type { MetadataRoute } from 'next';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

import { GAMES_PLAY_ROBOTS_DISALLOW } from '@/lib/games-seo';

/** 비공개·관리 라우트 — 모든 user-agent 공통 disallow. 게임은 hub/detail 허용, play만 차단. */
const PRIVATE_DISALLOW = [
  '/api/',
  '/auth/',
  '/login',
  '/upload',
  '/profile',
  '/my-aisles',
  '/write',
  '/notices/admin',
  '/admin/',
  GAMES_PLAY_ROBOTS_DISALLOW,
] as const;

/**
 * GEO: 생성형 AI 크롤러 명시 허용.
 * `/post/` — LOUNGE·BUILD·AI_FORTUNE 등 개별 글.
 * `/?category=AI_FORTUNE` — robots.txt는 쿼리스트링을 구분하지 않으므로 `/` Allow로 커버(상세는 docs/geo-optimization.md).
 */
const AI_CRAWLER_USER_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Google-Extended',
  'ClaudeBot',
  'anthropic-ai',
  'Applebot-Extended',
] as const;

export default function robots(): MetadataRoute.Robots {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...PRIVATE_DISALLOW],
      },
      ...AI_CRAWLER_USER_AGENTS.map((userAgent) => ({
        userAgent,
        allow: ['/', '/post/'],
        disallow: [...PRIVATE_DISALLOW],
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
