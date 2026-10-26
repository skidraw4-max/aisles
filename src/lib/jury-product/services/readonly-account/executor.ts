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

export const READONLY_ACCOUNT_EXECUTOR_ENABLED = true as boolean;

export type ObservedRequest = { method: string; url: string; isFormSubmit: boolean; isNavigation: boolean };
export type RequestVerdict = 'allow' | 'block';

export interface ObservationDriver {
  /** Install a guard consulted for every outgoing request (including subresources). Blocked requests must be aborted. */
  setRequestGuard(guard: (request: ObservedRequest) => RequestVerdict): Promise<void>;
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  currentUrl(): Promise<string>;
  detectChallenge(): Promise<'NONE' | 'TWO_FACTOR' | 'CAPTCHA'>;
  snapshotText(): Promise<string>;
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
  | 'NAVIGATION_BLOCKED'
  | 'DRIVER_ERROR';

export type ExecutorReport = {
  ok: boolean;
  stop?: ExecutorStop;
  challenge?: 'TWO_FACTOR' | 'CAPTCHA';
  loginAttempts: number;
  snapshots: { label: string; url: string; text: string }[];
  blockedRequests: { method: string; url: string; reason: 'ORIGIN' | 'METHOD' | 'FORM_SUBMIT' | 'LOGIN_ALREADY_USED' }[];
};

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

/** Pure request policy; exported for tests and for real driver adapters. */
export function createRequestGuard(input: { scope: ObservationScope; loginOrigin: string }) {
  let phase: 'PRE_LOGIN' | 'LOGIN_SUBMITTING' | 'POST_LOGIN' = 'PRE_LOGIN';
  let loginRequestUsed = false;
  const blocked: ExecutorReport['blockedRequests'] = [];
  const allowedOrigins = new Set(input.scope.allowedOrigins);
  const guard = (req: ObservedRequest): RequestVerdict => {
    const origin = originOf(req.url);
    const method = req.method.toUpperCase();
    if (!origin || !allowedOrigins.has(origin)) {
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
}): Promise<ExecutorReport> {
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
    await driver.goto(input.login.loginUrl);
    const pre = await driver.detectChallenge();
    if (pre !== 'NONE') return stop('CHALLENGE_REQUIRED', { challenge: pre });
    await driver.fill(input.login.usernameSelector, input.credential.username);
    await driver.fill(input.login.passwordSelector, input.credential.password);
    policy.beginLoginSubmit();
    report.loginAttempts = 1;
    await driver.click(input.login.submitSelector);
    policy.endLogin();
    const post = await driver.detectChallenge();
    if (post !== 'NONE') return stop('CHALLENGE_REQUIRED', { challenge: post });
    const landed = new URL(await driver.currentUrl());
    if (!policy.loginRequestUsed || landed.origin !== plan.loginOrigin || !landed.pathname.startsWith(input.login.successPathPrefix)) {
      return stop('LOGIN_FAILED');
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
        report.snapshots.push({ label: action.label, url: await driver.currentUrl(), text: await driver.snapshotText() });
      }
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
