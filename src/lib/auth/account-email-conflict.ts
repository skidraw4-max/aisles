/**
 * Client/server-safe helpers for the sync-profile ACCOUNT_EMAIL_CONFLICT outcome.
 * No server text, email, id, or token is ever surfaced: only fixed codes/messages.
 */

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

/** Login page notice for `?error=account_email_conflict`; null otherwise. */
export function accountEmailConflictNotice(errorParam: string | null): { type: 'err'; text: string } | null {
  return errorParam === ACCOUNT_EMAIL_CONFLICT_QUERY ? { type: 'err', text: ACCOUNT_EMAIL_CONFLICT_MESSAGE } : null;
}
