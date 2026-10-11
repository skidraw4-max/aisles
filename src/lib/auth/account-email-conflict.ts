/**
 * Client/server-safe helpers for the sync-profile ACCOUNT_EMAIL_CONFLICT outcome.
 * No server text, email, id, or token is ever surfaced: only fixed codes/messages.
 */
import { AUTH_CALLBACK_EMAIL_QUERY, AUTH_CALLBACK_SIGNIN_QUERY } from './auth-callback-error';

export const ACCOUNT_EMAIL_CONFLICT_CODE = 'ACCOUNT_EMAIL_CONFLICT' as const;
/** Login page `?error=` value used by the auth callback on conflict. */
export const ACCOUNT_EMAIL_CONFLICT_QUERY = 'account_email_conflict' as const;
export const ACCOUNT_EMAIL_CONFLICT_MESSAGE =
  '이 이메일에 연결된 기존 계정이 있어 프로필을 동기화할 수 없습니다. 관리자에게 문의해 주세요.';

export class AccountEmailConflictError extends Error {
  readonly code = ACCOUNT_EMAIL_CONFLICT_CODE;
  constructor() {
    super(ACCOUNT_EMAIL_CONFLICT_MESSAGE);
    this.name = 'AccountEmailConflictError';
  }
}

export function isAccountEmailConflictError(e: unknown): e is AccountEmailConflictError {
  return e instanceof AccountEmailConflictError;
}

/** Conflict only when status is exactly 409 AND the JSON body code matches. */
export function isAccountEmailConflictPayload(status: number, body: unknown): boolean {
  return (
    status === 409 &&
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === ACCOUNT_EMAIL_CONFLICT_CODE
  );
}

/** Reads a sync-profile Response (or null on network failure). Never throws. */
export async function isAccountEmailConflictResponse(res: Response | null | undefined): Promise<boolean> {
  if (!res || res.status !== 409) return false;
  const body = await res.json().catch(() => null);
  return isAccountEmailConflictPayload(res.status, body);
}

/**
 * Runs a profile sync for UI callers. Conflict => 'conflict' (caller shows the fixed
 * message and must not navigate as if login fully succeeded). Any other failure keeps
 * the previous behavior: warn with a fixed tag and continue ('proceed').
 */
export async function runProfileSync(
  sync: (token: string) => Promise<unknown>,
  token: string,
  warn: (tag: string, detail: string) => void = (tag, detail) => console.warn(tag, detail),
  tag = '[auth] profile sync deferred failed:',
): Promise<'proceed' | 'conflict'> {
  try {
    await sync(token);
    return 'proceed';
  } catch (err: unknown) {
    if (isAccountEmailConflictError(err)) return 'conflict';
    warn(tag, err instanceof Error ? err.message : String(err));
    return 'proceed';
  }
}

/**
 * In-memory guard for SessionProvider's background profile sync. After a conflict for a
 * user id, further background syncs for that same id are skipped until the user changes,
 * signs out (reset), or the page reloads. Nothing is persisted. Other failures never block.
 */
export function createProfileSyncGate() {
  let blockedUserId: string | null = null;
  return {
    shouldSync: (userId: string) => blockedUserId !== userId,
    record(userId: string, conflict: boolean) {
      if (conflict) blockedUserId = userId;
      else if (blockedUserId === userId) blockedUserId = null;
    },
    reset() {
      blockedUserId = null;
    },
  };
}
export type ProfileSyncGate = ReturnType<typeof createProfileSyncGate>;

/** Background sync through the gate. Network failure => 'failed' (not blocking, retried next time). */
export async function syncProfileWithGate(
  gate: ProfileSyncGate,
  userId: string,
  call: () => Promise<Response>,
): Promise<'skipped' | 'conflict' | 'synced' | 'failed'> {
  if (!gate.shouldSync(userId)) return 'skipped';
  let res: Response;
  try {
    res = await call();
  } catch {
    return 'failed';
  }
  const conflict = await isAccountEmailConflictResponse(res);
  gate.record(userId, conflict);
  return conflict ? 'conflict' : res.ok ? 'synced' : 'failed';
}

/** Login page text for `?error=auth_callback` (shared by the hub and Jury login pages). */
export const AUTH_CALLBACK_EMAIL_ERROR =
  '이메일 인증 링크가 만료되었거나 이미 사용되었습니다. 다시 로그인하거나 회원가입 후 새 인증 메일을 받아 주세요.';

/** Login page text for `?error=oauth_callback`. Generic: the cause is not asserted. */
export const AUTH_CALLBACK_SIGNIN_ERROR =
  '로그인을 완료하지 못했습니다. 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.';

/** Jury login notice when the Jury store cannot be read (no redirect). */
export const JURY_LOGIN_STORE_UNAVAILABLE_NOTICE =
  '일시적으로 Jury 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.';

/** Fixed text for an auth callback `?error=` value; null for anything else. */
export function authCallbackFailureText(errorParam: string | null): string | null {
  if (errorParam === AUTH_CALLBACK_EMAIL_QUERY) return AUTH_CALLBACK_EMAIL_ERROR;
  if (errorParam === AUTH_CALLBACK_SIGNIN_QUERY) return AUTH_CALLBACK_SIGNIN_ERROR;
  return null;
}

/** Login page notice for `?error=account_email_conflict`; null otherwise. */
export function accountEmailConflictNotice(errorParam: string | null): { type: 'err'; text: string } | null {
  return errorParam === ACCOUNT_EMAIL_CONFLICT_QUERY ? { type: 'err', text: ACCOUNT_EMAIL_CONFLICT_MESSAGE } : null;
}

/** Jury login page notice: conflict first, then auth callback failures; null otherwise (one notice only). */
export function juryLoginErrorNotice(errorParam: string | null): string | null {
  const conflict = accountEmailConflictNotice(errorParam);
  if (conflict) return conflict.text;
  return authCallbackFailureText(errorParam);
}
