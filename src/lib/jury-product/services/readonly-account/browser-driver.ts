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
const REFILL_DELAY_MS = 500;

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
  return { method, url: req.url(), isNavigation, isFormSubmit: isNavigation && req.resourceType() === 'document' && method === 'POST' };
}

export const CHALLENGE_PROBE = () => {
  const doc = (globalThis as unknown as { document: { querySelector(s: string): unknown; body?: { innerText?: string } } }).document;
  const has = (s: string) => Boolean(doc.querySelector(s));
  if (has('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile')) return 'CAPTCHA' as const;
  if (has('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i], input[name*="mfa" i]')) return 'TWO_FACTOR' as const;
  const text = (doc.body?.innerText ?? '').slice(0, 5000);
  if (/인증\\s*코드|인증번호|verification code|two-factor|2단계 인증/i.test(text)) return 'TWO_FACTOR' as const;
  return 'NONE' as const;
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
      await p.evaluate(() => (globalThis as unknown as { sessionStorage: { setItem(k: string, v: string): void } }).sessionStorage.setItem('__jury_block_submit', '1')).catch(() => undefined);
    },
    async currentUrl() {
      return (await ensure()).url();
    },
    async detectChallenge() {
      return (await ensure()).evaluate(CHALLENGE_PROBE).catch(() => 'NONE' as const);
    },
    async snapshotText() {
      const text = await (await ensure()).evaluate(
        () => (globalThis as unknown as { document: { body?: { innerText?: string } } }).document.body?.innerText ?? '',
      );
      return text.slice(0, MAX_SNAPSHOT_CHARS);
    },
    async close() {
      const c = context;
      context = null;
      page = null;
      if (c) await c.close();
    },
  };
}
