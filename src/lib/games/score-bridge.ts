/** postMessage type from game iframes → AIsle play shell. */
export const AISLE_GAME_SCORE_TYPE = 'aisle-game-score' as const;

export type AisleGameScoreMessage = {
  type: typeof AISLE_GAME_SCORE_TYPE;
  mode: string;
  score: number;
};

/**
 * Validates iframe → parent score payloads.
 * Returns null if the message is not an AIsle score event.
 */
export function parseAisleGameScoreMessage(data: unknown): AisleGameScoreMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== AISLE_GAME_SCORE_TYPE) return null;
  const mode = typeof d.mode === 'string' ? d.mode.trim() : '';
  if (!mode) return null;
  const scoreRaw = d.score;
  const score =
    typeof scoreRaw === 'number'
      ? scoreRaw
      : typeof scoreRaw === 'string'
        ? Number(scoreRaw)
        : NaN;
  if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) return null;
  if (score > 1_000_000_000) return null;
  return { type: AISLE_GAME_SCORE_TYPE, mode, score };
}
