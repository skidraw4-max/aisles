/**
 * I-059: per-page screen audit hook. Called by the executor after each observed page (same logged-in session, GET
 * navigation only). For every viewport: resize → settle → measure (→ capture, I-060). Never clicks, types or submits.
 * Sensitive paths (/mypage, I-057) are BLOCKED without measuring. Pages beyond the budget are NOT_TESTED, never PASS.
 */
import type { ObservationDriver } from '../readonly-account/executor';
import { isSensitivePath } from '../readonly-account/sensitive-paths';
import type { LayoutMetrics } from './layout-probe';
import { AUDIT_LIMITS, DEFAULT_AUDIT_VIEWPORTS, type AuditViewport, type AuditViewportName } from './viewports';

export type AuditPageStatus = 'PASS' | 'NOT_TESTED' | 'BLOCKED' | 'ERROR';
export type AuditPageResult = {
  path: string;
  label: string;
  viewport: AuditViewportName;
  /** PASS here only means "measured"; findings decide the area status (I-061/I-063). */
  status: AuditPageStatus;
  reason?: 'SENSITIVE_PATH' | 'BUDGET' | 'MAX_PAGES' | 'UNSUPPORTED' | 'MEASURE_FAILED';
  metrics?: LayoutMetrics;
  capture?: CaptureRef;
};
export type CaptureRef = { storageKey: string; sha256: string; byteSize: number; width: number; height: number; masked: true; maskedCount: number };

export type AuditCapture = (input: { path: string; viewport: AuditViewport }) => Promise<CaptureRef | null>;

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

export function createAuditHook(input: {
  driver: ObservationDriver;
  viewports?: readonly AuditViewport[];
  maxPages?: number;
  budgetMs?: number;
  clock?: () => number;
  sensitivePrefixes?: readonly string[];
  capture?: AuditCapture;
}) {
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  const viewports = input.viewports ?? DEFAULT_AUDIT_VIEWPORTS;
  const maxPages = input.maxPages ?? AUDIT_LIMITS.maxPages;
  const budgetMs = input.budgetMs ?? AUDIT_LIMITS.budgetMs;
  const results: AuditPageResult[] = [];
  const seen = new Set<string>();
  let audited = 0;
  const { driver } = input;
  const supported = Boolean(driver.setViewport && driver.layoutMetrics);

  const mark = (path: string, label: string, status: AuditPageStatus, reason: AuditPageResult['reason']) => {
    for (const vp of viewports) results.push({ path, label, viewport: vp.name, status, reason });
  };

  async function onPage(page: { label: string; url: string }): Promise<void> {
    const path = pathOf(page.url);
    if (seen.has(path)) return;
    seen.add(path);
    if (isSensitivePath(path, input.sensitivePrefixes)) return mark(path, page.label, 'BLOCKED', 'SENSITIVE_PATH');
    if (!supported) return mark(path, page.label, 'NOT_TESTED', 'UNSUPPORTED');
    if (audited >= maxPages) return mark(path, page.label, 'NOT_TESTED', 'MAX_PAGES');
    if (clock() - startedAt >= budgetMs) return mark(path, page.label, 'NOT_TESTED', 'BUDGET');
    audited += 1;
    for (const vp of viewports) {
      try {
        await driver.setViewport!(vp);
        const metrics = await driver.layoutMetrics!();
        const capture = input.capture ? await input.capture({ path, viewport: vp }).catch(() => null) : null;
        results.push({ path, label: page.label, viewport: vp.name, status: 'PASS', metrics, ...(capture ? { capture } : {}) });
      } catch {
        results.push({ path, label: page.label, viewport: vp.name, status: 'ERROR', reason: 'MEASURE_FAILED' });
      }
    }
    // leave the session on desktop so link discovery behaves as before
    await driver.setViewport!(viewports[0]).catch(() => undefined);
  }

  return { onPage, results, elapsedMs: () => clock() - startedAt };
}
