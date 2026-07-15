export type GameSlug = 'brickbreaking' | 'minibrick';

export type GameInfo = {
  slug: GameSlug;
  title: string;
  shortDescription: string;
  description: string;
  thumbVariant: 'brick' | 'mini';
  /** Public URL under /games/... ; null = CSS placeholder thumb */
  thumbnail: string | null;
  /** Static HTML entry under public/games/... (same-origin iframe) */
  embedPath: string;
};

export const GAMES: Record<GameSlug, GameInfo> = {
  brickbreaking: {
    slug: 'brickbreaking',
    title: 'BrickBreaking',
    shortDescription: '벽돌을 깨며 콤보를 쌓는 클래식 아케이드',
    description:
      '클래식 벽돌깨기. 파워업을 모아 고득점을 노리세요. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다. PC는 마우스·키보드(←→/AD, 스페이스), 모바일은 터치로 플레이합니다.',
    thumbVariant: 'brick',
    thumbnail: '/games/brickbreaking/thumbnail.png',
    embedPath: '/games/brickbreaking/index.html',
  },
  minibrick: {
    slug: 'minibrick',
    title: 'minibrick',
    shortDescription: '짧은 한 판으로 즐기는 미니 블록 퍼즐',
    description:
      '짧은 세션에 맞춘 미니 블록 퍼즐. 한 판만 빠르게 즐기고 싶을 때. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다. PC는 키보드·마우스, 모바일은 터치 스와이프로 플레이합니다.',
    thumbVariant: 'mini',
    thumbnail: '/games/minibrick/thumbnail.png',
    embedPath: '/games/minibrick/index.html',
  },
};

export const GAME_LIST: GameInfo[] = Object.values(GAMES);

export function getGame(slug: string): GameInfo | null {
  if (slug in GAMES) return GAMES[slug as GameSlug];
  return null;
}

/** Same-origin static game HTML path for iframe play. */
export function getGameEmbedPath(slug: string): string | null {
  return getGame(slug)?.embedPath ?? null;
}
