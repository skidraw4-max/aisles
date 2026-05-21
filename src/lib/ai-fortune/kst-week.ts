/** KST 기준 날짜·시각 부품 */
export type KstParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number; // 0=Sun … 6=Sat
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC `Date` → KST 달력 부품 */
export function getKstParts(date: Date = new Date()): KstParts {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    hour: kst.getUTCHours(),
    weekday: kst.getUTCDay(),
  };
}

/** 한국식 월 내 주차: 1–7일=1주, 8–14=2주, … */
export function weekOfMonthKst(date: Date = new Date()): number {
  const { day } = getKstParts(date);
  return Math.ceil(day / 7);
}

/** DB 중복 방지·크론 식별용 키 (예: 2026-05-W3) */
export function aiFortuneWeekKey(date: Date = new Date()): string {
  const { year, month } = getKstParts(date);
  const week = weekOfMonthKst(date);
  return `${year}-${String(month).padStart(2, '0')}-W${week}`;
}

/** DB 키 `2026-05-W3` → 표시용 `2026년 5월 3주차` */
export function formatAiFortuneWeekKeyLabel(weekKey: string): string {
  const m = /^(\d{4})-(\d{2})-W(\d+)$/.exec(weekKey.trim());
  if (!m) return weekKey;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const week = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(week)) return weekKey;
  return `${year}년 ${month}월 ${week}주차`;
}

export function aiFortunePostTitle(date: Date = new Date()): string {
  const { month } = getKstParts(date);
  const week = weekOfMonthKst(date);
  return `[AI FORTUNE] ${month}월 ${week}주차, 당신의 커리어를 바꿀 AI의 흐름`;
}

/** 월요일 05:00 KST 직후 크론 윈도우인지 (±30분 허용) */
export function isScheduledAiFortuneCronWindow(date: Date = new Date()): boolean {
  const { weekday, hour } = getKstParts(date);
  return weekday === 1 && hour === 5;
}
