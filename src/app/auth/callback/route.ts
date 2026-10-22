import { supabaseAuthCallbackGet } from '@/lib/supabase-auth-callback';

/**
 * Supabase 이메일 확인·매직링크 등: `emailRedirectTo` 로 이 경로를 지정.
 * 비밀번호 찾기는 `/auth/reset-callback` 사용(쿼리가 잘려도 재설정 페이지로 고정).
 */
export async function GET(request: Request) {
  return supabaseAuthCallbackGet(request, { afterSuccess: 'fromNextQueryOrHome' });
}
