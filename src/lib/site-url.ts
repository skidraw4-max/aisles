import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

/**
 * 이메일 인증·비밀번호 재설정 등 Supabase `redirectTo` / `emailRedirectTo`에 쓰는 공개 URL.
 *
 * 1) `NEXT_PUBLIC_SITE_URL` 이 있으면 항상 그 값(배포 환경·프리뷰 URL 명시용).
 * 2) 브라우저에서 localhost 로 가입만 해도 메일 링크가 localhost 로 가는 것을 막기 위해,
 *    env 가 없고 origin 이 localhost/127.0.0.1 이면 `getCanonicalSiteUrl()`(기본 프로덕션 도메인) 사용.
 * 3) 로컬에서 인증 메일까지 localhost 로 받고 싶으면 `.env.local` 에
 *    `NEXT_PUBLIC_SITE_URL=http://localhost:3000` 을 명시.
 */
export function getPublicSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) {
    return getCanonicalSiteUrl();
  }
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return getCanonicalSiteUrl();
    }
    return origin;
  }
  return getCanonicalSiteUrl();
}

/**
 * `resetPasswordForEmail` 의 `redirectTo`. `new URL` 로 조합해 경로가 빠지지 않게 함.
 * 메일의 verify 링크에 `redirect_to` 가 사이트 루트만 있으면 Dashboard 이메일 템플릿을 확인할 것.
 */
export function getPasswordRecoveryRedirectTo(): string {
  const explicit = process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_REDIRECT_TO?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const base = getPublicSiteUrl().replace(/\/$/, '');
  return new URL('/auth/reset-callback', `${base}/`).href;
}

/**
 * 서버(Route Handler) 전용. `window` 없이 env·canonical 만 사용 — Supabase 가 메일에 넣는 redirect_to 와 일치해야 함.
 */
export function getPasswordRecoveryRedirectToForServer(): string {
  const explicit = process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_REDIRECT_TO?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const base = getCanonicalSiteUrl();
  return new URL('/auth/reset-callback', `${base}/`).href;
}

/** Prisma 유저용: 메일의 redirect_to 에 토큰이 붙은 재설정 페이지 */
export function buildPasswordRecoveryPageUrlWithToken(token: string): string {
  const base = getCanonicalSiteUrl();
  const u = new URL('/reset-password', `${base}/`);
  u.searchParams.set('token', token);
  return u.href;
}
