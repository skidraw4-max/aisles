/** I-054: pure helpers for the guided read-only account flow (kept CSS-free so node tests can import them). */

/** With no successful read-only observation, 관찰 실행 replaces the generic next action (after discovery/scope). */
export function observationTakesPriority(model: { next?: { id: string } | null }, observationNeeded: boolean | undefined): boolean {
  const id = model.next?.id;
  return Boolean(observationNeeded) && id !== undefined && id !== 'discover' && id !== 'review-scope';
}

/** Guided stepper unless an older consent without stored scope exists (then the re-entry form). */
export function readonlySectionMode(state: { consentAccepted: boolean; scope?: unknown }): 'stepper' | 'legacy' {
  return state.consentAccepted && !state.scope ? 'legacy' : 'stepper';
}

/** Older discovery rows still carry the English 'route' wording. */
export function reasonDisplay(reason: string): string {
  return reason.replace('화면 route 후보', '화면 경로 후보');
}

/** Statuses shown with the warning badge color. */
export const WARN_BADGES: ReadonlySet<string> = new Set(['DEGRADED', 'ACTION_REQUIRED']);
