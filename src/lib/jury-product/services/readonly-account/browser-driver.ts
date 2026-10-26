/**
 * I-041 follow-up: real browser driver implementing ObservationDriver.
 *
 * Library choice: the repo has no browser automation dependency. Instead of adding one now (it would ship in the
 * Vercel bundle with the flag off), this adapter is written against a structural subset of the Playwright API.
 * At enablement the intended runtime is `playwright-core` + `@sparticuz/chromium` (no bundled browser download,
 * fits Vercel Functions size limits) — adding those dependencies is part of the approval list.
 *
 * Enforcement layers:
 * 1. context.route('**') sees every request of every page/frame (documents, XHR/fetch, subresources) → policy guard.
 * 2. The launcher must create the context with serviceWorkers: 'block' (service workers would bypass routing).
 * 3. Init script disables WebSocket, EventSource, sendBeacon, RTCPeerConnection and blocks form submit after login.
 */
import type { ObservationDriver, ObservedRequest, RequestVerdict } from './executor';

export interface PwRequest {
  method(): string;
  url(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
}
export interface PwRoute {
  request(): PwRequest;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}
export interface PwPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  inputValue(selector: string, options?: { timeout?: number }): Promise<string>;
  waitForSelector(selector: string, options?: { state?: 'attached' | 'visible'; timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForURL(url: (url: URL) => boolean, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<void>;
  waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void>;
  url(): string;
  evaluate<R>(fn: () => R): Promise<R>;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}
export interface PwContext {
  route(url: string, handler: (route: PwRoute) => Promise<void> | void): Promise<void>;
  addInitScript(script: { content: string }): Promise<void>;
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
/** Must return a context created with { serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true }. */
export type PwContextLauncher = () => Promise<PwContext>;

export const BLOCKED_RESOURCE_TYPES = new Set(['websocket', 'eventsource', 'ping', 'manifest']);
export const MAX_SNAPSHOT_CHARS = 20_000;
const TIMEOUT_MS = 15_000;
const LOGIN_IDLE_MS = 10_000;
const PAGE_IDLE_MS = 3_000;
const REFILL_DELAY_MS = 500;
/** I-050: per-page settle cap (network idle + text stability), keeps 20 pages well inside the ~200s budget. */
export const SETTLE_MAX_MS = 5_000;
export const SETTLE_POLL_MS = 400;
export const SETTLE_STABLE_CHECKS = 2;

/** Runs in the page. Kept as a string so it is not transpiled with Node globals. */
export const INIT_SCRIPT = `(() => {
  const deny = function () { throw new Error('blocked by Jury read-only policy'); };
  try { Object.defineProperty(window, 'WebSocket', { value: deny, configurable: false }); } catch (e) {}
  try { Object.defineProperty(window, 'EventSource', { value: deny, configurable: false }); } catch (e) {}
  try { Object.defineProperty(window, 'RTCPeerConnection', { value: deny, configurable: false }); } catch (e) {}
  try { Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: false }); } catch (e) {}
  try { if (navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, 'register', { value: () => Promise.reject(new Error('blocked')), configurable: false }); } catch (e) {}
  const blockSubmit = (ev) => { if (window.sessionStorage.getItem('__jury_block_submit') === '1') { ev.preventDefault(); ev.stopImmediatePropagation(); } };
  window.addEventListener('submit', blockSubmit, true);
  try { HTMLFormElement.prototype.submit = function () { if (window.sessionStorage.getItem('__jury_block_submit') !== '1') return HTMLFormElement.prototype.requestSubmit.call(this); }; } catch (e) {}
})();`;

export function toObservedRequest(req: PwRequest): ObservedRequest {
  const method = req.method().toUpperCase();
  const isNavigation = req.isNavigationRequest();
  const resourceType = req.resourceType();
  return { method, url: req.url(), isNavigation, isFormSubmit: isNavigation && resourceType === 'document' && method === 'POST', resourceType };
}

/**
 * I-055: only rendered widgets count. A hidden placeholder (display:none / visibility:hidden on itself or an ancestor,
 * or zero size) — e.g. a reCAPTCHA container a site only shows after a failed login — is not a challenge.
 */
export const CHALLENGE_PROBE = () => {
  type El = { getBoundingClientRect?(): { width: number; height: number }; parentElement?: El | null; getAttribute?(n: string): string | null };
  const g = globalThis as unknown as {
    document: { querySelectorAll(s: string): ArrayLike<El>; body?: { innerText?: string } };
    getComputedStyle?: (el: El) => { display?: string; visibility?: string };
  };
  const doc = g.document;
  const shown = (el: El) => {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
    if (!(r.width > 0 && r.height > 0)) return false;
    for (let cur: El | null | undefined = el; cur; cur = cur.parentElement) {
      const st = g.getComputedStyle ? g.getComputedStyle(cur) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse')) return false;
      if (cur.getAttribute && cur.getAttribute('hidden') !== null) return false;
    }
    return true;
  };
  const has = (s: string) => Array.from(doc.querySelectorAll(s)).some(shown);
  if (has('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile')) return 'CAPTCHA' as const;
  if (has('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i], input[name*="mfa" i]')) return 'TWO_FACTOR' as const;
  const text = (doc.body?.innerText ?? '').slice(0, 5000);
  if (/인증\\s*코드|인증번호|verification code|two-factor|2단계 인증/i.test(text)) return 'TWO_FACTOR' as const;
  return 'NONE' as const;
};

/** I-055: disabled attribute or aria-disabled="true" on the element (missing element = not disabled; click reports it). */
export const DISABLED_PROBE = (selector: string) => {
  const doc = (globalThis as unknown as { document: { querySelector(s: string): { disabled?: boolean; getAttribute(n: string): string | null } | null } }).document;
  const el = doc.querySelector(selector);
  if (!el) return false;
  return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
};
export const BUTTON_ENABLE_WAIT_MS = 3_000;

type ProbeEl = { href?: string; innerText?: string; title?: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; closest(s: string): unknown };
type ProbeDoc = { querySelectorAll(s: string): ArrayLike<ProbeEl> };

/** I-049: reads links only (href, short text, download attr, nav membership). Never clicks. Max 300 links. */
export const COLLECT_LINKS_PROBE = () => {
  const doc = (globalThis as unknown as { document: ProbeDoc }).document;
  const NAV = 'nav, header, aside, [role="navigation"], [role="menu"], [role="menubar"], [class*="sidebar" i], [class*="menu" i], [class*="nav" i]';
  const out: { href: string; text: string; download: boolean; nav: boolean }[] = [];
  const list = Array.from(doc.querySelectorAll('a[href]'));
  for (const a of list.slice(0, 300)) {
    const text = (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().slice(0, 80);
    out.push({ href: a.href ?? '', text, download: a.hasAttribute('download'), nav: Boolean(a.closest(NAV)) });
  }
  return out;
};

/** I-049: structural counts only (no text). */
export const PAGE_STATS_PROBE = () => {
  const doc = (globalThis as unknown as { document: ProbeDoc }).document;
  const count = (s: string) => doc.querySelectorAll(s).length;
  return {
    listItems: count('main li, [role="main"] li, [role="listitem"]') || count('li'),
    cards: count('[class*="card" i], article'),
    tableRows: count('tbody tr, [role="row"]'),
    headings: count('h1, h2, h3'),
  };
};

/** I-045: URL match first (SPA logins navigate via script after an async auth call), else network idle; total ≤ 15s. */
export async function waitAfterLoginClick(p: PwPage, waitFor?: { successPathPrefix: string; loginPath: string }, timeoutMs = TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(0, deadline - Date.now());
  if (waitFor) {
    const matched = await p
      .waitForURL((u) => u.pathname !== waitFor.loginPath && u.pathname.startsWith(waitFor.successPathPrefix), { timeout: left(), waitUntil: 'commit' })
      .then(() => true)
      .catch(() => false);
    if (matched) {
      await p.waitForLoadState('domcontentloaded', { timeout: left() }).catch(() => undefined);
      return;
    }
  }
  if (left() > 0) await p.waitForLoadState('networkidle', { timeout: left() }).catch(() => undefined);
}

/**
 * I-046: wait for the field to be visible (Playwright fill also waits for enabled/editable), fill, then read the
 * value back. Hydration can reset a controlled input, so re-fill once after a short delay. Values are never logged.
 */
export async function fillVerified(p: PwPage, selector: string, value: string): Promise<boolean> {
  await p.waitForSelector(selector, { state: 'visible', timeout: TIMEOUT_MS });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await p.waitForTimeout(REFILL_DELAY_MS);
    await p.fill(selector, value, { timeout: TIMEOUT_MS });
    const actual = await p.inputValue(selector, { timeout: TIMEOUT_MS }).catch(() => null);
    if (actual === value) return true;
  }
  return false;
}

/** I-050: body text length (no text leaves the page). */
export const TEXT_LENGTH_PROBE = () =>
  ((globalThis as unknown as { document: { body?: { innerText?: string } } }).document.body?.innerText ?? '').length;

/**
 * I-050: wait for a client-rendered page to settle before reading it. Bounded network idle, then poll the body text
 * length until it is non-empty and unchanged for SETTLE_STABLE_CHECKS consecutive polls. Never exceeds maxMs.
 * Returns the number of polls (for tests/diagnostics).
 */
export async function waitForSettle(p: PwPage, opts: { maxMs?: number; pollMs?: number; stableChecks?: number; now?: () => number } = {}): Promise<number> {
  const now = opts.now ?? Date.now;
  const maxMs = opts.maxMs ?? SETTLE_MAX_MS;
  const pollMs = opts.pollMs ?? SETTLE_POLL_MS;
  const need = opts.stableChecks ?? SETTLE_STABLE_CHECKS;
  const deadline = now() + maxMs;
  const left = () => Math.max(0, deadline - now());
  await p.waitForLoadState('networkidle', { timeout: Math.min(PAGE_IDLE_MS, left()) }).catch(() => undefined);
  let last = -1;
  let stable = 0;
  let polls = 0;
  while (left() > 0) {
    const raw = await p.evaluate(TEXT_LENGTH_PROBE).catch(() => -1);
    polls += 1;
    if (typeof raw !== 'number') break; // driver cannot measure → do not block
    if (raw > 0 && raw === last) {
      stable += 1;
      if (stable >= need) break;
    } else stable = 0;
    last = raw;
    if (left() <= 0) break;
    await p.waitForTimeout(Math.min(pollMs, left()));
  }
  return polls;
}

export function createBrowserObservationDriver(launch: PwContextLauncher): ObservationDriver {
  let context: PwContext | null = null;
  let page: PwPage | null = null;
  let guard: ((r: ObservedRequest) => RequestVerdict) | null = null;
  let loginClicked = false;
  const ensure = async () => {
    if (!context) {
      context = await launch();
      await context.addInitScript({ content: INIT_SCRIPT });
      await context.route('**/*', async (route) => {
        const req = route.request();
        if (BLOCKED_RESOURCE_TYPES.has(req.resourceType()) || !guard) return route.abort('blockedbyclient');
        return guard(toObservedRequest(req)) === 'allow' ? route.continue() : route.abort('blockedbyclient');
      });
      page = await context.newPage();
    }
    return page as PwPage;
  };
  return {
    async setRequestGuard(g) {
      guard = g;
      await ensure();
    },
    async goto(url, opts) {
      const p = await ensure();
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS }).catch(() => undefined);
      // I-046: let client JS hydrate the login form before typing (bounded; long-polling pages never go idle).
      if (opts?.login) await p.waitForLoadState('networkidle', { timeout: LOGIN_IDLE_MS }).catch(() => undefined);
      // I-049/I-050: bounded settle for post-login pages so client-rendered menus/lists exist before reading them.
      else await waitForSettle(p);
    },
    async fill(selector, value) {
      return fillVerified(await ensure(), selector, value);
    },
    async click(selector, waitFor) {
      const p = await ensure();
      if (loginClicked) throw new Error('only the single login click is allowed');
      loginClicked = true;
      await p.click(selector, { timeout: TIMEOUT_MS });
      await waitAfterLoginClick(p, waitFor);
      // I-050: the first post-login screen is client-rendered too; settle before it is read.
      await waitForSettle(p);
      await p.evaluate(() => (globalThis as unknown as { sessionStorage: { setItem(k: string, v: string): void } }).sessionStorage.setItem('__jury_block_submit', '1')).catch(() => undefined);
    },
    async currentUrl() {
      return (await ensure()).url();
    },
    async detectChallenge() {
      return (await ensure()).evaluate(CHALLENGE_PROBE).catch(() => 'NONE' as const);
    },
    async isDisabled(selector) {
      const p = await ensure();
      const deadline = Date.now() + BUTTON_ENABLE_WAIT_MS;
      for (;;) {
        const disabled = (await p.evaluate(DISABLED_PROBE, selector).catch(() => false)) === true;
        if (!disabled || Date.now() >= deadline) return disabled;
        await p.waitForTimeout(SETTLE_POLL_MS);
      }
    },
    async snapshotText() {
      const text = await (await ensure()).evaluate(
        () => (globalThis as unknown as { document: { body?: { innerText?: string } } }).document.body?.innerText ?? '',
      );
      return text.slice(0, MAX_SNAPSHOT_CHARS);
    },
    async collectLinks() {
      return (await ensure()).evaluate(COLLECT_LINKS_PROBE).catch(() => []);
    },
    async pageStats() {
      return (await ensure()).evaluate(PAGE_STATS_PROBE).catch(() => ({ listItems: 0, cards: 0, tableRows: 0, headings: 0 }));
    },
    async close() {
      const c = context;
      context = null;
      page = null;
      if (c) await c.close();
    },
  };
}
