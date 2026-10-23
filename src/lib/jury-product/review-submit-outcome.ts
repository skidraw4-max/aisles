/**
 * I-030 (t449u): decides what the evidence-card submit button shows after the server action settles.
 *
 * submitTenantReview always ends in redirect():
 * - success → /jury/reviews/{resultId}  (the card unmounts; nothing to show)
 * - refusal / failure → /jury/evidence?result=CODE (same route: the card can stay mounted, the page
 *   shows the notice for CODE, so the button must NOT also say "the page did not move")
 * Only when the URL is exactly what it was at submit time did no navigation happen; then the
 * button offers a refresh so the per-card status is re-read from the server. Display only.
 */
export type ReviewSubmitOutcome = 'NAVIGATED' | 'SAME_PAGE_NOTICE' | 'NO_NAVIGATION';

export function reviewSubmitOutcome(hrefAtSubmit: string, hrefNow: string): ReviewSubmitOutcome {
  if (hrefAtSubmit === hrefNow) return 'NO_NAVIGATION';
  let before: URL;
  let after: URL;
  try {
    before = new URL(hrefAtSubmit);
    after = new URL(hrefNow);
  } catch {
    return 'NAVIGATED';
  }
  if (before.pathname === after.pathname && after.searchParams.has('result')) return 'SAME_PAGE_NOTICE';
  return 'NAVIGATED';
}
