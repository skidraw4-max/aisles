import type { GameSlug } from './catalog';

/** Overall personal-best row uses this sentinel weekKey. */
export const OVERALL_WEEK_KEY = 'all';

export type RankingPeriod = 'weekly' | 'overall';

export type BrickMode = 'stage' | 'infinite';
export type MiniMode = 'normal' | 'endless';
export type GameMode = BrickMode | MiniMode;

const BRICK_MODES: readonly BrickMode[] = ['stage', 'infinite'];
const MINI_MODES: readonly MiniMode[] = ['normal', 'endless'];

export function isGameSlug(slug: string): slug is GameSlug {
  return slug === 'brickbreaking' || slug === 'minibrick';
}

export function modesForGame(slug: GameSlug): readonly GameMode[] {
  return slug === 'brickbreaking' ? BRICK_MODES : MINI_MODES;
}

export function isValidMode(slug: GameSlug, mode: string): mode is GameMode {
  return (modesForGame(slug) as readonly string[]).includes(mode);
}

export function defaultMode(slug: GameSlug): GameMode {
  return modesForGame(slug)[0];
}

export function modeLabel(mode: GameMode): string {
  switch (mode) {
    case 'stage':
      return '스테이지';
    case 'infinite':
      return '무한';
    case 'normal':
      return '일반';
    case 'endless':
      return '무한';
    default:
      return mode;
  }
}

/** ISO week key, e.g. 2026-W29 (UTC). */
export function isoWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weekKeyForPeriod(period: RankingPeriod, now: Date = new Date()): string {
  return period === 'overall' ? OVERALL_WEEK_KEY : isoWeekKey(now);
}

export type RankRow = {
  rank: number;
  userId: string;
  username: string;
  score: number;
};

export function assignRanks(
  rows: { userId: string; username: string; score: number }[]
): RankRow[] {
  return rows.map((row, i) => ({
    rank: i + 1,
    userId: row.userId,
    username: row.username,
    score: row.score,
  }));
}

export function formatScore(score: number): string {
  return score.toLocaleString('ko-KR');
}

export function parseScoreSubmit(body: unknown): { mode: string; score: number } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid JSON' };
  }
  const b = body as Record<string, unknown>;
  const mode = typeof b.mode === 'string' ? b.mode.trim() : '';
  if (!mode) return { error: 'mode is required' };
  const scoreRaw = b.score;
  const score =
    typeof scoreRaw === 'number'
      ? scoreRaw
      : typeof scoreRaw === 'string'
        ? Number(scoreRaw)
        : NaN;
  if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) {
    return { error: 'score must be a non-negative integer' };
  }
  if (score > 1_000_000_000) {
    return { error: 'score too large' };
  }
  return { mode, score };
}
