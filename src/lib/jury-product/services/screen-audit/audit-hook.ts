/**
 * I-059: per-page screen audit hook. Called by the executor after each observed page (same logged-in session, GET
 * navigation only). For every viewport: resize → settle → measure (→ capture, I-060). Never clicks, types or submits.
 * Sensitive paths (/mypage, I-057) are BLOCKED without measuring. Pages beyond the budget are NOT_TESTED, never PASS.
 * I-069: pages are sampled by type (page-sampling.ts). After the viewports, same-URL tabs on the desktop page are
 * clicked one at a time (max AUDIT_LIMITS.tabsPerPage) and measured as separate entries `${path}#tab-N`, only when
 * the URL did not change and the click caused no non-GET request (those are BLOCKED and tab clicking stops).
 * The only clicks ever made are on tabs returned by driver.listTabs (forms, submit, cart/buy/pay/logout/delete excluded).
 */
import type { ObservationDriver, ResourceStats } from '../readonly-account/executor';
import { isSensitivePath } from '../readonly-account/sensitive-paths';
import { sanitizeLabel } from '../readonly-account/discovery';
import { createPageSampler, DEFAULT_SAMPLE_LIMITS, type SampleLimits } from './page-sampling';
import type { LayoutMetrics } from './layout-probe';
import { AUDIT_LIMITS, DEFAULT_AUDIT_VIEWPORTS, DESKTOP_ONLY_MIN_WIDTH, type AuditViewport, type AuditViewportName } from './viewports';

export type AuditPageStatus = 'PASS' | 'NOT_TESTED' | 'BLOCKED' | 'ERROR';
export type AuditPageResult = {
  path: string;
  label: string;
  viewport: AuditViewportName;
  /** PASS here only means "measured"; findings decide the area status (I-061/I-063). */
  status: AuditPageStatus;
  reason?: 'SENSITIVE_PATH' | 'BUDGET' | 'MAX_PAGES' | 'UNSUPPORTED' | 'MEASURE_FAILED' | 'MOBILE_HOST_NOT_ALLOWED' | 'DESKTOP_ONLY_LAYOUT' | 'SAMPLE_LIMIT' | 'TAB_NAVIGATED' | 'TAB_NON_GET';
  metrics?: LayoutMetrics;
  capture?: CaptureRef;
  /** I-068: when this page×viewport was measured (epoch ms). */
  capturedAt?: number;
  /** I-068: measurement environment (counts/origins only). */
  env?: AuditEnv;
  /** I-068: origin the mobile page redirected to but that is outside the consented scope (never auto-added). */
  mobileOrigin?: string;
  /** I-069: set for a tab entry (path is `${pagePath}#tab-N`). name is masked like page labels. */
  tab?: { index: number; name: string };
};
export type AuditEnv = {
  emulated: boolean;
  blocked: ResourceStats['blocked'];
  fontsReady: boolean;
  /** origin actually measured when it differs from the requested page (e.g. an allowed mobile host). */
  finalOrigin?: string;
};
const NO_BLOCKED: ResourceStats['blocked'] = { stylesheet: 0, font: 0, script: 0, xhr: 0, other: 0 };
export type CaptureRef = { storageKey: string; sha256: string; byteSize: number; width: number; height: number; masked: true; maskedCount: number };

export type AuditCapture = (input: { path: string; viewport: AuditViewport }) => Promise<CaptureRef | null>;

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** I-068: mobile hosts that pages redirected to but which are outside the consented scope (for guidance only). */
export function mobileOriginsNotAllowed(pages: readonly Pick<AuditPageResult, 'mobileOrigin'>[]): string[] {
  return [...new Set(pages.map((p) => p.mobileOrigin).filter((o): o is string => Boolean(o)))].sort();
}

/** I-068: true when the page was measured with blocked CSS/fonts or unloaded fonts — visual findings may be artefacts. */
export function isEnvLimited(env: AuditEnv | undefined): boolean {
  return Boolean(env && (env.blocked.stylesheet > 0 || env.blocked.font > 0 || !env.fontsReady));
}

export function createAuditHook(input: {
  driver: ObservationDriver;
  viewports?: readonly AuditViewport[];
  maxPages?: number;
  budgetMs?: number;
  clock?: () => number;
  sensitivePrefixes?: readonly string[];
  capture?: AuditCapture;
  /** I-069: per-type sampling caps (total = maxPages when maxPages is given). */
  sample?: SampleLimits;
  /** I-069: tabs per page (0 = off). */
  tabsPerPage?: number;
}) {
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  const viewports = input.viewports ?? DEFAULT_AUDIT_VIEWPORTS;
  const maxPages = input.maxPages ?? AUDIT_LIMITS.maxPages;
  const budgetMs = input.budgetMs ?? AUDIT_LIMITS.budgetMs;
  const results: AuditPageResult[] = [];
  const seen = new Set<string>();
  const sampler = createPageSampler({ ...(input.sample ?? DEFAULT_SAMPLE_LIMITS), total: maxPages });
  const tabsPerPage = input.tabsPerPage ?? AUDIT_LIMITS.tabsPerPage;
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
    const sample = sampler.check(path);
    if (sample !== 'OK') return mark(path, page.label, 'NOT_TESTED', sample);
    if (clock() - startedAt >= budgetMs) return mark(path, page.label, 'NOT_TESTED', 'BUDGET');
    sampler.take(path);
    const origin = originOf(page.url);
    let mobileOpened = false;
    for (const vp of viewports) {
      const base = { path, label: page.label, viewport: vp.name };
      try {
        const emulate = vp.name === 'MOBILE' && Boolean(driver.openMobile);
        let finalOrigin: string | undefined;
        if (emulate) {
          mobileOpened = true;
          const nav = await driver.openMobile!(page.url);
          const navOrigin = originOf(nav.finalUrl);
          const redirectedOff = nav.blockedNavigationOrigin && nav.blockedNavigationOrigin !== origin ? nav.blockedNavigationOrigin : null;
          if (redirectedOff) {
            results.push({ ...base, status: 'NOT_TESTED', reason: 'MOBILE_HOST_NOT_ALLOWED', mobileOrigin: redirectedOff, capturedAt: clock() });
            continue;
          }
          if (navOrigin && navOrigin !== origin) finalOrigin = navOrigin;
          if (isSensitivePath(pathOf(nav.finalUrl), input.sensitivePrefixes)) {
            results.push({ ...base, status: 'BLOCKED', reason: 'SENSITIVE_PATH' });
            continue;
          }
        } else {
          await driver.setViewport!(vp);
        }
        const stats = driver.resourceStats ? await driver.resourceStats().catch(() => null) : null;
        const metrics = await driver.layoutMetrics!();
        const capturedAt = clock();
        const env: AuditEnv = { emulated: emulate, blocked: stats?.blocked ?? NO_BLOCKED, fontsReady: stats?.fontsReady ?? true, ...(finalOrigin ? { finalOrigin } : {}) };
        // I-068: a resize-only "mobile" of a fixed-min-width PC site is not a mobile measurement.
        if (vp.name === 'MOBILE' && !emulate && vp.width < DESKTOP_ONLY_MIN_WIDTH && metrics.docWidth >= DESKTOP_ONLY_MIN_WIDTH) {
          results.push({ ...base, status: 'NOT_TESTED', reason: 'DESKTOP_ONLY_LAYOUT', capturedAt, env });
          continue;
        }
        const capture = input.capture ? await input.capture({ path, viewport: vp }).catch(() => null) : null;
        results.push({ ...base, status: 'PASS', metrics, capturedAt, env, ...(capture ? { capture } : {}) });
      } catch {
        results.push({ ...base, status: 'ERROR', reason: 'MEASURE_FAILED' });
      }
    }
    if (mobileOpened) await driver.closeMobile?.().catch(() => undefined);
    // leave the session on desktop so link discovery behaves as before
    await driver.setViewport!(viewports[0]).catch(() => undefined);
    await auditTabs(page, path);
  }

  /** I-069: desktop-only tab pass on the current page. */
  async function auditTabs(page: { label: string; url: string }, path: string): Promise<void> {
    if (tabsPerPage <= 0 || !driver.listTabs || !driver.clickTab) return;
    const desktop = viewports.find((v) => v.name === 'DESKTOP') ?? viewports[0];
    let tabs: Awaited<ReturnType<NonNullable<ObservationDriver['listTabs']>>> = [];
    try {
      tabs = (await driver.listTabs(tabsPerPage)).filter((t) => !t.selected).slice(0, tabsPerPage);
    } catch {
      return;
    }
    let dirty = false;
    for (const [n, t] of tabs.entries()) {
      const name = sanitizeLabel(t.name, `탭 ${n + 1}`);
      const base = { path: `${path}#tab-${n + 1}`, label: `${page.label} · 탭: ${name}`.slice(0, 80), viewport: desktop.name, tab: { index: n + 1, name } };
      if (clock() - startedAt >= budgetMs) {
        results.push({ ...base, status: 'NOT_TESTED', reason: 'BUDGET' });
        continue;
      }
      try {
        const click = await driver.clickTab(t.index);
        dirty = true;
        if (click.nonGetRequests > 0) {
          results.push({ ...base, status: 'BLOCKED', reason: 'TAB_NON_GET', capturedAt: clock() });
          break; // a tab that tries to write: stop clicking on this page
        }
        if (!click.clicked) {
          results.push({ ...base, status: 'ERROR', reason: 'MEASURE_FAILED' });
          continue;
        }
        if (click.urlChanged || click.navigations > 0) {
          results.push({ ...base, status: 'BLOCKED', reason: 'TAB_NAVIGATED', capturedAt: clock() });
          break; // not a same-page tab; the page is restored below
        }
        const stats = driver.resourceStats ? await driver.resourceStats().catch(() => null) : null;
        const metrics = await driver.layoutMetrics!();
        const capturedAt = clock();
        const env: AuditEnv = { emulated: false, blocked: stats?.blocked ?? NO_BLOCKED, fontsReady: stats?.fontsReady ?? true };
        const capture = input.capture ? await input.capture({ path: base.path, viewport: desktop }).catch(() => null) : null;
        results.push({ ...base, status: 'PASS', metrics, capturedAt, env, ...(capture ? { capture } : {}) });
      } catch {
        results.push({ ...base, status: 'ERROR', reason: 'MEASURE_FAILED' });
      }
    }
    // restore the original page (GET) so link discovery reads the page as observed
    if (dirty) await driver.goto(page.url).catch(() => undefined);
  }

  return { onPage, results, elapsedMs: () => clock() - startedAt };
}
