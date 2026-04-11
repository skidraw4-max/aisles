import type { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const EMAIL_NOT_VERIFIED_MSG =
  '이메일 인증이 완료되지 않았습니다. 가입 시 받은 메일의 링크를 눌러 인증한 뒤 다시 시도해 주세요.';

/**
 * 이메일·비밀번호 가입자는 `email_confirmed_at` 필요.
 * Google 등 OAuth는 Supabase에서 보통 즉시 확인 처리됨(`provider` ≠ `email`).
 */
export function isEmailVerifiedForApp(user: User): boolean {
  if (user.email_confirmed_at) return true;
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.some((p) => p !== 'email')) return true;
  const provider = user.app_metadata?.provider as string | undefined;
  if (provider && provider !== 'email') return true;
  return false;
}

export function jsonEmailNotVerified() {
  return NextResponse.json({ error: EMAIL_NOT_VERIFIED_MSG }, { status: 403 });
}

export { EMAIL_NOT_VERIFIED_MSG };
