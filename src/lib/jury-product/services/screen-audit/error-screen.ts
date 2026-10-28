/**
 * I-096: site error screen detection (e.g. Next.js global-error "오류가 발생했습니다", "Application error: a
 * client-side exception has occurred", "Something went wrong"). Such a page is not the real screen — often the
 * site crashed because the read-only guard blocked one of its requests — so it is BLOCKED (reason ERROR_SCREEN)
 * instead of PASS and produces no UI findings. Conservative: the in-page keyword match is required AND the page must
 * look like a bare error card (no navigation, ≤2 headings, ≤4 controls, ~one screen tall, little text).
 */
import type { LayoutMetrics } from './layout-probe';

/** Runs in the page; kept as a string-free regex source so the probe returns a boolean only. */
export const ERROR_SCREEN_PATTERN =
  '(오류가\\s*발생|에러가\\s*발생|문제가\\s*발생했|일시적인\\s*오류|application error|client-side exception|server-side exception|something went wrong|unexpected error|internal server error|this page (?:could not|couldn.t) load|페이지를\\s*표시할\\s*수\\s*없)';

export function matchesErrorText(text: string): boolean {
  return new RegExp(ERROR_SCREEN_PATTERN, 'i').test(text);
}

export function isErrorScreen(m: LayoutMetrics | undefined | null): boolean {
  if (!m || m.errorText !== true) return false;
  if (m.navVisible) return false;
  if (m.headings > 2) return false;
  if ((m.interactive?.length ?? 0) + (m.pinned?.length ?? 0) > 4) return false;
  if (m.viewportHeight > 0 && m.docHeight > m.viewportHeight * 1.5) return false;
  if (typeof m.bodyTextLength === 'number' && m.bodyTextLength > 800) return false;
  return true;
}
