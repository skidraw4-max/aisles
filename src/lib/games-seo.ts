import type { Category } from '@prisma/client';

/** robots.txt — 플레이만 차단 (허브·상세는 크롤 허용) */
export const GAMES_PLAY_ROBOTS_DISALLOW = '/games/*/play' as const;

/**
 * 게임 App Router 경로 색인 정책.
 * hub(`/games`)·detail(`/games/[slug]`)만 indexable, play는 noindex.
 */
export function isGamesPathIndexable(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/games') return true;
  const detail = /^\/games\/([^/]+)$/.exec(path);
  if (detail && detail[1] && detail[1] !== 'play') return true;
  return false;
}

/** 사이트맵 게시글 priority — GOSSIP는 고가치 복도보다 낮게 */
export function sitemapPriorityForPostCategory(category: Category): number {
  if (category === 'GOSSIP') return 0.45;
  if (category === 'AI_FORTUNE' || category === 'BUILD' || category === 'LAUNCH') return 0.85;
  return 0.8;
}
