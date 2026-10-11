import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { ACCOUNT_EMAIL_CONFLICT_QUERY, isAccountEmailConflictResponse } from '@/lib/auth/account-email-conflict';
import { safeRelativePath } from '@/lib/auth/auth-redirect';
import {
  AUTH_CALLBACK_FLOW_PARAM,
  authCallbackFailureQuery,
  authCallbackLogLine,
  isEmailLinkFlow,
  safeAuthErrorCode,
  type AuthCallbackFailure,
} from '@/lib/auth/auth-callback-error';

type Options =
  | { afterSuccess: 'fromNextQueryOrHome' }
  | { afterSuccess: 'fixed'; path: string };

/**
 * Supabase 이메일·PKCE 콜백 공통 처리.
 * `fixed` → 쿼리의 `next`와 무관하게 항상 `path`로 이동 (비밀번호 찾기 등, redirectTo 쿼리가 지워지는 경우 대비).
 */
export async function supabaseAuthCallbackGet(
  request: Request,
  options: Options,
  /** Test seam only; production callers omit it. */
  deps: { createClient?: typeof createClient } = {},
): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next');
  // Message selection only: never affects success, session, next, or conflict handling.
  const emailFlow = isEmailLinkFlow(url.searchParams.get(AUTH_CALLBACK_FLOW_PARAM));

  const successPath =
    options.afterSuccess === 'fixed'
      ? options.path
      : safeRelativePath(nextParam, '/');

  // Fixed `?error=` value plus a log line with only the classification and allowlisted codes.
  const fail = (kind: AuthCallbackFailure, detail?: { error?: unknown; errorCode?: unknown }) => {
    console.error('[auth/callback] failed:', authCallbackLogLine(kind, { ...detail, emailFlow }));
    return NextResponse.redirect(
      new URL(`/login?error=${authCallbackFailureQuery(kind, options.afterSuccess === 'fixed' || emailFlow)}`, url.origin),
    );
  };
  // Profile email conflict: only for normal sign-in flows; fixed-path flows (password reset) are unchanged.
  const conflict = () => NextResponse.redirect(new URL(`/login?error=${ACCOUNT_EMAIL_CONFLICT_QUERY}`, url.origin));
  const syncConflict = (res: Response | null) =>
    options.afterSuccess === 'fixed' ? Promise.resolve(false) : isAccountEmailConflictResponse(res);

  const supabase = await (deps.createClient ?? createClient)();

  /** 이미 세션이 있으면 PKCE 코드 재사용·중복 요청 등으로 교환만 실패한 경우에도 성공 처리 */
  async function redirectSuccessIfSessionAlreadyPresent(): Promise<NextResponse | null> {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return null;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      const syncRes = await fetch(new URL('/api/auth/sync-profile', url.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => null);
      if (await syncConflict(syncRes)) return conflict();
    }
    return NextResponse.redirect(new URL(successPath, url.origin));
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession:', safeAuthErrorCode(error.code) ?? 'no_code');
      const recovered = await redirectSuccessIfSessionAlreadyPresent();
      if (recovered) return recovered;
      return fail('code_exchange_failed', { errorCode: error.code });
    }
    if (data.session?.access_token) {
      const syncRes = await fetch(new URL('/api/auth/sync-profile', url.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => null);
      if (await syncConflict(syncRes)) return conflict();
      return NextResponse.redirect(new URL(successPath, url.origin));
    }
    return fail('code_no_session');
  }

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (error) {
      console.error('[auth/callback] verifyOtp:', safeAuthErrorCode(error.code) ?? 'no_code');
      const recovered = await redirectSuccessIfSessionAlreadyPresent();
      if (recovered) return recovered;
      return fail('otp_failed', { errorCode: error.code });
    }
    if (data.session?.access_token) {
      const syncRes = await fetch(new URL('/api/auth/sync-profile', url.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => null);
      if (await syncConflict(syncRes)) return conflict();
      return NextResponse.redirect(new URL(successPath, url.origin));
    }
    return fail('otp_no_session');
  }

  // Provider/Supabase sent `?error=` instead of a code. Raw error_description is never read.
  const providerError = url.searchParams.get('error');
  const providerErrorCode = url.searchParams.get('error_code');
  if (providerError || providerErrorCode) {
    return fail('provider_error', { error: providerError, errorCode: providerErrorCode });
  }
  return fail('missing_params');
}
