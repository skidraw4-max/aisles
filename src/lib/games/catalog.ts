export type GameSlug = 'brickbreaking' | 'minibrick';

export type GameInfo = {
  slug: GameSlug;
  title: string;
  shortDescription: string;
  description: string;
  thumbVariant: 'brick' | 'mini';
};

export const GAMES: Record<GameSlug, GameInfo> = {
  brickbreaking: {
    slug: 'brickbreaking',
    title: 'BrickBreaking',
    shortDescription: '벽돌을 깨며 콤보를 쌓는 클래식 아케이드',
    description:
      '클래식 벽돌깨기. 파워업을 모아 고득점을 노리세요. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다.',
    thumbVariant: 'brick',
  },
  minibrick: {
    slug: 'minibrick',
    title: 'minibrick',
    shortDescription: '짧은 한 판으로 즐기는 미니 벽돌깨기',
    description:
      '짧은 세션에 맞춘 미니 벽돌깨기. 한 판만 빠르게 즐기고 싶을 때. 앱이 제공하는 공식 게임이며, 현재 UGC 제작은 지원하지 않습니다.',
    thumbVariant: 'mini',
  },
};

export const GAME_LIST: GameInfo[] = Object.values(GAMES);

export function getGame(slug: string): GameInfo | null {
  if (slug in GAMES) return GAMES[slug as GameSlug];
  return null;
}

export const RANKING_STUBS = {
  weekly: [
    { rank: 1, name: '픽셀브레이커', score: '128,400' },
    { rank: 2, name: '아치슬유저', score: '97,220' },
    { rank: 3, name: '나이트스와이프', score: '81,050' },
  ],
  overall: [
    { rank: 1, name: '아치슬유저', score: '412,900' },
    { rank: 2, name: '픽셀브레이커', score: '388,120' },
    { rank: 3, name: '레이스클리어', score: '301,770' },
  ],
} as const;
