/**
 * RM-09 (I-004, I-010): user-chosen evidence period instead of hardcoded / silent 7-day windows.
 * Reuses the shared Asia/Seoul helpers (read-only import; ai-review-board is not modified).
 */
import { addCalendarDays, resolveAnalysisPeriod, seoulYmd } from '@/lib/ai-review-board/analysis-period';

export const MAX_EVIDENCE_PERIOD_DAYS = 92;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type EvidencePeriod = { start: string; end: string; timezone: 'Asia/Seoul' };

/** Default shown in forms: the shared 7-day window ending yesterday (KST). */
export function defaultEvidencePeriod(now: Date = new Date()): EvidencePeriod {
  return resolveAnalysisPeriod(now);
}

function validYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function periodDays(start: string, end: string): number {
  const toMs = (v: string) => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d, 12); };
  return Math.round((toMs(end) - toMs(start)) / 86_400_000) + 1;
}

/** start ≤ end ≤ today(KST), ≤ 92 days, real calendar dates. */
export function validateEvidencePeriod(
  start: string,
  end: string,
  now: Date = new Date(),
): { ok: true; period: EvidencePeriod; days: number } | { ok: false; reason: 'INVALID_PERIOD' } {
  const s = start.trim();
  const e = end.trim();
  if (!validYmd(s) || !validYmd(e)) return { ok: false, reason: 'INVALID_PERIOD' };
  if (s > e) return { ok: false, reason: 'INVALID_PERIOD' };
  if (e > seoulYmd(now)) return { ok: false, reason: 'INVALID_PERIOD' };
  const days = periodDays(s, e);
  if (days > MAX_EVIDENCE_PERIOD_DAYS) return { ok: false, reason: 'INVALID_PERIOD' };
  return { ok: true, period: { start: s, end: e, timezone: 'Asia/Seoul' }, days };
}

/** Form defaults: default window + today's KST date as the max selectable day. */
export function intakePeriodDefaults(now: Date = new Date()): EvidencePeriod & { today: string } {
  return { ...defaultEvidencePeriod(now), today: seoulYmd(now) };
}

export { addCalendarDays };
