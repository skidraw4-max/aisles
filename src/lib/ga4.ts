/** GA4 measurement ID — unset or empty disables client events (layout skips gtag load). */
export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || 'G-BH4L4PYCJT';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** Fire a GA4 custom event when gtag is available; no-op if analytics is not loaded. */
export function sendGAEvent(
  eventName: string,
  params?: Record<string, string | number | boolean | undefined>
): void {
  if (typeof window === 'undefined') return;
  const gtag = window.gtag;
  if (typeof gtag !== 'function') return;

  const cleaned: Record<string, string | number | boolean> = {};
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        cleaned[key] = value;
      }
    }
  }
  gtag('event', eventName, cleaned);
}

/** 복도 탭·네비 클릭 */
export function trackCorridorTabSelect(category: string): void {
  sendGAEvent('corridor_tab_select', { category });
}

/** 홈 피드 `category` 쿼리 → `feed_post_click` surface */
export function homeFeedSurface(category: string | null): string {
  if (category === null) return 'home_all_feed';
  return `home_${category.toLowerCase()}_feed`;
}
