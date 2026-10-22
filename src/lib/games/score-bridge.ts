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

/** Same-origin check for iframe postMessage (www vs apex allowed when site is either). */
export function isTrustedGameMessageOrigin(
  eventOrigin: string,
  pageOrigin: string
): boolean {
  if (!eventOrigin || !pageOrigin) return false;
  if (eventOrigin === pageOrigin) return true;
  try {
    const a = new URL(eventOrigin);
    const b = new URL(pageOrigin);
    if (a.protocol !== b.protocol) return false;
    const stripWww = (h: string) => (h.startsWith('www.') ? h.slice(4) : h);
    return stripWww(a.hostname) === stripWww(b.hostname);
  } catch {
    return false;
  }
}
