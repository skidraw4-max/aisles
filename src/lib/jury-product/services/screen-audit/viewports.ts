/**
 * I-059: screen audit (화면 심사) viewports. Desktop and mobile are audited separately on the same logged-in session.
 * I-068: mobile runs in its own emulated context (MOBILE_DEVICE) that carries the logged-in session; a plain resize is
 * only the fallback for drivers without openMobile, and a fixed-min-width PC layout is then NOT_TESTED, not FAIL.
 */
export type AuditViewportName = 'DESKTOP' | 'MOBILE';
export type AuditViewport = { name: AuditViewportName; width: number; height: number };

export const AUDIT_VIEWPORTS: Record<AuditViewportName, AuditViewport> = {
  DESKTOP: { name: 'DESKTOP', width: 1366, height: 768 },
  MOBILE: { name: 'MOBILE', width: 390, height: 844 },
};

/** I-068: mobile device emulation (Android Chrome; screenshots are taken at CSS scale so size stays 390×844). */
export const MOBILE_DEVICE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
  locale: 'ko-KR',
} as const;
export type MobileDevice = typeof MOBILE_DEVICE;

/** I-068: a page at least this wide inside the 390px fallback viewport is a fixed-min-width PC layout. */
export const DESKTOP_ONLY_MIN_WIDTH = 1024;

export const DEFAULT_AUDIT_VIEWPORTS: readonly AuditViewport[] = [AUDIT_VIEWPORTS.DESKTOP, AUDIT_VIEWPORTS.MOBILE];

/**
 * Time plan for one Vercel invocation (maxDuration 300s): login + discovery share the observation budget, the audit
 * stops starting new pages after AUDIT_BUDGET_MS and marks the rest NOT_TESTED (a re-review continues them, I-064).
 */
export const AUDIT_LIMITS = {
  maxPages: 8,
  budgetMs: 150_000,
  discoveryBudgetMs: 60_000,
  discoveryMaxPages: 12,
} as const;
