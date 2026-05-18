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

/** Gemini 응답 전처리: 흔한 키·형태 변형 */
export function normalizeAiFortuneWeeklyRaw(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const o = { ...(value as Record<string, unknown>) };

  if (o.ok === true && typeof o.value === 'object' && o.value !== null) {
    return normalizeAiFortuneWeeklyRaw(o.value);
  }

  if (!o.trendBullets && Array.isArray(o.trends)) o.trendBullets = o.trends;
  if (!o.trendBullets && Array.isArray(o.trend_bullets)) o.trendBullets = o.trend_bullets;

  const mbtiRaw = o.mbti;
  if (mbtiRaw && typeof mbtiRaw === 'object' && !Array.isArray(mbtiRaw)) {
    o.mbti = Object.entries(mbtiRaw as Record<string, unknown>).map(([type, rest]) => {
      if (typeof rest === 'object' && rest !== null) {
        return { type, ...(rest as Record<string, unknown>) };
      }
      return { type };
    });
  }

  if (Array.isArray(o.mbti)) {
    o.mbti = o.mbti.map((row) => {
      if (typeof row !== 'object' || row === null) return row;
      const r = { ...(row as Record<string, unknown>) };
      if (!r.type && typeof r.mbti === 'string') r.type = r.mbti;
      if (!r.type && typeof r.mbtiType === 'string') r.type = r.mbtiType;
      return r;
    });
  }

  return o;
}

/** 검증 실패 원인 요약 (로그용, 비밀값 미포함) */
export function describeAiFortuneWeeklyPayloadIssues(value: unknown): string[] {
  const issues: string[] = [];
  const normalized = normalizeAiFortuneWeeklyRaw(value);
  if (typeof normalized !== 'object' || normalized === null) {
    issues.push('root: not an object');
    return issues;
  }
  const o = normalized as Record<string, unknown>;
  const weekLabel = typeof o.weekLabel === 'string' ? o.weekLabel.trim() : '';
  if (!weekLabel) issues.push('weekLabel: missing or empty');

  const trends = o.trendBullets;
  if (!Array.isArray(trends)) {
    issues.push('trendBullets: not an array');
  } else {
    const valid = trends.filter((t) => typeof t === 'string' && t.trim().length > 15);
    if (valid.length < 3) {
      issues.push(`trendBullets: need 3–5 items (≥16 chars), got ${valid.length}/${trends.length}`);
    }
  }

  const mbtiRaw = o.mbti;
  if (!Array.isArray(mbtiRaw)) {
    issues.push('mbti: not an array');
    return issues;
  }

  const byType = new Map<MbtiType, AiFortuneMbtiEntry>();
  const invalidRows: string[] = [];
  for (const row of mbtiRaw) {
    const entry = parseMbtiEntry(row);
    if (entry) {
      byType.set(entry.type, entry);
      continue;
    }
    if (typeof row === 'object' && row !== null) {
      const r = row as Record<string, unknown>;
      const typeHint = typeof r.type === 'string' ? r.type.trim() : '?';
      invalidRows.push(typeHint);
    }
  }
  if (byType.size !== MBTI_TYPES.length) {
    const missing = MBTI_TYPES.filter((t) => !byType.has(t));
    issues.push(`mbti: expected 16 types, valid ${byType.size} (missing: ${missing.join(', ')})`);
    if (invalidRows.length > 0) {
      issues.push(`mbti: invalid rows for types: ${invalidRows.slice(0, 8).join(', ')}`);
    }
  }

  return issues;
}

/** Gemini 응답·DB JSON 검증 */
export function parseAiFortuneWeeklyPayload(value: unknown): AiFortuneWeeklyPayload | null {
  const normalized = normalizeAiFortuneWeeklyRaw(value);
  if (typeof normalized !== 'object' || normalized === null) return null;
  const o = normalized as Record<string, unknown>;
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
