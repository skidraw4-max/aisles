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

export type ParsedAiFortuneWeekKey = { year: number; month: number; week: number };

/** `2026-05-W3` 파싱 — 실패 시 `null` */
export function parseAiFortuneWeekKey(weekKey: string): ParsedAiFortuneWeekKey | null {
  const m = /^(\d{4})-(\d{2})-W(\d+)$/.exec(weekKey.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const week = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(week)) return null;
  if (month < 1 || month > 12 || week < 1) return null;
  return { year, month, week };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 주차 키 → 해당 주 중순(KST 정오) 기준 `Date` */
export function dateForAiFortuneWeekKey(weekKey: string): Date | null {
  const parsed = parseAiFortuneWeekKey(weekKey);
  if (!parsed) return null;
  const { year, month, week } = parsed;
  const maxDay = daysInMonth(year, month);
  const day = Math.min((week - 1) * 7 + 4, maxDay);
  // KST 12:00 = UTC 03:00 (same calendar day in KST)
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
}

export function compareAiFortuneWeekKeys(a: string, b: string): number {
  const pa = parseAiFortuneWeekKey(a);
  const pb = parseAiFortuneWeekKey(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.year !== pb.year) return pa.year - pb.year;
  if (pa.month !== pb.month) return pa.month - pb.month;
  return pa.week - pb.week;
}

/** `startKey`~`endKey` 포함, KST 월·주차 순 */
export function listAiFortuneWeekKeysInRange(startKey: string, endKey: string): string[] {
  const start = parseAiFortuneWeekKey(startKey);
  const end = parseAiFortuneWeekKey(endKey);
  if (!start || !end) return [];
  const keys: string[] = [];
  let y = start.year;
  let m = start.month;
  let w = start.week;
  for (;;) {
    keys.push(`${y}-${String(m).padStart(2, '0')}-W${w}`);
    if (y === end.year && m === end.month && w === end.week) break;
    w += 1;
    const maxWeek = Math.ceil(daysInMonth(y, m) / 7);
    if (w > maxWeek) {
      w = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return keys;
}

/** AdSense 백필 기본 구간 (2026-04 1주차 ~ 2026-05 2주차) */
export const AI_FORTUNE_BACKFILL_START_KEY = '2026-04-W1';
export const AI_FORTUNE_BACKFILL_END_KEY = '2026-05-W2';

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
