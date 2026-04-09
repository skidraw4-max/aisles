/**
 * 이메일 인증·비밀번호 재설정 등 Supabase `redirectTo` / `emailRedirectTo`에 쓰는 공개 URL.
 * 프로덕션(Vercel 등)에서는 `NEXT_PUBLIC_SITE_URL=https://도메인` 필수 권장.
 * 미설정 시 브라우저 `origin` (로컬 개발).
 */
export function getPublicSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) {
    return env.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
}
