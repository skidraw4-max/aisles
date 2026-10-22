/**
 * Shared Asia/Seoul analysis window for DB aggregates + GA4.
 * Browser-safe: no node:fs, no @google-analytics/data.
 */

export type AnalysisPeriod = {
  start: string;
  end: string;
  timezone: 'Asia/Seoul';
};

/** YYYY-MM-DD in Asia/Seoul for an instant. */
export function seoulYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Add calendar days to a YYYY-MM-DD (UTC noon anchor avoids DST edge cases for date-only). */
export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Shared Review Board window: end = yesterday (Asia/Seoul), start = end − 6 days (7 inclusive).
 */
export function resolveAnalysisPeriod(now: Date = new Date()): AnalysisPeriod {
  const today = seoulYmd(now);
  const end = addCalendarDays(today, -1);
  const start = addCalendarDays(end, -6);
  return { start, end, timezone: 'Asia/Seoul' };
}

/** @deprecated Prefer resolveAnalysisPeriod — same function. */
export const resolveReviewBoardPeriod = resolveAnalysisPeriod;

/** Instant bounds [start 00:00 KST, end+1 00:00 KST) for createdAt filters. */
export function analysisPeriodInstantBounds(period: AnalysisPeriod): {
  gte: Date;
  lt: Date;
} {
  return {
    gte: new Date(`${period.start}T00:00:00+09:00`),
    lt: new Date(`${addCalendarDays(period.end, 1)}T00:00:00+09:00`),
  };
}

/**
 * PostViewDaily day-key bounds using YYYY-MM-DD as UTC midnights
 * (same calendar labels as analysisPeriod start/end).
 */
export function analysisPeriodUtcDayBounds(period: AnalysisPeriod): {
  gte: Date;
  lt: Date;
} {
  return {
    gte: new Date(`${period.start}T00:00:00.000Z`),
    lt: new Date(`${addCalendarDays(period.end, 1)}T00:00:00.000Z`),
  };
}
