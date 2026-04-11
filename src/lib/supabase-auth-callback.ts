import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

type Options =
  | { afterSuccess: 'fromNextQueryOrHome' }
  | { afterSuccess: 'fixed'; path: string };

/**
 * Supabase 이메일·PKCE 콜백 공통 처리.
 * `fixed` → 쿼리의 `next`와 무관하게 항상 `path`로 이동 (비밀번호 찾기 등, redirectTo 쿼리가 지워지는 경우 대비).
 */
export async function supabaseAuthCallbackGet(request: Request, options: Options): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next');

  const successPath =
    options.afterSuccess === 'fixed'
      ? options.path
      : nextParam?.startsWith('/')
        ? nextParam
        : '/';

  const fail = () => NextResponse.redirect(new URL('/login?error=auth_callback', url.origin));

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession:', error.message);
      return fail();
    }
    if (data.session?.access_token) {
      await fetch(new URL('/api/auth/sync-profile', url.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => {});
      return NextResponse.redirect(new URL(successPath, url.origin));
    }
    return fail();
  }

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (error) {
      console.error('[auth/callback] verifyOtp:', error.message);
      return fail();
    }
    if (data.session?.access_token) {
      await fetch(new URL('/api/auth/sync-profile', url.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => {});
      return NextResponse.redirect(new URL(successPath, url.origin));
    }
    return fail();
  }

  return fail();
}
