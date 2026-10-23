/**
 * I-030: per-evidence review state for the evidence card, read from stored requests/results/attempts.
 * Display only (never runs or re-runs a review). Survives refresh/leaving the page because it is
 * rebuilt from the DB on every render. Request keys and server dedupe are unchanged.
 */
import type { JuryConsoleView } from './console-view';
import { buildRequestStatusRows, type RequestStatusRow } from './review-request-status';

export type EvidenceReviewStatus = {
  /** Newest stored result for this evidence (COMPLETED), if any. */
  latestResult: { id: string; completedAt: string } | null;
  /** Newest request without a result (QUEUED/RUNNING/FAILED/STALE), only if newer than latestResult. */
  open: RequestStatusRow | null;
  /** true when a non-stale QUEUED/RUNNING attempt exists → the card disables a new submit. */
  inFlight: boolean;
  /** false when attempts were not loaded: state unknown, shown as such (never as "no request"). */
  attemptsLoaded: boolean;
};

export function evidenceReviewStatus(
  view: Pick<JuryConsoleView, 'requests' | 'results' | 'attempts'>,
  evidenceId: string,
  now: number,
): EvidenceReviewStatus {
  const requestIds = new Set(view.requests.filter((row) => row.evidenceId === evidenceId).map((row) => row.id));
  const latest = view.results
    .filter((row) => requestIds.has(row.reviewRequestId))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
  const latestResult = latest ? { id: latest.id, completedAt: latest.completedAt } : null;
  if (!view.attempts) return { latestResult, open: null, inFlight: false, attemptsLoaded: false };
  const rows = buildRequestStatusRows(view, now).filter((row) => row.evidenceId === evidenceId);
  const open = rows.find((row) => !latestResult || !row.startedAt || row.startedAt > latestResult.completedAt) ?? null;
  const inFlight = rows.some((row) => row.state === 'RUNNING' || row.state === 'QUEUED');
  return { latestResult, open, inFlight, attemptsLoaded: true };
}
