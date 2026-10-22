import { unstable_cache, revalidateTag } from 'next/cache';
import { prisma } from '@/lib/prisma';
import type { GameSlug } from './catalog';
import {
  OVERALL_WEEK_KEY,
  assignRanks,
  isoWeekKey,
  type GameMode,
  type RankRow,
  type RankingPeriod,
  weekKeyForPeriod,
} from './ranking';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export type RankingPayload = {
  gameSlug: GameSlug;
  mode: GameMode;
  period: RankingPeriod;
  weekKey: string;
  entries: RankRow[];
  me: RankRow | null;
};

export async function fetchRankings(options: {
  gameSlug: GameSlug;
  mode: GameMode;
  period: RankingPeriod;
  viewerUserId?: string | null;
  limit?: number;
}): Promise<RankingPayload> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));
  const weekKey = weekKeyForPeriod(options.period);
  const rows = await prisma.gameScore.findMany({
    where: {
      gameSlug: options.gameSlug,
      mode: options.mode,
      weekKey,
    },
    orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
    take: limit,
    include: { user: { select: { id: true, username: true } } },
  });

  const entries = assignRanks(
    rows.map((r) => ({
      userId: r.userId,
      username: r.user.username,
      score: r.score,
    }))
  );

  let me: RankRow | null = null;
  if (options.viewerUserId) {
    const inTop = entries.find((e) => e.userId === options.viewerUserId);
    if (inTop) {
      me = inTop;
    } else {
      const mine = await prisma.gameScore.findUnique({
        where: {
          userId_gameSlug_mode_weekKey: {
            userId: options.viewerUserId,
            gameSlug: options.gameSlug,
            mode: options.mode,
            weekKey,
          },
        },
        include: { user: { select: { username: true } } },
      });
      if (mine) {
        const better = await prisma.gameScore.count({
          where: {
            gameSlug: options.gameSlug,
            mode: options.mode,
            weekKey,
            OR: [
              { score: { gt: mine.score } },
              {
                AND: [{ score: mine.score }, { updatedAt: { lt: mine.updatedAt } }],
              },
            ],
          },
        });
        me = {
          rank: better + 1,
          userId: mine.userId,
          username: mine.user.username,
          score: mine.score,
        };
      }
    }
  }

  return {
    gameSlug: options.gameSlug,
    mode: options.mode,
    period: options.period,
    weekKey,
    entries,
    me,
  };
}

/** Upsert weekly + overall PBs when score improves. Returns whether any row was updated. */
export async function submitGameScore(options: {
  userId: string;
  gameSlug: GameSlug;
  mode: GameMode;
  score: number;
  now?: Date;
}): Promise<{ updated: boolean; weeklyScore: number; overallScore: number }> {
  const now = options.now ?? new Date();
  const weekKey = isoWeekKey(now);

  const [weekly, overall] = await Promise.all([
    upsertIfHigher({
      userId: options.userId,
      gameSlug: options.gameSlug,
      mode: options.mode,
      weekKey,
      score: options.score,
    }),
    upsertIfHigher({
      userId: options.userId,
      gameSlug: options.gameSlug,
      mode: options.mode,
      weekKey: OVERALL_WEEK_KEY,
      score: options.score,
    }),
  ]);

  const updated = weekly.changed || overall.changed;
  if (updated) {
    revalidateTag('game-hub-highlights');
  }

  return {
    updated,
    weeklyScore: weekly.score,
    overallScore: overall.score,
  };
}

async function upsertIfHigher(input: {
  userId: string;
  gameSlug: GameSlug;
  mode: GameMode;
  weekKey: string;
  score: number;
}): Promise<{ changed: boolean; score: number }> {
  const existing = await prisma.gameScore.findUnique({
    where: {
      userId_gameSlug_mode_weekKey: {
        userId: input.userId,
        gameSlug: input.gameSlug,
        mode: input.mode,
        weekKey: input.weekKey,
      },
    },
    select: { score: true },
  });

  if (!existing) {
    await prisma.gameScore.create({
      data: {
        userId: input.userId,
        gameSlug: input.gameSlug,
        mode: input.mode,
        weekKey: input.weekKey,
        score: input.score,
      },
    });
    return { changed: true, score: input.score };
  }

  if (input.score <= existing.score) {
    return { changed: false, score: existing.score };
  }

  await prisma.gameScore.update({
    where: {
      userId_gameSlug_mode_weekKey: {
        userId: input.userId,
        gameSlug: input.gameSlug,
        mode: input.mode,
        weekKey: input.weekKey,
      },
    },
    data: { score: input.score },
  });
  return { changed: true, score: input.score };
}

export type HubHighlight = {
  gameSlug: GameSlug;
  mode: GameMode;
  username: string | null;
  score: number | null;
};

const HUB_HIGHLIGHTS_REVALIDATE_SEC = 60;

async function fetchHubWeeklyHighlightsUncached(
  gameSlug: GameSlug,
  modes: readonly GameMode[]
): Promise<HubHighlight[]> {
  const weekKey = isoWeekKey();
  return Promise.all(
    modes.map(async (mode) => {
      const top = await prisma.gameScore.findFirst({
        where: { gameSlug, mode, weekKey },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
        include: { user: { select: { username: true } } },
      });
      return {
        gameSlug,
        mode,
        username: top?.user.username ?? null,
        score: top?.score ?? null,
      };
    })
  );
}

/** Top-1 weekly per mode for hub cards. Parallel per mode + 60s Data Cache. */
export async function fetchHubWeeklyHighlights(
  gameSlug: GameSlug,
  modes: readonly GameMode[]
): Promise<HubHighlight[]> {
  return unstable_cache(
    () => fetchHubWeeklyHighlightsUncached(gameSlug, modes),
    ['hub-weekly-highlights-v1', gameSlug, modes.join(',')],
    {
      revalidate: HUB_HIGHLIGHTS_REVALIDATE_SEC,
      tags: ['game-hub-highlights', `game-hub-${gameSlug}`],
    }
  )();
}
