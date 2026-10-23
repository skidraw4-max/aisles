/**
 * I-034 (I-030 follow-up): submit progress for the evidence-card review button, kept OUTSIDE
 * useFormStatus. In React 19.2 any urgent state update while a form action runs (e.g. the
 * elapsed-time tick) drops `useFormStatus().pending` back to false after a few ms, which
 * re-enabled the button mid-run. The button now owns its progress state via this pure reducer.
 *
 * Phases:
 * - IDLE: button enabled.
 * - SUBMITTING: one submit accepted; further submits are refused (ref guard + preventDefault).
 * - NO_NAVIGATION: the action resolved (form reset) but the URL did not change for
 *   NO_NAVIGATION_GRACE_MS → offer a refresh (display only).
 * - TIMED_OUT: the browser stopped waiting after the function limit; the real state comes from the
 *   server on refresh. Still refuses submits so a second paid run is not started blindly.
 * Leaving SUBMITTING: URL change (success redirect, or same-route `?result=` refusal/failure) →
 * IDLE; unmount (success navigation, error boundary) discards the state.
 */
import { reviewSubmitOutcome } from './review-submit-outcome';

export type ReviewSubmitPhase = 'IDLE' | 'SUBMITTING' | 'NO_NAVIGATION' | 'TIMED_OUT';

export type ReviewSubmitProgress = {
  phase: ReviewSubmitPhase;
  startedAt: number | null;
  hrefAtSubmit: string | null;
  resolvedAt: number | null;
};

export const NO_NAVIGATION_GRACE_MS = 3000;
/** Extra wait past the server function limit before the browser gives up waiting. */
export const TIMEOUT_MARGIN_MS = 30_000;

export const IDLE_PROGRESS: ReviewSubmitProgress = { phase: 'IDLE', startedAt: null, hrefAtSubmit: null, resolvedAt: null };

export type ReviewSubmitEvent =
  | { type: 'SUBMIT'; now: number; href: string }
  | { type: 'RESOLVED'; now: number }
  | { type: 'TICK'; now: number; href: string; limitSeconds: number }
  | { type: 'RESET' };

/** Only IDLE accepts a submit; every other phase refuses (duplicate / blind re-run). */
export function canSubmit(progress: ReviewSubmitProgress): boolean {
  return progress.phase === 'IDLE';
}

export function nextReviewSubmitProgress(progress: ReviewSubmitProgress, event: ReviewSubmitEvent): ReviewSubmitProgress {
  switch (event.type) {
    case 'SUBMIT':
      if (!canSubmit(progress)) return progress;
      return { phase: 'SUBMITTING', startedAt: event.now, hrefAtSubmit: event.href, resolvedAt: null };
    case 'RESOLVED':
      if (progress.phase !== 'SUBMITTING') return progress;
      return { ...progress, resolvedAt: progress.resolvedAt ?? event.now };
    case 'RESET':
      return IDLE_PROGRESS;
    case 'TICK': {
      if (progress.phase !== 'SUBMITTING' || progress.startedAt === null || progress.hrefAtSubmit === null) return progress;
      if (reviewSubmitOutcome(progress.hrefAtSubmit, event.href) !== 'NO_NAVIGATION') return IDLE_PROGRESS;
      if (progress.resolvedAt !== null && event.now - progress.resolvedAt >= NO_NAVIGATION_GRACE_MS) {
        return { ...progress, phase: 'NO_NAVIGATION' };
      }
      if (event.now - progress.startedAt > event.limitSeconds * 1000 + TIMEOUT_MARGIN_MS) return { ...progress, phase: 'TIMED_OUT' };
      return progress;
    }
  }
}

export function elapsedSeconds(progress: ReviewSubmitProgress, now: number): number {
  return progress.startedAt === null ? 0 : Math.max(0, Math.floor((now - progress.startedAt) / 1000));
}
