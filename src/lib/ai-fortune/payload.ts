import { MBTI_TYPES, type MbtiType, parseMbtiType } from '@/lib/ai-fortune/mbti';

export type AiFortuneMbtiEntry = {
  type: MbtiType;
  strategy: string;
  luckyKeyword: string;
  avoidHabit: string;
};

export type AiFortuneWeeklyPayload = {
  weekLabel: string;
  trendBullets: string[];
  mbti: AiFortuneMbtiEntry[];
  closingNote?: string;
};

function isNonEmptyString(v: unknown, minLen: number): v is string {
  return typeof v === 'string' && v.trim().length >= minLen;
}

function parseMbtiEntry(raw: unknown): AiFortuneMbtiEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const type = parseMbtiType(o.type);
  if (!type) return null;
  if (!isNonEmptyString(o.strategy, 20)) return null;
  if (!isNonEmptyString(o.luckyKeyword, 3)) return null;
  if (!isNonEmptyString(o.avoidHabit, 15)) return null;
  return {
    type,
    strategy: o.strategy.trim(),
    luckyKeyword: o.luckyKeyword.trim(),
    avoidHabit: o.avoidHabit.trim(),
  };
}

/** Gemini 응답·DB JSON 검증 */
export function parseAiFortuneWeeklyPayload(value: unknown): AiFortuneWeeklyPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const weekLabel = typeof o.weekLabel === 'string' ? o.weekLabel.trim() : '';
  const trends = o.trendBullets;
  if (!weekLabel || !Array.isArray(trends)) return null;
  const trendBullets = trends
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 15)
    .map((t) => t.trim())
    .slice(0, 5);
  if (trendBullets.length < 3) return null;

  const mbtiRaw = o.mbti;
  if (!Array.isArray(mbtiRaw)) return null;
  const byType = new Map<MbtiType, AiFortuneMbtiEntry>();
  for (const row of mbtiRaw) {
    const entry = parseMbtiEntry(row);
    if (entry) byType.set(entry.type, entry);
  }
  if (byType.size !== MBTI_TYPES.length) return null;
  const mbti = MBTI_TYPES.map((type) => byType.get(type)!);

  const closingNote =
    typeof o.closingNote === 'string' && o.closingNote.trim().length > 0
      ? o.closingNote.trim()
      : undefined;

  return { weekLabel, trendBullets, mbti, closingNote };
}

export function aiFortunePayloadFromDb(
  payload: unknown,
): AiFortuneWeeklyPayload | null {
  if (payload == null) return null;
  return parseAiFortuneWeeklyPayload(payload);
}
