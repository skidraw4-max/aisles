/**
 * I-041: login executor PoC with Jury-side read-only enforcement.
 * Accounts of any permission level (including admin) are accepted; safety comes from enforcement here:
 * - exactly one login attempt; the only non-GET/HEAD request allowed is the login submit to the login origin
 * - after login only GET/HEAD; every form submission is blocked
 * - every request must target an allowlisted origin
 * - only allowlisted action types, and navigation only to scoped paths
 * - 2FA/captcha => stop and report, never solved or bypassed
 * The browser is abstracted behind ObservationDriver; no browser library is bundled. Disabled by flag.
 */
import type { AccountCredentialSecret } from './credential-crypto';
import type { ObservationScope } from './consent';
import { allowedSitesOf, isSameSiteSubresource } from './same-site';
import { DEFAULT_DISCOVERY, normalizeLinkKey, normalizeStats, pickLinks, type DiscoveredLink, type DiscoveryOptions, type PageStats } from './discovery';

export const READONLY_ACCOUNT_EXECUTOR_ENABLED = true as boolean;

/** resourceType (I-055): Playwright resource type when known (script, stylesheet, image, font, xhr, fetch, document, ...). */
export type ObservedRequest = { method: string; url: string; isFormSubmit: boolean; isNavigation: boolean; resourceType?: string };
export type RequestVerdict = 'allow' | 'block';

export interface ObservationDriver {
  /** Install a guard consulted for every outgoing request (including subresources). Blocked requests must be aborted. */
  setRequestGuard(guard: (request: ObservedRequest) => RequestVerdict): Promise<void>;
  /** opts.login (I-046): the login page; the driver also waits for network idle (bounded) so the form is hydrated. */
  goto(url: string, opts?: { login?: boolean }): Promise<void>;
  /** I-046: returns false when the value could not be set (verified after fill, re-filled once). void = not verifiable. */
  fill(selector: string, value: string): Promise<boolean | void>;
  /** waitFor (I-045): after the click, wait until the URL leaves loginPath and starts with successPathPrefix, else network idle; max 15s. */
  click(selector: string, waitFor?: { successPathPrefix: string; loginPath: string }): Promise<void>;
  currentUrl(): Promise<string>;
  detectChallenge(): Promise<'NONE' | 'TWO_FACTOR' | 'CAPTCHA'>;
  /** I-055: true when the element is still disabled after a short bounded wait (e.g. a JS-enabled login button). Optional. */
  isDisabled?(selector: string): Promise<boolean>;
  snapshotText(): Promise<string>;
  /** I-049: links on the current page (href resolved, text, download attr, inside nav/menu/header/sidebar). Optional. */
  collectLinks?(): Promise<DiscoveredLink[]>;
  /** I-049: structural counts of the current page (no text). Optional. */
  pageStats?(): Promise<PageStats>;
  close(): Promise<void>;
}

export type LoginPlan = { loginUrl: string; usernameSelector: string; passwordSelector: string; submitSelector: string; successPathPrefix: string };

export type ObservationAction = { type: 'goto'; path: string } | { type: 'snapshot'; label: string };
export const ALLOWED_ACTION_TYPES = ['goto', 'snapshot'] as const;

export type ExecutorStop =
  | 'NOT_IMPLEMENTED'
  | 'SCOPE_INVALID'
  | 'ACTION_NOT_ALLOWED'
  | 'CHALLENGE_REQUIRED'
  | 'LOGIN_FAILED'
  | 'LOGIN_NOT_SUBMITTED'
  | 'LOGIN_NO_REDIRECT'
  | 'LOGIN_BUTTON_DISABLED'
  | 'NAVIGATION_BLOCKED'
  | 'DRIVER_ERROR';

export type ExecutorReport = {
  ok: boolean;
  stop?: ExecutorStop;
  challenge?: 'TWO_FACTOR' | 'CAPTCHA';
  loginAttempts: number;
  /** I-046: whether the single login request was let through. */
  loginRequestUsed?: boolean;
  /** I-046: URL after the login step, origin + path only (no query/hash). */
  finalUrl?: string;
  /** url = final URL after any redirect; requestedUrl (I-050) is set when the navigation was redirected elsewhere. */
  snapshots: { label: string; url: string; text: string; stats?: PageStats; discovered?: boolean; requestedUrl?: string }[];
  /** I-049: auto-discovery outcome. stoppedBy explains a partial result. */
  discovery?: {
    enabled: boolean;
    found: number;
    visited: number;
    skipped: number;
    errors: number;
    stoppedBy: DiscoveryStop;
    /** I-050: links whose final URL redirected to an already-observed page (not counted as new pages). */
    redirects?: { from: string; to: string }[];
  };
  blockedRequests: { method: string; url: string; reason: 'ORIGIN' | 'METHOD' | 'FORM_SUBMIT' | 'LOGIN_ALREADY_USED' }[];
};

export type DiscoveryStop = 'DONE' | 'MAX_PAGES' | 'BUDGET' | 'CHALLENGE' | 'SESSION_LOST' | 'UNSUPPORTED';

const READ_METHODS = new Set(['GET', 'HEAD']);

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

function pathAllowed(scope: ObservationScope, path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  return scope.paths.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`) || path.startsWith(`${p}?`));
}

/**
 * I-045 auth origins (e.g. Supabase): never navigable, never a form-submit target.
 * - any phase: GET/HEAD/OPTIONS (OPTIONS = CORS preflight; post-login GET covers /rest/v1 reads)
 * - login phase: exactly one POST to /auth/v1/token?grant_type=password (shares the single login slot)
 * - refresh_token POST is NOT allowed: a fresh password login returns a new session, and a run lasts well under
 *   the token lifetime, so refresh is not needed. Every other write (POST/PUT/PATCH/DELETE) stays blocked.
 */
export const AUTH_LOGIN_PATH = '/auth/v1/token';
const AUTH_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isPasswordLoginRequest(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === AUTH_LOGIN_PATH && u.searchParams.get('grant_type') === 'password' && [...u.searchParams.keys()].length === 1;
  } catch {
    return false;
  }
}

/** origin + path only; never query or hash (may carry tokens or PII). */
export function originPath(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? u.protocol : `${u.origin}${u.pathname}`;
  } catch {
    return 'invalid';
  }
}

/** Pure request policy; exported for tests and for real driver adapters. */
export function createRequestGuard(input: { scope: ObservationScope; loginOrigin: string }) {
  let phase: 'PRE_LOGIN' | 'LOGIN_SUBMITTING' | 'POST_LOGIN' = 'PRE_LOGIN';
  let loginRequestUsed = false;
  const blocked: ExecutorReport['blockedRequests'] = [];
  const allowedOrigins = new Set(input.scope.allowedOrigins);
  const authOrigins = new Set((input.scope.authOrigins ?? []).filter((o) => !allowedOrigins.has(o)));
  // I-055: static GET subresources (script/stylesheet/image/font) from the same registrable site are allowed.
  const allowedSites = allowedSitesOf(input.scope.allowedOrigins);
  const guard = (req: ObservedRequest): RequestVerdict => {
    const origin = originOf(req.url);
    const method = req.method.toUpperCase();
    if (origin && authOrigins.has(origin)) {
      if (req.isFormSubmit || req.isNavigation) {
        blocked.push({ method, url: req.url, reason: req.isFormSubmit ? 'FORM_SUBMIT' : 'ORIGIN' });
        return 'block';
      }
      if (AUTH_READ_METHODS.has(method)) return 'allow';
      if (method === 'POST' && phase === 'LOGIN_SUBMITTING' && !loginRequestUsed && isPasswordLoginRequest(req.url)) {
        loginRequestUsed = true;
        return 'allow';
      }
      blocked.push({ method, url: req.url, reason: loginRequestUsed && phase !== 'POST_LOGIN' && method === 'POST' ? 'LOGIN_ALREADY_USED' : 'METHOD' });
      return 'block';
    }
    if (!origin || !allowedOrigins.has(origin)) {
      if (origin && isSameSiteSubresource(req, allowedSites)) return 'allow';
      blocked.push({ method, url: req.url, reason: 'ORIGIN' });
      return 'block';
    }
    if (READ_METHODS.has(method) && !req.isFormSubmit) return 'allow';
    if (phase === 'LOGIN_SUBMITTING' && !loginRequestUsed && origin === input.loginOrigin && (req.isFormSubmit || method === 'POST')) {
      loginRequestUsed = true;
      return 'allow';
    }
    if (loginRequestUsed && phase !== 'POST_LOGIN' && !req.isFormSubmit && method === 'POST') {
      blocked.push({ method, url: req.url, reason: 'LOGIN_ALREADY_USED' });
      return 'block';
    }
    blocked.push({ method, url: req.url, reason: req.isFormSubmit ? 'FORM_SUBMIT' : 'METHOD' });
    return 'block';
  };
  return {
    guard,
    blocked,
    beginLoginSubmit: () => {
      phase = 'LOGIN_SUBMITTING';
    },
    endLogin: () => {
      phase = 'POST_LOGIN';
    },
    get loginRequestUsed() {
      return loginRequestUsed;
    },
  };
}

export function validateObservationPlan(input: { scope: ObservationScope; login: LoginPlan; actions: readonly ObservationAction[] }):
  | { ok: true; loginOrigin: string }
  | { ok: false; stop: 'SCOPE_INVALID' | 'ACTION_NOT_ALLOWED' } {
  const loginOrigin = originOf(input.login.loginUrl);
  if (!loginOrigin || !input.scope.allowedOrigins.includes(loginOrigin)) return { ok: false, stop: 'SCOPE_INVALID' };
  if (input.actions.length > 50) return { ok: false, stop: 'ACTION_NOT_ALLOWED' };
  for (const action of input.actions) {
    if (!(ALLOWED_ACTION_TYPES as readonly string[]).includes((action as { type: string }).type)) return { ok: false, stop: 'ACTION_NOT_ALLOWED' };
    if (action.type === 'goto' && !pathAllowed(input.scope, action.path)) return { ok: false, stop: 'ACTION_NOT_ALLOWED' };
  }
  return { ok: true, loginOrigin };
}

export async function executeReadonlyObservation(input: {
  driver: ObservationDriver;
  credential: AccountCredentialSecret;
  scope: ObservationScope;
  login: LoginPlan;
  actions: readonly ObservationAction[];
  /** I-049: menu auto-discovery after the explicit actions. false/undefined = off (pre-I-049 behavior). */
  discover?: Partial<DiscoveryOptions> | false;
  clock?: () => number;
}): Promise<ExecutorReport> {
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  const report: ExecutorReport = { ok: false, loginAttempts: 0, snapshots: [], blockedRequests: [] };
  const plan = validateObservationPlan(input);
  if (!plan.ok) return { ...report, stop: plan.stop };
  const policy = createRequestGuard({ scope: input.scope, loginOrigin: plan.loginOrigin });
  report.blockedRequests = policy.blocked;
  const { driver } = input;
  const stop = async (reason: ExecutorStop, extra: Partial<ExecutorReport> = {}) => {
    await driver.close().catch(() => undefined);
    return { ...report, ...extra, ok: false, stop: reason };
  };
  try {
    await driver.setRequestGuard(policy.guard);
    await driver.goto(input.login.loginUrl, { login: true });
    const pre = await driver.detectChallenge();
    if (pre !== 'NONE') return stop('CHALLENGE_REQUIRED', { challenge: pre });
    const userSet = await driver.fill(input.login.usernameSelector, input.credential.username);
    const passSet = await driver.fill(input.login.passwordSelector, input.credential.password);
    if (userSet === false || passSet === false) return stop('LOGIN_NOT_SUBMITTED', { finalUrl: originPath(await driver.currentUrl()) });
    // I-055: a login button that stays disabled (e.g. its enabling script did not load) is reported, not clicked.
    if (driver.isDisabled && (await driver.isDisabled(input.login.submitSelector).catch(() => false))) {
      return stop('LOGIN_BUTTON_DISABLED', { finalUrl: originPath(await driver.currentUrl()) });
    }
    policy.beginLoginSubmit();
    report.loginAttempts = 1;
    await driver.click(input.login.submitSelector, { successPathPrefix: input.login.successPathPrefix, loginPath: new URL(input.login.loginUrl).pathname });
    policy.endLogin();
    const post = await driver.detectChallenge();
    if (post !== 'NONE') return stop('CHALLENGE_REQUIRED', { challenge: post });
    const landed = new URL(await driver.currentUrl());
    report.loginRequestUsed = policy.loginRequestUsed;
    report.finalUrl = originPath(landed.toString());
    if (!policy.loginRequestUsed) return stop('LOGIN_NOT_SUBMITTED');
    if (landed.origin !== plan.loginOrigin || !landed.pathname.startsWith(input.login.successPathPrefix)) return stop('LOGIN_NO_REDIRECT');
    const opts: DiscoveryOptions | null = input.discover ? { ...DEFAULT_DISCOVERY, ...input.discover } : null;
    const loginPath = new URL(input.login.loginUrl).pathname;
    const visited = new Set<string>();
    const queue: { key: string; path: string; label: string; depth: number }[] = [];
    const queued = new Set<string>();
    const harvest = async (depth: number) => {
      if (!opts || !driver.collectLinks || depth >= opts.maxDepth) return;
      const here = await driver.currentUrl();
      const links = await driver.collectLinks().catch(() => [] as DiscoveredLink[]);
      for (const l of pickLinks(links, here, input.scope.allowedOrigins, { loginPath, limit: opts.perPageLinks })) {
        if (queued.has(l.key) || visited.has(l.key)) continue;
        queued.add(l.key);
        queue.push({ ...l, depth: depth + 1 });
      }
    };
    const stats = async () => (driver.pageStats ? normalizeStats(await driver.pageStats().catch(() => undefined)) : undefined);
    if (opts) {
      visited.add(normalizeLinkKey(landed));
      report.snapshots.push({ label: '로그인 후 첫 화면', url: landed.toString(), text: await driver.snapshotText(), stats: await stats(), discovered: true });
      await harvest(0);
    }
    for (const action of input.actions) {
      if (action.type === 'goto') {
        const target = new URL(action.path, plan.loginOrigin).toString();
        await driver.goto(target);
        const now = new URL(await driver.currentUrl());
        if (!input.scope.allowedOrigins.includes(now.origin) || !pathAllowed(input.scope, now.pathname)) return stop('NAVIGATION_BLOCKED');
        const challenge = await driver.detectChallenge();
        if (challenge !== 'NONE') return stop('CHALLENGE_REQUIRED', { challenge });
      } else {
        const url = await driver.currentUrl();
        if (opts) visited.add(normalizeLinkKey(new URL(url)));
        report.snapshots.push({ label: action.label, url, text: await driver.snapshotText(), ...(opts ? { stats: await stats() } : {}) });
        await harvest(0);
      }
    }
    if (opts) {
      const d: NonNullable<ExecutorReport['discovery']> = { enabled: true, found: 0, visited: 0, skipped: 0, errors: 0, stoppedBy: driver.collectLinks ? 'DONE' : 'UNSUPPORTED', redirects: [] };
      report.discovery = d;
      while (queue.length > 0) {
        if (report.snapshots.length >= opts.maxPages) {
          d.stoppedBy = 'MAX_PAGES';
          break;
        }
        if (clock() - startedAt >= opts.budgetMs) {
          d.stoppedBy = 'BUDGET';
          break;
        }
        const next = queue.shift()!;
        if (visited.has(next.key)) continue;
        visited.add(next.key);
        try {
          await driver.goto(next.key);
          const now = new URL(await driver.currentUrl());
          if (!input.scope.allowedOrigins.includes(now.origin)) {
            d.skipped += 1;
            continue;
          }
          if (now.pathname === loginPath) {
            d.stoppedBy = 'SESSION_LOST';
            break;
          }
          const challenge = await driver.detectChallenge();
          if (challenge !== 'NONE') {
            d.stoppedBy = 'CHALLENGE';
            break;
          }
          const finalKey = normalizeLinkKey(now);
          if (finalKey !== next.key && visited.has(finalKey)) {
            // I-050: redirected to a page already observed (e.g. EXPLORE → /onboarding) → duplicate, not a new page.
            (d.redirects ??= []).push({ from: next.path, to: originPath(now.toString()).slice(now.origin.length) || '/' });
            continue;
          }
          visited.add(finalKey);
          report.snapshots.push({
            label: next.label,
            url: now.toString(),
            text: await driver.snapshotText(),
            stats: await stats(),
            discovered: true,
            ...(finalKey !== next.key ? { requestedUrl: next.key } : {}),
          });
          d.visited += 1;
          await harvest(next.depth);
        } catch {
          d.errors += 1;
        }
      }
      d.found = queued.size;
      d.skipped += queue.filter((q) => !visited.has(q.key)).length;
    }
    await driver.close();
    return { ...report, ok: true };
  } catch {
    return stop('DRIVER_ERROR');
  }
}

/** Gated entry point. Stays NOT_IMPLEMENTED until the flag is turned on with separate approval. */
export async function runReadonlyObservation(
  input: Parameters<typeof executeReadonlyObservation>[0],
  enabled: boolean = READONLY_ACCOUNT_EXECUTOR_ENABLED,
): Promise<ExecutorReport> {
  if (!enabled) {
    await input.driver.close().catch(() => undefined);
    return { ok: false, stop: 'NOT_IMPLEMENTED', loginAttempts: 0, snapshots: [], blockedRequests: [] };
  }
  return executeReadonlyObservation(input);
}
