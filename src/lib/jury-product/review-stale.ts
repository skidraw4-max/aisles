/**
 * I-048: a connected-service review runs inside one server action (maxDuration 300s).
 * If the function is killed, nothing marks the row FAILED, so a RUNNING row whose
 * updatedAt is older than this is treated as abandoned and may be claimed again.
 */
export const REVIEW_STALE_RUNNING_MS = 330_000;

export function isStaleRunningReview(
  status: string | null | undefined,
  updatedAt: Date | string | null | undefined,
  now: number = Date.now(),
  staleMs: number = REVIEW_STALE_RUNNING_MS,
): boolean {
  if (status !== 'RUNNING' || updatedAt == null) return false;
  const at = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  if (!Number.isFinite(at)) return false;
  return now - at > staleMs;
}
