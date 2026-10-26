/** I-054: pure helpers for the guided read-only account flow (kept CSS-free so node tests can import them). */

/** With no successful read-only observation, 관찰 실행 replaces the generic next action (after discovery/scope). */
export function observationTakesPriority(model: { next?: { id: string } | null }, observationNeeded: boolean | undefined): boolean {
  const id = model.next?.id;
  return Boolean(observationNeeded) && id !== undefined && id !== 'discover' && id !== 'review-scope';
}

/** Failure reasons whose notice tells the user to consent again (same set the notice text uses). */
export const RECONSENT_REASONS: ReadonlySet<string> = new Set(['CONSENT_REQUIRED', 'CONSENT_STALE']);

/** True when an action result asks for re-consent. */
export function resultNeedsReconsent(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as { ok?: unknown; reason?: unknown };
  return r.ok === false && typeof r.reason === 'string' && RECONSENT_REASONS.has(r.reason);
}

/**
 * Single source for "① 범위 done". Done only when a current-version consent exists (the loader filters by version),
 * its stored scope re-hashes to scopeHash (storedConsentScope -> scope non-null), and no result asks for re-consent.
 * Outdated version / no stored scope / hash mismatch / stale result => ① reopens with checkbox and save button.
 */
export function consentStepDone(state: { consentAccepted: boolean; scope?: unknown }, results: readonly unknown[] = []): boolean {
  return Boolean(state.consentAccepted) && Boolean(state.scope) && !results.some(resultNeedsReconsent);
}

/** True when a consent existed but must be renewed (drives the explanation shown on the reopened ①). */
export function reconsentNeeded(state: { consentAccepted: boolean; scope?: unknown }, results: readonly unknown[] = []): boolean {
  return results.some(resultNeedsReconsent) || (Boolean(state.consentAccepted) && !state.scope);
}

/**
 * Always the guided stepper: an older consent without stored scope now reopens ① for re-consent
 * instead of the re-entry form that showed "동의 완료 ✓" with no way to consent again (I-054 t494).
 */
export function readonlySectionMode(_state: { consentAccepted: boolean; scope?: unknown }): 'stepper' | 'legacy' {
  return 'stepper';
}

/** Older discovery rows still carry the English 'route' wording. */
export function reasonDisplay(reason: string): string {
  return reason.replace('화면 route 후보', '화면 경로 후보');
}

/** Statuses shown with the warning badge color. */
export const WARN_BADGES: ReadonlySet<string> = new Set(['DEGRADED', 'ACTION_REQUIRED']);
