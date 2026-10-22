export type GameSlug =
  | 'brickbreaking'
  | 'minibrick'
  | 'bricks-match'
  | 'brick-invasion'
  | 'ricorail';

export type GameInfo = {
  slug: GameSlug;
  title: string;
  shortDescription: string;
  description: string;
  thumbVariant: 'brick' | 'mini';
  /** Public URL under /games/... ; null = CSS placeholder thumb */
  thumbnail: string | null;
  /**
   * Static HTML under public/embeds/... (NOT public/games/).
   * public/games/{slug}/index.html would shadow App Router /games/[slug].
   */
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
    thumbnail: '/embeds/brickbreaking/thumbnail.png',
    embedPath: '/embeds/brickbreaking/index.html',
  },
  minibrick: {
    slug: 'minibrick',
    title: 'minibrick',
    shortDescription: '짧은 한 판으로 즐기는 미니 블록 퍼즐',
    description:
      '짧은 세션에 맞춘 미니 블록 퍼즐. 한 판만 빠르게 즐기고 싶을 때. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다. PC는 키보드·마우스, 모바일은 터치 스와이프로 플레이합니다.',
    thumbVariant: 'mini',
    thumbnail: '/embeds/minibrick/thumbnail.png',
    embedPath: '/embeds/minibrick/index.html',
  },
  'bricks-match': {
    slug: 'bricks-match',
    title: 'Bricks Match',
    shortDescription: '색깔 벽돌로 무너진 모자이크를 복구하는 매치 퍼즐',
    description:
      '색깔 벽돌을 맞춰 모자이크 왕국을 복구하세요. 스테이지 모험과 끝없는 복구 모드를 지원합니다. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다. PC는 마우스, 모바일은 터치로 플레이합니다.',
    thumbVariant: 'brick',
    thumbnail: '/embeds/bricks-match/thumbnail.png',
    embedPath: '/embeds/bricks-match/index.html',
  },
  'brick-invasion': {
    slug: 'brick-invasion',
    title: 'BrickInvasion',
    shortDescription: '귀여운 보이드스웜을 막는 궤도 디펜스 벽돌깨기',
    description:
      '지구를 지키는 통통 포대. 구역을 클리어하며 탄약을 키우고 보스에 도전하세요. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다. PC는 마우스, 모바일은 터치로 조준·발사합니다.',
    thumbVariant: 'brick',
    thumbnail: '/embeds/brick-invasion/thumbnail.png',
    embedPath: '/embeds/brick-invasion/index.html',
  },
  ricorail: {
    slug: 'ricorail',
    title: '리코레일',
    shortDescription: '브릭을 맞춰 별빛 길을 쏘는 스테이지 퍼즐',
    description:
      '리코레일(Ricorail). 매치로 별을 모으며 월드를 탐험하는 퍼즐입니다. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다. PC는 마우스, 모바일은 터치로 플레이합니다.',
    thumbVariant: 'mini',
    thumbnail: '/embeds/ricorail/thumbnail.png',
    embedPath: '/embeds/ricorail/index.html',
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
