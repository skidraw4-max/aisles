import { supabaseAuthCallbackGet } from '@/lib/supabase-auth-callback';

/**
 * 비밀번호 찾기 메일의 `redirectTo` 전용. 쿼리스트링이 잘리더라도 항상 재설정 페이지로 보냄.
 */
export async function GET(request: Request) {
  return supabaseAuthCallbackGet(request, { afterSuccess: 'fixed', path: '/auth/reset-password' });
}
