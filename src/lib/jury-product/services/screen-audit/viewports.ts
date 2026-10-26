/**
 * I-059: screen audit (화면 심사) viewports. Desktop and mobile are audited separately on the same logged-in session.
 * Mobile is a 390×844 viewport resize (no UA/touch emulation: the context is shared with the login session).
 */
export type AuditViewportName = 'DESKTOP' | 'MOBILE';
export type AuditViewport = { name: AuditViewportName; width: number; height: number };

export const AUDIT_VIEWPORTS: Record<AuditViewportName, AuditViewport> = {
  DESKTOP: { name: 'DESKTOP', width: 1366, height: 768 },
  MOBILE: { name: 'MOBILE', width: 390, height: 844 },
};

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
