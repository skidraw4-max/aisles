import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Supabase 이메일 확인·매직링크 등: `emailRedirectTo`로 이 경로를 지정.
 * PKCE(`code`) 또는 구형 템플릿(`token_hash`+`type`) 모두 처리.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next');
  const next = nextParam?.startsWith('/') ? nextParam : '/';

  const fail = () => NextResponse.redirect(new URL('/login?error=auth_callback', url.origin));

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session?.access_token) {
      await fetch(new URL('/api/auth/sync-profile', url.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => {});
      return NextResponse.redirect(new URL(next, url.origin));
    }
    return fail();
  }

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error && data.session?.access_token) {
      await fetch(new URL('/api/auth/sync-profile', url.origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      }).catch(() => {});
      return NextResponse.redirect(new URL(next, url.origin));
    }
    return fail();
  }

  return fail();
}
