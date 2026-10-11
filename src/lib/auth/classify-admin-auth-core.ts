/**
 * Pure admin-auth classifier (diagnostics use). No Prisma, DB, cookies or network here:
 * the caller injects getUser/findRole. Results carry fixed codes only, never error text.
 *
 * Policy (fail-closed):
 *  - UNAUTHORIZED (401) only for clearly identified rejections (allowlist below).
 *  - Any other Auth outcome (retryable fetch, 5xx, unknown, other/ambiguous 4xx, thrown)
 *    => AUTH_UNAVAILABLE (503).
 *  - getUser OK but no user and no error => UNAUTHORIZED.
 *  - findRole throws => DB_UNAVAILABLE (503); role !== 'ADMIN' or null => FORBIDDEN (403).
 *
 * 401 allowlist, verified against installed @supabase/auth-js 2.102.1:
 *  - AuthSessionMissingError (lib/errors.js: status 400, no code), via isAuthSessionMissingError.
 *  - AuthApiError (lib/fetch.js handleError: non-502/503/504 HTTP error with JSON body), via
 *    isAuthApiError, only when BOTH status and code match:
 *      status 401|403|404 and code in SESSION_REJECT_CODES
 *      status 400        and code in REFRESH_REJECT_CODES (refresh during _useSession)
 *    Codes come from lib/error-codes.d.ts (ErrorCode union).
 */
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';

export type AdminAuthCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'AUTH_UNAVAILABLE' | 'DB_UNAVAILABLE';
export type AdminAuthClass = { ok: true; userId: string } | { ok: false; code: AdminAuthCode };

export type GetUserResult = { data?: { user?: { id?: unknown } | null } | null; error?: unknown };

export type ClassifyAdminAuthDeps = {
  getUser: () => Promise<GetUserResult>;
  findRole: (userId: string) => Promise<string | null | undefined>;
  /** Fixed-code logger. Defaults to console.error with a fixed tag. */
  log?: (line: string) => void;
  /** Prisma error codes (/^P\d{4}$/) allowed to be appended to the DB log line. Default: none. */
  logPrismaCodes?: readonly string[];
};

export const SESSION_REJECT_STATUSES: readonly number[] = Object.freeze([401, 403, 404]);
export const SESSION_REJECT_CODES: readonly string[] = Object.freeze([
  'bad_jwt',
  'no_authorization',
  'session_not_found',
  'session_expired',
  'user_not_found',
]);
export const REFRESH_REJECT_CODES: readonly string[] = Object.freeze([
  'refresh_token_not_found',
  'refresh_token_already_used',
]);

const TAG = '[classifyAdminAuth]';
const PRISMA_CODE = /^P\d{4}$/;

/** true only for allowlisted, clearly-identified session rejections. */
export function isClearAuthRejection(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthApiError(error)) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (typeof status !== 'number' || typeof code !== 'string') return false;
  if (SESSION_REJECT_STATUSES.includes(status) && SESSION_REJECT_CODES.includes(code)) return true;
  if (status === 400 && REFRESH_REJECT_CODES.includes(code)) return true;
  return false;
}

export async function classifyAdminAuthCore(deps: ClassifyAdminAuthDeps): Promise<AdminAuthClass> {
  const log = deps.log ?? ((line: string) => console.error(line));

  let res: GetUserResult;
  try {
    res = await deps.getUser();
  } catch {
    log(`${TAG} AUTH_UNAVAILABLE`);
    return { ok: false, code: 'AUTH_UNAVAILABLE' };
  }

  const error = res?.error;
  if (error !== null && error !== undefined) {
    if (isClearAuthRejection(error)) return { ok: false, code: 'UNAUTHORIZED' };
    log(`${TAG} AUTH_UNAVAILABLE`);
    return { ok: false, code: 'AUTH_UNAVAILABLE' };
  }

  const id = res?.data?.user?.id;
  if (typeof id !== 'string' || id.length === 0) return { ok: false, code: 'UNAUTHORIZED' };

  let role: string | null | undefined;
  try {
    role = await deps.findRole(id);
  } catch (e) {
    const allowed = deps.logPrismaCodes ?? [];
    const c = (e as { code?: unknown } | null)?.code;
    const suffix = typeof c === 'string' && PRISMA_CODE.test(c) && allowed.includes(c) ? ` ${c}` : '';
    log(`${TAG} DB_UNAVAILABLE${suffix}`);
    return { ok: false, code: 'DB_UNAVAILABLE' };
  }

  if (role !== 'ADMIN') return { ok: false, code: 'FORBIDDEN' };
  return { ok: true, userId: id };
}
